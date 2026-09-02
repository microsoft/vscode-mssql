#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Measures the cost the dialect layer adds.
 *
 * Four lanes, each with a control so a regression is attributable:
 *  - profile resolution and capability construction, which every connection change pays;
 *  - availability validation, measured as parse time with and without a gating profile;
 *  - SQLCMD projection, measured against SQL-only text so an ordinary script's overhead is visible;
 *  - profile-only rebinding, which must reuse the parse rather than repeat it.
 *
 * Usage: node --expose-gc benchmarks/dialect.mjs [--sizes 100k,1m,10m] [--json]
 */

import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    SqlCmdDocumentService,
    MemorySqlCmdIncludeStore,
    createEngineCapabilities,
} = require("../dist/index.js");

const sizes = parseSizes(argumentValue("--sizes") ?? "100k,1m,10m");
const warmups = Number(argumentValue("--warmups") ?? 3);
const samples = Number(argumentValue("--samples") ?? 7);

const profiles = {
    unknown: { engineProfile: "unknown", previewFeatures: false },
    "sql-server": {
        engineProfile: "sql-server",
        serverMajorVersion: 17,
        compatibilityLevel: 170,
        previewFeatures: false,
    },
    "azure-sql-database": {
        engineProfile: "azure-sql-database",
        serverMajorVersion: 17,
        compatibilityLevel: 170,
        previewFeatures: false,
    },
};

const report = {
    machine: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: (await import("node:os")).cpus().length,
    },
    profileResolution: measureProfileResolution(),
    availability: [],
    sqlcmd: [],
    rebind: [],
};

for (const size of sizes) {
    const sql = generateSql(size.bytes);
    report.availability.push(measureAvailability(size.label, sql));
    report.sqlcmd.push(measureSqlCmd(size.label, sql));
    report.rebind.push(await measureRebind(size.label, sql));
}

if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    print(report);
}

function measureProfileResolution() {
    const facts = [
        { engineEdition: 3, serverVersion: "16.0.4085.2", compatibilityLevel: 160 },
        { engineEdition: 5, compatibilityLevel: 170 },
        { engineEdition: 8, compatibilityLevel: 160 },
        { engineEdition: 6 },
        { engineEdition: 11, serverName: "ws.datawarehouse.fabric.microsoft.com" },
        {},
    ];
    const iterations = 20_000;
    const timings = repeat(() => {
        for (let index = 0; index < iterations; index++) {
            createEngineCapabilities(facts[index % facts.length]);
        }
    });
    return {
        iterations,
        ...summarize(timings),
        nanosecondsPerResolution: (median(timings) * 1e6) / iterations,
    };
}

function measureAvailability(label, sql) {
    const document = new ImmutableTextSnapshot("bench:/dialect.sql", 1, sql);
    const lanes = {};
    for (const [name, profile] of Object.entries(profiles)) {
        const service = new LezerSyntaxService(undefined, profile);
        lanes[name] = summarize(repeat(() => service.parse(document)));
    }
    const control = median(lanes.unknown.samples);
    return {
        size: label,
        bytes: sql.length,
        lanes,
        // The gating profile does the availability work the unknown profile defers.
        overheadPercent: percentChange(control, median(lanes["azure-sql-database"].samples)),
    };
}

function measureSqlCmd(label, sql) {
    const documents = new SqlCmdDocumentService({
        includes: new MemorySqlCmdIncludeStore([
            ["file:///bench/include.sql", "SELECT include_marker;\n"],
        ]),
    });
    const syntax = new LezerSyntaxService(undefined, profiles["sql-server"]);
    // The control is what a host pays today: parsing the text with no SQLCMD layer at all.
    const parseOnly = summarize(
        repeat(() => syntax.parse(new ImmutableTextSnapshot("bench:/plain.sql", 1, sql))),
    );
    // The measured lane is the whole pipeline a SQLCMD-aware host runs over the same SQL-only text.
    const projectedThenParsed = summarize(
        repeat(() => {
            const projection = documents.parse("file:///bench/plain.sql", 1, sql);
            syntax.parse(new ImmutableTextSnapshot("bench:/plain.sql", 1, projection.projectedSql));
        }),
    );
    const plain = summarize(repeat(() => documents.parse("file:///bench/plain.sql", 1, sql)));
    const directives = [
        ":setvar schema dbo",
        ":setvar env production",
        ":r include.sql",
        ":connect srv1",
        "",
    ].join("\n");
    const decorated = `${directives}${sql.replaceAll("dbo.", "$(schema).")}`;
    const withDirectives = summarize(
        repeat(() => documents.parse("file:///bench/sqlcmd.sql", 1, decorated)),
    );
    const first = documents.parse("file:///bench/sqlcmd.sql", 1, decorated);
    const editOffset = decorated.length - 12;
    const edit = { start: editOffset, end: editOffset, text: " " };
    const edited = decorated.slice(0, editOffset) + " " + decorated.slice(editOffset);
    const incremental = summarize(repeat(() => documents.update(first, 2, edited, [edit])));
    return {
        size: label,
        bytes: sql.length,
        parseOnly,
        projectedThenParsed,
        plain,
        withDirectives,
        incremental,
        // A SQL-only document must pay no material SQLCMD cost: the whole projected pipeline is
        // compared with the bare parse the host would have run anyway.
        plainOverheadPercent: percentChange(
            median(parseOnly.samples),
            median(projectedThenParsed.samples),
        ),
        directiveOverheadPercent: percentChange(
            median(plain.samples),
            median(withDirectives.samples),
        ),
        incrementalSpeedupPercent: percentChange(
            median(withDirectives.samples),
            median(incremental.samples),
        ),
    };
}

