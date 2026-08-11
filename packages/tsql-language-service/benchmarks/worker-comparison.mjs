#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { IncrementalBatchParser } from "../dist/parser/incremental/incrementalBatchParser.js";
import { createNodeSqlWorkerClient } from "../dist/worker/nodeClient.js";
import {
    LARGE_CORPUS_SPECS,
    editMiddleBatch,
    materializeLargeCorpora,
    readLargeCorpus,
} from "./large-corpora.mjs";

const options = parseArguments(process.argv.slice(2));
if (options.child) {
    await runChild(options);
} else {
    await runCoordinator(options);
}

async function runCoordinator(configuration) {
    const requested = parseSizes(configuration.sizes ?? "100k,1,10,100");
    const all = await materializeLargeCorpora();
    const corpora = requested.map((size) => {
        const match = all.find((entry) => entry.bytes === size);
        if (!match) throw new Error(`No generated corpus for ${displayBytes(size)}`);
        return match;
    });
    buildDotnetHarnesses();

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        qualification: [
            "Parser-only comparison; semantic binding and metadata query time are excluded.",
            "Worker initial time includes worker startup, module loading, structured cloning, and parsing. Worker internal time excludes host scheduling and message transfer.",
            "Warm incremental edits preserve source length and change one GO batch.",
        ],
        environment: {
            node: process.version,
            platform: `${platform()} ${release()}`,
            cpu: cpus()[0]?.model,
            logicalCpuCount: cpus().length,
            totalMemoryBytes: totalmem(),
            freeMemoryBytesAtStart: freemem(),
        },
        sources: {
            sqlParser: {
                root: siblingRepository("SqlParser"),
                commit: gitCommit(siblingRepository("SqlParser")),
                configuration: "Release/net8.0",
            },
        },
        configuration: {
            sizes: requested,
            samples: configuration.samples,
            warmups: configuration.warmups,
            heartbeatIntervalMs: 5,
        },
        results: [],
    };

    for (const corpus of corpora) {
        const samples = configuration.samples ?? defaultSamples(corpus.bytes);
        const warmups = configuration.warmups ?? (corpus.bytes >= 100 * 1024 * 1024 ? 0 : 1);
        const original = await readLargeCorpus(corpus);
        const edited = editMiddleBatch(original);
        const editedPath = corpus.path.replace(/\.sql$/i, ".edited.sql");
        await writeFile(editedPath, edited, "utf8");
        process.stderr.write(
            `\n${displayBytes(corpus.bytes)}: ${corpus.batchCount.toLocaleString()} batches, ${samples} sample(s), ${warmups} warmup(s)\n`,
        );
        original.length;
        edited.length;

        const sizeResults = [];
        for (const engine of ["saral-in-process", "saral-node-worker", "local-sqlparser"]) {
            process.stderr.write(`  running ${engine}...\n`);
            const result = runIsolated(engine, corpus.path, editedPath, samples, warmups);
            const qualified = {
                size: displayBytes(corpus.bytes),
                bytes: corpus.bytes,
                ...result,
            };
            sizeResults.push(qualified);
            report.results.push(qualified);
        }
        assertPackageParity(sizeResults);
    }

    const output =
        configuration.json ??
        fileURLToPath(new URL("./generated/worker-comparison-results.json", import.meta.url));
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printTable(report.results);
    console.log(`\nMachine-readable results: ${output}`);
}

async function runChild(configuration) {
    const file = required(configuration, "file");
    const editedFile = required(configuration, "edited");
    const samples = positiveInteger(configuration.samples ?? 1, "samples");
    const warmups = nonNegativeInteger(configuration.warmups ?? 0, "warmups");
    const original = await readFile(file, "utf8");
    const edited = await readFile(editedFile, "utf8");
    if (original.length !== edited.length) throw new Error("Benchmark edit changed source length");
    const edit = findSingleEdit(original, edited);
    let result;
    if (configuration.child === "saral-in-process") {
        result = await benchmarkInProcess(original, edited, samples, warmups);
    } else if (configuration.child === "saral-node-worker") {
        result = await benchmarkWorker(original, edit, samples, warmups);
    } else {
        throw new Error(`Unknown child engine: ${configuration.child}`);
    }
    console.log(JSON.stringify(result));
}

