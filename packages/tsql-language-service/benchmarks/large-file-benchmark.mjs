#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
    editMiddleBatch,
    LARGE_CORPUS_SPECS,
    materializeLargeCorpora,
    readLargeCorpus,
} from "./large-corpora.mjs";

const options = parseOptions(process.argv.slice(2));
const specs = LARGE_CORPUS_SPECS.filter((entry) => options.sizes.includes(entry.mebibytes));
const manifest = await materializeLargeCorpora({ specs });
const { IncrementalBatchParser, Lexer, Parser, analyze } = await loadBuiltModules();
const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        exposedGc: typeof globalThis.gc === "function",
    },
    configuration: options,
    corpora: [],
};

let sink = 0;
for (const entry of manifest) {
    report.corpora.push(await runCorpus(entry));
    globalThis.gc?.();
}
if (!Number.isFinite(sink)) {
    throw new Error("Benchmark consumer checksum became non-finite");
}
await emitReport(report);

async function runCorpus(entry) {
    const text = await readLargeCorpus(entry);
    const editedText = editMiddleBatch(text);
    const incremental = new IncrementalBatchParser();
    const baseline = incremental.create(text, 1);
    const representativeUpdate = incremental.update(baseline, editedText, 2);
    const correctness = verifyCorrectness(representativeUpdate, editedText);
    const reuse = reuseReport(representativeUpdate.statistics);

    const lanes = [
        measureLane("incremental-create", "batch-relative", () => {
            const result = incremental.create(text, 1);
            consumeIncremental(result);
        }),
        measureLane("incremental-middle-edit", "batch-relative", () => {
            const result = incremental.update(baseline, editedText, 2);
            consumeIncremental(result);
        }),
        measureLane("incremental-middle-edit+materialize", "absolute-ast-compatibility", () => {
            const result = incremental.update(baseline, editedText, 2);
            consumeParseResult(result.parseResult());
        }),
        measureLane("whole-parse-original", "full-reanalysis", () => {
            consumeParseResult(parseWhole(text));
        }),
        measureLane("whole-parse-middle-edit", "full-reanalysis", () => {
            consumeParseResult(parseWhole(editedText));
        }),
    ];
    if (options.includeAnalysis) {
        lanes.push(
            measureLane("whole-analysis-middle-edit", "full-reanalysis", () => {
                consumeAnalysis(analyze(editedText));
            }),
        );
    }

    return {
        name: entry.name,
        path: entry.path,
        bytes: entry.bytes,
        mebibytes: entry.mebibytes,
        batchCount: baseline.batches.length,
        logicalStatements: entry.logicalStatements,
        sourceSha256: entry.sha256,
        correctness,
        reuse,
        lanes,
    };
}

function measureLane(engine, strategy, action) {
    for (let index = 0; index < options.warmups; index++) {
        action();
    }
    const samples = [];
    for (let index = 0; index < options.samples; index++) {
        const start = performance.now();
        action();
        samples.push(performance.now() - start);
    }
    return { engine, strategy, timingMs: summarize(samples) };
}

function verifyCorrectness(snapshot, text) {
    const incrementalChecksum = parseChecksum(snapshot.parseResult());
    const wholeChecksum = parseChecksum(parseWhole(text));
    if (incrementalChecksum !== wholeChecksum) {
        throw new Error(
            `Incremental/whole parse mismatch: ${incrementalChecksum} != ${wholeChecksum}`,
        );
    }
    return { verified: true, incrementalChecksum, wholeChecksum };
}

function parseWhole(text) {
    return new Parser(new Lexer(text)).parse();
}

function parseChecksum(result) {
    const hash = createHash("sha256");
    hashCanonical({ ast: result.ast, issues: result.issues ?? [] }, hash);
    return hash.digest("hex");
}

function hashCanonical(value, hash) {
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

function consumeIncremental(result) {
    sink +=
        result.batches.length +
        result.statistics.parsedBatchCount +
        result.statistics.reusedBatchCount;
}

function consumeParseResult(result) {
    sink += result.ast.body.length + (result.issues?.length ?? 0) + result.ast.end;
}

function consumeAnalysis(result) {
    consumeParseResult(result);
    sink += result.diagnostics.length + result.lineage.edges.length;
}

function reuseReport(statistics) {
    return {
        parsedBatchCount: statistics.parsedBatchCount,
        reusedBatchCount: statistics.reusedBatchCount,
        totalBatchCount: statistics.totalBatchCount,
        reusedCharacterCount: statistics.reusedCharacterCount,
        totalCharacterCount: statistics.totalCharacterCount,
        reusedCharacterPercent:
            statistics.totalCharacterCount === 0
                ? 0
                : (statistics.reusedCharacterCount / statistics.totalCharacterCount) * 100,
    };
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
    if (lower === upper) {
        return sorted[lower];
    }
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function parseOptions(args) {
    const result = {
        sizes: [1, 10, 50],
        samples: 3,
        warmups: 1,
        includeAnalysis: false,
        format: "table",
        json: undefined,
    };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const next = args[index + 1];
        switch (argument) {
            case "--quick":
                result.sizes = [1];
                result.samples = 1;
                result.warmups = 0;
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
            case "--include-analysis":
                result.includeAnalysis = true;
                break;
            case "--format":
                if (!["table", "json", "both"].includes(next)) {
                    throw new Error(`${argument} must be table, json, or both`);
                }
                result.format = next;
                index++;
                break;
            case "--json":
                if (!next) {
                    throw new Error("--json requires a file path");
                }
                result.json = next;
                index++;
                break;
            default:
                throw new Error(`Unknown large-file benchmark option: ${argument}`);
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
        throw new Error("--sizes accepts a comma-separated subset of 1,10,50,100");
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

async function loadBuiltModules() {
    try {
        const [incrementalModule, lexerModule, parserModule, analysisModule] = await Promise.all([
            import("../dist/parser/incremental/incrementalBatchParser.js"),
            import("../dist/parser/saral/parser/lexer.js"),
            import("../dist/parser/saral/parser/parser.js"),
            import("../dist/parser/saral/analyze.js"),
        ]);
        return {
            IncrementalBatchParser: incrementalModule.IncrementalBatchParser,
            Lexer: lexerModule.Lexer,
            Parser: parserModule.Parser,
            analyze: analysisModule.analyze,
        };
    } catch (error) {
        console.error(
            "Build the package before running the large-file benchmark (`npm run build`).",
        );
        throw error;
    }
}

async function emitReport(result) {
    const json = JSON.stringify(result, null, 2);
    if (options.format === "table" || options.format === "both") {
        console.log(`Large T-SQL file benchmark | Node ${result.runtime.node}`);
        for (const corpus of result.corpora) {
            console.log(
                `\n${corpus.name}: ${corpus.bytes.toLocaleString()} bytes (${corpus.mebibytes} MiB), ${corpus.batchCount.toLocaleString()} batches`,
            );
            console.log(
                `Correctness SHA-256: ${corpus.correctness.incrementalChecksum}; reuse ${corpus.reuse.reusedBatchCount.toLocaleString()}/${corpus.reuse.totalBatchCount.toLocaleString()} batches (${corpus.reuse.reusedCharacterPercent.toFixed(2)}% of parsed characters)`,
            );
            console.table(
                corpus.lanes.map((lane) => ({
                    engine: lane.engine,
                    strategy: lane.strategy,
                    "p50 ms": lane.timingMs.p50.toFixed(2),
                    "p95 ms": lane.timingMs.p95.toFixed(2),
                    "mean ms": lane.timingMs.mean.toFixed(2),
                })),
            );
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
