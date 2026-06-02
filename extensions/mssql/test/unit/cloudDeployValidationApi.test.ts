/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ValidationService` — the layer that adapts an env id (plus
 * caller options) onto the `Runner` and optionally persists through D3's
 * `RunArtifactWriter`. Covers env lookup (hit, miss), persistence
 * (off / on-success / on-failure / dir-missing), and runner option
 * pass-through (signal, timeoutMs, runner identity).
 */

import { expect } from "chai";

import { DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";
import { EnvironmentStore } from "../../src/cloudDeploy/environments/environmentStore";
import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { RunArtifactWriter } from "../../src/cloudDeploy/runs";
import { RunStatus, ValidationStatus } from "../../src/cloudDeploy/runs/types";
import { ValidationService } from "../../src/cloudDeploy/validation";

import { FakeFileProvider, makeEnvironment } from "./cloudDeployRunsTestHelpers";
import { makeFakeRegistry, makeValidationConfig } from "./cloudDeployValidationTestHelpers";

const ARTIFACT_DIR = "/artifacts";

/**
 * Minimal in-memory `EnvironmentStore`-shaped stub. The real store needs a
 * workspace folder + workspace state; the service only calls `.get(id)`,
 * so a duck-typed object is sufficient for unit tests.
 */
class StubEnvironmentStore {
    private readonly _envs = new Map<string, ReturnType<typeof makeEnvironment>>();

    public set(env: ReturnType<typeof makeEnvironment>): void {
        this._envs.set(env.id, env);
    }

    public get(id: string): ReturnType<typeof makeEnvironment> | undefined {
        return this._envs.get(id);
    }

    // Other EnvironmentStore methods are unused by ValidationService.
    public list(): readonly ReturnType<typeof makeEnvironment>[] {
        return [...this._envs.values()];
    }
}

suite("CloudDeploy ValidationService", () => {
    let bus: DiagnosticEventBus;
    let envs: StubEnvironmentStore;

    setup(() => {
        bus = new DiagnosticEventBus();
        envs = new StubEnvironmentStore();
    });

    teardown(() => {
        bus.dispose();
    });

    test("returns a synthesized errored RunRecord when the env id is unknown", async () => {
        const { registry } = makeFakeRegistry();
        const service = new ValidationService(registry, bus, envs as unknown as EnvironmentStore);

        const result = await service.run("ghost-env");

        expect(result.record.status).to.equal(RunStatus.Errored);
        expect(result.record.environmentId).to.equal("ghost-env");
        expect(result.record.validations).to.have.length(1);
        expect(result.record.validations[0].status).to.equal(ValidationStatus.Errored);
        expect(result.record.validations[0].errorMessage).to.contain("ghost-env");
        expect(result.runArtifactPath).to.be.undefined;
    });

    test("dispatches the run when the env is found", async () => {
        const { registry, connectivity } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const service = new ValidationService(registry, bus, envs as unknown as EnvironmentStore);

        const result = await service.run("ok-env");

        expect(connectivity.invocations).to.have.length(1);
        expect(connectivity.invocations[0].envId).to.equal("ok-env");
        expect(result.record.status).to.equal(RunStatus.Passed);
        expect(result.runArtifactPath).to.be.undefined;
    });

    test("does not persist when persist is omitted", async () => {
        const { registry } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const fileProvider = new FakeFileProvider();
        const writer = new RunArtifactWriter(fileProvider, bus);
        const service = new ValidationService(
            registry,
            bus,
            envs as unknown as EnvironmentStore,
            writer,
        );

        const result = await service.run("ok-env");

        expect(result.runArtifactPath).to.be.undefined;
        expect(fileProvider.files.size).to.equal(0);
    });

    test("persists the run artifact when persist is true and writer is wired", async () => {
        const { registry } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const fileProvider = new FakeFileProvider();
        const writer = new RunArtifactWriter(fileProvider, bus);
        const service = new ValidationService(
            registry,
            bus,
            envs as unknown as EnvironmentStore,
            writer,
        );

        const result = await service.run("ok-env", { persist: true, artifactDir: ARTIFACT_DIR });

        expect(result.runArtifactPath).to.be.a("string");
        expect(result.runArtifactPath!).to.contain("artifacts");
        expect(result.runArtifactPath!.endsWith(".cdrun.zip")).to.equal(true);
        expect(fileProvider.files.size).to.equal(1);
        expect(result.persistError).to.be.undefined;
    });

    test("surfaces persistError when persist=true but artifactDir is missing", async () => {
        const { registry } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const fileProvider = new FakeFileProvider();
        const writer = new RunArtifactWriter(fileProvider, bus);
        const service = new ValidationService(
            registry,
            bus,
            envs as unknown as EnvironmentStore,
            writer,
        );

        const result = await service.run("ok-env", { persist: true });

        expect(result.runArtifactPath).to.be.undefined;
        expect(result.persistError).to.be.a("string");
        expect(result.record.status).to.equal(RunStatus.Passed);
    });

    test("surfaces persistError when the writer throws", async () => {
        const { registry } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        // FileProvider stub whose `writeFileAtomic` always rejects, so the
        // writer's caller sees the underlying I/O error.
        const writer = new RunArtifactWriter(
            {
                readFileBuffer: () => Promise.reject(new Error("nope")),
                writeFileAtomic: () => Promise.reject(new Error("disk full")),
                fileExists: () => Promise.resolve(false),
            },
            bus,
        );
        const service = new ValidationService(
            registry,
            bus,
            envs as unknown as EnvironmentStore,
            writer,
        );

        const result = await service.run("ok-env", { persist: true, artifactDir: ARTIFACT_DIR });

        expect(result.persistError).to.contain("disk full");
        expect(result.runArtifactPath).to.be.undefined;
        expect(result.record.status).to.equal(RunStatus.Passed);
    });

    test("forwards the AbortSignal to the runner", async () => {
        const { registry, connectivity } = makeFakeRegistry();
        connectivity.behavior = { kind: "wait-then-pass", delayMs: 1_000 };
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const service = new ValidationService(registry, bus, envs as unknown as EnvironmentStore);

        const controller = new AbortController();
        const promise = service.run("ok-env", { signal: controller.signal });
        // Immediately abort; the validator unblocks via signal.
        controller.abort();
        const result = await promise;

        expect(result.record.status).to.equal(RunStatus.Cancelled);
    });

    test("forwards a custom runner identity onto the RunRecord", async () => {
        const { registry } = makeFakeRegistry();
        envs.set(
            makeEnvironment({
                id: "ok-env",
                validations: [makeValidationConfig(ValidationType.Connectivity)],
            }),
        );
        const service = new ValidationService(registry, bus, envs as unknown as EnvironmentStore);

        const result = await service.run("ok-env", {
            runner: {
                userId: "ci-user",
                displayName: "CI",
                hostKind: "github-actions",
            },
        });

        expect(result.record.runner.userId).to.equal("ci-user");
        expect(result.record.runner.hostKind).to.equal("github-actions");
    });

    test("operates without an env store — every lookup returns env-not-found", async () => {
        const { registry } = makeFakeRegistry();
        const service = new ValidationService(registry, bus, undefined);

        const result = await service.run("any-env");

        expect(result.record.status).to.equal(RunStatus.Errored);
        expect(result.record.validations[0].errorMessage).to.contain("any-env");
    });
});