async function benchmarkInProcess(original, edited, samples, warmups) {
    const parser = new IncrementalBatchParser();
    forceGc();
    const initial = await measureResponsiveness(() => parser.create(original, 1));
    initial.result = undefined;

    for (let index = 0; index < warmups; index++) parser.create(original, index + 2);
    const full = [];
    for (let index = 0; index < samples; index++) {
        const measured = await measureResponsiveness(() => parser.create(original, index + 10));
        measured.result = undefined;
        full.push(measured);
    }

    let snapshot = parser.create(original, 100);
    let useEdited = true;
    for (let index = 0; index < warmups; index++) {
        snapshot = parser.update(snapshot, useEdited ? edited : original, 101 + index);
        useEdited = !useEdited;
    }
    const incremental = [];
    for (let index = 0; index < samples; index++) {
        const nextText = useEdited ? edited : original;
        const measured = await measureResponsiveness(() =>
            parser.update(snapshot, nextText, 200 + index),
        );
        snapshot = measured.result;
        measured.result = undefined;
        useEdited = !useEdited;
        incremental.push(measured);
    }
    return {
        engine: "saral-in-process",
        initialMs: initial.wallMs,
        warmedFullMs: summarizeMeasurements(full),
        warmedIncrementalMs: summarizeMeasurements(incremental),
        workerInternalInitialMs: null,
        workerInternalIncrementalMs: null,
        initialResponsiveness: responsiveness(initial),
        incrementalResponsiveness: summarizeResponsiveness(incremental),
        parsedBatchCount: snapshot.statistics.parsedBatchCount,
        reusedBatchCount: snapshot.statistics.reusedBatchCount,
        batchCount: snapshot.statistics.totalBatchCount,
        statementCount: snapshot.batches.reduce(
            (total, batch) => total + batch.artifact.ast.body.length,
            0,
        ),
        issueCount: snapshot.batches.reduce(
            (total, batch) => total + batch.artifact.issues.length,
            0,
        ),
        peakWorkingSetBytes: process.resourceUsage().maxRSS * 1024,
    };
}

async function benchmarkWorker(original, edit, samples, warmups) {
    const client = createNodeSqlWorkerClient({ name: "tsql-parser-benchmark" });
    const uri = "file:///worker-comparison.sql";
    try {
        forceGc();
        const initial = await measureResponsiveness(() =>
            client.openDocument(uri, 1, original, { mode: "parse" }),
        );
        const initialSummary = initial.result;

        const full = [];
        for (let index = 0; index < warmups + samples; index++) {
            await client.closeDocument(uri);
            const measured = await measureResponsiveness(() =>
                client.openDocument(uri, index + 2, original, { mode: "parse" }),
            );
            if (index >= warmups) full.push(measured);
        }

        let version = warmups + samples + 2;
        let useEdited = true;
        for (let index = 0; index < warmups; index++) {
            await client.changeDocument(uri, version++, [
                {
                    start: edit.start,
                    end: edit.end,
                    text: useEdited ? edit.editedText : edit.originalText,
                },
            ]);
            useEdited = !useEdited;
        }
        const incremental = [];
        for (let index = 0; index < samples; index++) {
            const measured = await measureResponsiveness(() =>
                client.changeDocument(uri, version++, [
                    {
                        start: edit.start,
                        end: edit.end,
                        text: useEdited ? edit.editedText : edit.originalText,
                    },
                ]),
            );
            useEdited = !useEdited;
            incremental.push(measured);
        }
        const last = incremental.at(-1)?.result ?? initialSummary;
        return {
            engine: "saral-node-worker",
            initialMs: initial.wallMs,
            warmedFullMs: summarizeMeasurements(full),
            warmedIncrementalMs: summarizeMeasurements(incremental),
            workerInternalInitialMs: initialSummary.workerElapsedMs,
            workerInternalIncrementalMs: summarize(
                incremental.map((measurement) => measurement.result.workerElapsedMs),
            ),
            initialResponsiveness: responsiveness(initial),
            incrementalResponsiveness: summarizeResponsiveness(incremental),
            parsedBatchCount: last.statistics.parsedBatchCount,
            reusedBatchCount: last.statistics.reusedBatchCount,
            batchCount: last.statistics.totalBatchCount,
            statementCount: last.statementCount,
            issueCount: last.issueCount,
            peakWorkingSetBytes: process.resourceUsage().maxRSS * 1024,
        };
    } finally {
        await client.dispose();
    }
}

