/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    createQueryStudioPanelViewState,
    isQueryStudioPanelViewState,
    isVectorTabEligible,
    normalizeQueryStudioPanelViewState,
    orderedQueryStudioTabs,
    resetQueryStudioPanelViewState,
} from "../../src/sharedInterfaces/queryStudioViewState";

suite("Query Studio panel view state", () => {
    test("orders every contributed tab after Messages", () => {
        expect(
            orderedQueryStudioTabs({ results: true, vector: true, queryPlan: true }),
        ).to.deep.equal(["results", "messages", "vector", "queryPlan"]);
        expect(
            orderedQueryStudioTabs({ results: false, vector: true, queryPlan: false }),
        ).to.deep.equal(["messages", "vector"]);
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
        state.vector.workspace = "compare";
        state.vector.profileNorm = "linf";
        state.vector.workspaceScrollTop.compare = 88;
        state.vector.selectedColumn = { resultSetId: "b0r0s0", columnOrdinal: 4 };
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
        expect(reset.vector).to.deep.equal({
            workspace: "compare",
            profileNorm: "linf",
            workspaceScrollTop: {},
        });
    });
});
