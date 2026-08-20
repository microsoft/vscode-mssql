#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { repositoryIdentity } from "./support/repository-identity.mjs";

const require = createRequire(import.meta.url);
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    SourceMappedColorizationService,
    SourceMappedFeatureService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
} = require("../dist/index.js");
const { createNodeWorkerClient } = require("../dist/worker/node/client.js");

const options = parseArguments(process.argv.slice(2));
const samples = integerOption(options.samples, 10);
const warmups = integerOption(options.warmups, 3);
const documentBytes = integerOption(options["document-kb"], 64) * 1024;
const catalogObjectCount = integerOption(options["catalog-objects"], 57_885);
const memoryDocuments = integerOption(options["memory-documents"], 8);
const seed = integerOption(options.seed, 0x5eed2026);
const corpora = corpusNames(options.corpora);
let nextFixtureId = 1;

const catalog = createCatalog(catalogObjectCount);
const catalogBuild = await timedAsync(async () => createMetadata(catalog));
const sharedMetadata = catalogBuild.value;
const lanes = [];
for (const corpusName of corpora) {
    const sql = generateCorpus(corpusName, documentBytes);
    lanes.push(runtimeLifecycleLane(corpusName, sql, "open"));
    lanes.push(runtimeLifecycleLane(corpusName, sql, "edit"));
    lanes.push(runtimeLifecycleLane(corpusName, sql, "rebind"));
    lanes.push(runtimeLifecycleLane(corpusName, sql, "refresh-rebind"));
    for (const feature of [
        "completion",
        "hover",
        "diagnostics",
        "definition",
        "signature",
        "coloring",
    ]) {
        lanes.push(firstFeatureLane(corpusName, sql, feature, "open"));
        lanes.push(firstFeatureLane(corpusName, sql, feature, "edit"));
        lanes.push(firstFeatureLane(corpusName, sql, feature, "rebind"));
        lanes.push(firstFeatureLane(corpusName, sql, feature, "refresh-rebind"));
        lanes.push(warmFeatureLane(corpusName, sql, feature));
    }
}
lanes.push(metadataRefreshLane());
lanes.push(sourceMappingLane());

const measurements = new Map(lanes.map((lane) => [lane.name, []]));
const random = seededRandom(seed);
for (let iteration = -warmups; iteration < samples; iteration++) {
    for (const lane of shuffle(lanes, random)) {
        const elapsed = await lane.run();
        if (iteration >= 0) measurements.get(lane.name).push(elapsed);
    }
}

const rows = lanes.map((lane) => ({
    lane: lane.name,
    ...distribution(measurements.get(lane.name)),
}));
const hostHeartbeat = await hostHeartbeatMeasurements();
const worker = options["skip-worker"] ? undefined : await workerMeasurements();
const memory = options["skip-memory"]
    ? { state: "skipped", reason: "--skip-memory" }
    : typeof global.gc !== "function"
      ? { state: "notCollected", reason: "run Node with --expose-gc" }
      : await catalogMemoryMeasurements();
const repository = await repositoryIdentity(process.cwd());
const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    commit: repository.commit,
    repository,
    runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model ?? "unknown",
        logicalCpus: os.cpus().length,
        totalMemoryMiB: round(os.totalmem() / 1024 / 1024),
    },
    configuration: {
        samples,
        warmups,
        seed,
        documentBytes,
        catalogObjectCount,
        memoryDocuments,
        corpora,
    },
    catalogBuildMs: round(catalogBuild.elapsedMs),
    featureLanes: rows,
    hostHeartbeat,
    worker,
    memory,
};

