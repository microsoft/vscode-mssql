/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the workload-simulation engine adapter: it drives sqlpysim through
 * the `ProcessProvider`, parses its `-json` output, and returns median
 * throughput / latency. Verifies the command it builds, the metric math, log
 * noise tolerance, and error handling.
 */

import { expect } from "chai";

import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";
import {
    measureWorkloadSimulation,
    WorkloadSimulationEngineError,
} from "../../src/cloudDeploy/validation/providers/workloadSimulationEngine";

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

const ENGINE = { pythonCommand: "python", sqlpysimPath: "/tools/sqlpysim.py" };

function baseOptions() {
    return {
        connectionString: "Server=db;Database=app;",
        workloadPath: "/wl.sql",
        threads: 4,
        iterations: 25,
        runs: 1,
    };
}

function json(batches: number, runtime: number, execTime: number, success = true): string {
    return JSON.stringify({
        configuration: { total_batches: batches },
        metrics: {
            total_runtime_seconds: runtime,
            total_query_execution_time_seconds: execTime,
        },
        success,
    });
}

suite("CloudDeploy WorkloadSimulationEngine", () => {
    test("builds the sqlpysim command line", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 0,
            stdout: json(100, 1, 1),
        });

        await measureWorkloadSimulation(
            ENGINE,
            processes,
            {
                connectionString: "Server=db;Database=app;",
                workloadPath: "/wl.sql",
                threads: 8,
                iterations: 100,
                runs: 1,
            },
            newSignal(),
        );

        const inv = processes.invocations[0];
        expect(inv.command).to.equal("python");
        expect(inv.args).to.deep.equal([
            "/tools/sqlpysim.py",
            "-c",
            "Server=db;Database=app;",
            "-i",
            "/wl.sql",
            "-n",
            "8",
            "-r",
            "100",
            "-json",
            "-q",
        ]);
    });

    test("derives throughput and average latency from the JSON", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 0,
            stdout: json(800, 2, 8),
        });

        const metrics = await measureWorkloadSimulation(
            ENGINE,
            processes,
            baseOptions(),
            newSignal(),
        );

        expect(metrics.throughputPerSec).to.equal(400); // 800 batches / 2 s
        expect(metrics.avgLatencyMs).to.be.closeTo(10, 0.0001); // 8 s / 800 * 1000
    });

    test("tolerates leading log noise before the JSON document", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 0,
            stdout: "2026-07-13 | Connecting...\n" + json(100, 1, 1),
        });

        const metrics = await measureWorkloadSimulation(
            ENGINE,
            processes,
            baseOptions(),
            newSignal(),
        );

        expect(metrics.throughputPerSec).to.equal(100);
    });

    test("throws when sqlpysim reports failure", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 1,
            stdout: json(100, 1, 1, false),
        });

        let caught: unknown;
        try {
            await measureWorkloadSimulation(ENGINE, processes, baseOptions(), newSignal());
        } catch (err) {
            caught = err;
        }
        expect(caught).to.be.instanceOf(WorkloadSimulationEngineError);
    });

    test("surfaces the first sqlpysim error message on failure", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 1,
            stdout: JSON.stringify({
                configuration: { total_batches: 100 },
                metrics: {
                    total_runtime_seconds: 0.01,
                    total_query_execution_time_seconds: 0,
                    errors: {
                        total: 2,
                        list: [
                            {
                                type: "ConnectionError",
                                message:
                                    "Connection string parsing failed: Unknown keyword 'user id'",
                            },
                        ],
                    },
                },
                success: false,
            }),
        });

        let caught: unknown;
        try {
            await measureWorkloadSimulation(ENGINE, processes, baseOptions(), newSignal());
        } catch (err) {
            caught = err;
        }
        expect(caught).to.be.instanceOf(WorkloadSimulationEngineError);
        expect((caught as WorkloadSimulationEngineError).message).to.contain(
            "Unknown keyword 'user id'",
        );
    });

    test("throws when the output has no JSON document", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("python", "/tools/sqlpysim.py", {
            mode: "exit",
            exitCode: 0,
            stdout: "connection failed, no json here",
        });

        let caught: unknown;
        try {
            await measureWorkloadSimulation(ENGINE, processes, baseOptions(), newSignal());
        } catch (err) {
            caught = err;
        }
        expect(caught).to.be.instanceOf(WorkloadSimulationEngineError);
    });
});
