/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fake runtime semantics (RBS2-4 fake lane): deterministic success path,
 * threshold failure path with skipped downstream, cancellation with one
 * terminal, gate approve/reject, unsupported activity refusal — the exact
 * behaviors the official perftest lane and the webview fixtures rely on.
 */

import { expect } from "chai";
import {
    computePlanHash,
    createFixtureRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { stampCatalogMetadata } from "../../src/runbookStudio/activities/activityCatalog";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { buildEvidenceExport } from "../../src/runbookStudio/evidenceExport";
import { newRunbookRootContext } from "../../src/runbookStudio/runbookDiag";
import {
    type ActivityExecutionDelegate,
    FakeRuntimeAdapter,
    type NodeExecution,
} from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
import {
    RuntimeBoundaryEvent,
    RuntimeEventObserver,
} from "../../src/runbookStudio/runtime/runtimeAdapterTypes";
import {
    RunbookArtifactFile,
    RUNBOOK_LOCK_SCHEMA_VERSION,
} from "../../src/sharedInterfaces/runbookStudio";

class CollectingObserver implements RuntimeEventObserver {
    public events: RuntimeBoundaryEvent[] = [];
    public gaps = 0;
    public exits: boolean[] = [];
    private terminalResolve: (() => void) | undefined;
    public readonly terminal = new Promise<void>((resolve) => {
        this.terminalResolve = resolve;
    });
    private gateResolve: (() => void) | undefined;
    public readonly gateReached = new Promise<void>((resolve) => {
        this.gateResolve = resolve;
    });

    onEvent(event: RuntimeBoundaryEvent): void {
        this.events.push(event);
        if (event.kind === "terminal") {
            this.terminalResolve?.();
        }
        if (event.kind === "gateRequested") {
            this.gateResolve?.();
        }
    }
    onGap(): void {
        this.gaps++;
    }
    onExit(unexpected: boolean): void {
        this.exits.push(unexpected);
    }

    terminalEvent(): Extract<RuntimeBoundaryEvent, { kind: "terminal" }> | undefined {
        return this.events.find(
            (e): e is Extract<RuntimeBoundaryEvent, { kind: "terminal" }> => e.kind === "terminal",
        );
    }
    nodeStates(nodeId: string): string[] {
        return this.events
            .filter(
                (e): e is Extract<RuntimeBoundaryEvent, { kind: "nodeState" }> =>
                    e.kind === "nodeState" && e.nodeId === nodeId,
            )
            .map((e) => e.state);
    }
}

function gateArtifact(): RunbookArtifactFile {
    const artifact = createFixtureRunbookArtifact();
    artifact.lock = {
        schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
        planRevision: "1",
        planHash: "sha256:gate",
        entryNodeId: "query",
        nodes: [
            {
                id: "query",
                label: "Query",
                kind: "activity",
                activityKind: "sql.query.read",
                activityVersion: 1,
            },
            { id: "approve", label: "Approve emit", kind: "gate" },
            { id: "report", label: "Report", kind: "report" },
        ],
        edges: [
            { from: "query", to: "approve" },
            { from: "approve", to: "report", when: "approved" },
        ],
    };
    return artifact;
}

function developerTsqltArtifact(): RunbookArtifactFile {
    const artifact = createDeveloperValidationPreviewArtifact();
    const lock = artifact.lock!;
    lock.nodes.push(
        { id: "approve-tsqlt", label: "Approve tSQLt execution", kind: "gate" },
        ...stampCatalogMetadata([
            {
                id: "run-tsqlt",
                label: "Run tSQLt suite",
                kind: "activity",
                activityKind: "tsqlt.run",
                inputs: {
                    database: "$nodes.provision-sandbox.connectionRef",
                    suite: "OrderTests",
                },
            },
        ]),
    );
    lock.edges = lock.edges.filter(
        (edge) => !(edge.from === "verify-schema" && edge.to === "run-sql-tests"),
    );
    lock.edges.push(
        { from: "verify-schema", to: "approve-tsqlt" },
        { from: "approve-tsqlt", to: "run-tsqlt", when: "approved" },
        { from: "approve-tsqlt", to: "dispose-sandbox", when: "rejected" },
        { from: "run-tsqlt", to: "run-sql-tests" },
        { from: "run-tsqlt", to: "dispose-sandbox", when: "failure" },
    );
    lock.planHash = computePlanHash(artifact.source, lock);
    return artifact;
}

suite("fakeRuntimeAdapter", () => {
    let adapter: FakeRuntimeAdapter;
    const ctx = () => newRunbookRootContext("test");

    setup(() => {
        adapter = new FakeRuntimeAdapter();
    });

    teardown(async () => {
        await adapter.dispose();
    });

    test("fixture succeeds end-to-end with verdict pass and one terminal", async () => {
        const observer = new CollectingObserver();
        await adapter.startRun(
            {
                runId: "r1",
                artifact: createFixtureRunbookArtifact(),
                parameterValues: { target: "conn-1", maxCount: 100 },
            },
            observer,
            ctx(),
        );
        await observer.terminal;
        const terminal = observer.terminalEvent()!;
        expect(terminal.state).to.equal("succeeded");
        expect(terminal.verdict).to.equal("pass");
        expect(terminal.runMetrics).to.deep.include({
            "query.rowCount": 5,
            "assertions.failed": 0,
        });
        expect(terminal.diagnosticCounts).to.deep.equal({ warningCount: 0, errorCount: 0 });
        expect(observer.events.filter((e) => e.kind === "terminal")).to.have.length(1);
        expect(observer.nodeStates("query")).to.deep.equal(["running", "succeeded"]);
        expect(observer.nodeStates("threshold")).to.deep.equal(["running", "succeeded"]);
        expect(observer.nodeStates("report")).to.deep.equal(["running", "succeeded"]);
        // The query produced a rowset output payload.
        const queryDone = observer.events.find(
            (e) => e.kind === "nodeState" && e.nodeId === "query" && e.state === "succeeded",
        ) as Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>;
        expect(queryDone.output?.contract).to.equal("rowset/1");
        expect(queryDone.output?.rows).to.have.length(5);
    });

    test("threshold failure fails the run and skips downstream before terminal", async () => {
        const observer = new CollectingObserver();
        await adapter.startRun(
            {
                runId: "r2",
                artifact: createFixtureRunbookArtifact(),
                // rowCount is 5; max 1 => threshold fails
                parameterValues: { target: "conn-1", maxCount: 1 },
            },
            observer,
            ctx(),
        );
        await observer.terminal;
        const terminal = observer.terminalEvent()!;
        expect(terminal.state).to.equal("failed");
        expect(terminal.verdict).to.equal("fail");
        expect(terminal.runMetrics).to.deep.include({ "assertions.failed": 1 });
        expect(terminal.diagnosticCounts).to.deep.equal({ warningCount: 0, errorCount: 1 });
        expect(observer.nodeStates("threshold")).to.deep.equal(["running", "failed"]);
        expect(observer.nodeStates("report")).to.deep.equal(["skipped"]);
        // Skips arrive BEFORE the terminal event.
        const skipIndex = observer.events.findIndex(
            (e) => e.kind === "nodeState" && e.nodeId === "report",
        );
        const terminalIndex = observer.events.findIndex((e) => e.kind === "terminal");
        expect(skipIndex).to.be.lessThan(terminalIndex);
    });

    test("failure-path cleanup/reporting does not erase the failing run verdict", async () => {
        const observer = new CollectingObserver();
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.edges = artifact.lock!.edges.map((edge) =>
            edge.from === "threshold" ? { ...edge, when: "failure" } : edge,
        );

        await adapter.startRun(
            {
                runId: "r2-cleanup",
                artifact,
                parameterValues: { target: "conn-1", maxCount: 1 },
            },
            observer,
            ctx(),
        );
        await observer.terminal;

        expect(observer.nodeStates("threshold")).to.deep.equal(["running", "failed"]);
        expect(observer.nodeStates("report")).to.deep.equal(["running", "succeeded"]);
        expect(observer.terminalEvent()).to.include({ state: "failed", verdict: "fail" });
    });

    test("cancellation settles with one cancelled terminal", async () => {
        const observer = new CollectingObserver();
        const artifact = gateArtifact(); // gate blocks so we can cancel mid-run
        await adapter.startRun({ runId: "r3", artifact, parameterValues: {} }, observer, ctx());
        await observer.gateReached;
        const outcome = await adapter.cancelRun("r3", ctx());
        expect(outcome).to.equal("cancelled");
        await observer.terminal;
        const terminal = observer.terminalEvent()!;
        expect(terminal.state).to.equal("cancelled");
        expect(observer.events.filter((e) => e.kind === "terminal")).to.have.length(1);
        // Cancel after terminal reports alreadyTerminal.
        expect(await adapter.cancelRun("r3", ctx())).to.equal("alreadyTerminal");
    });

    test("gate approval continues to downstream nodes", async () => {
        const observer = new CollectingObserver();
        await adapter.startRun(
            { runId: "r4", artifact: gateArtifact(), parameterValues: {} },
            observer,
            ctx(),
        );
        await observer.gateReached;
        const accepted = await adapter.respondToGate("r4", "approve", true, ctx());
        expect(accepted).to.equal(true);
        await observer.terminal;
        expect(observer.terminalEvent()!.state).to.equal("succeeded");
        expect(observer.nodeStates("report")).to.deep.equal(["running", "succeeded"]);
        expect(
            observer.events.some((e) => e.kind === "gateResponded" && e.approved === true),
        ).to.equal(true);
    });

    test("gate rejection with no rejected edge fails the run", async () => {
        const observer = new CollectingObserver();
        await adapter.startRun(
            { runId: "r5", artifact: gateArtifact(), parameterValues: {} },
            observer,
            ctx(),
        );
        await observer.gateReached;
        await adapter.respondToGate("r5", "approve", false, ctx());
        await observer.terminal;
        const terminal = observer.terminalEvent()!;
        expect(terminal.state).to.equal("failed");
        expect(observer.nodeStates("report")).to.deep.equal(["skipped"]);
    });

    test("responding to a gate that is not pending returns false", async () => {
        expect(await adapter.respondToGate("missing-run", "x", true, ctx())).to.equal(false);
    });

    test("validate rejects unsupported activities and missing locks", async () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock!.nodes[0].activityKind = "unregistered.activity";
        const result = await adapter.validate(artifact, ctx());
        expect(result.ok).to.equal(false);
        expect(result.issues[0].nodeId).to.equal("query");

        const noLock = createFixtureRunbookArtifact();
        delete noLock.lock;
        const noLockResult = await adapter.validate(noLock, ctx());
        expect(noLockResult.ok).to.equal(false);
    });

    test("developer validation preview emits typed evidence and cleanup after approval", async () => {
        const observer = new CollectingObserver();
        const artifact = createDeveloperValidationPreviewArtifact();
        expect((await adapter.validate(artifact, ctx())).ok).to.equal(true);
        await adapter.startRun(
            {
                runId: "developer-preview",
                artifact,
                parameterValues: {
                    projectPath: "Database.sqlproj",
                    sandboxConnection: "preview-profile",
                },
            },
            observer,
            ctx(),
        );
        await observer.gateReached;
        expect(
            await adapter.respondToGate("developer-preview", "approve-sandbox", true, ctx()),
        ).to.equal(true);
        while (
            !observer.events.some(
                (event) => event.kind === "gateRequested" && event.nodeId === "approve-deploy",
            )
        ) {
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
        }
        expect(
            await adapter.respondToGate("developer-preview", "approve-deploy", true, ctx()),
        ).to.equal(true);
        await observer.terminal;

        expect(observer.terminalEvent()).to.include({ state: "succeeded", verdict: "pass" });
        const contracts = observer.events
            .filter(
                (event): event is Extract<RuntimeBoundaryEvent, { kind: "nodeState" }> =>
                    event.kind === "nodeState" && event.state === "succeeded",
            )
            .map((event) => event.output?.contract)
            .filter(Boolean);
        expect(contracts).to.include.members([
            "workspaceSnapshot/1",
            "testSuiteDiscovery/1",
            "dacpacArtifact/1",
            "databaseLease/1",
            "deploymentPreview/1",
            "deploymentEvidence/1",
            "schemaDiff/1",
            "testResults/1",
            "cleanupEvidence/1",
            "evidenceBundle/1",
            "markdown/1",
        ]);
        expect(observer.nodeStates("dispose-sandbox")).to.deep.equal(["running", "succeeded"]);
        expect(observer.nodeStates("bundle-evidence")).to.deep.equal(["running", "succeeded"]);
        const preview = observer.events.find(
            (event) =>
                event.kind === "nodeState" &&
                event.nodeId === "preview-deploy" &&
                event.state === "succeeded",
        ) as Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>;
        expect(preview.output?.scalars).to.include({ changeCount: 3, preview: true });
        const evidence = observer.events.find(
            (event) =>
                event.kind === "nodeState" &&
                event.nodeId === "bundle-evidence" &&
                event.state === "succeeded",
        ) as Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>;
        const manifest = JSON.parse(evidence.output?.text ?? "{}");
        expect(manifest).to.include({ schemaVersion: 2, contract: "evidenceBundle/1" });
        expect(manifest.run.runtimeKind).to.equal("fake");
        expect(manifest.toolchain.requiredComponents).to.deep.equal(["vscode", "mssqlExtension"]);
        expect(manifest.nodes).to.have.length.greaterThan(0);
        expect(() => buildEvidenceExport(evidence.output?.text ?? "", "junit")).not.to.throw();
        expect(observer.terminalEvent()?.runMetrics).to.deep.include({
            "workspace.projectCount": 1,
            "tests.discovered": 2,
            "deployment.previewChangeCount": 3,
            "schema.matches": true,
            "sqlTests.passed": 2,
            "cleanup.completed": true,
        });
        expect(observer.terminalEvent()?.diagnosticCounts).to.deep.equal({
            warningCount: 0,
            errorCount: 0,
        });
    });

    test("governed tSQLt preview runs only after its exact gate and emits typed evidence", async () => {
        const observer = new CollectingObserver();
        const artifact = developerTsqltArtifact();
        expect((await adapter.validate(artifact, ctx())).ok).to.equal(true);
        await adapter.startRun(
            {
                runId: "developer-tsqlt-preview",
                artifact,
                parameterValues: {
                    projectPath: "Database.sqlproj",
                    sandboxConnection: "preview-profile",
                },
            },
            observer,
            ctx(),
        );
        await approveDeveloperGate(adapter, observer, "developer-tsqlt-preview", "approve-sandbox");
        await approveDeveloperGate(adapter, observer, "developer-tsqlt-preview", "approve-deploy");
        await approveDeveloperGate(adapter, observer, "developer-tsqlt-preview", "approve-tsqlt");
        await observer.terminal;

        expect(observer.terminalEvent()).to.include({ state: "succeeded", verdict: "pass" });
        expect(observer.nodeStates("run-tsqlt")).to.deep.equal(["running", "succeeded"]);
        const completed = observer.events.find(
            (event) =>
                event.kind === "nodeState" &&
                event.nodeId === "run-tsqlt" &&
                event.state === "succeeded",
        ) as Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>;
        expect(completed.output?.contract).to.equal("testResults/1");
        expect(completed.output?.columns).to.deep.equal([
            "suite",
            "test",
            "result",
            "message",
            "durationMs",
        ]);
        expect(completed.output?.scalars).to.include({ total: 2, passed: 2, allPassed: true });
    });

    test("developer publish failure still executes cleanup and failing evidence", async () => {
        const executed: string[] = [];
        const local = new FakeRuntimeAdapter(developerFailureDelegate("deploy-dacpac", executed));
        const observer = new CollectingObserver();
        try {
            await local.startRun(
                {
                    runId: "developer-publish-failure",
                    artifact: createDeveloperValidationPreviewArtifact(),
                    parameterValues: {
                        projectPath: "Database.sqlproj",
                        sandboxConnection: "preview-profile",
                    },
                },
                observer,
                ctx(),
            );
            await approveDeveloperGate(
                local,
                observer,
                "developer-publish-failure",
                "approve-sandbox",
            );
            await approveDeveloperGate(
                local,
                observer,
                "developer-publish-failure",
                "approve-deploy",
            );
            await observer.terminal;

            expect(observer.terminalEvent()).to.include({ state: "failed", verdict: "fail" });
            expect(observer.nodeStates("deploy-dacpac")).to.deep.equal(["running", "failed"]);
            expect(observer.nodeStates("verify-schema")).to.deep.equal(["skipped"]);
            expect(observer.nodeStates("run-sql-tests")).to.deep.equal(["skipped"]);
            expect(observer.nodeStates("dispose-sandbox")).to.deep.equal(["running", "succeeded"]);
            expect(observer.nodeStates("bundle-evidence")).to.deep.equal(["running", "succeeded"]);
            expect(executed).to.include.members([
                "deploy-dacpac",
                "dispose-sandbox",
                "bundle-evidence",
            ]);
        } finally {
            await local.dispose();
        }
    });

    test("developer deployment rejection never publishes and still cleans up", async () => {
        const executed: string[] = [];
        const local = new FakeRuntimeAdapter(developerFailureDelegate(undefined, executed));
        const observer = new CollectingObserver();
        try {
            await local.startRun(
                {
                    runId: "developer-deploy-rejected",
                    artifact: createDeveloperValidationPreviewArtifact(),
                    parameterValues: {
                        projectPath: "Database.sqlproj",
                        sandboxConnection: "preview-profile",
                    },
                },
                observer,
                ctx(),
            );
            await approveDeveloperGate(
                local,
                observer,
                "developer-deploy-rejected",
                "approve-sandbox",
            );
            await waitForGate(observer, "approve-deploy");
            expect(
                await local.respondToGate(
                    "developer-deploy-rejected",
                    "approve-deploy",
                    false,
                    ctx(),
                ),
            ).to.equal(true);
            await observer.terminal;

            expect(observer.terminalEvent()).to.include({ state: "failed", verdict: "fail" });
            expect(executed).not.to.include("deploy-dacpac");
            expect(observer.nodeStates("dispose-sandbox")).to.deep.equal(["running", "succeeded"]);
            expect(observer.nodeStates("bundle-evidence")).to.deep.equal(["running", "succeeded"]);
        } finally {
            await local.dispose();
        }
    });

    test("a closed delegate list refuses activity kinds the host omitted", async () => {
        const local = new FakeRuntimeAdapter({
            runtimeKind: "local",
            supportedActivityKinds: new Set([
                "workspace.inspect",
                "sqltest.discover",
                "dacpac.build",
                "dacpac.deploy.preview",
                "sql.query.read",
            ]),
            executeActivity: async () => undefined,
        });
        try {
            const validation = await local.validate(
                createDeveloperValidationPreviewArtifact(),
                ctx(),
            );
            expect(validation.ok).to.equal(false);
            expect(validation.issues[0].detail).to.contain("sandbox.provision");
        } finally {
            await local.dispose();
        }
    });

    test("delegated activities receive stable run and plan invocation identity", async () => {
        const artifact = createFixtureRunbookArtifact();
        let invocation:
            | {
                  runId: string;
                  planRevision: string;
                  planHash: string;
                  attempt: number;
              }
            | undefined;
        const local = new FakeRuntimeAdapter({
            runtimeKind: "local",
            supportedActivityKinds: new Set(["sql.query.read"]),
            executeActivity: async (node, binding) => {
                if (node.id === "query") {
                    invocation = binding.invocation;
                }
                return undefined;
            },
        });
        const observer = new CollectingObserver();
        try {
            await local.startRun(
                {
                    runId: "invocation-identity",
                    artifact,
                    parameterValues: { target: "profile-1", maxCount: 100 },
                },
                observer,
                ctx(),
            );
            await observer.terminal;
            expect(invocation).to.deep.equal({
                runId: "invocation-identity",
                planRevision: artifact.lock?.planRevision,
                planHash: artifact.lock?.planHash,
                attempt: 1,
            });
        } finally {
            await local.dispose();
        }
    });

    test("cancellation during a delegated build settles the active node as cancelled", async () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.lock = {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision: "1",
            planHash: "sha256:delegated-build-cancel",
            entryNodeId: "build",
            nodes: [
                {
                    id: "build",
                    label: "Build DACPAC",
                    kind: "activity",
                    activityKind: "dacpac.build",
                    inputs: { project: "$params.projectPath" },
                },
            ],
            edges: [],
        };
        const local = new FakeRuntimeAdapter({
            runtimeKind: "local",
            supportedActivityKinds: new Set(["dacpac.build"]),
            executeActivity: async (_node, binding) => {
                while (!binding.isCancellationRequested()) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 1));
                }
                return {
                    success: false,
                    message: "build task terminated",
                    errorCode: "RunbookStudio.ActivityCancelled",
                };
            },
        });
        const observer = new CollectingObserver();
        try {
            await local.startRun(
                {
                    runId: "delegated-build-cancel",
                    artifact,
                    parameterValues: { projectPath: "Database.sqlproj" },
                },
                observer,
                ctx(),
            );
            while (!observer.nodeStates("build").includes("running")) {
                await new Promise<void>((resolve) => setTimeout(resolve, 1));
            }
            expect(await local.cancelRun("delegated-build-cancel", ctx())).to.equal("cancelled");
            await observer.terminal;

            expect(observer.nodeStates("build")).to.deep.equal(["running", "cancelled"]);
            expect(observer.terminalEvent()).to.include({ state: "cancelled" });
            expect(observer.events.filter((event) => event.kind === "terminal")).to.have.length(1);
        } finally {
            await local.dispose();
        }
    });
});

