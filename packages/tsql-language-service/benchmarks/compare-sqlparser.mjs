#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { generateSqlCorpus } from "./generators/sql-corpus.mjs";

const require = createRequire(import.meta.url);
const { ImmutableTextSnapshot, LezerSyntaxService, applyTextChanges } = require("../dist/index.js");
const benchmarkDirectory = dirname(fileURLToPath(import.meta.url));
const generatedDirectory = join(benchmarkDirectory, "generated", "sqlparser-comparison");
const defaultSqlParserExecutable = join(
    benchmarkDirectory,
    "dotnet",
    "bin",
    "Release",
    "net10.0",
    process.platform === "win32" ? "LocalSqlParserBenchmark.exe" : "LocalSqlParserBenchmark",
);
const options = parseArgs(process.argv.slice(2));
const sizes = parseSizes(options.sizes ?? "100k,1m,10m");
mkdirSync(generatedDirectory, { recursive: true });

const reports = [];
for (const bytes of sizes) {
    const text = generateSqlCorpus(bytes);
    if (Buffer.byteLength(text, "utf8") !== bytes) {
        throw new Error(
            `Generator produced ${Buffer.byteLength(text, "utf8")} bytes, expected ${bytes}`,
        );
    }
    const originalPath = join(generatedDirectory, `${bytes}.sql`);
    writeFileSync(originalPath, text, "utf8");
    const edits = createEdits(text);
    const editPaths = Object.fromEntries(
        Object.entries(edits).map(([location, edit]) => {
            const path = join(generatedDirectory, `${bytes}-${location}.sql`);
            writeFileSync(path, edit.text, "utf8");
            return [location, path];
        }),
    );

    const typescript = benchmarkTypescript(text, edits, options.samples, options.warmups);
    const sqlparser = benchmarkSqlParser(
        originalPath,
        editPaths,
        options.samples,
        options.warmups,
        options.sqlparserExecutable,
    );
    reports.push({ bytes, typescript, sqlparser });
}

