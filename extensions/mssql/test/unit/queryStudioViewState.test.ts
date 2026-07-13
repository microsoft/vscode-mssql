/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createQueryStudioPanelViewState,
    isQueryStudioPanelViewState,
    isQueryStudioRunStartPending,
    isSpatialTabEligible,
    isVectorTabEligible,
    normalizeQueryStudioPanelViewState,
    orderedQueryStudioTabs,
    resetQueryStudioPanelViewState,
    resolveQueryStudioVisibleTab,
    shouldResetQueryStudioRunView,
} from "../../src/sharedInterfaces/queryStudioViewState";

suite("Query Studio panel view state", () => {
    test("a running query keeps Results selected while result metadata is transiently empty", () => {
        const empty = { results: false, vector: false, spatial: false, queryPlan: false };
        expect(resolveQueryStudioVisibleTab("results", empty, true)).to.equal("results");
        expect(
            resolveQueryStudioVisibleTab("results", { ...empty, results: true }, false),
        ).to.equal("results");
        expect(resolveQueryStudioVisibleTab("results", empty, false)).to.equal("messages");
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

    test("run-start notification protects Results until coarse state catches up", () => {
        expect(isQueryStudioRunStartPending(42, undefined)).to.equal(true);
        expect(isQueryStudioRunStartPending(42, 41)).to.equal(true);
        expect(isQueryStudioRunStartPending(42, 42)).to.equal(false);
        expect(isQueryStudioRunStartPending(undefined, 42)).to.equal(false);

        const empty = { results: false, vector: false, spatial: false, queryPlan: false };
        expect(
            resolveQueryStudioVisibleTab("results", empty, isQueryStudioRunStartPending(42, 41)),
        ).to.equal("results");
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
        });
        const expectedVector = createQueryStudioPanelViewState("run-2").vector;
        expectedVector.workspace = "compare";
        expectedVector.profileNorm = "linf";
        expect(reset.vector).to.deep.equal(expectedVector);
    });
});
