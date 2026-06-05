/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as vscode from "vscode";

import { CLOUD_DEPLOY_VIEW_ID, CloudDeployTreeProvider } from "../../src/cloudDeploy/dashboard";
import { EnvironmentStore } from "../../src/cloudDeploy/environments/environmentStore";
import { Environment } from "../../src/cloudDeploy/environments/types";
import {
    RunArtifactReader,
    RunArtifactWriter,
    RunStatus,
    RunStore,
    RunsDirectoryReader,
} from "../../src/cloudDeploy/runs";
import {
    FakeFileProvider,
    makeEnvironment,
    makeValidRunRecord,
} from "./cloudDeployRunsTestHelpers";

class FakeDirectoryReader implements RunsDirectoryReader {
    public paths: string[] = [];
    public async list(): Promise<readonly string[]> {
        return this.paths.slice();
    }
}

/**
 * Minimal stub of `EnvironmentStore` that exposes only the surface the tree
 * provider depends on. Cast through `unknown` so we do not have to construct
 * the real store (which requires a real workspace folder + Memento).
 */
class FakeEnvironmentStore {
    private readonly _emitter = new vscode.EventEmitter<{
        added: readonly Environment[];
        updated: readonly Environment[];
        removed: readonly string[];
    }>();
    public readonly onDidChangeEnvironments = this._emitter.event;
    private readonly _defaultEmitter = new vscode.EventEmitter<string | undefined>();
    public readonly onDidChangeDefaultEnvironment = this._defaultEmitter.event;
    public envs: Environment[] = [];
    public defaultEnvId: string | undefined = undefined;
    public list(): readonly Environment[] {
        return this.envs.slice();
    }
    public getDefaultEnvironmentId(): string | undefined {
        return this.defaultEnvId;
    }
    public fire(): void {
        this._emitter.fire({ added: [], updated: [], removed: [] });
    }
    public fireDefaultChanged(id: string | undefined): void {
        this.defaultEnvId = id;
        this._defaultEmitter.fire(id);
    }
    public dispose(): void {
        this._emitter.dispose();
        this._defaultEmitter.dispose();
    }
}

function asStore(s: FakeEnvironmentStore): EnvironmentStore {
    return s as unknown as EnvironmentStore;
}

