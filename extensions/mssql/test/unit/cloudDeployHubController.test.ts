/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { CloudDeployHubController } from "../../src/cloudDeploy/dashboard/cloudDeployHubController";
import {
    CloudDeployHubReducers,
    CloudDeployHubState,
} from "../../src/sharedInterfaces/cloudDeployHub";
import { EnvironmentStore } from "../../src/cloudDeploy/environments/environmentStore";
import { Environment } from "../../src/cloudDeploy/environments/types";
import {
    RunArtifactReader,
    RunArtifactWriter,
    RunStatus,
    RunStore,
    RunsDirectoryReader,
} from "../../src/cloudDeploy/runs";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    FakeFileProvider,
    makeEnvironment,
    makeValidRunRecord,
} from "./cloudDeployRunsTestHelpers";
import { stubVscodeWrapper } from "./utils";

class FakeDirectoryReader implements RunsDirectoryReader {
    public paths: string[] = [];
    public async list(): Promise<readonly string[]> {
        return this.paths.slice();
    }
}

/**
 * Minimal `EnvironmentStore` stub. Only the surface the hub controller calls
 * (`list`, `get`, `onDidChangeEnvironments`) is implemented.
 */
class FakeEnvironmentStore {
    private readonly _emitter = new vscode.EventEmitter<{
        added: readonly Environment[];
        updated: readonly Environment[];
        removed: readonly string[];
    }>();
    public readonly onDidChangeEnvironments = this._emitter.event;
    public envs: Environment[] = [];
    public list(): readonly Environment[] {
        return this.envs.slice();
    }
    public get(id: string): Environment | undefined {
        return this.envs.find((e) => e.id === id);
    }
    public fire(): void {
        this._emitter.fire({ added: [], updated: [], removed: [] });
    }
    public dispose(): void {
        this._emitter.dispose();
    }
}

function asEnvStore(s: FakeEnvironmentStore): EnvironmentStore {
    return s as unknown as EnvironmentStore;
}

type ReducerHandler<K extends keyof CloudDeployHubReducers> = (
    state: CloudDeployHubState,
    payload: CloudDeployHubReducers[K],
) => CloudDeployHubState | Promise<CloudDeployHubState>;

function getReducer<K extends keyof CloudDeployHubReducers>(
    controller: CloudDeployHubController,
    key: K,
): ReducerHandler<K> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (controller as any)._reducerHandlers.get(key);
}

