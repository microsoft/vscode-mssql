#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const options = parseOptions(process.argv.slice(2));
const moduleLoadStart = performance.now();
const modules = await loadBuiltModules();
const moduleLoadMs = performance.now() - moduleLoadStart;
const { IncrementalBatchParser, Lexer, Parser, analyze } = modules;

let sink = 0;
let retainedForMemory;
const corpusDefinitions = createCorpora(options);
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

for (const corpus of corpusDefinitions) {
    report.corpora.push(runCorpus(corpus));
}

if (!Number.isFinite(sink)) {
    throw new Error("Benchmark consumer checksum became non-finite");
}

await emitReport(report, options);

function runCorpus(corpus) {
    const incremental = new IncrementalBatchParser();
    const cold = [];

    cold.push(
        measureFirst("incremental-batch-create", "batch-relative", () => {
            const snapshot = incremental.create(corpus.text, 1);
            consumeIncremental(snapshot);
            return snapshot;
        }),
    );
    cold.push(
        measureFirst("whole-saral-parse", "full-reanalysis", () => {
            const result = parseWhole(corpus.text);
            consumeParseResult(result);
            return result;
        }),
    );
    cold.push(
        measureFirst("whole-saral-analysis", "full-reanalysis", () => {
            const result = analyze(corpus.text);
            consumeAnalysis(result);
            return result;
        }),
    );

    const warmed = [
        measureLane(
            "create",
            "incremental-batch-create",
            "batch-relative",
            () => {
                const snapshot = incremental.create(corpus.text, 1);
                consumeIncremental(snapshot);
                return snapshot;
            },
            options,
        ),
        measureLane(
            "create",
            "incremental-batch-create+materialize",
            "absolute-ast-compatibility",
            () => {
                const snapshot = incremental.create(corpus.text, 1);
                consumeParseResult(snapshot.parseResult());
                return snapshot;
            },
            options,
        ),
        measureLane(
            "create",
            "whole-saral-parse",
            "full-reanalysis",
            () => {
                const result = parseWhole(corpus.text);
                consumeParseResult(result);
                return result;
            },
            options,
        ),
        measureLane(
            "create",
            "whole-saral-analysis",
            "full-reanalysis",
            () => {
                const result = analyze(corpus.text);
                consumeAnalysis(result);
                return result;
            },
            options,
        ),
    ];

    const baseline = incremental.create(corpus.text, 1);
    const editReports = corpus.edits.map((edit, editIndex) => {
        const next = incremental.update(baseline, edit.text, editIndex + 2);
        const reuse = reuseReport(baseline, next);
        let correctness;
        try {
            correctness = verifyCorrectness(next, edit.text);
        } catch (error) {
            throw new Error(
                `Correctness verification failed for ${corpus.name}/${edit.name}: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
        const lanes = [
            measureLane(
                edit.name,
                "incremental-batch-update",
                "batch-relative",
                () => {
                    const snapshot = incremental.update(baseline, edit.text, editIndex + 2);
                    consumeIncremental(snapshot);
                    return snapshot;
                },
                options,
                reuse,
            ),
            measureLane(
                edit.name,
                "incremental-batch-update+materialize",
                "absolute-ast-compatibility",
                () => {
                    const snapshot = incremental.update(baseline, edit.text, editIndex + 2);
                    consumeParseResult(snapshot.parseResult());
                    return snapshot;
                },
                options,
                reuse,
            ),
            measureLane(
                edit.name,
                "whole-saral-parse",
                "full-reanalysis",
                () => {
                    const result = parseWhole(edit.text);
                    consumeParseResult(result);
                    return result;
                },
                options,
            ),
            measureLane(
                edit.name,
                "whole-saral-analysis",
                "full-reanalysis",
                () => {
                    const result = analyze(edit.text);
                    consumeAnalysis(result);
                    return result;
                },
                options,
            ),
        ];
        return { name: edit.name, bytes: Buffer.byteLength(edit.text), reuse, correctness, lanes };
    });

    return {
        name: corpus.name,
        description: corpus.description,
        bytes: Buffer.byteLength(corpus.text),
        characters: corpus.text.length,
        logicalStatements: corpus.logicalStatements,
        sqlBatchCount: baseline.statistics.totalBatchCount,
        firstObserved: cold,
        warmed,
        edits: editReports,
        baseCorrectness: verifyCorrectness(baseline, corpus.text),
    };
}

function measureFirst(engine, strategy, action) {
    const start = performance.now();
    const retained = action();
    const elapsedMs = performance.now() - start;
    sink += objectWeight(retained);
    return { engine, strategy, elapsedMs };
}

function measureLane(scenario, engine, strategy, action, settings, reuse = undefined) {
    for (let index = 0; index < settings.warmups; index++) {
        const value = action();
        sink += objectWeight(value);
    }
    const samples = [];
    for (let index = 0; index < settings.samples; index++) {
        const start = performance.now();
        const value = action();
        samples.push(performance.now() - start);
        sink += objectWeight(value);
    }
    return {
        scenario,
        engine,
        strategy,
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
    const deltas = [];
    for (let index = 0; index < samples; index++) {
        globalThis.gc();
        const before = process.memoryUsage().heapUsed;
        retainedForMemory = action();
        sink += objectWeight(retainedForMemory);
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
            "Forced-GC retained heap while one result is strongly reachable; small/negative deltas are noise.",
    };
}

function verifyCorrectness(incrementalSnapshot, text) {
    const incrementalResult = incrementalSnapshot.parseResult();
    const wholeResult = parseWhole(text);
    const analysisResult = analyze(text);
    const incrementalChecksum = parseChecksum(incrementalResult);
    const wholeParseChecksum = parseChecksum(wholeResult);
    const wholeAnalysisChecksum = parseChecksum({
        ast: analysisResult.ast,
        issues: analysisResult.issues,
    });
    if (
        incrementalChecksum !== wholeParseChecksum ||
        wholeParseChecksum !== wholeAnalysisChecksum
    ) {
        const incrementalCanonical = canonicalize({
            ast: incrementalResult.ast,
            issues: incrementalResult.issues ?? [],
        });
        const wholeCanonical = canonicalize({
            ast: wholeResult.ast,
            issues: wholeResult.issues ?? [],
        });
        const difference = firstDifference(incrementalCanonical, wholeCanonical);
        throw new Error(
            `Correctness checksum mismatch at ${difference}: incremental=${incrementalChecksum}, parse=${wholeParseChecksum}, analysis=${wholeAnalysisChecksum}`,
        );
    }
    return {
        matched: true,
        sha256: incrementalChecksum,
        statements: incrementalResult.ast.body.length,
        issues: incrementalResult.issues?.length ?? 0,
    };
}

function firstDifference(left, right, path = "$") {
    if (Object.is(left, right)) {
        return "no structural difference";
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) {
            return `${path}.length (${left.length} !== ${right.length})`;
        }
        for (let index = 0; index < left.length; index++) {
            const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
            if (difference !== "no structural difference") {
                return difference;
            }
        }
        return "no structural difference";
    }
    if (left && right && typeof left === "object" && typeof right === "object") {
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
        for (const key of keys) {
            if (!(key in left) || !(key in right)) {
                return `${path}.${key} (${key in left ? "incremental only" : "whole only"})`;
            }
            const difference = firstDifference(left[key], right[key], `${path}.${key}`);
            if (difference !== "no structural difference") {
                return difference;
            }
        }
        return "no structural difference";
    }
    return `${path} (${JSON.stringify(left)} !== ${JSON.stringify(right)})`;
}

function reuseReport(previous, next) {
    const previousArtifacts = new Set(previous.batches.map((batch) => batch.artifact));
    const identityReused = next.batches.filter((batch) =>
        previousArtifacts.has(batch.artifact),
    ).length;
    return {
        ...next.statistics,
        identityReusedBatchCount: identityReused,
        reusedBatchPercent: percentage(
            next.statistics.reusedBatchCount,
            next.statistics.totalBatchCount,
        ),
        reusedCharacterPercent: percentage(
            next.statistics.reusedCharacterCount,
            next.statistics.totalCharacterCount,
        ),
    };
}

function parseWhole(text) {
    return new Parser(new Lexer(text)).parse();
}

function consumeIncremental(snapshot) {
    sink += snapshot.batches.length + snapshot.statistics.parsedBatchCount;
    for (const batch of snapshot.batches) {
        sink += batch.artifact.ast.body.length + (batch.artifact.issues?.length ?? 0);
    }
}

function consumeParseResult(result) {
    sink += result.ast.body.length + (result.issues?.length ?? 0) + result.ast.end;
    for (const statement of result.ast.body) {
        sink += statement.start + statement.end + statement.type.length;
    }
}

function consumeAnalysis(result) {
    consumeParseResult({ ast: result.ast, issues: result.issues });
    sink +=
        result.diagnostics.length +
        result.scope.references.size +
        result.lineage.columns.length +
        result.lineage.edges.length +
        result.columns.resolutions.length;
}

function createCorpora(settings) {
    const total = settings.batchCount * settings.statementsPerBatch;
    return [
        generateCorpus(
            "many-small-batches",
            "Many independently reusable GO-separated editor batches.",
            settings.batchCount,
            settings.statementsPerBatch,
        ),
        generateCorpus(
            "one-huge-batch",
            "The same number of statements in one batch, demonstrating the reuse granularity limit.",
            1,
            total,
        ),
    ];
}

function generateCorpus(name, description, batchCount, statementsPerBatch) {
    const batches = [];
    const markerIds = [];
    let logicalIndex = 0;
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const statements = [];
        for (let statementIndex = 0; statementIndex < statementsPerBatch; statementIndex++) {
            const marker = markerText(logicalIndex, 0);
            markerIds.push(marker);
            statements.push(statement(logicalIndex, marker));
            logicalIndex++;
        }
        batches.push(statements.join("\n"));
    }
    const text = batches.join("\nGO\n");
    const locations = [
        ["edit-beginning", 0],
        ["edit-middle", Math.floor(markerIds.length / 2)],
        ["edit-end", markerIds.length - 1],
    ];
    const edits = locations.map(([editName, index]) => ({
        name: editName,
        text: editNumericLiteral(text, markerIds[index], "1001"),
    }));
    edits.push({
        name: "malformed-typing-middle",
        text: editNumericLiteral(text, markerIds[Math.floor(markerIds.length / 2)], "("),
    });
    edits.push({
        name: batchCount > 1 ? "remove-go-boundary-middle" : "add-go-boundary-middle",
        text:
            batchCount > 1
                ? removeMiddleGo(text)
                : addGoBeforeMarker(text, markerIds[Math.floor(markerIds.length / 2)]),
    });
    return { name, description, text, edits, logicalStatements: logicalIndex };
}

function statement(index, marker) {
    const suffix = String(index).padStart(6, "0");
    switch (index % 6) {
        case 0:
            return (
                `SELECT c.CustomerId, c.DisplayName, SUM(i.Amount) AS Total_${suffix} ` +
                `FROM dbo.Customers AS c LEFT JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId ` +
                `WHERE i.Amount >= 1000 ${marker} GROUP BY c.CustomerId, c.DisplayName;`
            );
        case 1:
            return (
                `WITH Ranked_${suffix} AS (` +
                `SELECT i.InvoiceId, i.CustomerId, ROW_NUMBER() OVER (PARTITION BY i.CustomerId ORDER BY i.IssuedAt DESC) AS rn ` +
                `FROM Sales.Invoices AS i) SELECT InvoiceId FROM Ranked_${suffix} WHERE rn <= 1000 ${marker};`
            );
        case 2:
            return (
                `UPDATE c SET CreditLimit = i.Amount FROM dbo.Customers AS c ` +
                `JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId ` +
                `WHERE i.Amount >= 1000 ${marker};`
            );
        case 3:
            return (
                `DELETE a FROM dbo.AuditLog AS a JOIN dbo.Customers AS c ON c.CustomerId = a.CustomerId ` +
                `WHERE a.AuditId < 1000 ${marker};`
            );
        case 4:
            return (
                `INSERT INTO dbo.AuditLog (CustomerId, Message) ` +
                `SELECT c.CustomerId, N'generated ${suffix}' FROM dbo.Customers AS c ` +
                `WHERE c.CustomerId <= 1000 ${marker};`
            );
        default:
            return (
                `SELECT i.InvoiceId, AVG(i.Amount) OVER (PARTITION BY i.CustomerId) AS Average_${suffix} ` +
                `FROM Sales.Invoices AS i WHERE i.Amount >= 1000 ${marker} ` +
                `ORDER BY i.IssuedAt DESC;`
            );
    }
}

function markerText(index, revision) {
    return `/*bench:${String(index).padStart(6, "0")}:r${revision}*/`;
}

function editNumericLiteral(text, marker, replacement) {
    const markerOffset = text.indexOf(marker);
    if (markerOffset < 0) {
        throw new Error(`Missing generated edit marker ${marker}`);
    }
    const numberOffset = text.lastIndexOf("1000", markerOffset);
    if (numberOffset < 0) {
        throw new Error(`Missing numeric edit target before ${marker}`);
    }
    return text.slice(0, numberOffset) + replacement + text.slice(numberOffset + 4);
}

function removeMiddleGo(text) {
    const matches = [...text.matchAll(/\nGO\n/gu)];
    const match = matches[Math.floor(matches.length / 2)];
    if (!match || match.index === undefined) {
        throw new Error("Generated many-batch corpus has no GO boundary");
    }
    return text.slice(0, match.index) + "\n--\n" + text.slice(match.index + match[0].length);
}

function addGoBeforeMarker(text, marker) {
    const offset = text.indexOf(marker);
    if (offset < 0) {
        throw new Error(`Missing generated GO insertion marker ${marker}`);
    }
    const statementStart = text.lastIndexOf("\n", offset) + 1;
    return text.slice(0, statementStart) + "GO\n" + text.slice(statementStart);
}

function parseChecksum(result) {
    const canonical = canonicalize({ ast: result.ast, issues: result.issues ?? [] });
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .filter((key) => value[key] !== undefined)
                .map((key) => [key, canonicalize(value[key])]),
        );
    }
    return value;
}

function summarize(samples) {
    const sorted = [...samples].sort((left, right) => left - right);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
    return {
        min: sorted[0],
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1),
        mean,
        standardDeviation: Math.sqrt(variance),
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

function percentage(numerator, denominator) {
    return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function objectWeight(value) {
    if (!value || typeof value !== "object") {
        return 0;
    }
    if ("batches" in value) {
        return value.batches.length;
    }
    if ("ast" in value) {
        return value.ast.body.length;
    }
    return 1;
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
            "Benchmark requires compiled package output. Run `npx tsc -p packages/tsql-language-service/tsconfig.json` from the repository root first.",
        );
        throw error;
    }
}

function parseOptions(args) {
    const quick = args.includes("--quick");
    const defaults = quick
        ? { batchCount: 12, statementsPerBatch: 3, samples: 5, warmups: 1 }
        : { batchCount: 200, statementsPerBatch: 5, samples: 30, warmups: 5 };
    const result = {
        quick,
        ...defaults,
        memorySamples: quick ? 1 : 3,
        format: "table",
        json: undefined,
    };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--quick") {
            continue;
        }
        const next = args[index + 1];
        switch (argument) {
            case "--batches":
                result.batchCount = positiveInteger(next, argument);
                index++;
                break;
            case "--statements-per-batch":
                result.statementsPerBatch = positiveInteger(next, argument);
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
                result.memorySamples = positiveInteger(next, argument);
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
                if (!next) {
                    throw new Error("--json requires a file path");
                }
                result.json = next;
                index++;
                break;
            default:
                throw new Error(`Unknown benchmark option: ${argument}`);
        }
    }
    return Object.freeze(result);
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

async function emitReport(result, settings) {
    const json = JSON.stringify(result, null, 2);
    if (settings.format === "table" || settings.format === "both") {
        console.log(
            `Incremental batch parser benchmark | Node ${result.runtime.node} | module load ${result.runtime.moduleLoadMs.toFixed(2)} ms`,
        );
        for (const corpus of result.corpora) {
            console.log(
                `\n${corpus.name}: ${formatBytes(corpus.bytes)}, ${corpus.logicalStatements} statements, ${corpus.sqlBatchCount} batches`,
            );
            console.table(
                [...corpus.warmed, ...corpus.edits.flatMap((edit) => edit.lanes)].map((lane) => ({
                    scenario: lane.scenario,
                    engine: lane.engine,
                    strategy: lane.strategy,
                    "p50 ms": lane.timingMs.p50.toFixed(2),
                    "p95 ms": lane.timingMs.p95.toFixed(2),
                    "mean ms": lane.timingMs.mean.toFixed(2),
                    "reuse batches": lane.reuse
                        ? `${lane.reuse.reusedBatchCount}/${lane.reuse.totalBatchCount}`
                        : "n/a",
                    "reuse chars": lane.reuse
                        ? `${lane.reuse.reusedCharacterPercent.toFixed(1)}%`
                        : "n/a",
                })),
            );
            console.log("First observed invocations (shared process; not isolated startup):");
            console.table(
                corpus.firstObserved.map((item) => ({
                    engine: item.engine,
                    strategy: item.strategy,
                    ms: item.elapsedMs.toFixed(2),
                })),
            );
        }
    }
    if ((settings.format === "json" || settings.format === "both") && !settings.json) {
        console.log(json);
    }
    if (settings.json) {
        await writeFile(settings.json, `${json}\n`, "utf8");
        console.log(`Wrote benchmark JSON to ${settings.json}`);
    }
}

function formatBytes(bytes) {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}
