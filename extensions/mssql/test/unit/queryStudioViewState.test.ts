/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createQueryStudioPanelViewState,
    isQueryStudioPanelViewState,
    normalizeQueryStudioPanelViewState,
    orderedQueryStudioTabs,
    resetQueryStudioPanelViewState,
    resolveQueryStudioVisibleTab,
    resolveQueryStudioTerminalAutoTab,
    shouldResetQueryStudioRunView,
} from "../../src/sharedInterfaces/queryStudioViewState";

suite("Query Studio panel view state", () => {
    test("Results is never stickily redirected to Messages when result metadata is empty", () => {
        const empty = { results: false, queryPlan: false, spatial: false };
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
        const base = { results: true, queryPlan: false, spatial: false };
        // Vector/Spatial/QueryPlan are conditional: when a rerun no longer
        // produces that shape, drop to Results (or Messages if even Results is
        // empty). Unlike Results, these are not the user's home surface.
        expect(resolveQueryStudioVisibleTab("queryPlan", base)).to.equal("results");
        expect(resolveQueryStudioVisibleTab("queryPlan", { ...base, results: false })).to.equal(
            "messages",
        );
        // An eligible contributed tab is honored.
        expect(resolveQueryStudioVisibleTab("queryPlan", { ...base, queryPlan: true })).to.equal(
            "queryPlan",
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
                queryPlan: true,
            }),
        ).to.deep.equal(["results", "messages", "queryPlan"]);
        expect(orderedQueryStudioTabs({ results: false, queryPlan: true })).to.deep.equal([
            "messages",
            "queryPlan",
        ]);
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
                queryPlan: {},
            }),
        ).to.equal(false);

        const normalized = normalizeQueryStudioPanelViewState(state, "run-1");
        expect(normalized).to.deep.equal(state);
        expect(normalized).not.to.equal(state);
        expect(normalizeQueryStudioPanelViewState(state, "run-2")).to.equal(undefined);
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
    });
    test("spatial view state round-trips camera and source selection, then clears run data", () => {
        const state = createQueryStudioPanelViewState("run-1");
        state.shell.activeTab = "spatial";
        state.spatial.selectedColumn = { resultSetId: "rs", columnOrdinal: 2 };
        state.spatial.camera = { centerX: -122, centerY: 47, zoom: 5, rotation: 0 };
        state.spatial.selectedRowOrdinal = 3;
        state.spatial.layerId = "worldOutline";
        state.spatial.filters = {
            showNull: false,
            showEmpty: true,
            showUnsupported: false,
            geometryType: "Polygon",
            srid: 4326,
        };
        expect(
            normalizeQueryStudioPanelViewState(JSON.parse(JSON.stringify(state)), "run-1"),
        ).to.deep.equal(state);
        expect(
            resolveQueryStudioVisibleTab("spatial", {
                results: true,
                spatial: false,
                queryPlan: false,
            }),
        ).to.equal("results");
        const reset = resetQueryStudioPanelViewState(state, "run-2");
        expect(reset.spatial.selectedColumn).to.equal(undefined);
        expect(reset.spatial.selectedRowOrdinal).to.equal(undefined);
        expect(reset.spatial.camera).to.equal(undefined);
        expect(reset.spatial.filters).to.deep.equal({
            showNull: false,
            showEmpty: true,
            showUnsupported: false,
        });
        const malformed = {
            ...state,
            spatial: { ...state.spatial, camera: { ...state.spatial.camera, zoom: NaN } },
        };
        expect(isQueryStudioPanelViewState(malformed)).to.equal(false);
    });
});