suite("CloudDeploy CloudDeployTreeProvider", () => {
    const ARTIFACT_DIR = "C:/runs";
    let fileProvider: FakeFileProvider;
    let writer: RunArtifactWriter;
    let reader: RunArtifactReader;
    let dirReader: FakeDirectoryReader;
    let runStore: RunStore;
    let envStore: FakeEnvironmentStore;
    let provider: CloudDeployTreeProvider;

    setup(() => {
        fileProvider = new FakeFileProvider();
        writer = new RunArtifactWriter(fileProvider);
        reader = new RunArtifactReader(fileProvider);
        dirReader = new FakeDirectoryReader();
        runStore = new RunStore(dirReader, reader);
        envStore = new FakeEnvironmentStore();
        provider = new CloudDeployTreeProvider(asStore(envStore), runStore);
    });

    teardown(() => {
        provider.dispose();
        runStore.dispose();
        envStore.dispose();
    });

    async function seedRun(
        runId: string,
        envId: string,
        envName: string,
        startedAtMs: number,
        status: RunStatus = RunStatus.Passed,
    ): Promise<void> {
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
    }

    test("exposes the expected view id constant", () => {
        expect(CLOUD_DEPLOY_VIEW_ID).to.equal("mssqlCloudDeploy");
    });

    test("root returns the two section nodes", () => {
        const roots = provider.getChildren();
        expect(roots).to.have.lengthOf(2);
        const ids = roots.map((n) => (n.kind === "section" ? n.id : "?"));
        expect(ids).to.deep.equal(["environments", "runs"]);
    });

    test("environments section is empty when no envs are declared", () => {
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        expect(children).to.have.lengthOf(1);
        expect(children[0].kind).to.equal("empty");
    });

    test("environments section reflects the env store list", () => {
        envStore.envs = [
            makeEnvironment({ id: "dev", name: "Dev" }),
            makeEnvironment({ id: "prod", name: "Prod" }),
        ];
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        expect(children).to.have.lengthOf(2);
        const names = children.map((c) => (c.kind === "environment" ? c.env.name : "?"));
        expect(names).to.deep.equal(["Dev", "Prod"]);
    });

    test("default environment is pinned to the top of the environments section", () => {
        envStore.envs = [
            makeEnvironment({ id: "dev", name: "Dev" }),
            makeEnvironment({ id: "staging", name: "Staging" }),
            makeEnvironment({ id: "prod", name: "Prod" }),
        ];
        envStore.defaultEnvId = "prod";
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        const names = children.map((c) => (c.kind === "environment" ? c.env.name : "?"));
        expect(names).to.deep.equal(["Prod", "Dev", "Staging"]);
    });

    test("env order is unchanged when no default is set", () => {
        envStore.envs = [
            makeEnvironment({ id: "dev", name: "Dev" }),
            makeEnvironment({ id: "prod", name: "Prod" }),
        ];
        envStore.defaultEnvId = undefined;
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        const names = children.map((c) => (c.kind === "environment" ? c.env.name : "?"));
        expect(names).to.deep.equal(["Dev", "Prod"]);
    });

    test("only the default environment leaf is flagged isDefault", () => {
        envStore.envs = [
            makeEnvironment({ id: "dev", name: "Dev" }),
            makeEnvironment({ id: "prod", name: "Prod" }),
        ];
        envStore.defaultEnvId = "prod";
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        const flags = children.map((c) =>
            c.kind === "environment" ? { name: c.env.name, isDefault: c.isDefault } : undefined,
        );
        expect(flags).to.deep.equal([
            { name: "Prod", isDefault: true },
            { name: "Dev", isDefault: false },
        ]);
    });

    test("runs section is empty before any scan", () => {
        const roots = provider.getChildren();
        const runSection = roots.find((n) => n.kind === "section" && n.id === "runs");
        const children = provider.getChildren(runSection);
        expect(children).to.have.lengthOf(1);
        expect(children[0].kind).to.equal("empty");
    });

    test("runs section lists scanned runs newest-first", async () => {
        await seedRun("r-old", "dev", "Dev", 1_000);
        await seedRun("r-new", "dev", "Dev", 5_000);
        await runStore.scan();

        const roots = provider.getChildren();
        const runSection = roots.find((n) => n.kind === "section" && n.id === "runs");
        const children = provider.getChildren(runSection);
        expect(children).to.have.lengthOf(2);
        const ids = children.map((c) => (c.kind === "run" ? c.entry.runId : "?"));
        expect(ids).to.deep.equal(["r-new", "r-old"]);
    });

    test("runs section caps at 10 entries", async () => {
        for (let i = 0; i < 15; i++) {
            await seedRun(`r-${i}`, "dev", "Dev", i * 1_000);
        }
        await runStore.scan();

        const roots = provider.getChildren();
        const runSection = roots.find((n) => n.kind === "section" && n.id === "runs");
        const children = provider.getChildren(runSection);
        expect(children).to.have.lengthOf(10);
    });

    test("environment leaf shows the latest run status as its icon", async () => {
        envStore.envs = [makeEnvironment({ id: "dev", name: "Dev" })];
        await seedRun("r-old", "dev", "Dev", 1_000, RunStatus.Passed);
        await seedRun("r-new", "dev", "Dev", 5_000, RunStatus.Failed);
        await runStore.scan();

        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        expect(children).to.have.lengthOf(1);
        const node = children[0];
        if (node.kind !== "environment") {
            throw new Error("expected environment node");
        }
        expect(node.latestStatus).to.equal(RunStatus.Failed);
    });

    test("environment leaf has undefined latestStatus when env has no runs", () => {
        envStore.envs = [makeEnvironment({ id: "dev", name: "Dev" })];
        const roots = provider.getChildren();
        const envSection = roots.find((n) => n.kind === "section" && n.id === "environments");
        const children = provider.getChildren(envSection);
        const node = children[0];
        if (node.kind !== "environment") {
            throw new Error("expected environment node");
        }
        expect(node.latestStatus).to.equal(undefined);
    });

    test("getTreeItem on an environment node binds the open-environment command", () => {
        envStore.envs = [makeEnvironment({ id: "dev", name: "Dev" })];
        const envSection = provider.getChildren()[0];
        const node = provider.getChildren(envSection)[0];
        const item = provider.getTreeItem(node);
        expect(item.command?.command).to.equal("mssql.cloudDeploy.openEnvironment");
        expect(item.command?.arguments).to.deep.equal(["dev"]);
        expect(item.contextValue).to.equal("cloudDeploy.environment");
    });

    test("getTreeItem on a run node binds the open-run command", async () => {
        await seedRun("r-1", "dev", "Dev", 1_000);
        await runStore.scan();
        const runSection = provider.getChildren()[1];
        const node = provider.getChildren(runSection)[0];
        const item = provider.getTreeItem(node);
        expect(item.command?.command).to.equal("mssql.cloudDeploy.openRun");
        expect(item.command?.arguments?.[0]).to.equal("r-1");
        expect(item.contextValue).to.equal("cloudDeploy.run");
    });

    test("onDidChangeTreeData fires when env store changes", () => {
        let fired = 0;
        provider.onDidChangeTreeData(() => fired++);
        envStore.fire();
        expect(fired).to.equal(1);
    });

    test("onDidChangeTreeData fires when run store changes", async () => {
        let fired = 0;
        provider.onDidChangeTreeData(() => fired++);
        await runStore.scan();
        expect(fired).to.equal(1);
    });

    test("onDidChangeTreeData fires when the default environment changes", () => {
        let fired = 0;
        provider.onDidChangeTreeData(() => fired++);
        envStore.fireDefaultChanged("prod");
        expect(fired).to.equal(1);
    });

    test("refresh() fires onDidChangeTreeData", () => {
        let fired = 0;
        provider.onDidChangeTreeData(() => fired++);
        provider.refresh();
        expect(fired).to.equal(1);
    });

    test("dispose() unsubscribes from store change events", () => {
        let fired = 0;
        provider.onDidChangeTreeData(() => fired++);
        provider.dispose();
        envStore.fire();
        expect(fired).to.equal(0);
    });

    test("works with no env store and no run store (graceful empty)", () => {
        const bare = new CloudDeployTreeProvider(undefined, undefined);
        try {
            const roots = bare.getChildren();
            expect(roots).to.have.lengthOf(2);
            for (const root of roots) {
                const children = bare.getChildren(root);
                expect(children).to.have.lengthOf(1);
                expect(children[0].kind).to.equal("empty");
            }
        } finally {
            bare.dispose();
        }
    });
});
