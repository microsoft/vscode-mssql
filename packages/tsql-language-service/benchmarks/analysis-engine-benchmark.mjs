#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integrated SaralSqlAnalysisEngine benchmark.
 *
 * This intentionally measures the public snapshot create/update boundary rather than the raw
 * parser. Every measurement therefore includes the adapter's token, scope, symbol, diagnostic,
 * document-schema, catalog, and feature-model work.
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { LARGE_CORPUS_SPECS, materializeLargeCorpora, readLargeCorpus } from "./large-corpora.mjs";

const options = parseOptions(process.argv.slice(2));
const moduleLoadStart = performance.now();
const { SaralSqlAnalysisEngine } = await loadBuiltEngine();
const moduleLoadMs = performance.now() - moduleLoadStart;

let sink = 0;
let retainedForMemory;
const requestedSpecs = LARGE_CORPUS_SPECS.filter((entry) =>
    options.quick ? entry.mebibytes === 1 : options.sizes.includes(entry.mebibytes),
);
const manifest = await materializeLargeCorpora({ specs: requestedSpecs });
const selected = await selectCorpora(manifest);
const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        moduleLoadMs,
        exposedGc: typeof globalThis.gc === "function",
    },
    configuration: options,
    corpora: [],
};

for (const corpus of selected) {
    report.corpora.push(runCorpus(corpus.entry, corpus.text));
}

async function selectCorpora(entries) {
    if (options.quick) {
        const source = entries.find((entry) => entry.mebibytes === 1);
        if (!source) throw new Error("The 1 MiB source corpus is unavailable for quick mode");
        const text = trimToCompleteBatches(await readLargeCorpus(source));
        return [{ entry: quickCorpusEntry(source, text), text }];
    }
    return Promise.all(
        entries
            .filter((entry) => options.sizes.includes(entry.mebibytes))
            .map(async (entry) => ({ entry, text: await readLargeCorpus(entry) })),
    );
}

function quickCorpusEntry(source, text) {
    return {
        ...source,
        name: "tsql-quick-16kib.sql",
        mebibytes: undefined,
        profileLabel: "quick 16 KiB",
        bytes: Buffer.byteLength(text),
        batchCount: (text.match(/(?:^|\n)GO\n/g) ?? []).length + 1,
        logicalStatements: undefined,
    };
}

function trimToCompleteBatches(text) {
    const target = 16 * 1024;
    const end = text.lastIndexOf("\nGO\n", target);
    if (end < 0) throw new Error("Quick corpus target contains no complete GO-separated batch");
    return text.slice(0, end + 4);
}

if (!Number.isFinite(sink)) {
    throw new Error("Benchmark consumer checksum became non-finite");
}

await emitReport(report);

function runCorpus(entry, text) {
    const edits = createEdits(text);
    return {
        name: entry.name,
        mebibytes: entry.mebibytes,
        profileLabel: entry.profileLabel ?? `${entry.mebibytes} MiB`,
        bytes: entry.bytes,
        characters: text.length,
        batchCount: entry.batchCount,
        logicalStatements: entry.logicalStatements,
        catalogLanes: [
            runCatalogLane("metadata-open", createRepresentativeCatalog("open"), text, edits),
            runCatalogLane(
                "closed-representative-catalog",
                createRepresentativeCatalog("closed"),
                text,
                edits,
            ),
        ],
    };
}