console.log(
    `Language-service lifecycle: ${catalogObjectCount.toLocaleString()} objects, ` +
        `${(documentBytes / 1024).toFixed(0)} KiB documents, ${samples} samples after ${warmups} warmups.`,
);
console.table(rows);
console.table(hostHeartbeat.rows);
if (worker) console.table(worker.rows);
console.log("Catalog memory:", memory);
if (options.json) {
    await writeFile(options.json, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
    console.log(`Wrote ${options.json}`);
}

function firstFeatureLane(corpusName, sql, feature, state) {
    return {
        name: `${corpusName}/${state}/first-${feature}`,
        async run() {
            const fixture = await createFixture(sql, `${corpusName}-${feature}-${state}`);
            try {
                if (state === "edit") await applyFixedWidthEdit(fixture);
                if (state === "rebind") await fixture.runtime.rebind(fixture.uri, fixture.version);
                if (state === "refresh-rebind") {
                    await fixture.metadata.refresh();
                    await fixture.runtime.rebind(fixture.uri, fixture.version);
                }
                const measured = timed(() => invokeFeature(fixture, feature));
                // Correctness is checked after timing. A repeated request over an immutable
                // snapshot must be identical, and an incremental edit must match a fresh open.
                const expected = summarize(invokeFeature(fixture, feature));
                assertEqualSummary(summarize(measured.value), expected, `${feature}/${state}`);
                if (state === "edit") await assertFreshEquivalent(fixture, feature);
                return measured.elapsedMs;
            } finally {
                await fixture.runtime.close(fixture.uri);
            }
        },
    };
}

function runtimeLifecycleLane(corpusName, sql, state) {
    return {
        name: `${corpusName}/runtime-${state}`,
        async run() {
            if (state === "open") {
                const uri = `benchmark:/${corpusName}-runtime-open-${nextFixtureId++}.sql`;
                const runtime = new InProcessLanguageServiceRuntime(
                    new LezerSyntaxService(),
                    new CatalogSemanticBinder(),
                    sharedMetadata,
                );
                const measured = await timedAsync(() => runtime.open(uri, 1, sql));
                await runtime.close(uri);
                return measured.elapsedMs;
            }
            const fixture = await createFixture(sql, `${corpusName}-runtime-${state}`);
            try {
                if (state === "edit")
                    return (await timedAsync(() => applyFixedWidthEdit(fixture))).elapsedMs;
                if (state === "rebind") {
                    return (
                        await timedAsync(() => fixture.runtime.rebind(fixture.uri, fixture.version))
                    ).elapsedMs;
                }
                return (
                    await timedAsync(async () => {
                        await fixture.metadata.refresh();
                        await fixture.runtime.rebind(fixture.uri, fixture.version);
                    })
                ).elapsedMs;
            } finally {
                await fixture.runtime.close(fixture.uri);
            }
        },
    };
}

function warmFeatureLane(corpusName, sql, feature) {
    let fixture;
    return {
        name: `${corpusName}/warm/${feature}`,
        async run() {
            fixture ??= await createFixture(sql, `${corpusName}-${feature}-warm`);
            invokeFeature(fixture, feature);
            const measured = timed(() => invokeFeature(fixture, feature));
            return measured.elapsedMs;
        },
    };
}

function metadataRefreshLane() {
    const metadata = createMetadata(catalog);
    return {
        name: "catalog/metadata-refresh",
        async run() {
            return (await timedAsync(() => metadata.refresh())).elapsedMs;
        },
    };
}

function sourceMappingLane() {
    const sql = `:setvar object Table000001\nSELECT * FROM dbo.$(object);\nSELECT * FROM dbo.`;
    let fixture;
    return {
        name: "source-map/completion-wrapper",
        async run() {
            fixture ??= await createFixture(sql, "source-map");
            const sourceOffset = sql.length;
            const projectedOffset = fixture
                .snapshot()
                .projection.toProjected(fixture.uri, sourceOffset);
            if (projectedOffset === undefined)
                throw new Error("source completion marker was unmapped");
            const direct = fixture.inner.completion(fixture.uri, fixture.version, projectedOffset);
            const measured = timed(() =>
                fixture.features.completion(fixture.uri, fixture.version, sourceOffset),
            );
            assertEqualSummary(
                JSON.stringify(measured.value.items.map((item) => item.label)),
                JSON.stringify(direct.items.map((item) => item.label)),
                "source mapping",
            );
            return measured.elapsedMs;
        },
    };
}

async function createFixture(sql, name, metadata = sharedMetadata) {
    const uri = `benchmark:/${name}-${nextFixtureId++}.sql`;
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    let version = 1;
    await runtime.open(uri, version, sql);
    const inner = new TsqlLanguageFeatureService(runtime, metadata);
    return {
        uri,
        runtime,
        metadata,
        inner,
        features: new SourceMappedFeatureService(inner, runtime),
        colors: new SourceMappedColorizationService(new TsqlColorizationService()),
        get version() {
            return version;
        },
        set version(value) {
            version = value;
        },
        get sql() {
            return sql;
        },
        set sql(value) {
            sql = value;
        },
        snapshot() {
            return runtime.snapshot(uri, version);
        },
    };
}

async function applyFixedWidthEdit(fixture) {
    const marker = "/* edit-marker */ 1";
    const start = fixture.sql.indexOf(marker) + marker.length - 1;
    if (start < marker.length - 1) throw new Error("edit marker missing");
    fixture.version++;
    fixture.sql = `${fixture.sql.slice(0, start)}2${fixture.sql.slice(start + 1)}`;
    await fixture.runtime.change(fixture.uri, fixture.version - 1, fixture.version, [
        { start, end: start + 1, text: "2" },
    ]);
}

function invokeFeature(fixture, feature) {
    const sql = fixture.sql;
    const version = fixture.version;
    if (feature === "completion") {
        return fixture.features.completion(fixture.uri, version, sql.length);
    }
    if (feature === "hover") {
        const offset = sql.lastIndexOf("Table000001") + 2;
        return fixture.features.hover(fixture.uri, version, offset);
    }
    if (feature === "diagnostics") return fixture.features.diagnostics(fixture.uri, version);
    if (feature === "definition") {
        const offset = sql.lastIndexOf("@benchmarkValue") + 2;
        return fixture.features.definitionTarget(fixture.uri, version, offset);
    }
    if (feature === "signature") {
        const offset = sql.lastIndexOf("JSON_VALUE(") + "JSON_VALUE(".length;
        return fixture.features.signatureHelp(fixture.uri, version, offset);
    }
    if (feature === "coloring") return fixture.colors.provideDocumentColors(fixture.snapshot());
    throw new Error(`Unknown feature ${feature}`);
}

async function assertFreshEquivalent(fixture, feature) {
    const fresh = await createFixture(fixture.sql, "fresh-equivalence", fixture.metadata);
    try {
        assertEqualSummary(
            summarize(invokeFeature(fixture, feature)),
            summarize(invokeFeature(fresh, feature)),
            `${feature}/incremental-fresh`,
        );
    } finally {
        await fresh.runtime.close(fresh.uri);
    }
}

async function workerMeasurements() {
    const sql = generateCorpus("many-batches", documentBytes);
    const workerSamples = Math.max(3, Math.min(samples, 10));
    const rows = [];
    for (const operation of ["open", "edit", "completion"]) {
        const elapsed = [];
        const heartbeat = [];
        for (let index = 0; index < workerSamples; index++) {
            const client = createNodeWorkerClient();
            const uri = `benchmark:/worker-${operation}-${index}.sql`;
            try {
                if (operation !== "open") await client.open(uri, 1, sql);
                const measured = await timedWithHeartbeat(async () => {
                    if (operation === "open") return client.open(uri, 1, sql);
                    if (operation === "edit") {
                        const start =
                            sql.indexOf("/* edit-marker */ 1") + "/* edit-marker */ ".length;
                        return client.change(uri, 2, [{ start, end: start + 1, text: "2" }]);
                    }
                    return client.completion(uri, sql.length);
                });
                elapsed.push(measured.elapsedMs);
                heartbeat.push(measured.heartbeatDelayMs);
            } finally {
                await client.dispose();
            }
        }
        rows.push({
            lane: `worker/${operation}`,
            ...distribution(elapsed),
            heartbeatP95Ms: round(percentile(heartbeat, 0.95)),
        });
    }
    return { samples: workerSamples, rows };
}

/**
 * Measures extension-host responsiveness when the in-process preview route performs heavy work.
 * The zero-delay timer is the heartbeat: synchronous parse/bind/feature work delays it by exactly
 * the amount the VS Code extension host would be unable to process another event. The Node-worker
 * table below uses the same measurement, making the trade-off directly comparable.
 */
async function hostHeartbeatMeasurements() {
    const sql = generateCorpus("many-batches", documentBytes);
    const heartbeatSamples = Math.max(3, Math.min(samples, 10));
    const rows = [];
    for (const operation of ["open", "edit", "completion"]) {
        const elapsed = [];
        const heartbeat = [];
        for (let index = 0; index < heartbeatSamples; index++) {
            let fixture;
            try {
                if (operation !== "open") {
                    fixture = await createFixture(sql, `host-${operation}-${index}`);
                }
                const measured = await timedWithHeartbeat(async () => {
                    if (operation === "open") {
                        fixture = await createFixture(sql, `host-${operation}-${index}`);
                        return fixture;
                    }
                    if (operation === "edit") return applyFixedWidthEdit(fixture);
                    return invokeFeature(fixture, "completion");
                });
                elapsed.push(measured.elapsedMs);
                heartbeat.push(measured.heartbeatDelayMs);
                if (operation === "completion") invokeFeature(fixture, "completion");
            } finally {
                if (fixture) await fixture.runtime.close(fixture.uri);
            }
        }
        rows.push({
            lane: `extension-host/${operation}`,
            ...distribution(elapsed),
            heartbeatP95Ms: round(percentile(heartbeat, 0.95)),
        });
    }
    return { samples: heartbeatSamples, rows };
}

async function catalogMemoryMeasurements() {
    const shared = await retainedCatalogHeap(true);
    const perDocument = await retainedCatalogHeap(false);
    return {
        state: "collected",
        documents: memoryDocuments,
        sharedCatalogMiB: round(shared / 1024 / 1024),
        perDocumentCatalogMiB: round(perDocument / 1024 / 1024),
        duplicatedCatalogMiB: round((perDocument - shared) / 1024 / 1024),
    };
}

async function retainedCatalogHeap(shared) {
    forceGc();
    const before = process.memoryUsage().heapUsed;
    const provider = shared ? createMetadata(createCatalog(catalogObjectCount)) : undefined;
    const fixtures = [];
    for (let index = 0; index < memoryDocuments; index++) {
        fixtures.push(
            await createFixture(
                generateCorpus("many-batches", Math.min(documentBytes, 32 * 1024)),
                `${shared ? "shared" : "private"}-memory-${index}`,
                provider ?? createMetadata(createCatalog(catalogObjectCount)),
            ),
        );
    }
    forceGc();
    const retained = Math.max(0, process.memoryUsage().heapUsed - before);
    for (const fixture of fixtures) await fixture.runtime.close(fixture.uri);
    return retained;
}

function createCatalog(count) {
    const schemaCounts = [
        ["dbo", Math.floor(count * 0.624)],
        ["SCHEMA_A", Math.floor(count * 0.309)],
        ["SCHEMA_B", Math.floor(count * 0.066)],
    ];
    const objects = [];
    let ordinal = 0;
    for (const [schema, schemaCount] of schemaCounts) {
        for (let index = 0; index < schemaCount; index++, ordinal++) {
            objects.push({
                ref: { id: `object:${ordinal}`, database: "CustomerDb" },
                database: "CustomerDb",
                schema,
                name: `Table${index.toString().padStart(6, "0")}`,
                kind: "table",
            });
        }
    }
    while (objects.length < count) {
        const index = objects.length;
        objects.push({
            ref: { id: `object:${index}`, database: "CustomerDb" },
            database: "CustomerDb",
            schema: "sys",
            name: `SystemObject${index.toString().padStart(6, "0")}`,
            kind: "view",
            system: true,
        });
    }
    return objects;
}

function createMetadata(objects) {
    const target = objects.find(
        (object) => object.schema === "dbo" && object.name === "Table000001",
    );
    if (!target) throw new Error("benchmark target object missing");
    return new InMemoryMetadataProvider({
        environment: {
            currentDatabase: "CustomerDb",
            defaultSchema: "dbo",
            caseSensitive: false,
        },
        databases: [{ name: "CustomerDb" }],
        schemas: ["dbo", "SCHEMA_A", "SCHEMA_B", "sys"].map((name) => ({
            database: "CustomerDb",
            name,
        })),
        objects,
        columns: new Map([
            [
                target.ref.id,
                Array.from({ length: 48 }, (_, index) => ({
                    name: index === 0 ? "Id" : `Column${index.toString().padStart(2, "0")}`,
                    typeDisplay: index % 3 === 0 ? "nvarchar(100)" : "int",
                    nullable: index % 5 !== 0,
                })),
            ],
        ]),
    });
}

function generateCorpus(kind, bytes) {
    const tail = `\n/* edit-marker */ 1;\nDECLARE @benchmarkValue int = 1;\nSELECT JSON_VALUE(N'{"id":1}', '$.id') AS JsonId;\nSELECT * FROM dbo.Table000001 WHERE Id = @benchmarkValue;\nSELECT * FROM dbo.`;
    const statements = {
        "one-large-batch":
            "SELECT o.Id, COUNT_BIG(*) AS Total FROM dbo.Table000001 AS o WHERE o.Id > 0 GROUP BY o.Id ORDER BY o.Id;\n",
        "many-batches":
            "SELECT o.Id, o.Column01 FROM dbo.Table000001 AS o WHERE o.Id > 0 ORDER BY o.Id;\nGO\n",
        malformed:
            "SELECT o. FROM dbo.Table000001 AS o WHERE (o.Id = ;\nINSERT INTO dbo.Table000001 (Id, Column01 VALUES (1, N'x');\nGO\n",
        unicode:
            "DECLARE @résultat nvarchar(40)=N'東京🚀'; SELECT @résultat, [Column01] FROM [dbo].[Table000001];\nGO\n",
        realistic:
            "WITH Recent AS (SELECT TOP (20) Id, Column01 FROM dbo.Table000001 WHERE Id > 0 ORDER BY Id DESC) SELECT r.Id, JSON_VALUE(N'{\"ok\":true}', '$.ok') FROM Recent AS r;\nGO\n",
    }[kind];
    if (!statements) throw new Error(`Unknown corpus '${kind}'.`);
    let result = "";
    while (
        Buffer.byteLength(result) + Buffer.byteLength(statements) + Buffer.byteLength(tail) <=
        bytes
    ) {
        result += statements;
    }
    return result + tail;
}

function summarize(value) {
    return JSON.stringify(value, (key, item) => {
        if (key === "uri") return "<document>";
        if (key === "resultId") return "<result>";
        if (key === "documentVersion") return "<version>";
        if (item instanceof Uint32Array) return [...item];
        if (Array.isArray(item) && item.length > 200) {
            return { count: item.length, first: item[0], last: item.at(-1) };
        }
        return item;
    });
}

function assertEqualSummary(actual, expected, label) {
    if (actual !== expected) throw new Error(`${label} correctness mismatch outside timed region`);
}

function timed(action) {
    const started = performance.now();
    const value = action();
    return { elapsedMs: performance.now() - started, value };
}

async function timedAsync(action) {
    const started = performance.now();
    const value = await action();
    return { elapsedMs: performance.now() - started, value };
}

async function timedWithHeartbeat(action) {
    const scheduled = performance.now();
    const heartbeat = new Promise((resolve) =>
        setTimeout(() => resolve(performance.now() - scheduled), 0),
    );
    const measured = timedAsync(action);
    const [result, heartbeatDelayMs] = await Promise.all([measured, heartbeat]);
    return { ...result, heartbeatDelayMs };
}

function distribution(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return {
        p50Ms: round(percentile(values, 0.5)),
        p95Ms: round(percentile(values, 0.95)),
        meanMs: round(mean),
        stddevMs: round(Math.sqrt(variance)),
        minMs: round(Math.min(...values)),
        maxMs: round(Math.max(...values)),
    };
}

function percentile(values, quantile) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function shuffle(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const selected = Math.floor(random() * (index + 1));
        [result[index], result[selected]] = [result[selected], result[index]];
    }
    return result;
}

function seededRandom(seedValue) {
    let state = seedValue >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
}

function forceGc() {
    for (let index = 0; index < 3; index++) global.gc();
}

function corpusNames(value) {
    const selected = (value ?? "many-batches,malformed,unicode,realistic")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const supported = new Set([
        "one-large-batch",
        "many-batches",
        "malformed",
        "unicode",
        "realistic",
    ]);
    for (const name of selected) {
        if (!supported.has(name)) throw new Error(`Unknown corpus '${name}'.`);
    }
    return selected;
}

function integerOption(value, fallback) {
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error(`Invalid positive integer '${value}'.`);
    return parsed;
}

function parseArguments(args) {
    const result = {};
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (!argument.startsWith("--")) throw new Error(`Unexpected argument '${argument}'.`);
        const key = argument.slice(2);
        if (key === "skip-worker" || key === "skip-memory") result[key] = true;
        else result[key] = args[++index];
    }
    return result;
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
