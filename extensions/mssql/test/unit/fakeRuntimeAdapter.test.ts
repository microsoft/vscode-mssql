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
        artifact.lock!.nodes[0].activityKind = "dacpac.build";
        const result = await adapter.validate(artifact, ctx());
        expect(result.ok).to.equal(false);
        expect(result.issues[0].nodeId).to.equal("query");

        const noLock = createFixtureRunbookArtifact();
        delete noLock.lock;
        const noLockResult = await adapter.validate(noLock, ctx());
        expect(noLockResult.ok).to.equal(false);
    });
});
