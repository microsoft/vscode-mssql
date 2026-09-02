#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} = require("../dist/index.js");

const catalogStarted = performance.now();
const objects = [
    ...objectsFor("dbo", 36_119),
    ...objectsFor("SCHEMA_A", 17_874),
    ...objectsFor("SCHEMA_B", 3_802),
    ...objectsFor("sys", 90, true),
];
const target = objects.find((object) => object.schema === "dbo" && object.name === "Table036118");
const columns = Array.from({ length: 80 }, (_, index) => ({
    name: `Column${index.toString().padStart(3, "0")}`,
    typeDisplay: index % 3 === 0 ? "nvarchar(100)" : "int",
    nullable: index % 5 !== 0,
    identity: index === 0,
    computed: index === 79,
}));
const metadata = new InMemoryMetadataProvider({
    environment: { currentDatabase: "CustomerDb", defaultSchema: "dbo", caseSensitive: false },
    schemas: ["sys", "SCHEMA_B", "dbo", "SCHEMA_A", "db_accessadmin"].map((name) => ({
        database: "CustomerDb",
        name,
    })),
    objects,
    // Production metadata is detail-lazy. Only the objects exercised by feature requests are loaded.
    columns: new Map([[target.ref.id, columns]]),
});
const catalogBuildMs = performance.now() - catalogStarted;
const runtime = new InProcessLanguageServiceRuntime(
    new LezerSyntaxService(),
    new CatalogSemanticBinder(),
    metadata,
);
const features = new TsqlLanguageFeatureService(runtime, metadata);

const scenarios = [
    ["schema-root", "SELECT * FROM ", (sql) => sql.length],
    ["dbo-empty-prefix", "SELECT * FROM dbo.", (sql) => sql.length],
    ["dbo-narrow-prefix", "SELECT * FROM dbo.Table036118", (sql) => sql.length],
    ["cross-schema-prefix", "SELECT * FROM SCHEMA_A.Table017873", (sql) => sql.length],
    ["alias-columns", "SELECT t. FROM dbo.Table036118 AS t;", (sql) => sql.indexOf("t.") + 2],
    ["select-star-expansion", "SELECT * FROM dbo.Table036118;", (sql) => sql.indexOf("*") + 1],
    ["insert-expansion", "INSERT INTO dbo.Table036118", (sql) => sql.length],
];

const rows = [];
for (const [name, sql, offset] of scenarios) {
    const uri = `benchmark:/${name}.sql`;
    const open = await measureAsync(() => runtime.open(uri, 1, sql));
    for (let index = 0; index < 5; index++) features.completion(uri, 1, offset(sql));
    const samples = [];
    let itemCount = 0;
    let incomplete = false;
    for (let index = 0; index < 30; index++) {
        const measured = measure(() => features.completion(uri, 1, offset(sql)));
        samples.push(measured.elapsedMs);
        itemCount = measured.value.items.length;
        incomplete = measured.value.incomplete;
    }
    rows.push({
        scenario: name,
        catalogObjects: objects.length,
        openAndBindMs: round(open.elapsedMs),
        completionP50Ms: round(percentile(samples, 0.5)),
        completionP95Ms: round(percentile(samples, 0.95)),
        items: itemCount,
        incomplete,
    });
}

console.log(
    `Catalog: ${objects.length.toLocaleString()} objects across five schemas; ` +
        `indexed in ${catalogBuildMs.toFixed(2)} ms; RSS ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MiB`,
);
console.table(rows);

function objectsFor(schema, count, system = false) {
    return Array.from({ length: count }, (_, index) => ({
        ref: { id: `${schema}:${index}`, database: "CustomerDb" },
        database: "CustomerDb",
        schema,
        name: `${system ? "SystemObject" : "Table"}${index.toString().padStart(6, "0")}`,
        kind: system ? "view" : "table",
        system: system || undefined,
    }));
}

function measure(action) {
    const started = performance.now();
    const value = action();
    return { elapsedMs: performance.now() - started, value };
}

async function measureAsync(action) {
    const started = performance.now();
    const value = await action();
    return { elapsedMs: performance.now() - started, value };
}

function percentile(values, quantile) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