function developerFailureDelegate(
    failNodeId: string | undefined,
    executed: string[],
): ActivityExecutionDelegate {
    const supportedActivityKinds = new Set([
        "workspace.inspect",
        "sqltest.discover",
        "dacpac.build",
        "sandbox.provision",
        "dacpac.deploy.preview",
        "dacpac.deploy",
        "schema.compare",
        "sqltest.run",
        "sandbox.dispose",
        "evidence.bundle",
    ]);
    return {
        runtimeKind: "local",
        supportedActivityKinds,
        executeActivity: async (node) => {
            executed.push(node.id);
            if (node.id === failNodeId) {
                return {
                    success: false,
                    message: "injected developer activity failure",
                    errorCode: "RunbookStudio.DeploymentFailed",
                };
            }
            return developerNodeSuccess(node.id);
        },
    };
}

function developerNodeSuccess(nodeId: string): NodeExecution {
    switch (nodeId) {
        case "discover-sql-tests":
            return {
                success: true,
                values: { tSqltClassCount: 1, tSqltTestCount: 2, complete: true },
            };
        case "build-dacpac":
            return {
                success: true,
                values: {
                    artifactPath: "C:\\workspace\\Database.dacpac",
                    artifactSha256: "a".repeat(64),
                },
            };
        case "provision-sandbox":
            return {
                success: true,
                values: { connectionRef: `runbook-sql-lease:effect-${"b".repeat(64)}` },
            };
        case "preview-deploy":
            return { success: true, values: { reportSha256: "c".repeat(64) } };
        case "bundle-evidence":
            return {
                success: true,
                verdict: "fail",
                output: {
                    contract: "evidenceBundle/1",
                    text: '{"verdict":"fail","injected":true}',
                },
            };
        default:
            return { success: true };
    }
}

async function approveDeveloperGate(
    adapter: FakeRuntimeAdapter,
    observer: CollectingObserver,
    runId: string,
    nodeId: string,
): Promise<void> {
    await waitForGate(observer, nodeId);
    expect(
        await adapter.respondToGate(runId, nodeId, true, newRunbookRootContext("test")),
    ).to.equal(true);
}

async function waitForGate(observer: CollectingObserver, nodeId: string): Promise<void> {
    while (
        !observer.events.some((event) => event.kind === "gateRequested" && event.nodeId === nodeId)
    ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
}
