/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Executable coverage audit for representative workflows from
 * "Hobbes for SQL Developers in VS Code". Claims here are intentionally
 * narrower than the scenario titles: catalog presence proves an executable
 * primitive, while the guarded fake run proves the landed V02 correctness
 * core as one composed contract. Unsupported operations stay explicit so a
 * UI or planner change cannot accidentally claim complete CI/CD support.
 */

import { expect } from "chai";
import { findActivity } from "../../src/runbookStudio/activities/activityCatalog";
import { createDeveloperValidationPreviewArtifact } from "../../src/runbookStudio/developerValidationPreview";
import { newRunbookRootContext } from "../../src/runbookStudio/runbookDiag";
import { FakeRuntimeAdapter } from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
import {
    RuntimeBoundaryEvent,
    RuntimeEventObserver,
} from "../../src/runbookStudio/runtime/runtimeAdapterTypes";

class ScenarioObserver implements RuntimeEventObserver {
    public readonly events: RuntimeBoundaryEvent[] = [];
    private settle: (() => void) | undefined;
    public readonly terminal = new Promise<void>((resolve) => (this.settle = resolve));

    onEvent(event: RuntimeBoundaryEvent): void {
        this.events.push(event);
        if (event.kind === "terminal") {
            this.settle?.();
        }
    }
    onGap(): void {}
    onExit(): void {}
}

const landedScenarioClaims = [
    {
        id: "V01",
        scope: "build/discover/assert/evidence inner-loop core",
        activities: [
            "workspace.inspect",
            "sqltest.discover",
            "dacpac.build",
            "sqltest.run",
            "evidence.bundle",
        ],
    },
    {
        id: "B14",
        scope: "approval-bound owned localhost sandbox lifecycle",
        activities: ["sandbox.provision", "sandbox.dispose"],
    },
    {
        id: "V02",
        scope: "local pre-merge correctness core",
        activities: [
            "workspace.inspect",
            "sqltest.discover",
            "dacpac.build",
            "sandbox.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "sqltest.run",
            "tsqlt.run",
            "sandbox.dispose",
            "evidence.bundle",
        ],
    },
    {
        id: "V10",
        scope: "DACPAC-to-owned-target schema convergence",
        activities: [
            "dacpac.build",
            "sandbox.provision",
            "dacpac.deploy.preview",
            "dacpac.deploy",
            "schema.compare",
            "sandbox.dispose",
        ],
    },
    {
        id: "B18",
        scope: "database-to-DACPAC extraction and durable schema comparison artifact",
        activities: ["dacpac.extract", "schema.compare.export"],
    },
    {
        id: "V15",
        scope: "bounded SQL invariant and threshold evidence",
        activities: ["sql.query.read", "assert.threshold", "evidence.bundle"],
    },
    {
        id: "I25",
        scope: "workspace and read-only database health evidence",
        activities: ["workspace.inspect", "sql.query.read", "evidence.bundle"],
    },
    {
        id: "DCR13-GIT",
        scope: "bounded non-mutating repository change-set capture",
        activities: ["git.change-set.inspect"],
    },
    {
        id: "V17",
        scope: "measured workload with correlated XEvent evidence",
        activities: [
            "sql.container.provision",
            "sql.workload.inspect",
            "xevent.session.start",
            "sql.workload.run",
            "xevent.session.stop",
            "xevent.xel.analyze",
            "xevent.xel.collect",
            "workload.benchmark",
            "sql.container.dispose",
        ],
    },
] as const;

const unsupportedScenarioClaims = [
    { id: "B01", title: "Scaffold new application DB", missing: "db.project.scaffold" },
    { id: "B04", title: "Author FK and supporting indexes", missing: "db.schema.apply" },
    { id: "B16", title: "Constraint-aware sample data", missing: "data.generate.constraint-aware" },
    { id: "V06", title: "Upgrade previous release", missing: "db.upgrade.validate" },
    { id: "V20", title: "Security and permissions", missing: "security.permissions.validate" },
    { id: "I01", title: "Query latency regression", missing: "perf.baseline.compare" },
    { id: "I19", title: "Connection/auth diagnosis", missing: "connection.auth.diagnose" },
    {
        id: "I22",
        title: "Reproduce production incident safely",
        missing: "incident.replay.sandbox",
    },
] as const;