function runCatalogLane(name, catalog, text, edits) {
    const engine = new SaralSqlAnalysisEngine();
    const baseline = engine.createSnapshot({
        text,
        uri: "file:///analysis-engine-benchmark.sql",
        catalog,
    });
    const baseCorrectness = verifySnapshotCanonical(baseline, text, catalog, `${name}/create`);
    const baseStatistics = incrementalStatistics(baseline);
    const lanes = [
        measureLane(
            "create",
            "snapshot-create",
            () =>
                engine.createSnapshot({
                    text,
                    uri: "file:///analysis-engine-benchmark.sql",
                    catalog,
                }),
            options,
        ),
    ];
    const editReports = [];
    for (const edit of edits) {
        const next = engine.updateSnapshot(baseline, { text: edit.text });
        const reuse = assertReusableEdit(baseline, next, edit.name);
        const correctness = verifySnapshotCanonical(
            next,
            edit.text,
            catalog,
            `${name}/${edit.name}`,
        );
        lanes.push(
            measureLane(
                edit.name,
                "snapshot-update",
                () => engine.updateSnapshot(baseline, { text: edit.text }),
                options,
                reuse,
            ),
        );
        editReports.push({
            name: edit.name,
            offset: edit.offset,
            bytes: Buffer.byteLength(edit.text),
            reuse,
            correctness,
        });
    }
    return {
        name,
        catalogVersion: catalog.version,
        catalogWorld: catalog.world,
        base: {
            incrementalStatistics: baseStatistics,
            correctness: baseCorrectness,
        },
        edits: editReports,
        lanes,
    };
}

function measureLane(scenario, operation, action, settings, reuse = undefined) {
    for (let index = 0; index < settings.warmups; index++) {
        consumeSnapshot(action());
    }
    const samples = [];
    for (let index = 0; index < settings.samples; index++) {
        const start = performance.now();
        const snapshot = action();
        samples.push(performance.now() - start);
        consumeSnapshot(snapshot);
    }
    return {
        scenario,
        operation,
        samples: settings.samples,
        timingMs: summarize(samples),
        reuse,
        memory: measureRetainedMemory(action, settings.memorySamples),
    };
}

function measureRetainedMemory(action, samples) {
    if (typeof globalThis.gc !== "function") {
        return {
            available: false,
            reason: "Run Node with --expose-gc for retained-heap samples.",
        };
    }
    if (samples === 0) {
        return {
            available: true,
            samples: 0,
            skipped: true,
            reason: "Memory sampling disabled by --memory-samples 0.",
        };
    }
    const deltas = [];
    for (let index = 0; index < samples; index++) {
        globalThis.gc();
        const before = process.memoryUsage().heapUsed;
        retainedForMemory = action();
        consumeSnapshot(retainedForMemory);
        globalThis.gc();
        deltas.push(process.memoryUsage().heapUsed - before);
        retainedForMemory = undefined;
        globalThis.gc();
    }
    return {
        available: true,
        samples,
        retainedHeapDeltaBytes: summarize(deltas),
        qualification:
            "Forced-GC retained heap while one integrated snapshot is strongly reachable; small/negative deltas are noise.",
    };
}

function createEdits(text) {
    const positions = [
        ["beginning", text.indexOf("1000")],
        ["middle", text.indexOf("1000", Math.floor(text.length / 2))],
        ["end", text.lastIndexOf("1000")],
    ];
    return positions.map(([name, offset]) => {
        if (!Number.isInteger(offset) || offset < 0) {
            throw new Error(`Generated corpus lacks the ${name} edit literal`);
        }
        const edited = `${text.slice(0, offset)}1001${text.slice(offset + 4)}`;
        if (Buffer.byteLength(edited, "utf8") !== Buffer.byteLength(text, "utf8")) {
            throw new Error(`${name} edit must preserve the exact corpus byte size`);
        }
        return {
            name,
            offset,
            text: edited,
        };
    });
}