suite("CloudDeploy CloudDeployHubController", () => {
    const ARTIFACT_DIR = "C:/runs";
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let envStore: FakeEnvironmentStore;
    let fileProvider: FakeFileProvider;
    let writer: RunArtifactWriter;
    let reader: RunArtifactReader;
    let dirReader: FakeDirectoryReader;
    let runStore: RunStore;
    let executeCommandStub: sinon.SinonStub;
    let controller: CloudDeployHubController | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;

        envStore = new FakeEnvironmentStore();
        fileProvider = new FakeFileProvider();
        writer = new RunArtifactWriter(fileProvider);
        reader = new RunArtifactReader(fileProvider);
        dirReader = new FakeDirectoryReader();
        runStore = new RunStore(dirReader, reader);

        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

        CloudDeployHubController.resetSingletonForTests();
    });

    teardown(() => {
        if (controller) {
            try {
                controller.dispose();
            } catch {
                // ignore
            }
            controller = undefined;
        }
        runStore.dispose();
        envStore.dispose();
        sandbox.restore();
        CloudDeployHubController.resetSingletonForTests();
    });

    async function seedRun(
        runId: string,
        envId: string,
        envName: string,
        startedAtMs: number,
        status: RunStatus = RunStatus.Passed,
    ): Promise<string> {
        const env = makeEnvironment({ id: envId, name: envName });
        const record = makeValidRunRecord({
            runId,
            environmentId: envId,
            environmentSnapshot: env,
            startedAtMs,
            endedAtMs: startedAtMs + 1_500,
            status,
        });
        const artifactPath = `${ARTIFACT_DIR}/${runId}.cdrun.zip`;
        await writer.write(record, undefined, artifactPath);
        dirReader.paths.push(artifactPath);
        return artifactPath;
    }

    function createController(
        initialView: Parameters<typeof CloudDeployHubController.getOrCreate>[4] = {
            kind: "runList",
        },
    ): CloudDeployHubController {
        controller = CloudDeployHubController.getOrCreate(
            mockContext,
            mockVscodeWrapper,
            asEnvStore(envStore),
            runStore,
            initialView,
        );
        return controller;
    }

    test("initial state for runList view starts with currentPage=runList", async () => {
        envStore.envs = [makeEnvironment({ id: "dev", name: "Dev" })];
        const c = createController({ kind: "runList" });
        expect(c.state.currentPage).to.equal("runList");
        expect(c.state.environments).to.have.lengthOf(1);
        expect(c.state.environments[0].id).to.equal("dev");
    });

    test("initial state for environment view selects the env and hydrates it", async () => {
        const env = makeEnvironment({ id: "dev", name: "Dev" });
        envStore.envs = [env];
        const c = createController({ kind: "environment", envId: "dev" });
        expect(c.state.currentPage).to.equal("environment");
        expect(c.state.selectedEnvId).to.equal("dev");
        expect(c.state.selectedEnvironment?.id).to.equal("dev");
    });

    test("getOrCreate returns the same singleton on the second call", () => {
        const first = createController({ kind: "runList" });
        const second = CloudDeployHubController.getOrCreate(
            mockContext,
            mockVscodeWrapper,
            asEnvStore(envStore),
            runStore,
            { kind: "runList" },
        );
        expect(second).to.equal(first);
    });

    test("navigate reducer to runList resets selection", async () => {
        envStore.envs = [makeEnvironment({ id: "dev", name: "Dev" })];
        const c = createController({ kind: "environment", envId: "dev" });
        const reducer = getReducer(c, "navigate");
        const next = await reducer(c.state, { page: "runList" });
        expect(next.currentPage).to.equal("runList");
        expect(next.selectedEnvId).to.equal(undefined);
        expect(next.selectedEnvironment).to.equal(undefined);
    });

    test("navigate to environment hydrates selectedEnvironment", async () => {
        envStore.envs = [makeEnvironment({ id: "prod", name: "Prod" })];
        const c = createController({ kind: "runList" });
        const reducer = getReducer(c, "navigate");
        const next = await reducer(c.state, { page: "environment", envId: "prod" });
        expect(next.currentPage).to.equal("environment");
        expect(next.selectedEnvId).to.equal("prod");
        expect(next.selectedEnvironment?.name).to.equal("Prod");
    });

    test("navigate to run hydrates selectedRun and artifact path", async () => {
        await seedRun("run-1", "dev", "Dev", 1_000);
        await runStore.scan();
        const c = createController({ kind: "runList" });
        const reducer = getReducer(c, "navigate");
        const next = await reducer(c.state, { page: "run", runId: "run-1" });
        expect(next.currentPage).to.equal("run");
        expect(next.selectedRunId).to.equal("run-1");
        expect(next.selectedRun?.runId).to.equal("run-1");
        expect(next.selectedRunArtifactPath).to.equal(`${ARTIFACT_DIR}/run-1.cdrun.zip`);
    });

    test("navigate to a missing run sets errorMessage", async () => {
        const c = createController({ kind: "runList" });
        const reducer = getReducer(c, "navigate");
        const next = await reducer(c.state, { page: "run", runId: "missing" });
        expect(next.currentPage).to.equal("run");
        expect(next.selectedRun).to.equal(undefined);
        expect(next.errorMessage).to.be.a("string").and.not.empty;
    });

    test("refresh reducer triggers runStore.scan and refreshes runs", async () => {
        const c = createController({ kind: "runList" });
        await seedRun("run-2", "dev", "Dev", 2_000);
        // Before scan, runs cache is still empty.
        expect(c.state.runs).to.have.lengthOf(0);
        const reducer = getReducer(c, "refresh");
        const next = await reducer(c.state, {});
        expect(next.runs).to.have.lengthOf(1);
        expect(next.runs[0].runId).to.equal("run-2");
    });

    test("revealArtifact reducer dispatches revealFileInOS for the matching run", async () => {
        const artifactPath = await seedRun("run-3", "dev", "Dev", 3_000);
        await runStore.scan();
        const c = createController({ kind: "runList" });
        const reducer = getReducer(c, "revealArtifact");
        await reducer(c.state, { runId: "run-3" });
        const call = executeCommandStub.getCalls().find((cc) => cc.args[0] === "revealFileInOS");
        expect(call, "expected revealFileInOS to be invoked").to.not.equal(undefined);
        const uri = call!.args[1] as vscode.Uri;
        expect(uri.fsPath.replace(/\\/g, "/").toLowerCase()).to.equal(artifactPath.toLowerCase());
    });

    test("revealArtifact for unknown runId is a no-op", async () => {
        const c = createController({ kind: "runList" });
        const reducer = getReducer(c, "revealArtifact");
        await reducer(c.state, { runId: "ghost" });
        const calls = executeCommandStub.getCalls().filter((cc) => cc.args[0] === "revealFileInOS");
        expect(calls).to.have.lengthOf(0);
    });

    test("environment store change re-pulls the env list into state", async () => {
        const c = createController({ kind: "runList" });
        expect(c.state.environments).to.have.lengthOf(0);
        envStore.envs = [makeEnvironment({ id: "added", name: "Added" })];
        envStore.fire();
        expect(c.state.environments.map((e) => e.id)).to.deep.equal(["added"]);
    });

    test("run store change re-pulls the run list into state", async () => {
        const c = createController({ kind: "runList" });
        expect(c.state.runs).to.have.lengthOf(0);
        await seedRun("run-4", "dev", "Dev", 4_000);
        await runStore.scan();
        expect(c.state.runs).to.have.lengthOf(1);
        expect(c.state.runs[0].runId).to.equal("run-4");
    });

    test("dispose clears the singleton so the next getOrCreate constructs a new instance", () => {
        const first = createController({ kind: "runList" });
        first.dispose();
        controller = undefined;
        const second = CloudDeployHubController.getOrCreate(
            mockContext,
            mockVscodeWrapper,
            asEnvStore(envStore),
            runStore,
            { kind: "runList" },
        );
        controller = second;
        expect(second).to.not.equal(first);
    });
});
