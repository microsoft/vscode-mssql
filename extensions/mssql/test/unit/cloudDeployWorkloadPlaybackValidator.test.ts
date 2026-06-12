/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `WorkloadPlaybackValidator` (Scope 2, in-process measurement +
 * run-based baseline):
 *   * Skipped when no ephemeral connection was provisioned.
 *   * Skipped when `workloadUri` is missing in settings.
 *   * Skipped when the workload spec is missing on disk
 *     (`ArtifactNotFoundError`).
 *   * Skipped when the spec declares no measurable steps.
 *   * Each spec step's query is executed `iterations` times against the
 *     ephemeral connection.
 *   * First run (no baseline) → Passed, recording observed steps.
 *   * Regression beyond threshold → Warning (not Failed), with the observed
 *     steps recorded.
 *   * No regression against a baseline → Passed.
 *   * Threshold override changes whether a step trips.
 *   * A query that throws while being measured → Errored.
 *   * Pre-aborted signal throws `CancellationError` without reading the spec.
 *   * Malformed spec JSON re-throws so the runner classifies as `Errored`.
 */

import { expect } from "chai";

import { ValidationStatus, type WorkloadPlaybackPayload } from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    type ConnectionHandle,
    FakeArtifactProvider,
    WorkloadPlaybackValidator,
} from "../../src/cloudDeploy/validation";

import { makeEnvironmentWithValidations } from "./cloudDeployValidationTestHelpers";

const RUN_OPTS_BASE = { runId: "run-test" } as const;
const WORKLOAD_URI = "file:///workload.json";

const QUERY_A = "SELECT * FROM dbo.A;";
const QUERY_B = "SELECT * FROM dbo.B;";

