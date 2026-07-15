/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createQueryStudioPanelViewState,
    isQueryStudioPanelViewState,
    isSpatialTabEligible,
    isVectorTabEligible,
    normalizeQueryStudioPanelViewState,
    orderedQueryStudioTabs,
    resetQueryStudioPanelViewState,
    resolveQueryStudioVisibleTab,
    resolveQueryStudioTerminalAutoTab,
    shouldResetQueryStudioRunView,
} from "../../src/sharedInterfaces/queryStudioViewState";

suite("Query Studio panel view state", () => {
    test("Results is never stickily redirected to Messages when result metadata is empty", () => {
        const empty = { results: false, vector: false, spatial: false, queryPlan: false };
        // Results is a core, always-present tab and the user's home surface. It
        // stays selected through EVERY transient empty-metadata window — while
        // executing, between back-to-back runs, and when a fast query is first
        // observed already terminal. The terminal-state handler (app.tsx), not
        // this resolver, is what moves a completed no-data/errored run to
        // Messages. Redirecting here is sticky (the eligibility effect writes
        // the resolved tab back into activeTab), which stranded `SELECT 100`
        // and other fast, result-bearing queries on Messages.
        expect(resolveQueryStudioVisibleTab("results", empty)).to.equal("results");
        expect(resolveQueryStudioVisibleTab("results", { ...empty, results: true })).to.equal(
            "results",
        );
        expect(resolveQueryStudioVisibleTab("messages", empty)).to.equal("messages");
    });

    test("a contributed tab that lost eligibility falls back to Results, then Messages", () => {
        const base = { results: true, vector: false, spatial: false, queryPlan: false };
        // Vector/Spatial/QueryPlan are conditional: when a rerun no longer
        // produces that shape, drop to Results (or Messages if even Results is
        // empty). Unlike Results, these are not the user's home surface.
        expect(resolveQueryStudioVisibleTab("vector", base)).to.equal("results");
        expect(resolveQueryStudioVisibleTab("spatial", base)).to.equal("results");
        expect(resolveQueryStudioVisibleTab("queryPlan", base)).to.equal("results");
        expect(resolveQueryStudioVisibleTab("vector", { ...base, results: false })).to.equal(
            "messages",
        );
        // An eligible contributed tab is honored.
        expect(resolveQueryStudioVisibleTab("vector", { ...base, vector: true })).to.equal(
            "vector",
        );
    });

    test("a fast terminal-only state push still resets a genuinely new run", () => {
        const runId = 1_783_900_000_000;
        expect(shouldResetQueryStudioRunView(runId, undefined, "idle")).to.equal(true);
        expect(shouldResetQueryStudioRunView(runId, runId - 1, String(runId - 1))).to.equal(true);

        // Recreating the webview for the same completed generation retains
        // an explicit Messages selection instead of pretending it is new.
        expect(shouldResetQueryStudioRunView(runId, undefined, String(runId))).to.equal(false);
        expect(shouldResetQueryStudioRunView(runId, runId, "idle")).to.equal(false);
        expect(shouldResetQueryStudioRunView(undefined, undefined, "idle")).to.equal(false);
    });

    test("upgrades a provisional terminal Messages selection when result metadata arrives late", () => {
        const provisional = resolveQueryStudioTerminalAutoTab(0, false, true);
        expect(provisional).to.equal("messages");
        expect(resolveQueryStudioTerminalAutoTab(1, false, true, provisional)).to.equal("results");
        // A stale zero-summary update must not strand a result-bearing run on Messages again.
        expect(resolveQueryStudioTerminalAutoTab(0, false, true, "results")).to.equal("results");
        // Errors keep their deliberate Messages focus even if a batch also produced data.
        expect(resolveQueryStudioTerminalAutoTab(1, true, true, "results")).to.equal("messages");
        // A silent no-data terminal state keeps the pre-run Results selection.
        expect(resolveQueryStudioTerminalAutoTab(0, false, false)).to.equal(undefined);
    });

    test("orders every contributed tab after Messages", () => {
        expect(
            orderedQueryStudioTabs({
                results: true,
                vector: true,
                spatial: true,
                queryPlan: true,
            }),
        ).to.deep.equal(["results", "messages", "vector", "spatial", "queryPlan"]);
        expect(
            orderedQueryStudioTabs({ results: false, vector: true, queryPlan: false }),
        ).to.deep.equal(["messages", "vector"]);
    });

    test("requires both the Spatial feature gate and negotiated column metadata", () => {
        const columns = [{ spatial: { kind: "geometry" as const, encoding: "wkb-v1" as const } }];
        expect(isSpatialTabEligible(false, columns)).to.equal(false);
        expect(isSpatialTabEligible(true, [{}])).to.equal(false);
        expect(isSpatialTabEligible(true, columns)).to.equal(true);
    });

    test("requires both the Vector feature gate and typed transport", () => {
        expect(isVectorTabEligible(false, ["binary-v1"])).to.equal(false);
        expect(isVectorTabEligible(true, ["textFallback"])).to.equal(false);
        expect(isVectorTabEligible(true, ["textFallback", "binary-v1"])).to.equal(true);
    });

    test("round trips the versioned panel state shape", () => {
        const state = createQueryStudioPanelViewState("run-1");
        state.shell.activeTab = "messages";
        state.messages.scrollTop = 420;
        state.results.grids.r0 = {
            selection: [{ fromRow: 2, toRow: 3, fromCell: 1, toCell: 4 }],
            scrollPosition: { scrollTop: 8, scrollLeft: 17 },
            filters: {
                "1": {
                    columnDef: "1",
                    filterValues: [null as unknown as string],
                },
            },
        };
        state.results.textView = {
            selection: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 4,
                endColumn: 5,
            },
            scrollTop: 120,
            scrollLeft: 44,
        };
        state.vector.search = {
            source: "expression",
            selectedRowOrdinal: 17,
            expression: "normalize(A + B)",
            targetId: "vst_host_owned",
            modelText: "I want ice cream",
            modelId: "vsm_external_model",
            modelParameters: '{"dimensions": 64}',
            lastRunId: "vsr_last_completed",
            metric: "euclidean",
            k: 50,
            includeApprox: false,
            filters: [{ column: "tenant_id", op: "eq", value: "42" }],
            sqlOpen: true,
            sqlTab: "approx",
            sqlScrollPositions: {
                exact: { scrollTop: 12, scrollLeft: 3 },
                approx: { scrollTop: 86, scrollLeft: 41 },
            },
            selectedRankIndex: 2,
            rankScrollTop: 144,
        };
        state.vector.workspace = "search";
        state.vector.selectedColumn = { resultSetId: "b0r0s0", columnOrdinal: 3 };
        state.vector.profileFinding = "invalidRows";
        state.vector.profileDrawerScrollTop = 72;
        state.vector.workspaceScrollTop = {
            profile: 10,
            search: 20,
            compare: 30,
            projection: 40,
            index: 50,
            pipeline: 60,
        };
        state.vector.compare = {
            ordinalInput: "1, 4, 9",
            lastSubmittedOrdinals: [1, 4, 9],
            metric: "negativeDot",
        };
        state.vector.projection = {
            fitted: true,
            centerX: -1.25,
            centerY: 4.5,
            scale: 240,
            selectedOrdinal: 9,
            listScrollTop: 320,
        };
        state.vector.index.selectedScriptId = "create";
        state.vector.index.scriptScrollTop = 48;
        state.vector.pipeline = {
            modelName: "VectorLabEmbeddingModel",
            sourceColumnOrdinal: 2,
            rowOrdinal: 8,
            showSql: true,
            chunkSize: 1_200,
            overlapPct: 20,
            lastRunId: "vpr_abcdefghijklmnop",
        };
        state.spatial = {
            selectedColumn: { resultSetId: "b0r0s0", columnOrdinal: 4 },
            labelColumnOrdinal: 1,
            colorColumnOrdinal: 2,
            groupBy: "srid",
            renderer: "canvas",
            sidebarOpen: true,
            listOpen: false,
            detailsOpen: true,
            filters: { showNull: false, showEmpty: true, showUnsupported: false },
            selectedRowOrdinal: 17,
            camera: { centerX: -122.3, centerY: 47.6, zoom: 8, rotation: 0.25 },
            listScrollTop: 220,
            layerId: "worldOutline",
        };
        state.queryPlan.pageScrollTop = 84;
        state.queryPlan.graphs["0"] = {
            zoomPercent: 125,
            scrollTop: 90,
            scrollLeft: 12,
            selectedElementId: "RelOp-7",
            propertiesPaneOpen: true,
            propertiesPaneWidth: 420,
        };

        expect(isQueryStudioPanelViewState(JSON.parse(JSON.stringify(state)))).to.equal(true);
        expect(isQueryStudioPanelViewState({ ...state, version: 999 })).to.equal(false);
        expect(
            isQueryStudioPanelViewState({
                version: 1,
                generation: "run-1",
                shell: {},
                results: {},
                messages: {},
                vector: {},
                queryPlan: {},
            }),
        ).to.equal(false);

        const normalized = normalizeQueryStudioPanelViewState(state, "run-1");
        expect(normalized).to.deep.equal({
            ...state,
            vector: {
                ...state.vector,
                search: {
                    ...state.vector.search,
                    filters: [{ column: "tenant_id", op: "eq", value: "" }],
                },
            },
        });
        expect(normalized).not.to.equal(state);
        expect(state.vector.search.filters[0].value).to.equal("42");
        expect(normalizeQueryStudioPanelViewState(state, "run-2")).to.equal(undefined);
        const generated = JSON.parse(JSON.stringify(state));
        generated.vector.search.source = "generatedVector";
        delete generated.vector.search.expression;
        expect(normalizeQueryStudioPanelViewState(generated, "run-1")).not.to.equal(undefined);
        generated.vector.search.generatedVectorId = "vsg_abcdefghijklmnopqrstuvwx";
        expect(normalizeQueryStudioPanelViewState(generated, "run-1")).to.equal(undefined);
        expect(
            normalizeQueryStudioPanelViewState(
                {
                    ...state,
                    vector: {
                        ...state.vector,
                        search: { ...state.vector.search, pastedVector: "[1,2,3]" },
                    },
                },
                "run-1",
            ),
        ).to.equal(undefined);

        // SPA-10: layerId persists only as a bounded identifier — never a URL
        // or template. Anything URL-shaped or oversized invalidates the slice.
        for (const layerId of ["https://tiles.example/{z}/{x}/{y}.png", "a b", "0leading"]) {
            expect(
                normalizeQueryStudioPanelViewState(
                    { ...state, spatial: { ...state.spatial, layerId } },
                    "run-1",
                ),
                layerId,
            ).to.equal(undefined);
        }
        expect(
            normalizeQueryStudioPanelViewState(
                { ...state, spatial: { ...state.spatial, layerId: "contoso-road" } },
                "run-1",
            ),
        ).to.not.equal(undefined);
    });

    test("retains the unsent model draft within bounds (restore contract)", () => {
        const state = createQueryStudioPanelViewState("run-1");
        state.vector.search.modelText = "I want ice cream";
        state.vector.search.modelId = "vsm_external_model";
        state.vector.search.modelParameters = '{"dimensions": 64}';
        const normalized = normalizeQueryStudioPanelViewState(
            JSON.parse(JSON.stringify(state)),
            "run-1",
        );
        expect(normalized?.vector.search.modelText).to.equal("I want ice cream");
        expect(normalized?.vector.search.modelId).to.equal("vsm_external_model");
        expect(normalized?.vector.search.modelParameters).to.equal('{"dimensions": 64}');

        // Bounds: the draft cap matches the model-call cap (32,768 chars);
        // id and parameter text stay short.
        state.vector.search.modelText = "x".repeat(32_768);
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.not.equal(undefined);
        state.vector.search.modelText = "x".repeat(32_769);
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.equal(undefined);
        state.vector.search.modelText = "ok";
        state.vector.search.modelId = "m".repeat(257);
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.equal(undefined);
        state.vector.search.modelId = undefined;
        state.vector.search.modelParameters = "p".repeat(2_049);
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.equal(undefined);

        // New runs do NOT carry the draft — it is result-session context.
        state.vector.search.modelParameters = undefined;
        state.vector.search.modelText = "unsent draft";
        const next = resetQueryStudioPanelViewState(state, "run-2");
        expect(next.vector.search.modelText).to.equal(undefined);
    });

    test("projection scale accepts sub-1 fits and rejects non-positive values", () => {
        // Wide PCA spreads legitimately fit at scales « 1; rejecting them
        // here would silently drop the ENTIRE panel snapshot on round trip.
        const state = createQueryStudioPanelViewState("run-1");
        state.vector.projection = {
            fitted: true,
            centerX: 0,
            centerY: 0,
            scale: 0.005,
            listScrollTop: 0,
        };
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.not.equal(undefined);
        state.vector.projection.scale = 0;
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.equal(undefined);
        state.vector.projection.scale = -4;
        expect(normalizeQueryStudioPanelViewState(state, "run-1")).to.equal(undefined);
    });

    test("new runs clear result-derived state and retain panel preferences", () => {
        const state = createQueryStudioPanelViewState("run-1");
        state.shell.activeTab = "queryPlan";
        state.shell.resultsHeightPct = 62;
        state.shell.resultsPaneMaximized = true;
        state.shell.maximizedGridId = "b0r0s0";
        state.results.stackScrollTop = 200;
        state.results.grids.b0r0s0 = { frozenColumnIndex: 2 };
        state.messages = {
            scrollTop: 99,
            selection: {
                anchor: { messageIndex: 1, offset: 2 },
                focus: { messageIndex: 2, offset: 8 },
            },
        };
        state.vector.workspace = "compare";
        state.vector.profileNorm = "linf";
        state.vector.workspaceScrollTop.compare = 88;
        state.vector.selectedColumn = { resultSetId: "b0r0s0", columnOrdinal: 4 };
        state.vector.search.targetId = "vst_result_bound";
        state.vector.search.lastRunId = "vsr_result_bound";
        state.vector.search.selectedRankIndex = 6;
        state.vector.compare.lastSubmittedOrdinals = [1, 4, 9];
        state.vector.index.selectedScriptId = "createIndex";
        state.vector.pipeline.modelName = "VectorLabEmbeddingModel";
        state.spatial.selectedColumn = { resultSetId: "b0r0s0", columnOrdinal: 2 };
        state.spatial.selectedRowOrdinal = 9;
        state.spatial.camera = { centerX: 1, centerY: 2, zoom: 5, rotation: 0 };
        state.spatial.groupBy = "geometryType";
        state.spatial.renderer = "gpuPoints";
        state.spatial.listOpen = false;
        state.spatial.layerId = "worldOutline";
        state.queryPlan.graphs["0"] = {
            zoomPercent: 150,
            scrollTop: 10,
            scrollLeft: 20,
            propertiesPaneOpen: true,
            propertiesPaneWidth: 500,
        };

        const reset = resetQueryStudioPanelViewState(state, "run-2");
        expect(reset.generation).to.equal("run-2");
        expect(reset.shell).to.deep.equal({
            activeTab: "results",
            resultsHeightPct: 62,
            resultsCollapsed: false,
            resultsPaneMaximized: true,
        });
        expect(reset.results).to.deep.equal({ stackScrollTop: 0, grids: {} });
        expect(reset.messages).to.deep.equal({ scrollTop: 0 });
        expect(reset.queryPlan).to.deep.equal({ pageScrollTop: 0, graphs: {} });
        expect(reset.spatial).to.deep.equal({
            ...createQueryStudioPanelViewState("run-2").spatial,
            groupBy: "geometryType",
            renderer: "gpuPoints",
            listOpen: false,
            // Layer choice survives reruns (D-0031); eligibility/consent are
            // re-checked against the new result before anything renders.
            layerId: "worldOutline",
        });
        const expectedVector = createQueryStudioPanelViewState("run-2").vector;
        expectedVector.workspace = "compare";
        expectedVector.profileNorm = "linf";
        expect(reset.vector).to.deep.equal(expectedVector);
    });
});
