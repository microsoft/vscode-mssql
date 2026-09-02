#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { generateSqlCorpus } from "./generators/sql-corpus.mjs";

const require = createRequire(import.meta.url);
const { ImmutableTextSnapshot, LezerSyntaxService, applyTextChanges } = require("../dist/index.js");
const { createNodeWorkerClient } = require("../dist/worker/node/client.js");
const options = parseArgs(process.argv.slice(2));
const sizes = options.smoke ? [5 * 1024] : parseSizes(options.sizes ?? "5k,100k,1m,10m");
const rows = [];

for (const size of sizes) {
    const text = generateSqlCorpus(size);
    const service = new LezerSyntaxService();
    const initialText = new ImmutableTextSnapshot("file:///bench.sql", 1, text);
    const coldFull = measure(() => service.parse(initialText));
    const warmFull = measure(() => service.parse(initialText));
    const editLocations = [
        ["start", Math.max(1, Math.floor(text.length * 0.01))],
        ["middle", Math.floor(text.length / 2)],
        ["end", Math.max(1, Math.floor(text.length * 0.99))],
    ];
    for (const [editLocation, rawOffset] of editLocations) {
        const offset = stableIdentifierEditOffset(text, Number(rawOffset));
        const change = {
            start: offset,
            end: offset + 1,
            text: text[offset] === "X" ? "Y" : "X",
        };
        const editedText = applyTextChanges(initialText, 2, [change]);
        const incremental = measure(() => service.update(coldFull.value, editedText, [change]));
        const fullReparse = measure(() => service.parse(editedText));
        if (checksum(incremental.value) !== checksum(fullReparse.value)) {
            throw new Error(`Incremental/full syntax mismatch at ${size} bytes (${editLocation})`);
        }

        let workerInitial;
        let workerEdit;
        let workerEditStats;
        if (editLocation === "middle") {
            const worker = createNodeWorkerClient();
            try {
                workerInitial = await measureAsync(() => worker.open("file:///bench.sql", 1, text));
                workerEdit = await measureAsync(() =>
                    worker.change("file:///bench.sql", 2, [change]),
                );
                workerEditStats = await worker.stats("file:///bench.sql");
            } finally {
                await worker.dispose();
            }
        }
        rows.push({
            bytes: text.length,
            editLocation,
            coldFullMs: round(coldFull.elapsedMs),
            warmFullMs: round(warmFull.elapsedMs),
            fullReparseMs: round(fullReparse.elapsedMs),
            incrementalMs: round(incremental.elapsedMs),
            speedup: round(fullReparse.elapsedMs / incremental.elapsedMs),
            throughputMiBPerSecond: round(text.length / 1024 / 1024 / (warmFull.elapsedMs / 1000)),
            diagnostics: coldFull.value.diagnostics.length,
            reusedBatchChunks: incremental.value.statistics.reusedChunkCount,
            reparsedBatchChunks: incremental.value.statistics.reparsedChunkCount,
            parsedCharacters: incremental.value.statistics.parsedCharacterCount,
            workerInitialWallMs: optionalRound(workerInitial?.elapsedMs),
            workerEditWallMs: optionalRound(workerEdit?.elapsedMs),
            workerInitialInternalMs: optionalRound(workerInitial?.value.workerElapsedMs),
            workerEditInternalMs: optionalRound(workerEdit?.value.workerElapsedMs),
            workerEditParseMs: optionalRound(workerEditStats?.syntax.elapsedMs),
            workerEditBindMs: optionalRound(workerEditStats?.semantics.elapsedMs),
            workerReusedSemanticUnits: workerEditStats?.semantics.unitsReused,
            workerReboundSemanticUnits: workerEditStats?.semantics.unitsRebound,
        });
    }
}

console.table(rows);

/** Keeps positional edits inside an identifier instead of accidentally mutating a GO boundary. */
function stableIdentifierEditOffset(text, preferredOffset) {
    const marker = "u.Name";
    const after = text.indexOf(marker, Math.max(0, preferredOffset));
    const occurrence = after >= 0 ? after : text.lastIndexOf(marker, preferredOffset);
    if (occurrence < 0) throw new Error("Benchmark corpus has no stable identifier edit marker");
    return occurrence + 3;
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

function round(value) {
    return Math.round(value * 100) / 100;
}

function optionalRound(value) {
    return value === undefined ? undefined : round(value);
}

function parseArgs(args) {
    const result = { smoke: false, sizes: undefined };
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--smoke") result.smoke = true;
        else if (args[index] === "--sizes") result.sizes = args[++index];
    }
    return result;
}

function parseSizes(value) {
    const suffixes = { k: 1024, m: 1024 * 1024 };
    return value.split(",").map((entry) => {
        const match = /^(\d+)([km]?)$/i.exec(entry.trim());
        if (!match) throw new Error(`Invalid size: ${entry}`);
        return Number(match[1]) * (suffixes[match[2].toLowerCase()] ?? 1);
    });
}
