/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * End-to-end tests for the D2 validation pipeline. Wires:
 *   * A `ValidatorRegistry` of fake validators (mixed pass / warn / fail / errored)
 *   * A real `DiagnosticEventBus`
 *   * A real `RunArtifactWriter` over `FakeFileProvider`
 *   * A real `RunArtifactReader` over the same provider
 *   * The real `ValidationService`
 * — and asserts the round-trip: `service.run(envId, {persist})` produces a
 * `RunRecord` whose on-disk artifact reads back identical, with the
 * expected `RunStatus` rollups for each scenario.
 *
 * These tests deliberately avoid the VS Code surface (`OutputChannelSubscriber`,
 * command registration). The CloudDeployService wiring is exercised
 * indirectly: this file proves the pieces compose at the API boundary.
 */

import { expect } from "chai";

import { DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";
import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { RunArtifactReader, RunArtifactWriter } from "../../src/cloudDeploy/runs";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunStatus,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";
import { ValidationService } from "../../src/cloudDeploy/validation";

import { FakeFileProvider, makeEnvironment } from "./cloudDeployRunsTestHelpers";
import { makeFakeRegistry, makeValidationConfig } from "./cloudDeployValidationTestHelpers";

const ARTIFACT_DIR = "/artifacts";

class StubEnvironmentStore {
    private readonly _envs = new Map<string, ReturnType<typeof makeEnvironment>>();

    public set(env: ReturnType<typeof makeEnvironment>): void {
        this._envs.set(env.id, env);
    }

    public get(id: string): ReturnType<typeof makeEnvironment> | undefined {
        return this._envs.get(id);
    }

    public list(): readonly ReturnType<typeof makeEnvironment>[] {
        return [...this._envs.values()];
    }
}

interface E2EHarness {
    readonly bus: DiagnosticEventBus;
    readonly fileProvider: FakeFileProvider;
    readonly writer: RunArtifactWriter;
    readonly reader: RunArtifactReader;
    readonly service: ValidationService;
    readonly fakes: ReturnType<typeof makeFakeRegistry>;
    readonly envs: StubEnvironmentStore;
}

function makeHarness(): E2EHarness {
    const bus = new DiagnosticEventBus();
    const fileProvider = new FakeFileProvider();
    const writer = new RunArtifactWriter(fileProvider, bus);
    const reader = new RunArtifactReader(fileProvider);
    const fakes = makeFakeRegistry();
    const envs = new StubEnvironmentStore();
    const service = new ValidationService(
        fakes.registry,
        bus,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        envs as any,
        writer,
    );
    return { bus, fileProvider, writer, reader, service, fakes, envs };
}

suite("CloudDeploy validation pipeline E2E", () => {
    let h: E2EHarness;

    setup(() => {
        h = makeHarness();
    });

    teardown(() => {
        h.bus.dispose();
    });

    test("happy path: passing validation persists and reads back identical", async () => {
        h.envs.set(
            makeEnvironment({
                id: "env-pass",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );

        const result = await h.service.run("env-pass", {
            persist: true,
            artifactDir: ARTIFACT_DIR,
        });

        expect(result.persistError).to.be.undefined;
        expect(result.runArtifactPath).to.be.a("string");
        expect(result.record.status).to.equal(RunStatus.Passed);
        expect(result.record.schemaVersion).to.equal(RUN_RECORD_SCHEMA_VERSION);

        const roundTripped = await h.reader.read(result.runArtifactPath!);
        expect(roundTripped).to.deep.equal(result.record);
    });

    test("rolls up to Failed when one validator fails", async () => {
        h.fakes.connectivity.behavior = { kind: "pass" };
        h.fakes.staticAnalysis.behavior = { kind: "fail" };
        h.envs.set(
            makeEnvironment({
                id: "env-mix",
                validations: [
                    makeValidationConfig(ValidationType.Connectivity),
                    makeValidationConfig(ValidationType.StaticAnalysis),
                ],
            }),
        );

        const result = await h.service.run("env-mix", {
            persist: true,
            artifactDir: ARTIFACT_DIR,
        });

        expect(result.record.status).to.equal(RunStatus.Failed);
        expect(result.record.validations).to.have.length(2);
        const roundTripped = await h.reader.read(result.runArtifactPath!);
        expect(roundTripped.status).to.equal(RunStatus.Failed);
    });

    test("rolls up to Errored when one validator throws", async () => {
        h.fakes.connectivity.behavior = { kind: "pass" };
        h.fakes.unitTests.behavior = { kind: "throw", error: new Error("kaboom") };
        h.envs.set(
            makeEnvironment({
                id: "env-err",
                validations: [
                    makeValidationConfig(ValidationType.Connectivity),
                    makeValidationConfig(ValidationType.UnitTests),
                ],
            }),
        );

        const result = await h.service.run("env-err", {
            persist: true,
            artifactDir: ARTIFACT_DIR,
        });

        expect(result.record.status).to.equal(RunStatus.Errored);
        const roundTripped = await h.reader.read(result.runArtifactPath!);
        expect(roundTripped.status).to.equal(RunStatus.Errored);
        const erroredArm = roundTripped.validations.find(
            (v) => v.status === ValidationStatus.Errored,
        );
        expect(erroredArm).to.not.be.undefined;
        expect(erroredArm!.errorMessage).to.contain("kaboom");
    });

    test("rolls up to Cancelled when the caller aborts mid-run", async () => {
        h.fakes.connectivity.behavior = { kind: "wait-then-pass", delayMs: 10_000 };
        h.envs.set(
            makeEnvironment({
                id: "env-cancel",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );

        const ac = new AbortController();
        const promise = h.service.run("env-cancel", {
            signal: ac.signal,
            persist: true,
            artifactDir: ARTIFACT_DIR,
        });
        ac.abort();
        const result = await promise;

        expect(result.record.status).to.equal(RunStatus.Cancelled);
        const roundTripped = await h.reader.read(result.runArtifactPath!);
        expect(roundTripped.status).to.equal(RunStatus.Cancelled);
    });

    test("synthesized env-not-found record is not persisted", async () => {
        const result = await h.service.run("ghost", {
            persist: true,
            artifactDir: ARTIFACT_DIR,
        });

        expect(result.record.status).to.equal(RunStatus.Errored);
        // env-not-found short-circuits before the writer is even reached.
        expect(result.runArtifactPath).to.be.undefined;
        expect(h.fileProvider.files.size).to.equal(0);
    });

    test("custom runner identity propagates onto the round-tripped artifact", async () => {
        h.envs.set(
            makeEnvironment({
                id: "env-id",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );

        const result = await h.service.run("env-id", {
            persist: true,
            artifactDir: ARTIFACT_DIR,
            runner: { userId: "ci", displayName: "CI", hostKind: "github-actions" },
        });

        const roundTripped = await h.reader.read(result.runArtifactPath!);
        expect(roundTripped.runner.userId).to.equal("ci");
        expect(roundTripped.runner.hostKind).to.equal("github-actions");
    });
});