function assertReusableEdit(previous, next, name) {
    const previousStatistics = incrementalStatistics(previous);
    const nextStatistics = incrementalStatistics(next);
    if (nextStatistics.totalBatchCount !== previousStatistics.totalBatchCount) {
        throw new Error(`${name}: fixed-width edit unexpectedly changed GO batch count`);
    }
    if (nextStatistics.totalBatchCount > 1 && nextStatistics.reusedBatchCount < 1) {
        throw new Error(`${name}: update reused no GO batches`);
    }
    if (nextStatistics.parsedBatchCount >= nextStatistics.totalBatchCount) {
        throw new Error(`${name}: fixed-width edit reparsed every GO batch`);
    }
    return {
        ...nextStatistics,
        reusedBatchPercent: percentage(
            nextStatistics.reusedBatchCount,
            nextStatistics.totalBatchCount,
        ),
        reusedCharacterPercent: percentage(
            nextStatistics.reusedCharacterCount,
            nextStatistics.totalCharacterCount,
        ),
    };
}

function incrementalStatistics(snapshot) {
    const statistics = snapshot.incrementalStatistics;
    if (!statistics) {
        throw new Error("Saral analysis snapshot did not expose incremental benchmark statistics");
    }
    return {
        parsedBatchCount: statistics.parsedBatchCount,
        reusedBatchCount: statistics.reusedBatchCount,
        totalBatchCount: statistics.totalBatchCount,
        reusedCharacterCount: statistics.reusedCharacterCount,
        totalCharacterCount: statistics.totalCharacterCount,
    };
}

function verifySnapshotCanonical(snapshot, text, catalog, label) {
    if (snapshot.text !== text) {
        throw new Error(`${label}: snapshot text does not match its input`);
    }
    const fresh = new SaralSqlAnalysisEngine().createSnapshot({
        text,
        uri: "file:///analysis-engine-benchmark.sql",
        catalog,
    });
    const incrementalChecksum = snapshotChecksum(snapshot);
    const freshChecksum = snapshotChecksum(fresh);
    if (incrementalChecksum !== freshChecksum) {
        throw new Error(
            `${label}: integrated snapshot checksum mismatch (${incrementalChecksum} !== ${freshChecksum})`,
        );
    }
    return {
        matched: true,
        sha256: incrementalChecksum,
        tokens: snapshot.tokens.length,
        statements: snapshot.statements.length,
        scopes: snapshot.scopes.length,
        symbols: snapshot.symbols().length,
        syntaxDiagnostics: snapshot.syntaxDiagnostics.length,
        semanticDiagnostics: snapshot.semanticDiagnostics.length,
    };
}

function snapshotChecksum(snapshot) {
    const hash = createHash("sha256");
    hash.update("saral-analysis-snapshot-v1\0");
    hashCanonical(snapshot.syntaxDiagnostics, hash);
    hashCanonical(snapshot.semanticDiagnostics, hash);
    hashCanonical(snapshot.tokens, hash);
    hashCanonical(snapshot.statements, hash);
    hashCanonical(snapshot.scopes, hash);
    hashCanonical(snapshot.symbols(), hash);
    hashCanonical(snapshot.externalReferences(), hash);
    hashCanonical(snapshot.mutationTargets(), hash);
    hashCanonical(snapshot.lineage(), hash);
    return hash.digest("hex");
}

function hashCanonical(value, hash) {
    if (value === undefined) {
        hash.update("undefined");
        return;
    }
    if (value === null) {
        hash.update("null");
        return;
    }
    if (Array.isArray(value)) {
        hash.update("[");
        for (const item of value) {
            hashCanonical(item, hash);
            hash.update(",");
        }
        hash.update("]");
        return;
    }
    if (value && typeof value === "object") {
        hash.update("{");
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) {
                hash.update(JSON.stringify(key));
                hash.update(":");
                hashCanonical(value[key], hash);
                hash.update(",");
            }
        }
        hash.update("}");
        return;
    }
    hash.update(JSON.stringify(value));
}

