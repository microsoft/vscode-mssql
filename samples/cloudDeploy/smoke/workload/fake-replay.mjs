#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy smoke harness — synthetic replay tool (test double).
 *
 * The WorkloadPlaybackValidator spawns the configured replayCommand with
 * shell:false, zero args, and pipes the captured workload to stdin. It then
 * parses this process's stdout as one { "steps": [...] } document and diffs
 * each observed step against baseline.json.
 *
 * This double does not replay real SQL. It reads the workload steps from
 * stdin and emits observed latencies derived from them: the step whose id is
 * "step-2-regression" is deliberately overshot to ~2.5x its captured latency
 * (well past the default 0.25 latency threshold) so the validator emits
 * exactly one latency-regression finding; every other step stays within
 * tolerance (~1.05x). This exercises the validator's parse + compare contract,
 * which is the only behavior a smoke test can meaningfully assert here.
 */

import fs from "node:fs";

const REGRESSION_STEP_ID = "step-2-regression";
const REGRESSION_FACTOR = 2.5;
const WITHIN_TOLERANCE_FACTOR = 1.05;

function main() {
    const raw = fs.readFileSync(0, "utf8"); // fd 0 = stdin
    const workload = JSON.parse(raw);
    if (workload === null || typeof workload !== "object" || !Array.isArray(workload.steps)) {
        process.stderr.write('Workload piped to fake-replay is missing a "steps" array.\n');
        process.exit(1);
        return;
    }

    const steps = workload.steps
        .filter((step) => step && typeof step.id === "string" && typeof step.latencyMs === "number")
        .map((step) => {
            const factor =
                step.id === REGRESSION_STEP_ID ? REGRESSION_FACTOR : WITHIN_TOLERANCE_FACTOR;
            return {
                id: step.id,
                latencyMs: Math.round(step.latencyMs * factor),
            };
        });

    process.stdout.write(JSON.stringify({ steps }));
    process.exit(0);
}

main();
