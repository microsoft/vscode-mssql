/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hobbes adapter mapping + supervisor plumbing (RBS2-4b): status projections
 * verified against the runtime's InvestigationRunStatuses contract, and the
 * loopback port allocator. Full process supervision is exercised against the
 * real runtime package in the perftest live lane, not unit CI.
 */

import { expect } from "chai";
import * as sinon from "sinon";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import {
    HobbesRuntimeAdapter,
    launchRefusalError,
    libraryContentFingerprint,
    mapRegionStatus,
    mapTerminalStatus,
    plannerRequestBody,
    plannerTimeoutMilliseconds,
    ReasoningCoalescer,
    rebaseLibraryArtifact,
    summarizeHobbesRegionMetrics,
    terminalNodeSettlementEvents,
} from "../../src/runbookStudio/runtime/hobbesRuntimeAdapter";
import {
    findFreePort,
    RuntimeLaunchCoordinator,
    RuntimeSupervisor,
} from "../../src/runbookStudio/runtime/runtimeSupervisor";

suite("hobbesRuntimeAdapter", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("concurrent runtime callers share one launch and retry after failure", async () => {
        const coordinator = new RuntimeLaunchCoordinator<string>();
        let settleFirst: ((value: string) => void) | undefined;
        const firstLaunch = sandbox.stub().returns(
            new Promise<string>((resolve) => {
                settleFirst = resolve;
            }),
        );

        const firstCaller = coordinator.run(firstLaunch);
        const secondCaller = coordinator.run(firstLaunch);
        expect(firstCaller).to.equal(secondCaller);
        await Promise.resolve();
        expect(firstLaunch).to.have.been.calledOnce;
        settleFirst!("ready");
        expect(await firstCaller).to.equal("ready");

        const failedLaunch = sandbox.stub().rejects(new Error("startup failed"));
        let failure: unknown;
        try {
            await coordinator.run(failedLaunch);
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.an("error").with.property("message", "startup failed");
        const retryLaunch = sandbox.stub().resolves("recovered");
        expect(await coordinator.run(retryLaunch)).to.equal("recovered");
        expect(retryLaunch).to.have.been.calledOnce;
    });

    test("planner timeout defaults to ten minutes and stays within supported bounds", () => {
        expect(plannerTimeoutMilliseconds(undefined)).to.equal(10 * 60_000);
        expect(plannerTimeoutMilliseconds(Number.NaN)).to.equal(10 * 60_000);
        expect(plannerTimeoutMilliseconds(15)).to.equal(15 * 60_000);
        expect(plannerTimeoutMilliseconds(0)).to.equal(60_000);
        expect(plannerTimeoutMilliseconds(60)).to.equal(30 * 60_000);
    });

    test("terminal statuses map to host terminal states", () => {
        expect(mapTerminalStatus("completed")).to.equal("succeeded");
        expect(mapTerminalStatus("failed")).to.equal("failed");
        expect(mapTerminalStatus("canceled")).to.equal("cancelled");
        // Non-terminal runtime states never produce a host terminal.
        expect(mapTerminalStatus("running")).to.equal(undefined);
        expect(mapTerminalStatus("pending-confirmation")).to.equal(undefined);
        expect(mapTerminalStatus(undefined)).to.equal(undefined);
        expect(mapTerminalStatus("some-future-status")).to.equal(undefined);
    });

    test("region statuses map conservatively (unknown = no report)", () => {
        expect(mapRegionStatus("running")).to.equal("running");
        expect(mapRegionStatus("completed")).to.equal("succeeded");
        expect(mapRegionStatus("succeeded")).to.equal("succeeded");
        expect(mapRegionStatus("failed")).to.equal("failed");
        expect(mapRegionStatus("queued")).to.equal(undefined);
        expect(mapRegionStatus(undefined)).to.equal(undefined);
    });

    test("runtime region findings produce bounded terminal metrics", () => {
        expect(
            summarizeHobbesRegionMetrics([
                { findingCount: 3, remediationCount: 1 },
                { findingCount: 2, remediationCount: 2 },
                { findingCount: -1, remediationCount: Number.NaN },
            ]),
        ).to.deep.equal({ "findings.total": 5, "remediations.total": 3 });
        expect(summarizeHobbesRegionMetrics([{}])).to.equal(undefined);
    });

    test("successful conditional runs settle unreported nodes as branch-not-taken", () => {
        const events = terminalNodeSettlementEvents(
            new Set(["query", "chosen", "not-taken"]),
            new Map([
                ["query", "succeeded"],
                ["chosen", "succeeded"],
            ]),
            "succeeded",
        );

        expect(events).to.have.length(1);
        expect(events[0]).to.include({
            kind: "nodeState",
            nodeId: "not-taken",
            state: "skipped",
            outcome: "skipped",
            branchNotTaken: true,
        });
        expect(events[0].message).to.contain("branch not taken");
    });

    test("accepted cancellation settles active and unreached nodes before the terminal", () => {
        const events = terminalNodeSettlementEvents(
            new Set(["done", "active", "waiting", "later"]),
            new Map([
                ["done", "succeeded"],
                ["active", "running"],
                ["waiting", "awaitingApproval"],
            ]),
            "cancelled",
        );

        expect(events.map((event) => [event.nodeId, event.state])).to.deep.equal([
            ["active", "cancelled"],
            ["waiting", "cancelled"],
            ["later", "skipped"],
        ]);
    });

    test("launch refusals map to user-actionable errors with the refusal code retained", () => {
        const notFound = launchRefusalError("runbook-not-found");
        expect(notFound.rbsError.code).to.equal("RunbookStudio.RuntimeCapabilityUnsupported");
        expect(notFound.rbsError.message).to.contain("local");
        expect(notFound.refusalCode).to.equal("runbook-not-found");

        const versionMismatch = launchRefusalError("runbook-version-mismatch");
        expect(versionMismatch.rbsError.code).to.equal(
            "RunbookStudio.RuntimeCapabilityUnsupported",
        );

        const connection = launchRefusalError("connection-not-found");
        expect(connection.rbsError.code).to.equal("RunbookStudio.BindingInvalid");

        const unknown = launchRefusalError("some-future-code");
        expect(unknown.rbsError.code).to.equal("RunbookStudio.RuntimeProtocol");
        expect(unknown.rbsError.message).to.contain("some-future-code");
        expect(unknown.rbsError.retryable).to.equal(true);
    });

    test("planner generation targets the open draft with an If-Match revision", () => {
        expect(
            plannerRequestBody("inspect blocking", {
                assetId: "runbook-open-draft",
                revisionId: "rev-17",
            }),
        ).to.deep.equal({
            promptText: "inspect blocking",
            runbookId: "runbook-open-draft",
            ifMatchRevision: "rev-17",
        });
        expect(plannerRequestBody("new detached runbook")).to.deep.equal({
            promptText: "new detached runbook",
        });
    });

    test("library content fingerprint ignores lifecycle revisions but detects plan edits", () => {
        const head = {
            id: "rb-1",
            revisionId: "rev-1",
            state: "draft",
            versionLabel: "1.00",
            updatedAt: "2026-07-18T00:00:00Z",
            title: "Blocking",
            description: "Inspect blockers",
            category: "investigate",
            plan: { nodes: [{ id: "query" }], edges: [] },
            schemaVersion: 1,
        };
        const lifecycleOnly = {
            ...head,
            revisionId: "rev-2",
            state: "approved",
            versionLabel: "1.01",
            updatedAt: "2026-07-18T01:00:00Z",
        };
        expect(libraryContentFingerprint(lifecycleOnly)).to.equal(libraryContentFingerprint(head));
        expect(
            libraryContentFingerprint({
                ...lifecycleOnly,
                plan: { nodes: [{ id: "query" }, { id: "report" }], edges: [] },
            }),
        ).not.to.equal(libraryContentFingerprint(head));
        expect(
            libraryContentFingerprint({
                ...lifecycleOnly,
                clientExtensions: { vscodeMssqlArtifact: { name: "Locally edited" } },
            }),
        ).not.to.equal(libraryContentFingerprint(head));
    });

    test("library rebase keeps remote-only edits and replays local edits", () => {
        const base = {
            name: "Blocking",
            source: { intent: "Inspect blockers", parameters: [{ id: "target" }] },
            lock: { planRevision: "1", nodes: [{ id: "query" }] },
            presentation: { revision: 1, sections: [] },
        };
        const local = {
            ...base,
            presentation: { revision: 2, sections: [{ id: "summary" }] },
        } as unknown as Parameters<typeof rebaseLibraryArtifact>[1];
        const remote = {
            ...base,
            name: "Blocking analysis",
            lock: { planRevision: "2", nodes: [{ id: "query" }, { id: "report" }] },
        };

        const rebased = rebaseLibraryArtifact(base, local, remote);

        expect(rebased.name).to.equal("Blocking analysis");
        expect(rebased.lock?.planRevision).to.equal("2");
        expect(rebased.presentation).to.deep.equal(local.presentation);
    });

    test("[artifact-folder-routing] library save preserves folder and local plan", async () => {
        const artifact = createFixtureRunbookArtifact();
        artifact.id = "rb-extension-native";
        artifact.name = "Extract and inspect schema";
        artifact.family = "build";
        artifact.lock!.nodes[0].activityKind = "dacpac.extract";
        const original = {
            ...createFixtureRunbookArtifact(),
            id: artifact.id,
            name: "New runbook",
        };
        const head = {
            id: artifact.id,
            revisionId: "revision-1",
            title: original.name,
            description: original.description,
            category: "Testing3",
            plan: { nodes: [], edges: [] },
            clientExtensions: { vscodeMssqlArtifact: original },
        };
        const supervisor = sandbox.createStubInstance(RuntimeSupervisor);
        supervisor.ensureRunning.resolves({
            baseUrl: "http://127.0.0.1:43119",
            metadata: { version: "test" },
            pid: 1,
        });
        const fetchStub = sandbox.stub(globalThis, "fetch");
        fetchStub.onFirstCall().resolves(
            new Response(JSON.stringify(head), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        let savedBody: Record<string, unknown> | undefined;
        fetchStub.onSecondCall().callsFake(async (_input, init) => {
            savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(
                JSON.stringify({
                    ...savedBody,
                    revisionId: "revision-2",
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            );
        });
        const adapter = new HobbesRuntimeAdapter(supervisor);

        const result = await adapter.commitLibraryDocument(
            artifact.id,
            artifact,
            {
                assetId: artifact.id,
                revisionId: "revision-1",
                contentFingerprint: "content-1",
                extensionFingerprint: "extension-1",
                extensionArtifact: original,
            },
            "normal",
            { traceId: "trace-library-save", operationId: "operation-library-save" },
        );

        expect(result.status).to.equal("committed");
        expect(fetchStub).to.have.been.calledTwice;
        expect(savedBody?.plan).to.deep.equal(head.plan);
        expect(savedBody?.category).to.equal("Testing3");
        expect(savedBody).to.have.nested.property(
            "clientExtensions.vscodeMssqlArtifact.lock.nodes[0].activityKind",
            "dacpac.extract",
        );
    });

    test("findFreePort returns a bindable loopback port", async () => {
        const port = await findFreePort();
        expect(port).to.be.greaterThan(0);
        expect(port).to.be.lessThan(65536);
        const second = await findFreePort();
        expect(second).to.be.greaterThan(0);
    });

    suite("ReasoningCoalescer", () => {
        test("flushes one combined run when the size ceiling is reached", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            const fragment = "x".repeat(60);
            coalescer.append(fragment, 0);
            coalescer.append(fragment, 1);
            coalescer.append(fragment, 2);
            expect(emitted).to.have.length(0);
            coalescer.append(fragment, 3); // 240 chars → size flush
            expect(emitted).to.deep.equal([fragment.repeat(4)]);
        });

        test("boundary flush emits the partial buffer and empty flush is a no-op", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("thinking ", 0);
            coalescer.append("aloud", 10);
            coalescer.flush(); // tool-call / status / turn boundary
            expect(emitted).to.deep.equal(["thinking aloud"]);
            coalescer.flush(); // nothing buffered → no emission
            expect(emitted).to.have.length(1);
        });

        test("deadline poke flushes only once the first buffered char is 500ms old", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("slow", 1000);
            coalescer.poke(1499); // under the deadline: still buffering
            expect(emitted).to.have.length(0);
            coalescer.poke(1500); // 500ms since FIRST char → flush
            expect(emitted).to.deep.equal(["slow"]);
            // The deadline re-arms from the next first buffered char.
            coalescer.append("next", 2000);
            coalescer.poke(2100);
            expect(emitted).to.have.length(1);
            coalescer.poke(2500);
            expect(emitted).to.deep.equal(["slow", "next"]);
        });

        test("empty deltas never arm the deadline", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("", 0);
            coalescer.poke(10_000);
            coalescer.flush();
            expect(emitted).to.have.length(0);
        });
    });
});
