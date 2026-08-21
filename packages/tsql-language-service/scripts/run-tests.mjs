#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const lane = process.argv[2] ?? "fast";
const validLanes = new Set(["all", "offline", "fast", "integration", "performance"]);
if (!validLanes.has(lane)) {
    console.error(`Unknown test lane '${lane}'. Expected one of: ${[...validLanes].join(", ")}.`);
    process.exit(2);
}

const root = resolve("test");
const allTests = (await discover(root)).map((path) => relative(process.cwd(), path));
let selected = allTests.filter((path) => belongsToLane(path.replaceAll("\\", "/"), lane));
const shuffleArgument = process.argv.find((argument) => argument.startsWith("--shuffle="));
if (shuffleArgument) {
    const seed = Number.parseInt(shuffleArgument.slice("--shuffle=".length), 10);
    if (!Number.isSafeInteger(seed)) {
        console.error(`Invalid shuffle seed '${shuffleArgument}'.`);
        process.exit(2);
    }
    selected = shuffled(selected, seed);
    console.log(`Running ${lane} tests in deterministic shuffled order (seed ${seed}).`);
}
if (selected.length === 0) {
    console.error(`Test lane '${lane}' did not discover any files.`);
    process.exit(2);
}

const args = [];
// Memory gates are part of the truthful offline/all lanes, not an optional local enhancement.
if (lane === "performance" || lane === "offline" || lane === "all") args.push("--expose-gc");
args.push("--test");
// Performance files deliberately share one process so their warmup and retained-heap contracts
// are measurable. Correctness suites use Node's normal per-file process isolation.
if (lane === "performance") args.push("--test-isolation=none");
if (lane === "integration") args.push("--test-concurrency=1");
args.push(...selected);

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function belongsToLane(path, selectedLane) {
    const integration = path.includes("/integration/");
    const performance = path.includes("/performance/");
    if (selectedLane === "integration") return integration;
    if (selectedLane === "performance") return performance;
    if (selectedLane === "fast") return !integration && !performance;
    if (selectedLane === "offline") return !integration;
    return true;
}

async function discover(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) result.push(...(await discover(path)));
        else if (entry.isFile() && entry.name.endsWith(".test.js")) result.push(path);
    }
    return result.sort();
}

function shuffled(values, seed) {
    const result = [...values];
    let state = seed >>> 0;
    const random = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x1_0000_0000;
    };
    for (let index = result.length - 1; index > 0; index--) {
        const selectedIndex = Math.floor(random() * (index + 1));
        [result[index], result[selectedIndex]] = [result[selectedIndex], result[index]];
    }
    return result;
}
