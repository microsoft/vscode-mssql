/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — workload-simulation engine adapter.
 *
 * Drives Microsoft's sqlsimtools workload simulator (the `sqlpysim` Python port)
 * as an external process and returns aggregate throughput / latency metrics.
 * This is the seam that lets `WorkloadSimulationValidator` wrap sqlpysim as its
 * engine without reimplementing load generation: we build the command, run it
 * through the shared `ProcessProvider`, and parse its `-json` output.
 *
 * sqlpysim is invoked as `python <sqlpysim> -c <connstr> -i <workload> -n
 * <threads> -r <iterations> -json -q`. It replays the workload file
 * concurrently and emits one aggregate metrics document per run. We run it
 * `runs` times and report the median to damp machine noise.
 */

import { ProcessProvider } from "./processProvider";

/** Location of the sqlpysim engine. Injected by the host; absent means the gate skips. */
export interface WorkloadSimulationEngineLocation {
    /** Command that runs Python (e.g. "python", "python3", or an absolute path). */
    readonly pythonCommand: string;
    /** Absolute path to `sqlpysim.py`. */
    readonly sqlpysimPath: string;
}

/** Knobs for a single simulation measurement. */
export interface WorkloadSimulationRunOptions {
    /** Connection string sqlpysim opens against the target database. */
    readonly connectionString: string;
    /** Absolute path to the workload `.sql` file replayed under load. */
    readonly workloadPath: string;
    /** Concurrent threads. */
    readonly threads: number;
    /** Iterations per thread. */
    readonly iterations: number;
    /** Measurement passes; the median is reported. */
    readonly runs: number;
}

/** Aggregate metrics distilled from sqlpysim's JSON, medianed across passes. */
export interface WorkloadSimulationMetrics {
    /** Batches executed per second (total batches / wall-clock runtime). */
    readonly throughputPerSec: number;
    /** Mean per-batch execution time in milliseconds. */
    readonly avgLatencyMs: number;
    /** Wall-clock runtime of a single pass, in seconds. */
    readonly runtimeSeconds: number;
    /** Total batches executed in a single pass (threads * iterations). */
    readonly totalBatches: number;
}

/** Thrown when sqlpysim cannot be run or its output cannot be understood. */
export class WorkloadSimulationEngineError extends Error {
    public constructor(
        message: string,
        public readonly detail?: unknown,
    ) {
        super(message);
        this.name = "WorkloadSimulationEngineError";
    }
}

/** The subset of sqlpysim's `-json` document this adapter relies on. */
interface SqlpysimJson {
    readonly configuration?: { readonly total_batches?: number };
    readonly metrics?: {
        readonly total_runtime_seconds?: number;
        readonly total_query_execution_time_seconds?: number;
        readonly errors?: {
            readonly total?: number;
            readonly list?: ReadonlyArray<{ readonly type?: string; readonly message?: string }>;
        };
    };
    readonly success?: boolean;
}

/**
 * Runs the workload `runs` times through sqlpysim and returns the median
 * throughput / latency. Throws `WorkloadSimulationEngineError` when a pass
 * fails or its JSON is unusable.
 */
export async function measureWorkloadSimulation(
    engine: WorkloadSimulationEngineLocation,
    processes: ProcessProvider,
    options: WorkloadSimulationRunOptions,
    signal: AbortSignal,
): Promise<WorkloadSimulationMetrics> {
    const totalBatches = options.threads * options.iterations;
    const runtimes: number[] = [];
    const throughputs: number[] = [];
    const latencies: number[] = [];

    for (let pass = 0; pass < Math.max(1, options.runs); pass++) {
        const parsed = await runOnce(engine, processes, options, signal);
        const runtime = parsed.metrics?.total_runtime_seconds;
        const execTime = parsed.metrics?.total_query_execution_time_seconds;
        if (parsed.success !== true || typeof runtime !== "number" || runtime <= 0) {
            const firstError = parsed.metrics?.errors?.list?.find(
                (e) => e.message !== undefined && e.message.length > 0,
            )?.message;
            const detail = firstError !== undefined ? ` First error: ${firstError}` : "";
            throw new WorkloadSimulationEngineError(
                `sqlpysim reported failure or an unusable runtime (success=${parsed.success}, runtime=${runtime}).${detail}`,
            );
        }
        const batches = parsed.configuration?.total_batches ?? totalBatches;
        runtimes.push(runtime);
        throughputs.push(batches / runtime);
        latencies.push(
            typeof execTime === "number" && batches > 0 ? (execTime / batches) * 1000 : 0,
        );
    }

    return {
        throughputPerSec: median(throughputs),
        avgLatencyMs: median(latencies),
        runtimeSeconds: median(runtimes),
        totalBatches,
    };
}

/** Builds and runs the sqlpysim command once, returning its parsed JSON. */
async function runOnce(
    engine: WorkloadSimulationEngineLocation,
    processes: ProcessProvider,
    options: WorkloadSimulationRunOptions,
    signal: AbortSignal,
): Promise<SqlpysimJson> {
    const args = [
        engine.sqlpysimPath,
        "-c",
        options.connectionString,
        "-i",
        options.workloadPath,
        "-n",
        String(options.threads),
        "-r",
        String(options.iterations),
        "-json",
        "-q",
    ];
    const result = await processes.spawn(engine.pythonCommand, args, { signal });
    if (result.aborted) {
        throw new WorkloadSimulationEngineError("sqlpysim run was aborted.");
    }
    return parseJson(result.stdout);
}

/** Extracts the JSON document from sqlpysim stdout, tolerating leading log noise. */
function parseJson(stdout: string): SqlpysimJson {
    const start = stdout.indexOf("{");
    if (start < 0) {
        throw new WorkloadSimulationEngineError("sqlpysim produced no JSON output.");
    }
    try {
        return JSON.parse(stdout.slice(start)) as SqlpysimJson;
    } catch (err) {
        throw new WorkloadSimulationEngineError("Failed to parse sqlpysim JSON output.", err);
    }
}

/** Median of a non-empty sample set (resists slow outliers better than the mean). */
function median(samples: readonly number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
