/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Executable coverage audit for representative workflows from
 * "Hobbes for SQL Developers in VS Code". This intentionally distinguishes
 * the small end-to-end slice that works today from workflows that still need
 * typed activities; adding a capability should require updating this audit.
 */

import { expect } from "chai";
import { findActivity } from "../../src/runbookStudio/activities/activityCatalog";
import { createFixtureRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
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

const representativeScenarios = [
    { id: "B01", title: "Scaffold new application DB", missing: "db.project.scaffold" },
    { id: "B14", title: "Provision local/ephemeral DB", missing: "db.sandbox.provision" },
    { id: "B16", title: "Constraint-aware sample data", missing: "data.generate.constraint-aware" },
    { id: "B04", title: "FK relationship + supporting indexes", missing: "db.schema.apply" },
    { id: "V02", title: "Full pre-merge verification", missing: "db.project.build" },
    { id: "V06", title: "Upgrade previous release", missing: "db.upgrade.validate" },
    { id: "V10", title: "Schema drift", missing: "db.schema.compare" },
    { id: "V17", title: "Performance regression benchmark", missing: "workload.benchmark" },
    { id: "V20", title: "Security and permissions", missing: "security.permissions.validate" },
    { id: "I01", title: "Query latency regression", missing: "perf.baseline.compare" },
    { id: "I19", title: "Connection/auth diagnosis", missing: "connection.auth.diagnose" },
    {
        id: "I22",
        title: "Reproduce production incident safely",
        missing: "incident.replay.sandbox",
    },
] as const;

suite("developer scenario smoke", () => {
    test("runs the current V01, V15, and I25 read-only slices through results", async () => {
        for (const scenario of [
            { id: "V01", title: "Fast inner-loop check" },
            { id: "V15", title: "Data-quality invariant" },
            { id: "I25", title: "Developer environment health" },
        ]) {
            const adapter = new FakeRuntimeAdapter();
            const artifact = createFixtureRunbookArtifact();
            artifact.id = scenario.id.toLowerCase();
            artifact.name = scenario.title;
            artifact.source.intent = scenario.title;
            const validation = await adapter.validate(
                artifact,
                newRunbookRootContext(`scenario-${scenario.id}`),
            );
            expect(validation.ok, scenario.id).to.equal(true);

            const observer = new ScenarioObserver();
            await adapter.startRun(
                {
                    runId: `scenario-${scenario.id}`,
                    artifact,
                    parameterValues: { target: "synthetic", maxCount: 100 },
                },
                observer,
                newRunbookRootContext(`scenario-${scenario.id}`),
            );
            await observer.terminal;

            const terminal = observer.events.find((event) => event.kind === "terminal");
            expect(terminal).to.include({ state: "succeeded", verdict: "pass" });
            expect(
                observer.events.some(
                    (event) => event.kind === "nodeState" && event.output?.contract === "rowset/1",
                ),
                `${scenario.id} rowset evidence`,
            ).to.equal(true);
            expect(
                observer.events.some(
                    (event) =>
                        event.kind === "nodeState" && event.output?.contract === "markdown/1",
                ),
                `${scenario.id} report evidence`,
            ).to.equal(true);
            await adapter.dispose();
        }
    });

    test("records the missing typed capability for twelve broader workflows", () => {
        expect(representativeScenarios).to.have.length(12);
        for (const scenario of representativeScenarios) {
            expect(
                findActivity(scenario.missing),
                `${scenario.id} ${scenario.title} unexpectedly claims executable support`,
            ).to.equal(undefined);
        }
    });
});
