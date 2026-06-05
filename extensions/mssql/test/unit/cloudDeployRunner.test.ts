/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy validation `Runner` orchestrator. Covers:
 *   * Dispatch order (connectivity-first, declaration order otherwise).
 *   * Per-`validationStatus` rollup into `RunStatus` via worst-wins.
 *   * Cancellation: pre-aborted signal, mid-flight cancellation, timeout flavor.
 *   * Connectivity gating: a failing connectivity validation Skips the rest.
 *   * Bus event ordering: run-started → per-validation pairs → run-finished.
 *   * `RunRecord` construction: schemaVersion, env snapshot, runner identity, ids.
 *   * Disabled validations are silently skipped (no event, no result entry).
 *   * Errors from `validator.run()` are caught and surfaced as `Errored`.
 */

import { expect } from "chai";

import { DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";
import { ValidationType } from "../../src/cloudDeploy/environments/types";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunStatus,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";
import {
    ConnectivityValidator,
    defineRegistry,
    FakeConnectionProvider,
    Runner,
} from "../../src/cloudDeploy/validation";

import {
    makeEnvironmentWithValidations,
    makeFakeRegistry,
    makeValidationConfig,
    TestEventCollector,
} from "./cloudDeployValidationTestHelpers";

suite("CloudDeploy Validation Runner", () => {
    let bus: DiagnosticEventBus;
    let collector: TestEventCollector;

    setup(() => {
        bus = new DiagnosticEventBus();
        collector = new TestEventCollector(bus);
    });

    teardown(() => {
        collector.dispose();
        bus.dispose();
    });

    // -------------------------------------------------------------------------
    // Dispatch + ordering
    // -------------------------------------------------------------------------

    suite("dispatch order", () => {
        test("runs connectivity first even when declared last", async () => {
            const { registry, connectivity, staticAnalysis, unitTests } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
                makeValidationConfig(ValidationType.Connectivity),
            ]);

            const startOrder: ValidationType[] = [];
            for (const v of [connectivity, staticAnalysis, unitTests]) {
                const original = v.run.bind(v);
                v.run = async (...args) => {
                    startOrder.push(v.type);
                    return original(...args);
                };
            }

            await new Runner(registry, bus).run(env);

            expect(startOrder).to.deep.equal([
                ValidationType.Connectivity,
                ValidationType.StaticAnalysis,
                ValidationType.UnitTests,
            ]);
        });

        test("preserves declaration order for non-connectivity validations", async () => {
            const { registry, staticAnalysis, unitTests, workloadPlayback } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.WorkloadPlayback),
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const startOrder: ValidationType[] = [];
            for (const v of [staticAnalysis, unitTests, workloadPlayback]) {
                const original = v.run.bind(v);
                v.run = async (...args) => {
                    startOrder.push(v.type);
                    return original(...args);
                };
            }

            await new Runner(registry, bus).run(env);

            expect(startOrder).to.deep.equal([
                ValidationType.WorkloadPlayback,
                ValidationType.StaticAnalysis,
                ValidationType.UnitTests,
            ]);
        });
    });

    // -------------------------------------------------------------------------
    // Enabled gating
    // -------------------------------------------------------------------------

    suite("enabled flag", () => {
        test("skips disabled validations entirely (no invocation, no result entry)", async () => {
            const { registry, staticAnalysis, unitTests } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis, { enabled: false }),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);

            expect(staticAnalysis.invocations).to.have.length(0);
            expect(unitTests.invocations).to.have.length(1);
            expect(record.validations).to.have.length(1);
            expect(record.validations[0].payload.validationType).to.equal(ValidationType.UnitTests);
        });

        test("empty validations array rolls up to Passed", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([]);

            const record = await new Runner(registry, bus).run(env);

            expect(record.status).to.equal(RunStatus.Passed);
            expect(record.validations).to.have.length(0);
        });
    });

    // -------------------------------------------------------------------------
    // Status rollup
    // -------------------------------------------------------------------------

    suite("status rollup", () => {
        test("all-Passed rolls up to Passed", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);
            expect(record.status).to.equal(RunStatus.Passed);
        });

        test("a single Warning rolls up to Warning when nothing worse is present", async () => {
            const { registry, staticAnalysis } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "warning" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);
            expect(record.status).to.equal(RunStatus.Warning);
        });

        test("Failed beats Warning in the rollup", async () => {
            const { registry, staticAnalysis, unitTests } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "warning" };
            unitTests.behavior = { kind: "fail" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);
            expect(record.status).to.equal(RunStatus.Failed);
        });

        test("Errored beats Failed (highest severity wins)", async () => {
            const { registry, staticAnalysis, unitTests } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "fail" };
            unitTests.behavior = { kind: "errored", message: "boom" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);
            expect(record.status).to.equal(RunStatus.Errored);
        });
    });

    // -------------------------------------------------------------------------
    // Cancellation
    // -------------------------------------------------------------------------

    suite("cancellation", () => {
        test("pre-aborted signal Cancels every validation without invoking validators", async () => {
            const { registry, connectivity, staticAnalysis } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);
            const controller = new AbortController();
            controller.abort();

            const record = await new Runner(registry, bus).run(env, { signal: controller.signal });

            expect(connectivity.invocations).to.have.length(0);
            expect(staticAnalysis.invocations).to.have.length(0);
            expect(record.status).to.equal(RunStatus.Cancelled);
            for (const r of record.validations) {
                expect(r.status).to.equal(ValidationStatus.Cancelled);
                expect(r.cancellationReason).to.equal("user");
            }
        });

        test("a validator throwing CancellationError mid-flight cancels the remaining validations", async () => {
            const { registry, connectivity, staticAnalysis, unitTests } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "cancel" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            const record = await new Runner(registry, bus).run(env);

            expect(connectivity.invocations).to.have.length(1);
            expect(staticAnalysis.invocations).to.have.length(1);
            expect(unitTests.invocations).to.have.length(0);
            const byType = new Map(
                record.validations.map((r) => [r.payload.validationType, r.status]),
            );
            expect(byType.get(ValidationType.Connectivity)).to.equal(ValidationStatus.Passed);
            expect(byType.get(ValidationType.StaticAnalysis)).to.equal(ValidationStatus.Cancelled);
            expect(byType.get(ValidationType.UnitTests)).to.equal(ValidationStatus.Cancelled);
            expect(record.status).to.equal(RunStatus.Cancelled);
        });

        test('timeoutMs surfaces cancellation with reason "timeout"', async () => {
            const { registry, staticAnalysis } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "wait-then-pass", delayMs: 2_000 };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            const record = await new Runner(registry, bus).run(env, { timeoutMs: 5 });

            expect(record.status).to.equal(RunStatus.Cancelled);
            expect(record.validations[0].status).to.equal(ValidationStatus.Cancelled);
            expect(record.validations[0].cancellationReason).to.equal("timeout");
        });
    });

    // -------------------------------------------------------------------------
    // Connectivity gating
    // -------------------------------------------------------------------------

    suite("connectivity gating", () => {
        test("a failing connectivity validation marks subsequent validations Skipped", async () => {
            const { registry, connectivity, staticAnalysis, unitTests } = makeFakeRegistry();
            connectivity.behavior = { kind: "fail" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
                makeValidationConfig(ValidationType.Connectivity),
            ]);

            const record = await new Runner(registry, bus).run(env);

            expect(connectivity.invocations).to.have.length(1);
            expect(staticAnalysis.invocations).to.have.length(0);
            expect(unitTests.invocations).to.have.length(0);
            const byType = new Map(record.validations.map((r) => [r.payload.validationType, r]));
            expect(byType.get(ValidationType.Connectivity)?.status).to.equal(
                ValidationStatus.Failed,
            );
            expect(byType.get(ValidationType.StaticAnalysis)?.status).to.equal(
                ValidationStatus.Skipped,
            );
            expect(byType.get(ValidationType.UnitTests)?.status).to.equal(ValidationStatus.Skipped);
        });

        test("a passing connectivity validation does not gate anything", async () => {
            const { registry, staticAnalysis, unitTests } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);

            await new Runner(registry, bus).run(env);

            expect(staticAnalysis.invocations).to.have.length(1);
            expect(unitTests.invocations).to.have.length(1);
        });
    });

    // -------------------------------------------------------------------------
    // Bus emission
    // -------------------------------------------------------------------------

    suite("bus emission", () => {
        test("emits validation-run-started first and validation-run-finished last", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            await new Runner(registry, bus).run(env);

            expect(collector.events.length).to.be.greaterThan(0);
            expect(collector.events[0].type).to.equal("validation-run-started");
            expect(collector.events[collector.events.length - 1].type).to.equal(
                "validation-run-finished",
            );
        });

        test("validation-run-started carries the dispatch order in validationTypes", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.Connectivity),
            ]);

            await new Runner(registry, bus).run(env);

            const started = collector.eventsOfType("validation-run-started")[0];
            expect(started.payload.validationTypes).to.deep.equal([
                ValidationType.Connectivity,
                ValidationType.StaticAnalysis,
            ]);
        });

        test("emits paired validation-started/validation-finished events for cancelled validations", async () => {
            const { registry, staticAnalysis } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "cancel" };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            await new Runner(registry, bus).run(env);

            const started = collector.eventsOfType("validation-started");
            const finished = collector.eventsOfType("validation-finished");
            expect(started).to.have.length(1);
            expect(finished).to.have.length(1);
            expect(finished[0].payload.status).to.equal(ValidationStatus.Cancelled);
            expect(finished[0].payload.cancellationReason).to.equal("user");
        });

        test("emits a paired validation-started/validation-finished for each validation on the happy path", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            await new Runner(registry, bus).run(env);

            const started = collector.eventsOfType("validation-started");
            const finished = collector.eventsOfType("validation-finished");
            expect(started).to.have.length(2);
            expect(finished).to.have.length(2);
            expect(started.map((event) => event.payload.validationType)).to.deep.equal([
                ValidationType.Connectivity,
                ValidationType.StaticAnalysis,
            ]);
            expect(finished.map((event) => event.payload.status)).to.deep.equal([
                ValidationStatus.Passed,
                ValidationStatus.Passed,
            ]);
        });
    });

    // -------------------------------------------------------------------------
    // Errored capture
    // -------------------------------------------------------------------------

    suite("error capture", () => {
        test("non-CancellationError exceptions surface as Errored with errorMessage", async () => {
            const { registry, staticAnalysis } = makeFakeRegistry();
            staticAnalysis.behavior = { kind: "throw", error: new Error("kaboom") };
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            const record = await new Runner(registry, bus).run(env);

            expect(record.validations[0].status).to.equal(ValidationStatus.Errored);
            expect(record.validations[0].errorMessage).to.equal("kaboom");
            expect(record.status).to.equal(RunStatus.Errored);
        });
    });

    // -------------------------------------------------------------------------
    // RunRecord construction
    // -------------------------------------------------------------------------

    suite("RunRecord", () => {
        test("stamps schemaVersion, environmentId, env snapshot, and runner identity", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);

            const record = await new Runner(registry, bus).run(env);

            expect(record.schemaVersion).to.equal(RUN_RECORD_SCHEMA_VERSION);
            expect(record.environmentId).to.equal(env.id);
            expect(record.environmentSnapshot).to.equal(env);
            expect(record.runner.hostKind).to.equal("vscode");
            expect(record.runner.userId).to.be.a("string").and.not.empty;
            expect(record.endedAtMs).to.be.at.least(record.startedAtMs);
        });

        test("uses the provided runId and runner identity when supplied", async () => {
            const { registry } = makeFakeRegistry();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);
            const runner = {
                userId: "test-user",
                displayName: "Test User",
                hostKind: "vscode" as const,
            };

            const record = await new Runner(registry, bus).run(env, {
                runId: "my-run-id",
                runner,
            });

            expect(record.runId).to.equal("my-run-id");
            expect(record.runner).to.deep.equal(runner);
        });
    });

    // -------------------------------------------------------------------------
    // Real ConnectivityValidator integration (commit 2)
    //
    // Exercises the runner with the real `ConnectivityValidator` wired in
    // place of the fake-connectivity arm. Proves the end-to-end path —
    // provider → validator → runner — produces the expected RunRecord
    // shape and that gating fires off a real Failed result, not just a
    // fake-configured one.
    // -------------------------------------------------------------------------

    suite("real ConnectivityValidator integration", () => {
        function buildRegistryWithRealConnectivity(provider: FakeConnectionProvider) {
            const fakes = makeFakeRegistry();
            return defineRegistry({
                [ValidationType.Connectivity]: new ConnectivityValidator(provider),
                [ValidationType.StaticAnalysis]: fakes.staticAnalysis,
                [ValidationType.UnitTests]: fakes.unitTests,
                [ValidationType.WorkloadPlayback]: fakes.workloadPlayback,
            });
        }

        test("real connectivity Pass → run rolls up to Passed; rest of validators run", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
            ]);
            provider.configure(env.id, {
                mode: "success",
                handle: { executeResponses: { "SELECT @@VERSION": [["SQL Server 2022"]] } },
            });
            const registry = buildRegistryWithRealConnectivity(provider);

            const record = await new Runner(registry, bus).run(env);

            expect(record.status).to.equal(RunStatus.Passed);
            const byType = new Map(record.validations.map((r) => [r.payload.validationType, r]));
            const connRes = byType.get(ValidationType.Connectivity);
            expect(connRes?.status).to.equal(ValidationStatus.Passed);
            const summary = (connRes?.payload as { summary: { serverVersion?: string } }).summary;
            expect(summary.serverVersion).to.equal("SQL Server 2022");
            expect(byType.get(ValidationType.StaticAnalysis)?.status).to.equal(
                ValidationStatus.Passed,
            );
        });

        test("real connectivity Fail (auth-failed) → run rolls up to Failed; rest are Skipped", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
            ]);
            provider.configure(env.id, { mode: "failure", kind: "auth-failed" });
            const registry = buildRegistryWithRealConnectivity(provider);

            const record = await new Runner(registry, bus).run(env);

            expect(record.status).to.equal(RunStatus.Failed);
            const byType = new Map(record.validations.map((r) => [r.payload.validationType, r]));
            expect(byType.get(ValidationType.Connectivity)?.status).to.equal(
                ValidationStatus.Failed,
            );
            expect(byType.get(ValidationType.StaticAnalysis)?.status).to.equal(
                ValidationStatus.Skipped,
            );
            expect(byType.get(ValidationType.UnitTests)?.status).to.equal(ValidationStatus.Skipped);
        });

        test("connectivity always dispatches first even when declared last", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.StaticAnalysis),
                makeValidationConfig(ValidationType.UnitTests),
                makeValidationConfig(ValidationType.Connectivity),
            ]);
            provider.configure(env.id, { mode: "failure", kind: "connection-refused" });
            const registry = buildRegistryWithRealConnectivity(provider);

            const record = await new Runner(registry, bus).run(env);

            // The runner reorders connectivity to run first regardless of declaration order.
            // We assert via the persisted result list (validators don't emit per-arm events
            // themselves yet; only the runner-synthesized Skipped/Cancelled paths do).
            expect(record.validations[0].payload.validationType).to.equal(
                ValidationType.Connectivity,
            );
            expect(record.validations[0].status).to.equal(ValidationStatus.Failed);
        });

        test("provider sees the same env id the runner is processing", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations(
                [makeValidationConfig(ValidationType.Connectivity)],
                { id: "env-real-conn" },
            );
            const registry = buildRegistryWithRealConnectivity(provider);

            await new Runner(registry, bus).run(env);

            expect(provider.invocations.map((i) => i.envId)).to.deep.equal(["env-real-conn"]);
        });

        test("timeoutMs cancels real connectivity; runner stamps reason 'timeout'", async () => {
            const provider = new FakeConnectionProvider();
            const env = makeEnvironmentWithValidations([
                makeValidationConfig(ValidationType.Connectivity),
            ]);
            provider.configure(env.id, { mode: "timeout" });
            const registry = buildRegistryWithRealConnectivity(provider);

            const record = await new Runner(registry, bus).run(env, { timeoutMs: 10 });

            const conn = record.validations[0];
            expect(conn.status).to.equal(ValidationStatus.Cancelled);
            expect(conn.cancellationReason).to.equal("timeout");
        });
    });
});
