#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy smoke — modal replay test double.
 * Reads the captured workload as JSON from stdin (fd 0) and writes an observed
 * `{ steps: [...] }` metrics doc to stdout, shaped for WorkloadPlaybackValidator.
 * The behavior is selected by the single CLI arg (passed by the .cmd shim):
 *   pass        every step within tolerance (latency x1.05, throughput unchanged) -> 0 regressions
 *   throughput  throughput dropped 50% + error rate raised to 0.10 -> throughput + error-rate regressions
 *   slow        same as pass, but sleeps ~20s first (long-running validation)
 * This is a deterministic stand-in; it does not replay real SQL. The validator's
 * job under test is parse-stdout + diff-against-baseline, which is what we exercise.
 */
import fs from "node:fs";

const MODE = process.argv[2] ?? "pass";
const SLEEP_MS = 20000;
const THROUGHPUT_DROP_FACTOR = 0.5;
const RAISED_ERROR_RATE = 0.1;
const WITHIN_TOLERANCE_LATENCY_FACTOR = 1.05;

function sleepSync(ms) {
    // Real blocking sleep without busy-spinning the CPU.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const workload = JSON.parse(fs.readFileSync(0, "utf8"));
const inputSteps = Array.isArray(workload.steps) ? workload.steps : [];

const steps = inputSteps.map((step) => {
    if (MODE === "throughput") {
        return {
            id: step.id,
            latencyMs: step.latencyMs,
            throughputQps:
                step.throughputQps != null
                    ? step.throughputQps * THROUGHPUT_DROP_FACTOR
                    : undefined,
            errorRate: RAISED_ERROR_RATE,
        };
    }
    // "pass" and "slow" both stay within tolerance.
    return {
        id: step.id,
        latencyMs:
            step.latencyMs != null ? step.latencyMs * WITHIN_TOLERANCE_LATENCY_FACTOR : undefined,
        throughputQps: step.throughputQps,
    };
});

if (MODE === "slow") {
    sleepSync(SLEEP_MS);
}

process.stdout.write(JSON.stringify({ steps }));
process.exit(0);