async function measureResponsiveness(operation) {
    const intervalMs = 5;
    let expected = performance.now() + intervalMs;
    let heartbeatCount = 0;
    let maxHeartbeatLagMs = 0;
    const timer = setInterval(() => {
        const now = performance.now();
        heartbeatCount++;
        maxHeartbeatLagMs = Math.max(maxHeartbeatLagMs, now - expected);
        expected = now + intervalMs;
    }, intervalMs);
    await new Promise((resolve) => setImmediate(resolve));
    const started = performance.now();
    try {
        const result = await operation();
        return {
            result,
            wallMs: performance.now() - started,
            heartbeatCount,
            maxHeartbeatLagMs,
        };
    } finally {
        clearInterval(timer);
    }
}

function runIsolated(engine, file, edited, samples, warmups) {
    const args = [
        "--file",
        file,
        "--edited",
        edited,
        "--samples",
        String(samples),
        "--warmups",
        String(warmups),
    ];
    let command;
    let commandArgs;
    if (engine.startsWith("saral-")) {
        command = process.execPath;
        commandArgs = [
            "--max-old-space-size=16384",
            fileURLToPath(import.meta.url),
            "--child",
            engine,
            ...args,
        ];
    } else {
        command = "dotnet";
        const project = "LocalSqlParserBenchmark";
        commandArgs = [dotnetOutput(project), ...args, "--label", engine];
    }
    const completed = spawnSync(command, commandArgs, {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
    });
    if (completed.status !== 0) {
        return {
            engine,
            failed: true,
            exitCode: completed.status,
            error: (
                completed.stderr ||
                completed.stdout ||
                completed.error?.message ||
                "unknown failure"
            ).trim(),
        };
    }
    const line = completed.stdout.trim().split(/\r?\n/).at(-1);
    return JSON.parse(line);
}

function buildDotnetHarnesses() {
    for (const project of ["LocalSqlParserBenchmark.csproj"]) {
        const completed = spawnSync(
            "dotnet",
            ["build", dotnetProject(project), "-c", "Release", "--nologo"],
            {
                encoding: "utf8",
                windowsHide: true,
            },
        );
        if (completed.status !== 0) {
            throw new Error(
                `Failed to build ${project}:\n${completed.stdout}\n${completed.stderr}`,
            );
        }
    }
}

function dotnetProject(name) {
    return fileURLToPath(new URL(`./dotnet/${name}`, import.meta.url));
}

function dotnetOutput(project) {
    return fileURLToPath(
        new URL(`./dotnet/bin/${project}/Release/net10.0/${project}.dll`, import.meta.url),
    );
}

function findSingleEdit(original, edited) {
    let start = 0;
    while (start < original.length && original[start] === edited[start]) start++;
    let end = original.length;
    while (end > start && original[end - 1] === edited[end - 1]) end--;
    return {
        start,
        end,
        originalText: original.slice(start, end),
        editedText: edited.slice(start, end),
    };
}

function summarizeMeasurements(measurements) {
    return summarize(measurements.map((measurement) => measurement.wallMs));
}

function summarize(values) {
    const ordered = [...values].sort((left, right) => left - right);
    return {
        min: ordered[0],
        median: percentile(ordered, 0.5),
        p95: percentile(ordered, 0.95),
        max: ordered.at(-1),
        mean: values.reduce((total, value) => total + value, 0) / values.length,
        values,
    };
}