const SPEC_TWO_STEPS = JSON.stringify({
    steps: [
        { id: "stepA", query: QUERY_A, iterations: 3 },
        { id: "stepB", query: QUERY_B, iterations: 1 },
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

/**
 * Test-double connection that records each executed SQL and optionally sleeps
 * a configured number of milliseconds per query so a step's measured latency
 * is deterministically high (or low). One query may be configured to throw.
 */
class MeasurableConnectionHandle implements ConnectionHandle {
    public readonly executed: string[] = [];
    public disposed = false;

    public constructor(
        private readonly _delayMsBySql: Readonly<Record<string, number>> = {},
        private readonly _throwOnSql?: string,
    ) {}

    public async execute(sql: string, _signal: AbortSignal): Promise<unknown[][]> {
        this.executed.push(sql);
        if (this._throwOnSql !== undefined && sql === this._throwOnSql) {
            throw new Error("query blew up");
        }
        const delay = this._delayMsBySql[sql] ?? 0;
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        return [[]];
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
    }

    /** Count of recorded executions for a given SQL string. */
    public countOf(sql: string): number {
        return this.executed.filter((s) => s === sql).length;
    }
}

suite("CloudDeploy WorkloadPlaybackValidator", () => {
    let artifacts: FakeArtifactProvider;
    let validator: WorkloadPlaybackValidator;

    setup(() => {
        artifacts = new FakeArtifactProvider();
        validator = new WorkloadPlaybackValidator(artifacts);
    });

    test("returns Skipped when no ephemeral connection was provisioned", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, SPEC_TWO_STEPS);

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal() },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        expect(result.displayName).to.equal("Workload Playback");
        expect(artifacts.reads).to.have.length(0);
    });

    test("returns Skipped when workloadUri is missing", async () => {
        const env = makeEnvironmentWithValidations([]);

        const result = await validator.run(
            env,
            {},
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: new MeasurableConnectionHandle(),
            },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/workloadUri/);
        expect(artifacts.reads).to.have.length(0);
    });

    test("returns Skipped when the workload spec is missing on disk", async () => {
        const env = makeEnvironmentWithValidations([]);
        // workloadUri set but artifact intentionally not seeded.

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: new MeasurableConnectionHandle(),
            },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/Workload spec not found/);
        expect(artifacts.reads.map((r) => r.uri)).to.deep.equal([WORKLOAD_URI]);
    });

    test("returns Skipped when the spec declares no measurable steps", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, JSON.stringify({ steps: [] }));

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: new MeasurableConnectionHandle(),
            },
        );

        expect(result.status).to.equal(ValidationStatus.Skipped);
    });

    test("executes each step's query for the configured iteration count", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, SPEC_TWO_STEPS);
        const connection = new MeasurableConnectionHandle();

        await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal(), ephemeralConnection: connection },
        );

        expect(connection.countOf(QUERY_A)).to.equal(3);
        expect(connection.countOf(QUERY_B)).to.equal(1);
    });

    test("returns Passed and records observed steps when there is no baseline", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, SPEC_TWO_STEPS);

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: new MeasurableConnectionHandle(),
                // no workloadBaseline
            },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(0);
        expect(payload.summary).to.deep.equal({ steps: 2, regressions: 0 });
        expect(payload.observedSteps?.map((s) => s.id)).to.deep.equal(["stepA", "stepB"]);
    });

    test("returns Warning (not Failed) when a step regresses beyond threshold", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, JSON.stringify({ steps: [{ id: "stepA", query: QUERY_A }] }));
        // Make stepA take a clearly-measurable time so observed >> baseline.
        const connection = new MeasurableConnectionHandle({ [QUERY_A]: 40 });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: connection,
                workloadBaseline: [{ id: "stepA", latencyMs: 1 }],
            },
        );

        expect(result.status).to.equal(ValidationStatus.Warning);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(1);
        expect(payload.findings[0].stepId).to.equal("stepA");
        expect(payload.findings[0].regression).to.equal("latency");
    });

    test("returns Passed when no step regresses against the baseline", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, JSON.stringify({ steps: [{ id: "stepA", query: QUERY_A }] }));
        const connection = new MeasurableConnectionHandle({ [QUERY_A]: 2 });

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: connection,
                // Generous baseline: observed (~2 ms) is far below it, no regression.
                workloadBaseline: [{ id: "stepA", latencyMs: 5000 }],
            },
        );

        expect(result.status).to.equal(ValidationStatus.Passed);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings).to.have.length(0);
    });

    test("threshold override changes whether a step trips", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, JSON.stringify({ steps: [{ id: "stepA", query: QUERY_A }] }));
        const lenientConnection = new MeasurableConnectionHandle({ [QUERY_A]: 2 });

        // Default 25% threshold: observed (~2 ms) is far below baseline (100 ms),
        // so no regression.
        const lenient = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: lenientConnection,
                workloadBaseline: [{ id: "stepA", latencyMs: 100 }],
            },
        );
        expect(lenient.status).to.equal(ValidationStatus.Passed);

        // A tiny baseline relative to a clearly-measurable observed latency
        // trips a regression at the default threshold.
        const strictConnection = new MeasurableConnectionHandle({ [QUERY_A]: 40 });
        const strict = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            {
                ...RUN_OPTS_BASE,
                signal: liveSignal(),
                ephemeralConnection: strictConnection,
                workloadBaseline: [{ id: "stepA", latencyMs: 1 }],
            },
        );
        expect(strict.status).to.equal(ValidationStatus.Warning);
        expect((strict.payload as WorkloadPlaybackPayload).findings[0].regression).to.equal(
            "latency",
        );
    });

    test("returns Errored when a workload query throws while being measured", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, JSON.stringify({ steps: [{ id: "stepA", query: QUERY_A }] }));
        const connection = new MeasurableConnectionHandle({}, QUERY_A);

        const result = await validator.run(
            env,
            { workloadUri: WORKLOAD_URI },
            { ...RUN_OPTS_BASE, signal: liveSignal(), ephemeralConnection: connection },
        );

        expect(result.status).to.equal(ValidationStatus.Errored);
        const payload = result.payload as WorkloadPlaybackPayload;
        expect(payload.findings[0].message).to.match(/Workload measurement failed/);
    });

    test("pre-aborted signal throws CancellationError without reading the spec", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, SPEC_TWO_STEPS);

        try {
            await validator.run(
                env,
                { workloadUri: WORKLOAD_URI },
                {
                    ...RUN_OPTS_BASE,
                    signal: abortedSignal(),
                    ephemeralConnection: new MeasurableConnectionHandle(),
                },
            );
            expect.fail("expected CancellationError");
        } catch (err) {
            expect(err).to.be.instanceOf(CancellationError);
            expect(artifacts.reads).to.have.length(0);
        }
    });

    test("malformed spec JSON re-throws so the runner classifies as Errored", async () => {
        const env = makeEnvironmentWithValidations([]);
        artifacts.set(WORKLOAD_URI, "not valid json");

        try {
            await validator.run(
                env,
                { workloadUri: WORKLOAD_URI },
                {
                    ...RUN_OPTS_BASE,
                    signal: liveSignal(),
                    ephemeralConnection: new MeasurableConnectionHandle(),
                },
            );
            expect.fail("expected the malformed spec to throw");
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.match(/workload spec/i);
        }
    });
});
