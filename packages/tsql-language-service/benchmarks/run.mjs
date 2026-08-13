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
    const full = measure(() => service.parse(initialText));
    const offset = Math.floor(text.length / 2);
    const change = { start: offset, end: offset + 1, text: text[offset] === "X" ? "Y" : "X" };
    const editedText = applyTextChanges(initialText, 2, [change]);
    const incremental = measure(() => service.update(full.value, editedText, [change]));
    const fresh = service.parse(editedText);
    if (checksum(incremental.value) !== checksum(fresh)) {
        throw new Error(`Incremental/full syntax mismatch at ${size} bytes`);
    }
    const worker = createNodeWorkerClient();
    let workerInitial;
    let workerEdit;
    try {
        workerInitial = await measureAsync(() => worker.open("file:///bench.sql", 1, text));
        workerEdit = await measureAsync(() => worker.change("file:///bench.sql", 2, [change]));
    } finally {
        await worker.dispose();
    }
    rows.push({
        bytes: size,
        fullParseMs: full.elapsedMs,
        incrementalParseMs: incremental.elapsedMs,
        reusableFragments: incremental.value.statistics.reusableFragmentCount,
        workerInitialWallMs: workerInitial.elapsedMs,
        workerEditWallMs: workerEdit.elapsedMs,
        workerInitialInternalMs: workerInitial.value.workerElapsedMs,
        workerEditInternalMs: workerEdit.value.workerElapsedMs,
    });
}

console.table(rows);

function checksum(snapshot) {
    let value = 2166136261;
    const cursor = snapshot.tree.cursor();
    do {
        for (const character of `${cursor.name}:${cursor.from}:${cursor.to};`) {
            value = Math.imul(value ^ character.charCodeAt(0), 16777619);
        }
    } while (cursor.next());
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
