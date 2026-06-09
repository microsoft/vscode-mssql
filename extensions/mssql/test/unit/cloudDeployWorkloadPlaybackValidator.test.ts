/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `WorkloadPlaybackValidator`:
 *   * Skipped for non-Container source-of-truth (no replay target).
 *   * Skipped when `workloadUri` or `baselineUri` is missing in settings.
 *   * Skipped when either artifact is missing on disk
 *     (`ArtifactNotFoundError`).
 *   * Failed when the replay tool exits non-zero; stderr surfaces in the
 *     synthesized finding.
 *   * Passed when no per-step metric exceeds its threshold.
 *   * Failed with one finding per step that exceeds latency / throughput /
 *     error-rate / plan-hash thresholds.
 *   * Threshold overrides via settings change which steps trip.
 *   * Pre-aborted signal throws `CancellationError` without reading
 *     artifacts.
 *   * Mid-flight cancel via `mode: "hang"` then abort throws
 *     `CancellationError`.
 *   * Malformed baseline JSON re-throws so the runner classifies as
 *     `Errored`.
 *   * The captured workload bytes are forwarded to the replay tool via
 *     stdin verbatim.
 *   * Custom `replayCommand` is used in place of the default.
 */

import { expect } from "chai";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type WorkloadPlaybackPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    FakeArtifactProvider,
    FakeProcessProvider,
    WorkloadPlaybackValidator,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const WORKLOAD_URI = "file:///workload.json";
const BASELINE_URI = "file:///baseline.json";
const DEFAULT_COMMAND = "sql-workload-replay";

const BASELINE_JSON = JSON.stringify({
    steps: [
        {
            id: "stepA",
            latencyMs: 100,
            throughputQps: 1000,
            errorRate: 0.01,
            planHash: "h1",
        },
        {
            id: "stepB",
            latencyMs: 50,
            throughputQps: 500,
            errorRate: 0.0,
            planHash: "h2",
        },
    ],
});

const NO_REGRESSION_OBSERVED_JSON = JSON.stringify({
    steps: [
        {
            id: "stepA",
            latencyMs: 105,
            throughputQps: 1010,
            errorRate: 0.01,
            planHash: "h1",
        },
        {
            id: "stepB",
            latencyMs: 52,
            throughputQps: 510,
            errorRate: 0.0,
            planHash: "h2",
        },
    ],
});

function abortedSignal(): AbortSignal {
    const c = new AbortController();
    c.abort();
    return c.signal;
}

function liveSignal(): AbortSignal {
    return new AbortController().signal;
}

function seedHappyArtifacts(artifacts: FakeArtifactProvider, observed: string): void {
    artifacts.set(WORKLOAD_URI, '{"steps":[]}');
    artifacts.set(BASELINE_URI, BASELINE_JSON);
    void observed; // observed is forwarded by the test that owns processes.respond
}

