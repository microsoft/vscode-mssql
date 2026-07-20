/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure presentation resolution (RBS2-9 keystone): determinism, total layout
 * (explicit pending/noOutput/expired/sourceMissing states), derived default
 * layout, drift fallback with the pin preserved, and definition validation
 * degrading to derived rather than blanking the surface.
 */

import { expect } from "chai";
import {
    applyPresentationLayoutEdits,
    applyOutputSchemaBindings,
    compatibleViews,
    createViewSpec,
    DEFAULT_PRESENTATION_LAYOUT,
    migrateLegacyPresentationDefinition,
    outputPresentationsOf,
    pinnedViewsOf,
    presentationWidgetsOf,
    resetOutputPresentation,
    resolveDerivedSourcePlan,
    resolvePresentation,
    upsertOutputPin,
    upsertOutputPresentation,
    validateOutputViewSettings,
    validatePresentationDefinition,
} from "../../src/runbookStudio/presentation/presentationResolver";
import {
    LegacyPresentationDefinition,
    PresentationDefinition,
    PRESENTATION_SCHEMA_VERSION,
    expectedContractFor,
    isViewCandidateSelectable,
    outputPresentationNeedsReview,
    outputSchemaFingerprint,
    viewCandidateTier,
    viewCandidates,
    RunFieldName,
} from "../../src/sharedInterfaces/runbookPresentation";
import { RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";
import { findActivity } from "../../src/runbookStudio/activities/activityCatalog";

function snapshot(): RunbookRunSnapshot {
    return {
        runId: "run_1",
        runbookId: "rb",
        planRevision: "1",
        planHash: "sha256:x",
        state: "succeeded",
        seq: 9,
        nodes: [
            {
                nodeId: "query",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "h1", contract: "rowset/1", rows: 5 }],
            },
            {
                nodeId: "threshold",
                state: "succeeded",
                attempt: 1,
                outputs: [{ handleId: "h2", contract: "scalarSet/1" }],
            },
            { nodeId: "report", state: "running", attempt: 1 },
        ],
    };
}

function definition(): PresentationDefinition {
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: 3,
        authoredForPlanRevision: "1",
        registryVersion: "2.0",
        results: {
            sections: [
                { id: "main", label: "Main", role: "primary", order: 0, whenEmpty: "collapse" },
                { id: "overflow", role: "overflow", order: 1, whenEmpty: "collapse" },
            ],
            widgets: [
                binding("w1", "query", "grid", 0),
                binding("w2", "threshold", "scalar-cards", 1, true),
                binding("w3", "report", "markdown", 2),
                binding("w4", "gone", "grid", 3),
            ],
            layout: DEFAULT_PRESENTATION_LAYOUT,
        },
        derivedSources: [],
    };
}

function binding(
    id: string,
    nodeId: string,
    kind: Parameters<typeof createViewSpec>[0],
    order: number,
    pinned = false,
): PresentationDefinition["results"]["widgets"][number] {
    const view = createViewSpec(kind, `${id}:${kind}`);
    return {
        id,
        source: { kind: "activity-output", nodeId, slot: "primary" },
        views: [view],
        presentation: { mode: "single" },
        defaultViewId: view.id,
        sectionId: "main",
        placement: { order },
        authoredContract: "unknown/1",
        authoredContractFingerprint: "test",
        provenance: pinned ? { by: "user" } : { by: "default" },
    };
}

function runFieldBinding(
    id: string,
    field: RunFieldName,
    order: number,
    viewKind: Parameters<typeof createViewSpec>[0] = "scalar-cards",
): PresentationDefinition["results"]["widgets"][number] {
    const view = createViewSpec(viewKind, `${id}:${viewKind}`);
    return {
        id,
        source: { kind: "run-field", field },
        views: [view],
        presentation: { mode: "single" },
        defaultViewId: view.id,
        sectionId: "main",
        placement: { order },
        authoredContract: "scalarSet/1",
        authoredContractFingerprint: "scalarSet/1",
        provenance: { by: "default" },
    };
}

