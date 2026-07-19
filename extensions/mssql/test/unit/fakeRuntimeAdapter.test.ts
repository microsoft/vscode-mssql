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
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { newRunbookRootContext } from "../../src/runbookStudio/runbookDiag";
import { FakeRuntimeAdapter } from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
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
        expect(observer.nodeStates("threshold")).to.deep.equal(["running", "failed"]);
        expect(observer.nodeStates("report")).to.deep.equal(["skipped"]);
        // Skips arrive BEFORE the terminal event.
        const skipIndex = observer.events.findIndex(
            (e) => e.kind === "nodeState" && e.nodeId === "report",
        );
        const terminalIndex = observer.events.findIndex((e) => e.kind === "terminal");
        expect(skipIndex).to.be.lessThan(terminalIndex);
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
                    sandboxName: "preview-sandbox",
                },
            },
            observer,
            ctx(),
        );
        await observer.gateReached;
        expect(
            await adapter.respondToGate("developer-preview", "approve-sandbox", true, ctx()),
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
            "dacpacArtifact/1",
            "databaseLease/1",
            "deploymentPreview/1",
            "cleanupEvidence/1",
            "markdown/1",
        ]);
        expect(observer.nodeStates("dispose-sandbox")).to.deep.equal(["running", "succeeded"]);
        const preview = observer.events.find(
            (event) =>
                event.kind === "nodeState" &&
                event.nodeId === "preview-deploy" &&
                event.state === "succeeded",
        ) as Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>;
        expect(preview.output?.scalars).to.include({ changeCount: 3, preview: true });
    });

    test("local delegates accept build activities but refuse preview-only sandbox work", async () => {
        const local = new FakeRuntimeAdapter({
            runtimeKind: "local",
            supportedActivityKinds: new Set([
                "workspace.inspect",
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
