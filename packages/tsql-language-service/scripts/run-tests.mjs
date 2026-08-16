#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const lane = process.argv[2] ?? "fast";
const validLanes = new Set(["all", "corpus", "fast", "integration", "performance"]);
if (!validLanes.has(lane)) {
    console.error(`Unknown test lane '${lane}'. Expected one of: ${[...validLanes].join(", ")}.`);
    process.exit(2);
}

const root = resolve("test");
const allTests = (await discover(root)).map((path) => relative(process.cwd(), path));
const selected = allTests.filter((path) => belongsToLane(path.replaceAll("\\", "/"), lane));
if (selected.length === 0) {
    console.error(`Test lane '${lane}' did not discover any files.`);
    process.exit(2);
}

const args = ["--test", "--test-isolation=none"];
if (lane === "integration") args.push("--test-concurrency=1");
args.push(...selected);

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function belongsToLane(path, selectedLane) {
    const integration = path.includes("/integration/");
    const corpus = path.includes("/regression/corpus/");
    const performance = path.includes("/performance/");
    if (selectedLane === "integration") return integration;
    if (selectedLane === "corpus") return corpus;
    if (selectedLane === "performance") return performance;
    if (selectedLane === "fast") return !integration && !corpus && !performance;
    return !integration;
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
