#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Measures only SemanticBinder.bind(). Parsing and metadata construction are completed before the
// timed loop so future diagnostic batches can detect binder regressions without parser noise.

import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    LezerSyntaxService,
} = require("../dist/index.js");

const warmups = numberOption("--warmups", 10);
const samples = numberOption("--samples", 40);
const statementCount = numberOption("--statements", 100);
const metadata = createMetadata(statementCount).pin();
const syntaxService = new LezerSyntaxService();
const lanes = [
    ["local scalar statements", localSql(statementCount)],
    ["resolved catalog selects", catalogSql(statementCount, false)],
    ["missing-object diagnostics", catalogSql(statementCount, true)],
];

console.log(
    `direct semantic bind, ${warmups} warmups + ${samples} samples, ` +
        `${statementCount} statements per document`,
);
for (const [label, text] of lanes) {
    const document = new ImmutableTextSnapshot(
        `benchmark:/${label.replaceAll(" ", "-")}.sql`,
        1,
        text,
    );
    const syntax = syntaxService.parse(document);
    if (syntax.diagnostics.length !== 0) {
        throw new Error(`${label} generated ${syntax.diagnostics.length} syntax diagnostics`);
    }
    const result = measureBind(syntax);
    console.log(
        `${label.padEnd(30)} wall p50 ${format(result.wall.p50)}  p95 ${format(result.wall.p95)}  ` +
            `binder p50 ${format(result.internal.p50)}  p95 ${format(result.internal.p95)}  ` +
            `${result.diagnostics} diagnostics`,
    );
}

function measureBind(syntax) {
    const binder = new CatalogSemanticBinder();
    const wall = [];
    const internal = [];
    let diagnostics = 0;
    for (let index = 0; index < warmups + samples; index++) {
        const started = performance.now();
        const snapshot = binder.bind({ syntax, metadata });
        const elapsed = performance.now() - started;
        diagnostics = snapshot.diagnostics.length;
        if (index >= warmups) {
            wall.push(elapsed);
            internal.push(snapshot.statistics.elapsedMs);
        }
    }
    return { wall: statistics(wall), internal: statistics(internal), diagnostics };
}

function createMetadata(count) {
    const objects = [];
    const columns = new Map();
    for (let index = 0; index < count; index++) {
        const id = `table:${index}`;
        objects.push({
            ref: { id, database: "benchmark" },
            database: "benchmark",
            schema: "dbo",
            name: `Table${index}`,
            kind: "table",
        });
        columns.set(id, [
            { name: "Id", typeDisplay: "int", nullable: false },
            { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
        ]);
    }
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "benchmark", defaultSchema: "dbo" },
        databases: [{ name: "benchmark" }],
        schemas: [{ database: "benchmark", name: "dbo" }],
        objects,
        columns,
    });
}

function localSql(count) {
    return Array.from(
        { length: count },
        (_, index) => `DECLARE @value${index} int = ${index}; SELECT @value${index};`,
    ).join("\n");
}

function catalogSql(count, missing) {
    return Array.from(
        { length: count },
        (_, index) => `SELECT t.Id, t.Name FROM dbo.${missing ? "Missing" : "Table"}${index} AS t;`,
    ).join("\n");
}

function statistics(values) {
    values.sort((left, right) => left - right);
    return {
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
    };
}

function numberOption(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    const value = Number(process.argv[index + 1]);
    if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${name} must be a positive integer`);
    return value;
}

function format(value) {
    return `${value.toFixed(2)} ms`;
}
