/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `WorkloadSimulationValidator`: it drives the sqlpysim engine against
 * the per-run ephemeral connection string, records aggregate throughput /
 * latency as one observed step, and flags advisory regressions vs the baseline.
 *   * skips (not fails) when the connection string, engine, workloadUri, or
 *     workload file is absent;
 *   * first run records measurements and passes;
 *   * a throughput / latency drop past threshold warns (advisory, never fails);
 *   * an engine failure surfaces as Errored.
 */

import { expect } from "chai";
import { rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

import { type Environment, SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import { ValidationStatus, type WorkloadObservedStep } from "../../src/cloudDeploy/runs/types";
import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";
import { type ValidatorRunOptions } from "../../src/cloudDeploy/validation/types";
import { WorkloadSimulationValidator } from "../../src/cloudDeploy/validation/validators/workloadSimulationValidator";

const ENGINE = { pythonCommand: "python", sqlpysimPath: "/tools/sqlpysim.py" };
const ENV: Environment = {
    id: "e",
    name: "E",
    sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "db.sqlproj" },
    validations: [],
};

const created: string[] = [];

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

function tempWorkload(): string {
    const p = path.join(os.tmpdir(), `cd-wlsim-${randomUUID()}.sql`);
    writeFileSync(p, "SELECT 1;");
    created.push(p);
    return p;
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

function respond(processes: FakeProcessProvider, stdout: string, exitCode = 0): void {
    processes.respond("python", "/tools/sqlpysim.py", { mode: "exit", exitCode, stdout });
}

function opts(over?: Partial<ValidatorRunOptions>): ValidatorRunOptions {
    return { runId: "r", signal: newSignal(), ephemeralConnectionString: "Server=db;", ...over };
}

suite("CloudDeploy WorkloadSimulationValidator", () => {
    suiteTeardown(() => {
        for (const p of created) {
            try {
                rmSync(p);
            } catch {
                // best-effort temp cleanup
            }
        }
    });

    suite("skips", () => {
        test("skips when no ephemeral connection string was provided", async () => {
            const v = new WorkloadSimulationValidator(new FakeProcessProvider(), ENGINE);
            const r = await v.run(
                ENV,
                { workloadUri: tempWorkload() },
                opts({ ephemeralConnectionString: undefined }),
            );
            expect(r.status).to.equal(ValidationStatus.Skipped);
        });

        test("skips when the engine is not configured", async () => {
            const v = new WorkloadSimulationValidator(new FakeProcessProvider(), undefined);
            const r = await v.run(ENV, { workloadUri: tempWorkload() }, opts());
            expect(r.status).to.equal(ValidationStatus.Skipped);
        });

        test("skips when workloadUri is missing", async () => {
            const v = new WorkloadSimulationValidator(new FakeProcessProvider(), ENGINE);
            const r = await v.run(ENV, {}, opts());
            expect(r.status).to.equal(ValidationStatus.Skipped);
        });

        test("skips when the workload file does not exist", async () => {
            const v = new WorkloadSimulationValidator(new FakeProcessProvider(), ENGINE);
            const r = await v.run(ENV, { workloadUri: "/no/such/workload.sql" }, opts());
            expect(r.status).to.equal(ValidationStatus.Skipped);
        });
    });

    test("first run records the observed step and passes", async () => {
        const processes = new FakeProcessProvider();
        respond(processes, json(800, 2, 8));
        const v = new WorkloadSimulationValidator(processes, ENGINE);

        const r = await v.run(ENV, { workloadUri: tempWorkload(), runs: 1 }, opts());

        expect(r.status).to.equal(ValidationStatus.Passed);
        const payload = r.payload as { observedSteps?: readonly WorkloadObservedStep[] };
        expect(payload.observedSteps).to.have.length(1);
        expect(payload.observedSteps?.[0].id).to.equal("workload");
        expect(payload.observedSteps?.[0].throughputQps).to.equal(400);
    });

    test("first run surfaces measured throughput and latency as changes", async () => {
        const processes = new FakeProcessProvider();
        respond(processes, json(800, 2, 8));
        const v = new WorkloadSimulationValidator(processes, ENGINE);

        const r = await v.run(ENV, { workloadUri: tempWorkload(), runs: 1 }, opts());

        const payload = r.payload as { changes?: readonly { axis: string }[] };
        const axes = (payload.changes ?? []).map((c) => c.axis);
        expect(axes).to.include("throughput");
        expect(axes).to.include("latency");
    });

    test("warns when throughput drops past the threshold vs the baseline", async () => {
        const processes = new FakeProcessProvider();
        respond(processes, json(800, 8, 8)); // 100 batches/s, 10 ms/batch
        const v = new WorkloadSimulationValidator(processes, ENGINE);
        const baseline: WorkloadObservedStep[] = [
            { id: "workload", latencyMs: 5, throughputQps: 1000 },
        ];

        const r = await v.run(
            ENV,
            { workloadUri: tempWorkload(), runs: 1 },
            opts({ workloadBaseline: baseline }),
        );

        expect(r.status).to.equal(ValidationStatus.Warning);
        const payload = r.payload as { findings: readonly unknown[] };
        expect(payload.findings.length).to.be.greaterThan(0);
    });

    test("errors when the engine reports a failed run", async () => {
        const processes = new FakeProcessProvider();
        respond(processes, json(100, 1, 1, false), 1);
        const v = new WorkloadSimulationValidator(processes, ENGINE);

        const r = await v.run(ENV, { workloadUri: tempWorkload(), runs: 1 }, opts());

        expect(r.status).to.equal(ValidationStatus.Errored);
    });
});
