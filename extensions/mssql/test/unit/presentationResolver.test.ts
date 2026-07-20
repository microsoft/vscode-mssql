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
    compatibleViews,
    createViewSpec,
    DEFAULT_PRESENTATION_LAYOUT,
    migrateLegacyPresentationDefinition,
    outputPresentationsOf,
    pinnedViewsOf,
    resetOutputPresentation,
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
    viewCandidateTier,
} from "../../src/sharedInterfaces/runbookPresentation";
import { RunbookRunSnapshot } from "../../src/sharedInterfaces/runbookStudio";

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

suite("presentationResolver", () => {
    test("rowset candidates expose both shipped chart renderers", () => {
        expect(compatibleViews("rowset/1")).to.deep.equal(["grid", "bar", "timeseries", "json"]);
        expect(viewCandidateTier("rowset/1", "grid")).to.equal("recommended");
        expect(viewCandidateTier("rowset/1", "bar")).to.equal("available");
        expect(viewCandidateTier("rowset/1", "json")).to.equal("fallback");
        expect(viewCandidateTier("unknown/1", "json")).to.equal("recommended");
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
            { contractByNode: { query: "rowset/1" }, planRevision: "9" },
        );
        expect(outputPresentationsOf(laidOut).query).to.deep.include({
            widgetId: "layout-query",
            sectionId: "summary",
            placement: { order: 2, span: { compact: 1, medium: 3, wide: 6 } },
            hidden: false,
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
});