suite("CloudDeploy WorkloadPlaybackValidator", () => {
    let artifacts: FakeArtifactProvider;
    let processes: FakeProcessProvider;
    let validator: WorkloadPlaybackValidator;

    setup(() => {
        artifacts = new FakeArtifactProvider();
        processes = new FakeProcessProvider();
        validator = new WorkloadPlaybackValidator(artifacts, processes);
    });

    test("returns Skipped for SqlProj source-of-truth without reading artifacts", async () => {
        const env = makeEnvironmentWithValidations([], {
            sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "/work/proj.sqlproj" },
        });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        expect(result.displayName).to.equal("Workload Playback");
        expect(artifacts.reads).to.have.length(0);
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Skipped when workloadUri is missing", async () => {
        const env = makeEnvironmentWithValidations([]);

        const result = await validator.run(
            env,
            { baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/workloadUri/);
        expect(artifacts.reads).to.have.length(0);
    });

    test("returns Skipped when baselineUri is missing", async () => {
        const env = makeEnvironmentWithValidations([]);

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/baselineUri/);
        expect(artifacts.reads).to.have.length(0);
    });

    test("returns Skipped when the workload artifact is missing on disk", async () => {
        const env = makeEnvironmentWithValidations([]);
        // workload uri unset; baseline uri set so we exercise "workload missing first" specifically.
        artifacts.set(BASELINE_URI, BASELINE_JSON);

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/Captured workload artifact not found/);
        // We attempted to read workload only; baseline read never happens.
        expect(artifacts.reads.map((r) => r.uri)).to.deep.equal([WORKLOAD_URI]);
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Skipped when the baseline artifact is missing on disk", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        // baseline uri intentionally not seeded.

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/Baseline artifact not found/);
        expect(artifacts.reads.map((r) => r.uri)).to.deep.equal([WORKLOAD_URI, BASELINE_URI]);
        expect(processes.invocations).to.have.length(0);
    });

    test("returns Failed with stderr excerpt when the replay tool exits non-zero", async () => {
        const env = makeEnvironmentWithValidations([]);
        seedHappyArtifacts(artifacts, "");
        processes.respond(DEFAULT_COMMAND, "", {
            mode: "exit",
            exitCode: 2,
            stdout: "",
            stderr: "replay tool: connection refused",
        });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].message).to.match(/exited with code 2/);
        expect(payload.findings[0].message).to.match(/connection refused/);
    });

    test("returns Passed when every step is within thresholds", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        processes.respond(DEFAULT_COMMAND, "", {
            mode: "exit",
            exitCode: 0,
            stdout: NO_REGRESSION_OBSERVED_JSON,
        });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(0);
        expect(payload.summary).to.deep.equal({ steps: 2, regressions: 0 });
    });

    test("emits one finding per regression kind when thresholds are exceeded", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        const observed = JSON.stringify({
            steps: [
                // stepA: latency +50%, plan changed
                {
                    id: "stepA",
                    latencyMs: 150,
                    throughputQps: 1000,
                    errorRate: 0.01,
                    planHash: "h1-new",
                },
                // stepB: throughput -50%, error-rate +10pp
                {
                    id: "stepB",
                    latencyMs: 50,
                    throughputQps: 250,
                    errorRate: 0.1,
                    planHash: "h2",
                },
            ],
        });
        processes.respond(DEFAULT_COMMAND, "", {
            mode: "exit",
            exitCode: 0,
            stdout: observed,
        });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as WorkloadPlaybackPayload;
        const byKind = payload.findings.map((f) => `${f.stepId}:${f.regression}`).sort();
        expect(byKind).to.deep.equal([
            "stepA:latency",
            "stepA:plan-change",
            "stepB:error-rate",
            "stepB:throughput",
        ]);
        expect(payload.summary).to.deep.equal({ steps: 2, regressions: 4 });
    });

    test("threshold overrides change which steps trip", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        // 10% latency bump on stepA: under default 25% threshold (would Pass)
        // but should trip with a 5% override.
        const observed = JSON.stringify({
            steps: [
                {
                    id: "stepA",
                    latencyMs: 110,
                    throughputQps: 1000,
                    errorRate: 0.01,
                    planHash: "h1",
                },
                {
                    id: "stepB",
                    latencyMs: 50,
                    throughputQps: 500,
                    errorRate: 0.0,
                    planHash: "h2",
                },
            ],
        });
        processes.respond(DEFAULT_COMMAND, "", {
            mode: "exit",
            exitCode: 0,
            stdout: observed,
        });

        const result = await validator.run(
            env,
            {
                workloadUri: WORKLOAD_URI,
                baselineUri: BASELINE_URI,
                latencyRegressionThreshold: 0.05,
            },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Failed);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].stepId).to.equal("stepA");
        expect(payload.findings[0].regression).to.equal("latency");
    });

    test("pre-aborted signal throws CancellationError without reading artifacts", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);

        try {
            await validator.run(
                env,
                { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
                { ...RUN_OPTS_BASE, signal: abortedSignal() },
            );
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
            expect(artifacts.reads).to.have.length(0);
            expect(processes.invocations).to.have.length(0);
        }
    });

    test("mid-flight cancel during replay throws CancellationError", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        processes.respond(DEFAULT_COMMAND, "", { mode: "hang" });

        const controller = new AbortController();
        const runPromise = validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: controller.signal },
        );
        // Give the validator time to read artifacts and call spawn before we abort.
        await new Promise((resolve) => setTimeout(resolve, 5));
        controller.abort();

        try {
            await runPromise;
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
        }
    });

    test("malformed baseline JSON re-throws so the runner classifies as Errored", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, "not valid json");

        try {
            await validator.run(
                env,
                { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
                { ...RUN_OPTS_BASE, signal: liveSignal() },
            );
            expect.fail("expected the malformed baseline to throw");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.match(/baseline/);
        }
        // Replay tool was never spawned.
        expect(processes.invocations).to.have.length(0);
    });

    test("forwards the captured workload bytes to the replay tool via stdin", async () => {
        const env = makeEnvironmentWithValidations([]);
        const workloadBody = '{"steps":[{"id":"x"}]}';
        artifacts.set(WORKLOAD_URI, workloadBody);
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        processes.respond(DEFAULT_COMMAND, "", {
            mode: "exit",
            exitCode: 0,
            stdout: NO_REGRESSION_OBSERVED_JSON,
        });

        await validator.run(
            env,
            { workloadUri: WORKLOAD_URI, baselineUri: BASELINE_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(processes.invocations).to.have.length(1);
        expect(processes.invocations[0].command).to.equal(DEFAULT_COMMAND);
        expect(processes.invocations[0].args).to.deep.equal([]);
        expect(processes.invocations[0].stdin).to.equal(workloadBody);
    });

    test("uses the configured replayCommand override", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, '{"steps":[]}');
        artifacts.set(BASELINE_URI, BASELINE_JSON);
        processes.respond("/usr/local/bin/replay-it", "", {
            mode: "exit",
            exitCode: 0,
            stdout: NO_REGRESSION_OBSERVED_JSON,
        });

        const result = await validator.run(
            env,
            {
                workloadUri: WORKLOAD_URI,
                baselineUri: BASELINE_URI,
                replayCommand: "/usr/local/bin/replay-it",
            },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        expect(processes.invocations[0].command).to.equal("/usr/local/bin/replay-it");
    });
});