function createRepresentativeCatalog(world) {
    const objects = Object.freeze([
        catalogObject("dbo", "Customers", "table", [
            ["CustomerId", "int", false],
            ["DisplayName", "nvarchar(200)", false],
            ["CreditLimit", "decimal(19,4)", true],
        ]),
        catalogObject("Sales", "Invoices", "table", [
            ["InvoiceId", "bigint", false],
            ["CustomerId", "int", false],
            ["Amount", "decimal(19,4)", false],
            ["IssuedAt", "datetime2", false],
        ]),
        catalogObject("dbo", "AuditLog", "table", [
            ["AuditId", "bigint", false],
            ["CustomerId", "int", false],
            ["Message", "nvarchar(max)", true],
        ]),
        catalogObject("dbo", "CustomerSummary", "table", [
            ["CustomerId", "int", false],
            ["DisplayName", "nvarchar(200)", false],
        ]),
        Object.freeze({
            parts: Object.freeze(["dbo", "RefreshCustomerSummary"]),
            kind: "procedure",
            parameters: Object.freeze([{ name: "@MinimumAmount", type: "decimal(19,4)" }]),
        }),
    ]);
    const byName = new Map(objects.map((object) => [catalogKey(object.parts), object]));
    return Object.freeze({
        version: `analysis-benchmark-${world}-1`,
        world,
        columnsFor(parts) {
            return resolveCatalogObject(byName, parts)?.columns;
        },
        objectFor(parts) {
            return resolveCatalogObject(byName, parts);
        },
        tableCandidates(parts) {
            const normalized = parts.map(normalizeIdentifier);
            return objects
                .filter((object) =>
                    normalized.every(
                        (part, index) =>
                            part ===
                            normalizeIdentifier(
                                object.parts[object.parts.length - normalized.length + index] ?? "",
                            ),
                    ),
                )
                .map((object) => object.parts);
        },
        childrenOf(prefix) {
            const normalized = prefix.map(normalizeIdentifier);
            const children = new Map();
            for (const object of objects) {
                const start = object.parts.length - normalized.length - 1;
                if (
                    start < -1 ||
                    !normalized.every(
                        (part, index) =>
                            part ===
                            normalizeIdentifier(
                                object.parts[object.parts.length - normalized.length + index] ?? "",
                            ),
                    )
                ) {
                    continue;
                }
                const childIndex =
                    normalized.length === 0 ? 0 : object.parts.length - normalized.length;
                const child = object.parts[childIndex];
                if (child) {
                    children.set(normalizeIdentifier(child), {
                        name: child,
                        kind: childIndex === object.parts.length - 1 ? "table" : "namespace",
                    });
                }
            }
            return [...children.values()];
        },
    });
}

function catalogObject(schema, name, kind, columns) {
    return Object.freeze({
        parts: Object.freeze([schema, name]),
        kind,
        columns: Object.freeze(
            columns.map(([columnName, type, nullable]) =>
                Object.freeze({ name: columnName, type, nullable }),
            ),
        ),
    });
}

function resolveCatalogObject(byName, parts) {
    const key = catalogKey(parts);
    return (
        byName.get(key) ??
        (parts.length === 1 ? byName.get(catalogKey(["dbo", parts[0]])) : undefined)
    );
}

function catalogKey(parts) {
    return parts.map(normalizeIdentifier).join(".");
}

function normalizeIdentifier(value) {
    return value.replace(/^\[|\]$/g, "").toLocaleLowerCase("en-US");
}

function consumeSnapshot(snapshot) {
    sink +=
        snapshot.tokens.length +
        snapshot.statements.length +
        snapshot.scopes.length +
        snapshot.syntaxDiagnostics.length +
        snapshot.semanticDiagnostics.length +
        snapshot.symbols().length +
        snapshot.externalReferences().length +
        snapshot.lineage().length;
}

function summarize(samples) {
    const sorted = [...samples].sort((left, right) => left - right);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return {
        min: sorted[0],
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.at(-1),
        mean,
    };
}