const output = {
    generatedAt: new Date().toISOString(),
    corpus: "deterministic-valid-go-batches",
    sizes,
    samples: options.samples,
    warmups: options.warmups,
    reports,
};
console.table(tableRows(reports));
if (options.json) {
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function benchmarkTypescript(text, edits, samples, warmups) {
    const service = new LezerSyntaxService();
    const originalDocument = new ImmutableTextSnapshot("file:///benchmark.sql", 1, text);
    forceGc();
    const first = measure(() => service.parse(originalDocument));
    for (let index = 0; index < warmups; index++) service.parse(originalDocument);
    const warmedFull = sample(samples, () => service.parse(originalDocument));
    const editReports = Object.entries(edits).map(([location, edit]) => {
        for (let index = 0; index < warmups; index++) service.parse(edit.document);
        const fullReparse = sample(samples, () => service.parse(edit.document));

        let previous = first.value;
        let useEdited = true;
        for (let index = 0; index < warmups; index++) {
            previous = service.update(previous, useEdited ? edit.document : originalDocument, [
                useEdited ? edit.change : edit.reverseChange,
            ]);
            useEdited = !useEdited;
        }
        const incrementalValues = [];
        for (let index = 0; index < samples; index++) {
            const measured = measure(() =>
                service.update(previous, useEdited ? edit.document : originalDocument, [
                    useEdited ? edit.change : edit.reverseChange,
                ]),
            );
            incrementalValues.push(measured.elapsedMs);
            previous = measured.value;
            useEdited = !useEdited;
        }
        const incrementalEdited = service.update(first.value, edit.document, [edit.change]);
        const freshEdited = service.parse(edit.document);
        if (checksum(incrementalEdited) !== checksum(freshEdited)) {
            throw new Error(
                `TypeScript incremental/full mismatch at ${text.length} bytes (${location})`,
            );
        }
        return {
            location,
            fullReparseMs: summarize(fullReparse),
            incrementalMs: summarize(incrementalValues),
            diagnostics: freshEdited.diagnostics.length,
            offeredFragments: incrementalEdited.statistics.reusableFragmentCount,
            reusedBatchChunks: incrementalEdited.statistics.reusedChunkCount,
            reparsedBatchChunks: incrementalEdited.statistics.reparsedChunkCount,
            parsedCharacters: incrementalEdited.statistics.parsedCharacterCount,
        };
    });
    forceGc();
    return {
        engine: "typescript-lezer",
        fullStrategy: "full-reparse",
        editStrategy: "go-batch-incremental",
        runtime: process.version,
        firstFullMs: first.elapsedMs,
        warmedFullMs: summarize(warmedFull),
        edits: editReports,
        diagnostics: first.value.diagnostics.length,
        batchCount: first.value.statistics.batchCount,
        rawErrorNodes: first.value.statistics.rawErrorNodeCount,
        managedHeapBytes: process.memoryUsage().heapUsed,
        workingSetBytes: process.memoryUsage().rss,
        peakWorkingSetBytes: process.resourceUsage().maxRSS * 1024,
    };
}

function benchmarkSqlParser(originalPath, edits, samples, warmups, executable) {
    const result = spawnSync(
        executable,
        [
            "--file",
            originalPath,
            "--edited-start",
            edits.start,
            "--edited-middle",
            edits.middle,
            "--edited-end",
            edits.end,
            "--samples",
            String(samples),
            "--warmups",
            String(warmups),
        ],
        { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(
            `SqlParser benchmark failed (${result.status}): ${result.stderr || result.stdout}`,
        );
    }
    return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

function createEdits(text) {
    return Object.fromEntries(
        [
            ["start", 0.01],
            ["middle", 0.5],
            ["end", 0.99],
        ].map(([location, ratio], version) => {
            const offset = editableOffset(text, Math.floor(text.length * ratio));
            const original = text[offset];
            const replacement = original === "0" ? "1" : "0";
            const change = { start: offset, end: offset + 1, text: replacement };
            const document = applyTextChanges(
                new ImmutableTextSnapshot("file:///benchmark.sql", 1, text),
                version + 2,
                [change],
            );
            return [
                location,
                {
                    change,
                    reverseChange: { start: offset, end: offset + 1, text: original },
                    document,
                    text: document.text,
                },
            ];
        }),
    );
}

function editableOffset(text, target) {
    for (let distance = 0; distance < text.length; distance++) {
        const right = target + distance;
        if (right < text.length && /[01]/u.test(text[right])) return right;
        const left = target - distance;
        if (left >= 0 && /[01]/u.test(text[left])) return left;
    }
    throw new Error("Corpus contains no fixed-width numeric edit target");
}

function tableRows(reports) {
    return reports.flatMap(({ bytes, typescript, sqlparser }) =>
        [typescript, sqlparser].flatMap((engine) =>
            engine.edits.map((edit) => ({
                size: formatBytes(bytes),
                engine: engine.engine,
                edit: edit.location,
                firstFullMs: round(engine.firstFullMs),
                warmFullP50Ms: round(engine.warmedFullMs.median),
                editFullP50Ms: round(edit.fullReparseMs.median),
                editIncrementalP50Ms: round(edit.incrementalMs.median),
                diagnostics: edit.diagnostics,
                currentRssMiB: round(engine.workingSetBytes / 1024 / 1024),
            })),
        ),
    );
}

function checksum(snapshot) {
    let value = 2166136261;
    const pending = [snapshot.root()];
    while (pending.length > 0) {
        const node = pending.pop();
        for (const character of `${node.kind}:${node.start}:${node.end};`) {
            value = Math.imul(value ^ character.charCodeAt(0), 16777619);
        }
        const children = [...node.children()];
        for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    return value >>> 0;
}

function sample(count, action) {
    return Array.from({ length: count }, () => measure(action).elapsedMs);
}

function measure(action) {
    const started = performance.now();
    const value = action();
    return { elapsedMs: performance.now() - started, value };
}

function summarize(values) {
    const ordered = [...values].sort((left, right) => left - right);
    return {
        min: ordered[0],
        median: percentile(ordered, 0.5),
        p95: percentile(ordered, 0.95),
        max: ordered.at(-1),
        mean: ordered.reduce((total, value) => total + value, 0) / ordered.length,
        values,
    };
}

function percentile(ordered, value) {
    if (ordered.length === 1) return ordered[0];
    const position = (ordered.length - 1) * value;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return lower === upper
        ? ordered[lower]
        : ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function forceGc() {
    if (globalThis.gc) globalThis.gc();
}

function parseArgs(args) {
    const result = {
        sizes: undefined,
        samples: 3,
        warmups: 1,
        json: undefined,
        sqlparserExecutable: process.env.SQLPARSER_BENCHMARK_EXE ?? defaultSqlParserExecutable,
    };
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--sizes") result.sizes = args[++index];
        else if (args[index] === "--samples")
            result.samples = positiveInteger(args[++index], "samples");
        else if (args[index] === "--warmups")
            result.warmups = nonNegativeInteger(args[++index], "warmups");
        else if (args[index] === "--json") result.json = args[++index];
        else if (args[index] === "--sqlparser-exe") result.sqlparserExecutable = args[++index];
        else throw new Error(`Unknown option: ${args[index]}`);
    }
    return result;
}

function parseSizes(value) {
    const suffixes = { k: 1024, m: 1024 * 1024 };
    return value.split(",").map((entry) => {
        const match = /^(\d+)([km]?)$/iu.exec(entry.trim());
        if (!match) throw new Error(`Invalid size: ${entry}`);
        return Number(match[1]) * (suffixes[match[2].toLowerCase()] ?? 1);
    });
}

function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
    return parsed;
}

function nonNegativeInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new Error(`${name} must be non-negative`);
    return parsed;
}

function round(value) {
    return Math.round(value * 100) / 100;
}

function formatBytes(bytes) {
    return bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MiB` : `${bytes / 1024} KiB`;
}