async function waitForEvent(
    observer: ScenarioObserver,
    predicate: (event: RuntimeBoundaryEvent) => boolean,
): Promise<RuntimeBoundaryEvent> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        const event = observer.events.find(predicate);
        if (event) {
            return event;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    throw new Error("Timed out waiting for the developer scenario event");
}

suite("developer scenario smoke", () => {
    test("keeps nine landed scenario slices anchored to executable catalog activities", () => {
        expect(landedScenarioClaims).to.have.length(9);
        for (const scenario of landedScenarioClaims) {
            for (const activity of scenario.activities) {
                const descriptor = findActivity(activity);
                expect(descriptor, `${scenario.id} ${scenario.scope}: ${activity}`).not.to.equal(
                    undefined,
                );
                expect(descriptor?.previewOnly, `${scenario.id} ${activity}`).not.to.equal(true);
            }
        }
    });

    test("runs the composed V02 correctness core through approvals, cleanup, and evidence", async () => {
        const adapter = new FakeRuntimeAdapter();
        const observer = new ScenarioObserver();
        const artifact = createDeveloperValidationPreviewArtifact();
        const context = newRunbookRootContext("scenario-v02-core");
        try {
            expect((await adapter.validate(artifact, context)).ok).to.equal(true);
            await adapter.startRun(
                {
                    runId: "scenario-v02-core",
                    artifact,
                    parameterValues: {
                        projectPath: "Database.sqlproj",
                        sandboxConnection: "preview-profile",
                    },
                },
                observer,
                context,
            );
            await waitForEvent(
                observer,
                (event) => event.kind === "gateRequested" && event.nodeId === "approve-sandbox",
            );
            expect(
                await adapter.respondToGate("scenario-v02-core", "approve-sandbox", true, context),
            ).to.equal(true);
            await waitForEvent(
                observer,
                (event) => event.kind === "gateRequested" && event.nodeId === "approve-deploy",
            );
            expect(
                await adapter.respondToGate("scenario-v02-core", "approve-deploy", true, context),
            ).to.equal(true);
            await observer.terminal;

            const succeeded = observer.events.filter(
                (event): event is Extract<RuntimeBoundaryEvent, { kind: "nodeState" }> =>
                    event.kind === "nodeState" && event.state === "succeeded",
            );
            const contracts = succeeded
                .map((event) => event.output?.contract)
                .filter((contract): contract is string => contract !== undefined);
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
            ]);
            expect(contracts.indexOf("cleanupEvidence/1")).to.be.lessThan(
                contracts.indexOf("evidenceBundle/1"),
            );
            const terminal = observer.events.find(
                (event): event is Extract<RuntimeBoundaryEvent, { kind: "terminal" }> =>
                    event.kind === "terminal",
            );
            expect(terminal).to.include({ state: "succeeded", verdict: "pass" });
            expect(terminal?.diagnosticCounts).to.deep.equal({ warningCount: 0, errorCount: 0 });
            expect(terminal?.runMetrics).to.deep.include({
                "workspace.folderCount": 1,
                "workspace.projectCount": 1,
                "tests.discovered": 2,
                "tests.discoveryComplete": true,
                "build.artifactSizeBytes": 84 * 1024,
                "sandbox.provisioned": true,
                "deployment.previewChangeCount": 3,
                "deployment.applied": true,
                "schema.alertCount": 0,
                "schema.matches": true,
                "sqlTests.passed": 2,
                "cleanup.completed": true,
                "evidence.verdict": "pass",
            });
        } finally {
            await adapter.dispose();
        }
    });

    test("keeps eight unsupported scenario operations design-only", () => {
        expect(unsupportedScenarioClaims).to.have.length(8);
        for (const scenario of unsupportedScenarioClaims) {
            expect(
                findActivity(scenario.missing),
                `${scenario.id} ${scenario.title} unexpectedly claims executable support`,
            ).to.equal(undefined);
        }
    });
});