function percentile(sorted, quantile) {
    const position = (sorted.length - 1) * quantile;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function percentage(value, total) {
    return total === 0 ? 0 : (value / total) * 100;
}

function parseOptions(args) {
    const result = {
        quick: false,
        sizes: [1, 10, 50],
        samples: 3,
        warmups: 1,
        memorySamples: 1,
        format: "table",
        json: undefined,
    };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const next = args[index + 1];
        switch (argument) {
            case "--quick":
                result.quick = true;
                result.samples = 1;
                result.warmups = 0;
                result.memorySamples = 0;
                break;
            case "--sizes":
                result.sizes = parseSizes(next);
                index++;
                break;
            case "--samples":
                result.samples = positiveInteger(next, argument);
                index++;
                break;
            case "--warmups":
                result.warmups = nonNegativeInteger(next, argument);
                index++;
                break;
            case "--memory-samples":
                result.memorySamples = nonNegativeInteger(next, argument);
                index++;
                break;
            case "--format":
                if (!["table", "json", "both"].includes(next)) {
                    throw new Error(`${argument} must be table, json, or both`);
                }
                result.format = next;
                index++;
                break;
            case "--json":
                if (!next) throw new Error("--json requires a file path");
                result.json = next;
                index++;
                break;
            default:
                throw new Error(`Unknown analysis-engine benchmark option: ${argument}`);
        }
    }
    return Object.freeze(result);
}

function parseSizes(value) {
    const requested = (value ?? "")
        .split(",")
        .map((part) => Number.parseInt(part, 10))
        .filter(Number.isFinite);
    const supported = new Set(LARGE_CORPUS_SPECS.map((entry) => entry.mebibytes));
    if (requested.length === 0 || requested.some((size) => !supported.has(size))) {
        throw new Error("--sizes accepts a comma-separated subset of 1,10,50");
    }
    return [...new Set(requested)];
}

function positiveInteger(value, option) {
    const number = Number.parseInt(value ?? "", 10);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`${option} requires a positive integer`);
    }
    return number;
}

function nonNegativeInteger(value, option) {
    const number = Number.parseInt(value ?? "", 10);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`${option} requires a non-negative integer`);
    }
    return number;
}

async function loadBuiltEngine() {
    try {
        return await import("../dist/adapters/saral.js");
    } catch (error) {
        console.error("Build the package before running (`npm run build`).");
        throw error;
    }
}

async function emitReport(result) {
    const json = JSON.stringify(result, null, 2);
    if (options.format === "table" || options.format === "both") {
        console.log(`Integrated Saral analysis-engine benchmark | Node ${result.runtime.node}`);
        for (const corpus of result.corpora) {
            console.log(
                `\n${corpus.name}: ${corpus.bytes.toLocaleString()} bytes (${corpus.profileLabel}), ${corpus.batchCount.toLocaleString()} batches`,
            );
            for (const lane of corpus.catalogLanes) {
                console.log(
                    `${lane.name}: canonical ${lane.base.correctness.sha256}; ${lane.base.incrementalStatistics.totalBatchCount.toLocaleString()} batches`,
                );
                console.table(
                    lane.lanes.map((item) => ({
                        scenario: item.scenario,
                        operation: item.operation,
                        "p50 ms": item.timingMs.p50.toFixed(2),
                        "p95 ms": item.timingMs.p95.toFixed(2),
                        "mean ms": item.timingMs.mean.toFixed(2),
                        "reused batches": item.reuse
                            ? `${item.reuse.reusedBatchCount}/${item.reuse.totalBatchCount}`
                            : "n/a",
                        "retained MiB": retainedHeapLabel(item.memory),
                    })),
                );
            }
        }
    }
    if ((options.format === "json" || options.format === "both") && !options.json) {
        console.log(json);
    }
    if (options.json) {
        await writeFile(options.json, `${json}\n`, "utf8");
        console.log(`Wrote benchmark JSON to ${options.json}`);
    }
}

function retainedHeapLabel(memory) {
    const bytes = memory.retainedHeapDeltaBytes?.p50;
    return Number.isFinite(bytes) ? (bytes / (1024 * 1024)).toFixed(2) : "n/a";
}