async function measureRebind(label, sql) {
    const metadata = new InMemoryMetadataProvider({
        environment: { currentDatabase: "warehouse", defaultSchema: "dbo", caseSensitive: false },
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, profiles.unknown),
        new CatalogSemanticBinder(),
        metadata,
    );
    const uri = "bench:/rebind.sql";
    await runtime.open(uri, 1, sql);
    const facts = [{ engineEdition: 5 }, { engineEdition: 8 }];
    const timings = [];
    for (let index = 0; index < warmups + samples; index++) {
        const started = performance.now();
        await runtime.setEngineFacts(facts[index % facts.length]);
        const elapsed = performance.now() - started;
        if (index >= warmups) timings.push(elapsed);
    }
    await runtime.close(uri);
    return { size: label, bytes: sql.length, ...summarize(timings) };
}

function repeat(action) {
    const timings = [];
    for (let index = 0; index < warmups + samples; index++) {
        globalThis.gc?.();
        const started = performance.now();
        action();
        const elapsed = performance.now() - started;
        if (index >= warmups) timings.push(elapsed);
    }
    return timings;
}

function summarize(timings) {
    const sorted = [...timings].sort((left, right) => left - right);
    return {
        samples: sorted,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minimumMs: sorted[0] ?? 0,
        maximumMs: sorted.at(-1) ?? 0,
    };
}

function median(value) {
    const sorted = Array.isArray(value) ? [...value].sort((a, b) => a - b) : value.samples;
    return percentile(sorted, 0.5);
}

function percentile(sorted, fraction) {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
    return sorted[index];
}

function percentChange(control, measured) {
    return control === 0 ? 0 : ((measured - control) / control) * 100;
}

function generateSql(bytes) {
    const statement = [
        "SELECT c.CustomerID, c.Name, o.OrderID",
        "FROM dbo.Customers AS c",
        "    INNER JOIN dbo.Orders AS o ON o.CustomerID = c.CustomerID",
        "WHERE c.Name LIKE N'A%'",
        "ORDER BY c.CustomerID;",
        "GO",
        "",
    ].join("\n");
    const parts = [];
    let length = 0;
    while (length < bytes) {
        parts.push(statement);
        length += statement.length;
    }
    return parts.join("");
}

function parseSizes(value) {
    return value.split(",").map((entry) => {
        const trimmed = entry.trim().toLowerCase();
        const multiplier = trimmed.endsWith("m") ? 1024 * 1024 : trimmed.endsWith("k") ? 1024 : 1;
        return { label: trimmed, bytes: Number.parseFloat(trimmed) * multiplier };
    });
}

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function print(value) {
    console.log("T-SQL dialect benchmarks");
    console.log(
        `Machine: node ${value.machine.node} ${value.machine.platform}/${value.machine.arch}, ${value.machine.cpus} CPUs`,
    );
    console.log(
        `Profile resolution: ${value.profileResolution.nanosecondsPerResolution.toFixed(0)} ns each ` +
            `(p50 ${value.profileResolution.p50Ms.toFixed(2)} ms for ${value.profileResolution.iterations})`,
    );
    for (const entry of value.availability) {
        console.log(
            `Availability ${entry.size} (${entry.bytes} chars): ` +
                Object.entries(entry.lanes)
                    .map(([name, lane]) => `${name} p50 ${lane.p50Ms.toFixed(1)} ms`)
                    .join(", ") +
                ` — gating overhead ${entry.overheadPercent.toFixed(1)}%`,
        );
    }
    for (const entry of value.sqlcmd) {
        console.log(
            `SQLCMD ${entry.size}: SQL-only pipeline overhead ${entry.plainOverheadPercent.toFixed(1)}% ` +
                `(parse ${entry.parseOnly.p50Ms.toFixed(1)} ms vs ${entry.projectedThenParsed.p50Ms.toFixed(1)} ms), ` +
                `projection p50 ${entry.plain.p50Ms.toFixed(1)} ms, ` +
                `with directives p50 ${entry.withDirectives.p50Ms.toFixed(1)} ms ` +
                `(${entry.directiveOverheadPercent.toFixed(1)}%), ` +
                `incremental p50 ${entry.incremental.p50Ms.toFixed(1)} ms ` +
                `(${entry.incrementalSpeedupPercent.toFixed(1)}%)`,
        );
    }
    for (const entry of value.rebind) {
        console.log(
            `Profile-only rebind ${entry.size}: p50 ${entry.p50Ms.toFixed(1)} ms, p95 ${entry.p95Ms.toFixed(1)} ms`,
        );
    }
}