function percentile(ordered, percentileValue) {
    if (ordered.length === 1) return ordered[0];
    const position = (ordered.length - 1) * percentileValue;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return ordered[lower];
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function responsiveness(measurement) {
    return {
        heartbeatCount: measurement.heartbeatCount,
        maxHeartbeatLagMs: measurement.maxHeartbeatLagMs,
        responsive: measurement.heartbeatCount > 0,
    };
}

function summarizeResponsiveness(measurements) {
    return {
        totalHeartbeats: measurements.reduce((total, value) => total + value.heartbeatCount, 0),
        maxHeartbeatLagMs: Math.max(...measurements.map((value) => value.maxHeartbeatLagMs)),
        responsiveSamples: measurements.filter((value) => value.heartbeatCount > 0).length,
        sampleCount: measurements.length,
    };
}

function printTable(results) {
    const baselines = new Map(
        results
            .filter((result) => result.engine === "saral-in-process" && !result.failed)
            .map((result) => [result.bytes, result]),
    );
    console.table(
        results.map((result) => {
            if (result.failed)
                return { size: result.size, engine: result.engine, error: result.error };
            const baseline = baselines.get(result.bytes);
            return {
                size: result.size,
                engine: result.engine,
                "initial ms": round(result.initialMs),
                "initial x sync": ratio(result.initialMs, baseline?.initialMs),
                "warm full p50": round(result.warmedFullMs.median),
                "warm edit p50": round(result.warmedIncrementalMs.median),
                "edit x sync": ratio(
                    result.warmedIncrementalMs.median,
                    baseline?.warmedIncrementalMs.median,
                ),
                "main responsive": result.initialResponsiveness?.responsive ?? "not measured",
                reuse:
                    result.reusedBatchCount === undefined
                        ? "native incremental"
                        : `${result.reusedBatchCount}/${result.batchCount}`,
            };
        }),
    );
}

function assertPackageParity(results) {
    const direct = results.find((result) => result.engine === "saral-in-process");
    const worker = results.find((result) => result.engine === "saral-node-worker");
    for (const field of [
        "parsedBatchCount",
        "reusedBatchCount",
        "batchCount",
        "statementCount",
        "issueCount",
    ]) {
        if (direct?.[field] !== worker?.[field]) {
            throw new Error(
                `${direct?.size ?? "corpus"}: worker ${field} ${worker?.[field]} did not match in-process ${direct?.[field]}`,
            );
        }
    }
}

function ratio(value, baseline) {
    return baseline ? `${(value / baseline).toFixed(2)}x` : undefined;
}

function round(value) {
    return Number(value.toFixed(2));
}

function parseSizes(value) {
    const aliases = new Map([
        ["100k", 100 * 1024],
        ["100kib", 100 * 1024],
        ["1", 1024 * 1024],
        ["1m", 1024 * 1024],
        ["10", 10 * 1024 * 1024],
        ["10m", 10 * 1024 * 1024],
        ["50", 50 * 1024 * 1024],
        ["50m", 50 * 1024 * 1024],
        ["100", 100 * 1024 * 1024],
        ["100m", 100 * 1024 * 1024],
    ]);
    return value.split(",").map((raw) => {
        const size = aliases.get(raw.trim().toLowerCase());
        if (!size) throw new Error(`Unsupported benchmark size: ${raw}`);
        return size;
    });
}

function defaultSamples(bytes) {
    if (bytes <= 100 * 1024) return 5;
    if (bytes <= 1024 * 1024) return 3;
    if (bytes <= 10 * 1024 * 1024) return 2;
    return 1;
}

function displayBytes(bytes) {
    return bytes < 1024 * 1024 ? `${bytes / 1024} KiB` : `${bytes / 1024 / 1024} MiB`;
}

function forceGc() {
    if (global.gc) global.gc();
}

function siblingRepository(name) {
    return fileURLToPath(new URL(`../../../../${name}/`, import.meta.url));
}

function gitCommit(repository) {
    const completed = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
    });
    return completed.status === 0 ? completed.stdout.trim() : undefined;
}

function parseArguments(argumentsList) {
    const parsed = {};
    for (let index = 0; index < argumentsList.length; index++) {
        const argument = argumentsList[index];
        if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
        const key = argument.slice(2);
        const value = argumentsList[index + 1];
        if (value === undefined || value.startsWith("--")) {
            parsed[key] = true;
        } else {
            parsed[key] = value;
            index++;
        }
    }
    if (parsed.samples !== undefined) parsed.samples = positiveInteger(parsed.samples, "samples");
    if (parsed.warmups !== undefined)
        parsed.warmups = nonNegativeInteger(parsed.warmups, "warmups");
    return parsed;
}

function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
    return parsed;
}

function nonNegativeInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be non-negative`);
    return parsed;
}

function required(configuration, name) {
    const value = configuration[name];
    if (typeof value !== "string") throw new Error(`Missing --${name}`);
    return value;
}