suite("presentationResolver", () => {
    test("rowset candidates expose both shipped chart renderers", () => {
        expect(compatibleViews("rowset/1")).to.deep.equal(["grid", "bar", "timeseries", "json"]);
        expect(viewCandidateTier("rowset/1", "grid")).to.equal("recommended");
        expect(viewCandidateTier("rowset/1", "bar")).to.equal("available");
        expect(viewCandidateTier("rowset/1", "json")).to.equal("fallback");
        expect(viewCandidateTier("unknown/1", "json")).to.equal("recommended");
    });

    test("unknown rowset fields keep shape-dependent charts explicitly conditional", () => {
        expect(
            viewCandidates("rowset/1")
                .filter((candidate) => candidate.view === "bar" || candidate.view === "timeseries")
                .map((candidate) => [
                    candidate.view,
                    candidate.compatibility,
                    candidate.reason,
                    candidate.score,
                ]),
        ).to.deep.equal([
            ["bar", "conditional", "runtime-shape-required", 0.78],
            ["timeseries", "conditional", "runtime-shape-required", 0.88],
        ]);
    });

    test("known fields bind viable charts and retain impossible charts with exact reasons", () => {
        const candidates = viewCandidates("rowset/1", {
            fields: [
                { name: "test", valueType: "string", roles: ["label"] },
                { name: "durationMs", valueType: "number", roles: ["measure"] },
            ],
        });
        expect(candidates.find((candidate) => candidate.view === "bar")).to.deep.include({
            compatibility: "compatible",
            reason: "category-and-measure",
            bindings: { categoryField: "test", valueFields: ["durationMs"] },
        });
        expect(candidates.find((candidate) => candidate.view === "timeseries")).to.deep.include({
            compatibility: "incompatible",
            reason: "temporal-field-missing",
            score: 0,
        });

        const noMeasure = viewCandidates("testResults/1", {
            fields: [{ name: "passed", valueType: "boolean" }],
        });
        expect(noMeasure.find((candidate) => candidate.view === "bar")).to.deep.include({
            compatibility: "incompatible",
            reason: "numeric-field-missing",
        });

        expect(
            viewCandidates("testResults/1", findActivity("sqltest.run")?.outputSchema).find(
                (candidate) => candidate.view === "bar",
            )?.compatibility,
        ).to.equal("incompatible");
        expect(
            viewCandidates("testResults/1", findActivity("tsqlt.run")?.outputSchema).find(
                (candidate) => candidate.view === "bar",
            )?.bindings,
        ).to.deep.equal({ categoryField: "suite", valueFields: ["durationMs"] });
        expect(
            isViewCandidateSelectable(
                "testResults/1",
                "bar",
                findActivity("sqltest.run")?.outputSchema,
            ),
        ).to.equal(false);
        expect(
            isViewCandidateSelectable(
                "testResults/1",
                "bar",
                findActivity("tsqlt.run")?.outputSchema,
            ),
        ).to.equal(true);
        expect(isViewCandidateSelectable("rowset/1", "timeseries")).to.equal(true);
    });

    test("explicit authoring binds catalog fields and fingerprints descriptor changes", () => {
        const originalSchema = {
            fields: [
                { name: "suite", valueType: "string" as const, roles: ["label" as const] },
                {
                    name: "durationMs",
                    valueType: "number" as const,
                    roles: ["measure" as const],
                },
            ],
        };
        const originalFingerprint = outputSchemaFingerprint("testResults/1", originalSchema);
        expect(
            outputSchemaFingerprint("testResults/1", {
                fields: [
                    { name: "suite", valueType: "string", roles: ["category", "label"] },
                    { name: "durationMs", valueType: "number", roles: ["measure"] },
                ],
            }),
        ).to.equal(
            outputSchemaFingerprint("testResults/1", {
                fields: [
                    { name: "suite", valueType: "string", roles: ["label", "category"] },
                    { name: "durationMs", valueType: "number", roles: ["measure"] },
                ],
            }),
        );

        const bound = applyOutputSchemaBindings(
            {
                id: "bar",
                kind: "bar",
                props: {
                    categoryField: "oldCategory",
                    valueFields: ["oldValue"],
                    orientation: "horizontal",
                },
            },
            "testResults/1",
            originalSchema,
        );
        expect(bound).to.deep.equal({
            id: "bar",
            kind: "bar",
            props: {
                categoryField: "suite",
                valueFields: ["durationMs"],
                orientation: "horizontal",
            },
        });

        const authored = upsertOutputPresentation(
            undefined,
            "tests",
            ["bar"],
            { mode: "single" },
            "bar",
            { bar: { orientation: "vertical" } },
            {
                authoredContract: "testResults/1",
                authoredContractFingerprint: originalFingerprint,
                outputSchema: originalSchema,
            },
        );
        const summary = outputPresentationsOf(authored).tests;
        expect(summary.authoredContractFingerprint).to.equal(originalFingerprint);
        expect(outputPresentationNeedsReview(summary, originalFingerprint)).to.equal(false);
        expect(authored.results.widgets[0].views[0]).to.deep.include({
            kind: "bar",
            props: {
                categoryField: "suite",
                valueFields: ["durationMs"],
                orientation: "vertical",
                sort: undefined,
                maxCategories: undefined,
            },
        });

        const changedSchema = {
            fields: [
                { name: "testClass", valueType: "string" as const },
                { name: "elapsedMs", valueType: "number" as const },
            ],
        };
        const changedFingerprint = outputSchemaFingerprint("testResults/1", changedSchema);
        expect(changedFingerprint).not.to.equal(originalFingerprint);
        expect(outputPresentationNeedsReview(summary, changedFingerprint)).to.equal(true);

        const reviewed = upsertOutputPresentation(
            authored,
            "tests",
            ["bar"],
            { mode: "single" },
            "bar",
            summary.settings,
            {
                authoredContract: "testResults/1",
                authoredContractFingerprint: changedFingerprint,
                outputSchema: changedSchema,
            },
        );
        expect(reviewed.results.widgets[0].views[0]).to.deep.include({
            props: {
                categoryField: "testClass",
                valueFields: ["elapsedMs"],
                orientation: "vertical",
                sort: undefined,
                maxCategories: undefined,
            },
        });
        expect(
            outputPresentationNeedsReview(
                outputPresentationsOf(reviewed).tests,
                changedFingerprint,
            ),
        ).to.equal(false);
    });

    test("developer evidence contracts have implemented default presentations", () => {
        for (const [activityKind, contract] of [
            ["workspace.inspect", "workspaceSnapshot/1"],
            ["dacpac.build", "dacpacArtifact/1"],
            ["sandbox.provision", "databaseLease/1"],
            ["dacpac.deploy", "deploymentEvidence/1"],
            ["sandbox.dispose", "cleanupEvidence/1"],
        ] as const) {
            expect(expectedContractFor("activity", activityKind)).to.equal(contract);
            expect(compatibleViews(contract)).to.deep.equal(["scalar-cards", "json"]);
        }
        expect(expectedContractFor("activity", "dacpac.deploy.preview")).to.equal(
            "deploymentPreview/1",
        );
        expect(compatibleViews("deploymentPreview/1")).to.deep.equal(["log-view", "json"]);
        expect(expectedContractFor("activity", "schema.compare")).to.equal("schemaDiff/1");
        expect(compatibleViews("schemaDiff/1")).to.deep.equal(["log-view", "json"]);
        expect(expectedContractFor("activity", "sqltest.discover")).to.equal(
            "testSuiteDiscovery/1",
        );
        expect(compatibleViews("testSuiteDiscovery/1")).to.deep.equal(["grid", "json"]);
        expect(expectedContractFor("activity", "sqltest.run")).to.equal("testResults/1");
        expect(expectedContractFor("activity", "tsqlt.run")).to.equal("testResults/1");
        expect(compatibleViews("testResults/1")).to.deep.equal(["grid", "bar", "json"]);
        expect(expectedContractFor("activity", "evidence.bundle")).to.equal("evidenceBundle/1");
        expect(compatibleViews("evidenceBundle/1")).to.deep.equal(["log-view", "json"]);
    });

    test("resolution is deterministic", () => {
        const a = resolvePresentation(definition(), snapshot());
        const b = resolvePresentation(definition(), snapshot());
        expect(JSON.stringify(a)).to.equal(JSON.stringify(b));
    });

    test("total layout: every widget resolves to an explicit state", () => {
        const resolved = resolvePresentation(definition(), snapshot());
        const widgets = resolved.sections[0].widgets;
        expect(widgets.map((w) => w.state)).to.deep.equal([
            "ready", // query rowset
            "ready", // threshold scalars
            "pending", // report still running, no output yet
            "sourceMissing", // node 'gone' not in the plan
        ]);
        expect(resolved.revision).to.equal(3);
        expect(resolved.derived).to.equal(false);
    });

    test("noOutput when a terminal node produced nothing", () => {
        const snap = snapshot();
        snap.nodes[2] = { nodeId: "report", state: "succeeded", attempt: 1 };
        const resolved = resolvePresentation(definition(), snap);
        expect(resolved.sections[0].widgets[2].state).to.equal("noOutput");
    });

    test("branch-not-taken outputs reflow without parsing localized messages", () => {
        const snap = snapshot();
        snap.nodes[1] = {
            nodeId: "threshold",
            state: "skipped",
            attempt: 0,
            outcome: "skipped",
            branchNotTaken: true,
            message: "localized text can change",
        };
        const resolved = resolvePresentation(definition(), snap);
        expect(resolved.sections[0].widgets.map((widget) => widget.id)).to.deep.equal([
            "w1",
            "w3",
            "w4",
        ]);
    });

    test("expired handles render as expired, keeping identity", () => {
        const snap = snapshot();
        snap.nodes[0].outputs = [{ handleId: "h1", contract: "rowset/1", expired: true }];
        const resolved = resolvePresentation(definition(), snap);
        const widget = resolved.sections[0].widgets[0];
        expect(widget.state).to.equal("expired");
        expect(widget.handleId).to.equal("h1");
    });

    test("drift: incompatible pinned view degrades visibly to the contract default", () => {
        const def = definition();
        // Pin the threshold widget to a view its scalarSet contract does not support.
        def.results.widgets[1].views = [createViewSpec("er-diagram", "w2:er")];
        def.results.widgets[1].defaultViewId = "w2:er";
        const resolved = resolvePresentation(def, snapshot());
        const widget = resolved.sections[0].widgets[1];
        expect(widget.state).to.equal("ready");
        expect(widget.view).to.equal("scalar-cards");
        expect(widget.drift?.requestedView).to.equal("er-diagram");
    });

    test("V2 drift is per view and preserves a compatible authored sibling", () => {
        const def = definition();
        const widget = def.results.widgets[1];
        widget.views = [createViewSpec("bar", "w2:bar"), createViewSpec("json", "w2:json")];
        widget.presentation = { mode: "tabs" };
        widget.defaultViewId = "w2:bar";

        const resolved = resolvePresentation(def, snapshot()).sections[0].widgets[1];
        expect(resolved.view).to.equal("json");
        expect(resolved.activeViewId).to.equal("w2:json");
        expect(resolved.presentation).to.deep.equal({ mode: "tabs" });
        expect(resolved.views[0].issue).to.deep.include({
            viewId: "w2:bar",
            code: "CONTRACT_KIND_CHANGED",
            fallbackViewId: "w2:json",
        });
        expect(resolved.views[1].issue).to.equal(undefined);
    });

    test("unknown V2 section assignments flow to the configured overflow section", () => {
        const def = definition();
        def.results.widgets[0].sectionId = "removed-section";
        const resolved = resolvePresentation(def, snapshot());
        expect(
            resolved.sections.find((section) => section.id === "overflow")?.widgets[0].id,
        ).to.equal("w1");
    });

    test("outputs added after authoring remain visible in Overflow", () => {
        const def = definition();
        def.results.widgets = def.results.widgets.filter((widget) => widget.id !== "w2");
        const resolved = resolvePresentation(def, snapshot());
        const overflow = resolved.sections.find((section) => section.id === "overflow");
        expect(overflow?.widgets.map((widget) => widget.id)).to.deep.equal([
            "overflow:threshold:primary",
        ]);
        expect(overflow?.widgets[0]).to.deep.include({
            nodeId: "threshold",
            view: "scalar-cards",
            state: "ready",
        });
    });

    test("no definition derives one section per node with outputs", () => {
        const resolved = resolvePresentation(undefined, snapshot());
        expect(resolved.derived).to.equal(true);
        expect(resolved.revision).to.equal(0);
        expect(resolved.sections.map((s) => s.id)).to.deep.equal(["node:query", "node:threshold"]);
        expect(resolved.sections[0].widgets[0].view).to.equal("grid");
        expect(resolved.sections[1].widgets[0].view).to.equal("scalar-cards");
    });

    test("validatePresentationDefinition refuses malformed/duplicate/newer input", () => {
        expect(validatePresentationDefinition(undefined)).to.equal(undefined);
        expect(validatePresentationDefinition("nope")).to.equal(undefined);
        expect(
            validatePresentationDefinition({ schemaVersion: 3, revision: 1, sections: [] }),
        ).to.equal(undefined);
        const dupe = definition();
        dupe.results.widgets.push({ ...dupe.results.widgets[0] });
        expect(validatePresentationDefinition(dupe)).to.equal(undefined);
        expect(validatePresentationDefinition(definition())).to.not.equal(undefined);
    });

    test("migrates V1 definitions to V2 without losing layout, titles, or pins", () => {
        const legacy: LegacyPresentationDefinition = {
            schemaVersion: 1,
            revision: 7,
            sections: [
                {
                    id: "main",
                    title: "Main",
                    widgets: [
                        {
                            id: "old-widget",
                            source: { nodeId: "query", outputIndex: 0 },
                            view: "bar",
                            title: "Rows by category",
                            pinnedByUser: true,
                        },
                    ],
                },
            ],
        };
        const migrated = migrateLegacyPresentationDefinition(legacy);
        expect(migrated.schemaVersion).to.equal(2);
        expect(migrated.revision).to.equal(7);
        expect(migrated.results.sections[0]).to.deep.include({
            id: "main",
            label: "Main",
            role: "primary",
        });
        expect(migrated.results.widgets[0].views[0]).to.deep.include({
            kind: "bar",
            title: "Rows by category",
        });
        expect(pinnedViewsOf(migrated)).to.deep.equal({ query: "bar" });
        expect(validatePresentationDefinition(legacy)).to.deep.equal(migrated);
    });

    test("empty run resolves to an empty derived layout (not a crash)", () => {
        const resolved = resolvePresentation(undefined, undefined);
        expect(resolved.sections).to.deep.equal([]);
        expect(resolved.derived).to.equal(true);
    });

    test("empty-section policies collapse, describe, or reserve explicitly", () => {
        const def = definition();
        def.results.widgets = [];
        def.results.sections = [
            { id: "collapsed", role: "summary", order: 0, whenEmpty: "collapse" },
            {
                id: "described",
                label: "Checks",
                role: "primary",
                order: 1,
                whenEmpty: "show-empty-state",
            },
            { id: "reserved", role: "details", order: 2, whenEmpty: "reserve" },
        ];
        def.results.layout = { ...def.results.layout, overflowSectionId: "collapsed" };
        def.results.emptyState = {
            title: "No checks yet",
            body: "Run validation to populate this section.",
            suggestedAction: "Run validation",
        };

        const resolved = resolvePresentation(def, undefined);
        expect(resolved.sections.map((section) => section.id)).to.deep.equal([
            "described",
            "reserved",
        ]);
        expect(resolved.sections.map((section) => section.whenEmpty)).to.deep.equal([
            "show-empty-state",
            "reserve",
        ]);
        expect(resolved.emptyState).to.deep.equal(def.results.emptyState);
        expect(resolved.emptyState).not.to.equal(def.results.emptyState);
    });

    test("visibility policies use durable readiness, row-count, terminal, and verdict facts", () => {
        const def = definition();
        def.results.widgets = [
            { ...binding("always", "query", "grid", 0), visibility: { when: "always" } },
            { ...binding("ready", "query", "grid", 1), visibility: { when: "source-ready" } },
            {
                ...binding("nonempty", "query", "grid", 2),
                visibility: { when: "source-non-empty" },
            },
            {
                ...binding("unknown-rows", "threshold", "scalar-cards", 3),
                visibility: { when: "source-non-empty" },
            },
            {
                ...binding("complete", "query", "grid", 4),
                visibility: { when: "run-complete" },
            },
            {
                ...binding("passing", "query", "grid", 5),
                visibility: { when: "verdict", values: ["pass"] },
            },
            {
                ...binding("warning", "query", "grid", 6),
                visibility: { when: "verdict", values: ["warn"] },
            },
            { ...binding("never", "query", "grid", 7), visibility: { when: "never" } },
        ];
        const snap = snapshot();
        snap.verdict = "pass";

        const terminalIds = resolvePresentation(def, snap).sections[0].widgets.map(
            (widget) => widget.id,
        );
        expect(terminalIds).to.deep.equal(["always", "ready", "nonempty", "complete", "passing"]);

        snap.state = "running";
        snap.verdict = undefined;
        snap.nodes[0].outputs![0].rows = 0;
        const runningIds = resolvePresentation(def, snap).sections[0].widgets.map(
            (widget) => widget.id,
        );
        expect(runningIds).to.deep.equal(["always", "ready"]);

        snap.verdict = "indeterminate";
        expect(
            resolvePresentation(def, snap).sections[0].widgets.map((widget) => widget.id),
        ).to.deep.equal(["always", "ready", "warning"]);

        snap.nodes[0].outputs![0].expired = true;
        expect(
            resolvePresentation(def, snap).sections[0].widgets.map((widget) => widget.id),
        ).to.deep.equal(["always", "warning"]);
    });

    test("run-field sources resolve bounded durable metadata without handles", () => {
        const def = definition();
        def.results.widgets = [
            {
                ...runFieldBinding("status", "status", 0),
                visibility: { when: "source-ready" },
            },
            runFieldBinding("verdict", "verdict", 1),
            runFieldBinding("elapsed", "elapsedMs", 2),
            runFieldBinding("completed", "completedNodeCount", 3),
            {
                ...runFieldBinding("total", "totalNodeCount", 4),
                visibility: { when: "source-non-empty" },
            },
            runFieldBinding("warnings", "warningCount", 5),
            runFieldBinding("fallback", "status", 6, "bar"),
        ];
        const snap = snapshot();
        snap.verdict = "pass";
        snap.startedEpochMs = 100;
        snap.endedEpochMs = 550;
        snap.diagnosticCounts = { warningCount: 2, errorCount: 0 };

        const widgets = resolvePresentation(def, snap).sections[0].widgets;
        expect(widgets.map((widget) => widget.id)).to.deep.equal([
            "status",
            "verdict",
            "elapsed",
            "completed",
            "total",
            "warnings",
            "fallback",
        ]);
        expect(widgets.map((widget) => widget.state)).to.deep.equal([
            "ready",
            "ready",
            "ready",
            "ready",
            "ready",
            "ready",
            "ready",
        ]);
        expect(widgets.slice(0, 6).map((widget) => widget.runField?.value)).to.deep.equal([
            "succeeded",
            "pass",
            450,
            2,
            3,
            2,
        ]);
        expect(widgets.every((widget) => widget.handleId === undefined)).to.equal(true);
        expect(widgets[6]).to.deep.include({ view: "scalar-cards", contract: "scalarSet/1" });
        expect(widgets[6].drift?.requestedView).to.equal("bar");

        snap.state = "running";
        snap.verdict = undefined;
        snap.endedEpochMs = undefined;
        const running = resolvePresentation(def, snap).sections[0].widgets;
        expect(running.find((widget) => widget.id === "verdict")?.state).to.equal("pending");
        expect(running.find((widget) => widget.id === "elapsed")?.state).to.equal("pending");

        snap.diagnosticCounts = undefined;
        expect(
            resolvePresentation(def, snap).sections[0].widgets.find(
                (widget) => widget.id === "warnings",
            )?.state,
        ).to.equal("sourceMissing");
    });

    test("run-metric sources resolve only durable runtime-published scalars", () => {
        const def = definition();
        def.results.widgets = [
            {
                ...runFieldBinding("passed", "status", 0),
                source: { kind: "run-metric", key: "tests.passed" },
                visibility: { when: "source-ready" },
            },
            {
                ...runFieldBinding("changed", "status", 1),
                source: { kind: "run-metric", key: "deployment.changed" },
            },
            {
                ...runFieldBinding("missing", "status", 2),
                source: { kind: "run-metric", key: "not.published" },
            },
        ];
        const snap = snapshot();
        snap.runMetrics = { "tests.passed": 18, "deployment.changed": false };
        const widgets = resolvePresentation(def, snap).sections[0].widgets;
        expect(widgets.map((widget) => widget.state)).to.deep.equal(["ready", "ready", "noOutput"]);
        expect(widgets[0].runMetric).to.deep.equal({ key: "tests.passed", value: 18 });
        expect(widgets[1].runMetric).to.deep.equal({
            key: "deployment.changed",
            value: false,
        });
        expect(widgets.every((widget) => widget.handleId === undefined)).to.equal(true);

        snap.state = "running";
        snap.runMetrics = undefined;
        const running = resolvePresentation(def, snap).sections[0].widgets;
        expect(running.map((widget) => widget.id)).to.deep.equal(["changed", "missing"]);
        expect(running.every((widget) => widget.state === "pending")).to.equal(true);
    });

    test("validation rejects run fields outside the closed grammar", () => {
        const def = definition() as unknown as {
            results: { widgets: Array<{ source: { kind: string; field?: string } }> };
        };
        def.results.widgets[0].source = { kind: "run-field", field: "secretPath" };
        expect(validatePresentationDefinition(def)).to.equal(undefined);
    });

    test("validation rejects empty run metric keys", () => {
        const def = definition() as unknown as {
            results: { widgets: Array<{ source: { kind: string; key?: string } }> };
        };
        def.results.widgets[0].source = { kind: "run-metric", key: "" };
        expect(validatePresentationDefinition(def)).to.equal(undefined);
    });

    test("derived widgets resolve to a trusted base handle and composed pipeline", () => {
        const def = definition();
        def.derivedSources = [
            {
                id: "slow-tests",
                from: { kind: "activity-output", nodeId: "query", slot: "primary" },
                pipeline: {
                    steps: [
                        { op: "filter", predicate: { op: "gt", field: "durationMs", value: 10 } },
                    ],
                },
                authoredContract: "rowset/1",
                provenance: { by: "user" },
            },
            {
                id: "slow-tests-top",
                from: { kind: "derived", sourceId: "slow-tests" },
                pipeline: { steps: [{ op: "limit", count: 5 }] },
                authoredContract: "rowset/1",
                provenance: { by: "user" },
            },
        ];
        def.results.widgets = [
            {
                ...binding("derived-widget", "unused", "grid", 0),
                source: { kind: "derived", sourceId: "slow-tests-top" },
                authoredContract: "rowset/1",
                authoredContractFingerprint: "rowset/1",
                visibility: { when: "source-ready" },
            },
        ];
        expect(validatePresentationDefinition(def)).to.exist;
        expect(resolveDerivedSourcePlan(def, "slow-tests-top", snapshot())).to.deep.equal({
            state: "ready",
            handleId: "h1",
            nodeId: "query",
            contract: "rowset/1",
            pipeline: {
                steps: [
                    { op: "filter", predicate: { op: "gt", field: "durationMs", value: 10 } },
                    { op: "limit", count: 5 },
                ],
            },
        });
        expect(resolvePresentation(def, snapshot()).sections[0].widgets[0]).to.deep.include({
            id: "derived-widget",
            state: "ready",
            handleId: "h1",
            contract: "rowset/1",
            derivedSourceId: "slow-tests-top",
        });

        const cyclic = structuredClone(def);
        cyclic.derivedSources[0].from = { kind: "derived", sourceId: "slow-tests-top" };
        expect(validatePresentationDefinition(cyclic)).to.equal(undefined);

        const tooDeep = structuredClone(def);
        tooDeep.derivedSources[0].pipeline.steps = Array.from({ length: 11 }, () => ({
            op: "limit" as const,
            count: 5,
        }));
        tooDeep.derivedSources[1].pipeline.steps = Array.from({ length: 10 }, () => ({
            op: "limit" as const,
            count: 5,
        }));
        expect(validatePresentationDefinition(tooDeep)).to.equal(undefined);

        const executable = structuredClone(def) as unknown as {
            derivedSources: Array<{ pipeline: { steps: unknown[] } }>;
        };
        executable.derivedSources[0].pipeline.steps = [{ op: "javascript", code: "alert(1)" }];
        expect(validatePresentationDefinition(executable)).to.equal(undefined);
    });

    test("upsertOutputPin creates, re-pins, and clears without touching authored widgets", () => {
        // First pin creates the definition + primary section.
        const pinned = upsertOutputPin(undefined, "query", "bar");
        expect(pinned.revision).to.equal(1);
        expect(pinned.results.sections.some((section) => section.id === "primary")).to.equal(true);
        expect(pinned.results.widgets[0]).to.deep.include({
            id: "pin-query",
            defaultViewId: "pin-query:bar",
        });
        expect(pinned.results.widgets[0].views[0].kind).to.equal("bar");
        expect(pinned.results.widgets[0].provenance.by).to.equal("user");
        expect(pinnedViewsOf(pinned)).to.deep.equal({ query: "bar" });

        // Re-pin updates in place (no duplicate widget).
        const repinned = upsertOutputPin(pinned, "query", "grid");
        expect(repinned.results.widgets).to.have.length(1);
        expect(pinnedViewsOf(repinned)).to.deep.equal({ query: "grid" });

        // Clearing removes the pin-created widget entirely.
        const cleared = upsertOutputPin(repinned, "query", undefined);
        expect(cleared.results.widgets).to.have.length(0);
        expect(pinnedViewsOf(cleared)).to.deep.equal({});

        // Clearing an AUTHORED widget only unpins it — never deletes layout.
        const authored = upsertOutputPin(undefined, "other", "grid");
        authored.results.widgets[0].id = "hand-made";
        const unpinned = upsertOutputPin(authored, "other", undefined);
        expect(unpinned.results.widgets).to.have.length(1);
        expect(unpinned.results.widgets[0].provenance.by).to.equal("default");
    });

    test("V2 output edits preserve retained settings and expose a bounded authoring summary", () => {
        const def = definition();
        def.results.widgets[0].views = [
            {
                id: "w1:bar",
                kind: "bar",
                props: {
                    categoryField: "category",
                    valueFields: ["count"],
                    orientation: "horizontal",
                },
            },
        ];
        def.results.widgets[0].defaultViewId = "w1:bar";

        const edited = upsertOutputPresentation(
            def,
            "query",
            ["bar", "json"],
            { mode: "tabs" },
            "json",
            undefined,
            { authoredContract: "rowset/1", planRevision: "8" },
        );
        expect(edited.revision).to.equal(4);
        expect(edited.authoredForPlanRevision).to.equal("8");
        expect(edited.results.widgets[0].views[0]).to.deep.include({
            id: "w1:bar",
            kind: "bar",
            props: {
                categoryField: "category",
                valueFields: ["count"],
                orientation: "horizontal",
            },
        });
        expect(outputPresentationsOf(edited).query).to.deep.equal({
            widgetId: "w1",
            views: ["bar", "json"],
            defaultView: "json",
            presentation: { mode: "tabs" },
            setByUser: true,
            sectionId: "main",
            placement: { order: 0 },
            hidden: false,
            settings: { bar: { orientation: "horizontal" } },
            authoredContractFingerprint: "rowset/1",
        });

        const configured = upsertOutputPresentation(
            edited,
            "query",
            ["bar", "json"],
            { mode: "tabs" },
            "json",
            {
                bar: {
                    orientation: "vertical",
                    sort: "category",
                    maxCategories: 20,
                },
            },
            { authoredContract: "rowset/1", planRevision: "8" },
        );
        expect(configured.results.widgets[0].views[0]).to.deep.include({
            id: "w1:bar",
            kind: "bar",
            props: {
                categoryField: "category",
                valueFields: ["count"],
                orientation: "vertical",
                sort: "category",
                maxCategories: 20,
            },
        });
        expect(outputPresentationsOf(configured).query.settings).to.deep.equal({
            bar: { orientation: "vertical", sort: "category", maxCategories: 20 },
        });
        expect(
            resolvePresentation(configured, snapshot()).sections[0].widgets[0].views[0].settings,
        ).to.deep.equal({
            orientation: "vertical",
            sort: "category",
            maxCategories: 20,
        });

        // Results can change the default without collapsing a multi-view
        // binding back to the old single-view grammar.
        const newDefault = upsertOutputPin(configured, "query", "bar");
        expect(outputPresentationsOf(newDefault).query).to.deep.include({
            views: ["bar", "json"],
            defaultView: "bar",
            presentation: { mode: "tabs" },
        });

        const reset = resetOutputPresentation(newDefault, "query", "grid", {
            authoredContract: "rowset/1",
            planRevision: "8",
        });
        expect(reset.results.widgets.find((widget) => widget.id === "w1")).to.exist;
        expect(outputPresentationsOf(reset).query).to.deep.equal({
            widgetId: "w1",
            views: ["grid"],
            defaultView: "grid",
            presentation: { mode: "single" },
            setByUser: false,
            sectionId: "main",
            placement: { order: 0 },
            hidden: false,
            authoredContractFingerprint: "rowset/1",
        });

        const generatedPin = upsertOutputPin(undefined, "new-node", "bar");
        const resetGenerated = resetOutputPresentation(generatedPin, "new-node", "grid");
        expect(resetGenerated.results.widgets).to.have.length(0);
    });

    test("native renderer settings reject unknown, unselected, and unbounded input", () => {
        expect(
            validateOutputViewSettings(
                {
                    grid: { pageSize: 25, density: "compact" },
                    bar: { orientation: "vertical", sort: "value-asc", maxCategories: 50 },
                },
                ["grid", "bar"],
            ),
        ).to.equal(true);
        expect(validateOutputViewSettings({ bar: { maxCategories: 500 } }, ["bar"])).to.equal(
            false,
        );
        expect(validateOutputViewSettings({ bar: { color: "red" } }, ["bar"])).to.equal(false);
        expect(validateOutputViewSettings({ grid: { pageSize: 25 } }, ["bar"])).to.equal(false);
        expect(validateOutputViewSettings({ json: {} }, ["json"])).to.equal(false);
    });

    test("layout edits materialize Overflow outputs and explicit hiding prevents reflow", () => {
        const laidOut = applyPresentationLayoutEdits(
            undefined,
            [
                {
                    nodeId: "query",
                    defaultView: "grid",
                    sectionId: "summary",
                    placement: { order: 2, span: { compact: 1, medium: 3, wide: 6 } },
                    hidden: false,
                },
            ],
            {
                contractByNode: { query: "rowset/1" },
                fingerprintByNode: { query: "schema-v1:rowset/1:known" },
                planRevision: "9",
            },
        );
        expect(outputPresentationsOf(laidOut).query).to.deep.include({
            widgetId: "layout-query",
            sectionId: "summary",
            placement: { order: 2, span: { compact: 1, medium: 3, wide: 6 } },
            hidden: false,
            authoredContractFingerprint: "schema-v1:rowset/1:known",
        });
        expect(resolvePresentation(laidOut, snapshot()).sections[0].widgets[0].nodeId).to.equal(
            "query",
        );

        const hidden = applyPresentationLayoutEdits(laidOut, [
            {
                nodeId: "query",
                widgetId: "layout-query",
                defaultView: "grid",
                sectionId: "summary",
                placement: { order: 2 },
                hidden: true,
            },
        ]);
        const resolved = resolvePresentation(hidden, snapshot());
        expect(
            resolved.sections
                .flatMap((section) => section.widgets)
                .some((widget) => widget.nodeId === "query"),
        ).to.equal(false);
        expect(outputPresentationsOf(hidden).query.hidden).to.equal(true);
    });

    test("layout edits atomically reorder sibling widgets", () => {
        const reordered = applyPresentationLayoutEdits(definition(), [
            {
                nodeId: "query",
                widgetId: "w1",
                defaultView: "grid",
                sectionId: "main",
                placement: { order: 1 },
                hidden: false,
            },
            {
                nodeId: "threshold",
                widgetId: "w2",
                defaultView: "scalar-cards",
                sectionId: "main",
                placement: { order: 0 },
                hidden: false,
            },
        ]);
        const ids = resolvePresentation(reordered, snapshot()).sections[0].widgets.map(
            (widget) => widget.id,
        );
        expect(ids.slice(0, 2)).to.deep.equal(["w2", "w1"]);
    });

    test("layout edits materialize source-aware run and derived widgets", () => {
        const base = definition();
        const derivedSource = {
            id: "slow-tests",
            from: { kind: "activity-output" as const, nodeId: "query", slot: "primary" },
            authoredContract: "rowset/1",
            pipeline: { steps: [{ op: "limit" as const, count: 5 }] },
        };
        const laidOut = applyPresentationLayoutEdits(
            base,
            [
                {
                    nodeId: "run-field:status",
                    source: { kind: "run-field", field: "status" },
                    defaultView: "scalar-cards",
                    sectionId: "main",
                    placement: { order: 2 },
                    hidden: false,
                },
                {
                    nodeId: "derived:slow-tests",
                    source: { kind: "derived", sourceId: "slow-tests" },
                    derivedSource,
                    defaultView: "grid",
                    sectionId: "main",
                    placement: { order: 3 },
                    hidden: false,
                },
            ],
            {
                contractByNode: {
                    "run-field:status": "scalarSet/1",
                    "derived:slow-tests": "rowset/1",
                },
                sourceByNode: {
                    "run-field:status": { kind: "run-field", field: "status" },
                    "derived:slow-tests": { kind: "derived", sourceId: "slow-tests" },
                },
                titleByNode: {
                    "run-field:status": "Run status",
                    "derived:slow-tests": "Slow tests",
                },
            },
        );
        expect(validatePresentationDefinition(laidOut)).to.deep.equal(laidOut);

        expect(presentationWidgetsOf(laidOut).slice(-2)).to.deep.include.members([
            {
                layoutId: "layout-run-field:status",
                widgetId: "layout-run-field:status",
                source: { kind: "run-field", field: "status" },
                defaultView: "scalar-cards",
                sectionId: "main",
                placement: { order: 2 },
                hidden: false,
            },
            {
                layoutId: "layout-derived:slow-tests",
                widgetId: "layout-derived:slow-tests",
                source: { kind: "derived", sourceId: "slow-tests" },
                derivedSource,
                defaultView: "grid",
                sectionId: "main",
                placement: { order: 3 },
                hidden: false,
            },
        ]);
        const widgets = resolvePresentation(laidOut, snapshot()).sections.flatMap(
            (section) => section.widgets,
        );
        expect(widgets.find((widget) => widget.id === "layout-run-field:status")).to.deep.include({
            state: "ready",
            source: { kind: "run-field", field: "status" },
        });
        expect(widgets.find((widget) => widget.id === "layout-derived:slow-tests")).to.deep.include(
            {
                state: "ready",
                source: { kind: "derived", sourceId: "slow-tests" },
                derivedSourceId: "slow-tests",
            },
        );
    });

    test("derived-source removal deletes its widget and leaves dependencies invalid", () => {
        const base = definition();
        base.derivedSources.push({
            id: "slow-tests",
            from: { kind: "activity-output", nodeId: "query", slot: "primary" },
            authoredContract: "rowset/1",
            pipeline: { steps: [{ op: "limit", count: 5 }] },
            provenance: { by: "user" },
        });
        base.results.widgets.push({
            id: "slow-tests-widget",
            source: { kind: "derived", sourceId: "slow-tests" },
            views: [{ id: "slow-tests-grid", kind: "grid", props: {} }],
            presentation: { mode: "single" },
            defaultViewId: "slow-tests-grid",
            sectionId: "main",
            placement: { order: 3 },
            visibility: { when: "always" },
            authoredContract: "rowset/1",
            authoredContractFingerprint: "rowset/1",
            provenance: { by: "user" },
        });
        const removed = applyPresentationLayoutEdits(base, [
            {
                nodeId: "slow-tests-widget",
                widgetId: "slow-tests-widget",
                source: { kind: "derived", sourceId: "slow-tests" },
                removeDerivedSourceId: "slow-tests",
                defaultView: "grid",
                sectionId: "main",
                placement: { order: 3 },
                hidden: true,
            },
        ]);
        expect(removed.derivedSources).to.deep.equal([]);
        expect(
            removed.results.widgets.some(
                (widget) =>
                    widget.source.kind === "derived" && widget.source.sourceId === "slow-tests",
            ),
        ).to.equal(false);
        expect(validatePresentationDefinition(removed)).to.deep.equal(removed);

        const withDependent = structuredClone(base);
        withDependent.derivedSources.push({
            id: "slowest-tests",
            from: { kind: "derived", sourceId: "slow-tests" },
            authoredContract: "rowset/1",
            pipeline: { steps: [{ op: "limit", count: 1 }] },
            provenance: { by: "user" },
        });
        const orphaned = applyPresentationLayoutEdits(withDependent, [
            {
                nodeId: "slow-tests-widget",
                source: { kind: "derived", sourceId: "slow-tests" },
                removeDerivedSourceId: "slow-tests",
                defaultView: "grid",
                sectionId: "main",
                placement: { order: 3 },
                hidden: true,
            },
        ]);
        expect(validatePresentationDefinition(orphaned)).to.equal(undefined);
    });

    test("derived-source rename atomically retargets its widget and dependent sources", () => {
        const base = definition();
        base.derivedSources.push(
            {
                id: "slow-tests",
                from: { kind: "activity-output", nodeId: "query", slot: "primary" },
                authoredContract: "rowset/1",
                pipeline: { steps: [{ op: "limit", count: 5 }] },
                provenance: { by: "user" },
            },
            {
                id: "slowest-tests",
                from: { kind: "derived", sourceId: "slow-tests" },
                authoredContract: "rowset/1",
                pipeline: { steps: [{ op: "limit", count: 1 }] },
                provenance: { by: "user" },
            },
        );
        base.results.widgets.push({
            id: "slow-tests-widget",
            source: { kind: "derived", sourceId: "slow-tests" },
            views: [{ id: "slow-tests-grid", kind: "grid", props: {} }],
            presentation: { mode: "single" },
            defaultViewId: "slow-tests-grid",
            sectionId: "main",
            placement: { order: 3 },
            visibility: { when: "always" },
            authoredContract: "rowset/1",
            authoredContractFingerprint: "rowset/1",
            provenance: { by: "user" },
        });
        const renamed = applyPresentationLayoutEdits(
            base,
            [
                {
                    nodeId: "slow-tests-widget",
                    widgetId: "slow-tests-widget",
                    source: { kind: "derived", sourceId: "long-tests" },
                    derivedSource: {
                        id: "long-tests",
                        from: { kind: "activity-output", nodeId: "query", slot: "primary" },
                        authoredContract: "rowset/1",
                        pipeline: { steps: [{ op: "limit", count: 5 }] },
                    },
                    renameDerivedSourceFrom: "slow-tests",
                    defaultView: "grid",
                    sectionId: "main",
                    placement: { order: 3 },
                    hidden: false,
                },
            ],
            {
                contractByNode: { "slow-tests-widget": "rowset/1" },
                sourceByNode: {
                    "slow-tests-widget": { kind: "derived", sourceId: "long-tests" },
                },
            },
        );
        expect(renamed.derivedSources.map((source) => source.id)).to.deep.equal([
            "long-tests",
            "slowest-tests",
        ]);
        expect(renamed.derivedSources[1].from).to.deep.equal({
            kind: "derived",
            sourceId: "long-tests",
        });
        expect(renamed.results.widgets.at(-1)?.source).to.deep.equal({
            kind: "derived",
            sourceId: "long-tests",
        });
        expect(validatePresentationDefinition(renamed)).to.deep.equal(renamed);
    });

    test("layout policy edits persist Flow, Stacked, and Grid semantics without widget edits", () => {
        const stacked = applyPresentationLayoutEdits(
            definition(),
            [],
            { planRevision: "10" },
            { strategy: "stacked" },
        );
        expect(stacked.revision).to.equal(4);
        expect(stacked.authoredForPlanRevision).to.equal("10");
        expect(stacked.results.layout).to.include({
            strategy: "stacked",
            sectionFlow: "document",
        });
        expect(stacked.results.widgets).to.deep.equal(definition().results.widgets);

        const grid = applyPresentationLayoutEdits(stacked, [], undefined, { strategy: "grid" });
        expect(grid.results.layout).to.include({ strategy: "grid", sectionFlow: "dashboard" });
        expect(validatePresentationDefinition(grid)).to.deep.equal(grid);

        const invalid = structuredClone(grid) as PresentationDefinition;
        invalid.results.layout.strategy = "tiles" as "grid";
        expect(validatePresentationDefinition(invalid)).to.equal(undefined);
    });
});
