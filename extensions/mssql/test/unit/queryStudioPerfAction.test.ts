/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    normalizeQueryStudioPerfActivateTabArgs,
    normalizeQueryStudioPerfInteractionArgs,
} from "../../src/queryStudio/queryStudioPerfAction";
import { resolveVectorPerfSearchTarget } from "../../src/webviews/pages/QueryStudio/vectorPerfAction";
import {
    performRegisteredQueryStudioPerfGridScroll,
    performRegisteredQueryStudioPerfGridCopy,
    performRegisteredQueryStudioPerfGridSelection,
    performRegisteredQueryStudioPerfMessagesCopy,
    registerQueryStudioPerfMessagesController,
    queryStudioPerfScrollOffset,
    queryStudioPerfSweepOffsets,
    registerQueryStudioPerfGridController,
} from "../../src/webviews/pages/QueryStudio/queryStudioPerfInteraction";
import type { QsVectorPerfSearchAction } from "../../src/sharedInterfaces/queryStudio";
import type { VectorSearchTargetInfo } from "../../src/sharedInterfaces/vectorSearch";

const SEARCH_ACTION: QsVectorPerfSearchAction = {
    source: { kind: "selectedRow", ordinal: 1000 },
    target: {
        schema: "dbo",
        table: "VectorLabSearchCorpus",
        vectorColumn: "embedding",
    },
    metric: "cosine",
    k: 20,
    includeApprox: false,
};

function target(overrides?: Partial<VectorSearchTargetInfo>): VectorSearchTargetInfo {
    return {
        id: "host-binding-1",
        schema: "dbo",
        table: "VectorLabSearchCorpus",
        vectorColumn: "embedding",
        dimensions: 64,
        keyColumn: "chunk_id",
        keyIsUnique: true,
        filterColumns: [],
        ...overrides,
    };
}

suite("Query Studio PERF_MODE Vector actions", () => {
    test("generic pane activation admits Spatial without accepting a payload", () => {
        expect(normalizeQueryStudioPerfActivateTabArgs({ tab: "spatial" })).to.deep.equal({
            value: { activation: { tab: "spatial" } },
        });
        expect(
            normalizeQueryStudioPerfActivateTabArgs({
                tab: "spatial",
                vector: { workspace: "projection" },
            }),
        ).to.have.property("error");
    });

    test("normalizes the supported Projection and Search command shapes", () => {
        expect(normalizeQueryStudioPerfActivateTabArgs(undefined)).to.deep.equal({
            value: { activation: { tab: "vector" } },
        });
        expect(
            normalizeQueryStudioPerfActivateTabArgs({
                uri: "file:///vectorlab.sql",
                tab: "vector",
                vector: { workspace: "projection" },
            }),
        ).to.deep.equal({
            value: {
                uri: "file:///vectorlab.sql",
                activation: { tab: "vector", vector: { workspace: "projection" } },
            },
        });

        const normalized = normalizeQueryStudioPerfActivateTabArgs({
            tab: "vector",
            vector: {
                workspace: "search",
                search: {
                    ...SEARCH_ACTION,
                    sql: "SELECT secret",
                    text: "arbitrary model input",
                    source: { ...SEARCH_ACTION.source, json: "[1,2,3]" },
                },
            },
            text: "must not cross the seam",
        });
        expect(normalized).to.deep.equal({
            value: {
                activation: {
                    tab: "vector",
                    vector: { workspace: "search", search: SEARCH_ACTION },
                },
            },
        });
        expect(JSON.stringify(normalized)).not.to.contain("SELECT secret");
        expect(JSON.stringify(normalized)).not.to.contain("arbitrary model input");
    });

    test("rejects pasted/text sources, unsafe selectors, and out-of-budget K", () => {
        for (const search of [
            { ...SEARCH_ACTION, source: { kind: "pastedVector", json: "[1]" } },
            {
                ...SEARCH_ACTION,
                target: { ...SEARCH_ACTION.target, table: "dbo.T; DROP TABLE T" },
            },
            { ...SEARCH_ACTION, k: 1001 },
            { ...SEARCH_ACTION, source: { kind: "selectedRow", ordinal: -1 } },
        ]) {
            const result = normalizeQueryStudioPerfActivateTabArgs({
                tab: "vector",
                vector: { workspace: "search", search },
            });
            expect(result).to.have.property("error");
        }
    });

    test("resolves the selector only to one host-discovered binding", () => {
        const resolved = resolveVectorPerfSearchTarget(SEARCH_ACTION, [
            target({ schema: "DBO", table: "vectorlabsearchcorpus", vectorColumn: "EMBEDDING" }),
        ]);
        expect(resolved).to.deep.equal({
            target: target({
                schema: "DBO",
                table: "vectorlabsearchcorpus",
                vectorColumn: "EMBEDDING",
            }),
            targetIndex: 0,
        });

        expect(resolveVectorPerfSearchTarget(SEARCH_ACTION, [])).to.have.property("error");
        expect(
            resolveVectorPerfSearchTarget(SEARCH_ACTION, [target(), target({ id: "binding-2" })]),
        ).to.have.property("error");
        expect(
            resolveVectorPerfSearchTarget(SEARCH_ACTION, [
                target({ keyColumn: undefined, keyIsUnique: false }),
            ]),
        ).to.have.property("error");
    });
});

suite("Query Studio PERF_MODE result interactions", () => {
    test("maps semantic targets to bounded scroll offsets", () => {
        expect(queryStudioPerfScrollOffset(10_000, 1_000, "start")).to.equal(0);
        expect(queryStudioPerfScrollOffset(10_000, 1_000, "middle")).to.equal(4_500);
        expect(queryStudioPerfScrollOffset(10_000, 1_000, "end")).to.equal(9_000);
        expect(queryStudioPerfScrollOffset(500, 1_000, "end")).to.equal(0);
        expect(queryStudioPerfSweepOffsets(10_000, 1_000, 4)).to.deep.equal([
            2_250, 4_500, 6_750, 9_000,
        ]);
        expect(queryStudioPerfSweepOffsets(500, 1_000, 4)).to.deep.equal([0, 0, 0, 0]);
    });

    test("routes grid scrolls through the current product controller", () => {
        const calls: string[] = [];
        const disposeOld = registerQueryStudioPerfGridController("b0r0s0", {
            scroll: (axis, target) => {
                calls.push(`old:${axis}:${target}`);
                return "applied";
            },
        });
        const disposeCurrent = registerQueryStudioPerfGridController("b0r0s0", {
            scroll: (axis, target) => {
                calls.push(`current:${axis}:${target}`);
                return "applied";
            },
        });

        disposeOld();
        expect(performRegisteredQueryStudioPerfGridScroll("b0r0s0", "vertical", "middle")).to.equal(
            "applied",
        );
        expect(calls).to.deep.equal(["current:vertical:middle"]);

        disposeCurrent();
        expect(performRegisteredQueryStudioPerfGridScroll("b0r0s0", "horizontal", "end")).to.equal(
            "viewportUnavailable",
        );
    });

    test("waits for the product selection summary before settling select-all", async () => {
        let settle!: () => void;
        const selectionSettled = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const dispose = registerQueryStudioPerfGridController("selection-grid", {
            scroll: () => "applied",
            selectAll: async () => {
                await selectionSettled;
                return "applied";
            },
        });

        let completed = false;
        const pending = performRegisteredQueryStudioPerfGridSelection("selection-grid").then(
            (outcome) => {
                completed = true;
                return outcome;
            },
        );
        await Promise.resolve();
        expect(completed).to.equal(false);
        settle();
        expect(await pending).to.equal("applied");

        dispose();
        expect(await performRegisteredQueryStudioPerfGridSelection("selection-grid")).to.equal(
            "selectionUnavailable",
        );
    });

    test("routes copy-all through the current product copy implementation", async () => {
        const headers: boolean[] = [];
        const dispose = registerQueryStudioPerfGridController("copy-grid", {
            scroll: () => "applied",
            copyAll: async (includeHeaders) => {
                headers.push(includeHeaders);
                return "applied";
            },
        });

        expect(await performRegisteredQueryStudioPerfGridCopy("copy-grid", true)).to.equal(
            "applied",
        );
        expect(headers).to.deep.equal([true]);
        dispose();
        expect(await performRegisteredQueryStudioPerfGridCopy("copy-grid", false)).to.equal(
            "selectionUnavailable",
        );
    });

    test("normalizes relative scroll actions and drops unknown payload", () => {
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                uri: "file:///results.sql",
                action: {
                    kind: "scrollGrid",
                    resultSetIndex: 2,
                    axis: "vertical",
                    target: "end",
                    selector: "#arbitrary",
                    sql: "SELECT secret",
                },
            }),
        ).to.deep.equal({
            value: {
                uri: "file:///results.sql",
                action: {
                    kind: "scrollGrid",
                    resultSetIndex: 2,
                    axis: "vertical",
                    target: "end",
                },
            },
        });
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                action: { kind: "copyMessages", extra: true },
            }),
        ).to.deep.equal({
            value: { action: { kind: "copyMessages" } },
        });
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                action: { kind: "scrollResultStack", target: "middle", pixels: 42 },
            }),
        ).to.deep.equal({
            value: { action: { kind: "scrollResultStack", target: "middle" } },
        });
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                action: { kind: "sweepResultStack", steps: 32, selector: "#arbitrary" },
            }),
        ).to.deep.equal({
            value: { action: { kind: "sweepResultStack", steps: 32 } },
        });
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                action: {
                    kind: "selectGrid",
                    resultSetIndex: 3,
                    selection: "all",
                    selector: "#arbitrary",
                },
            }),
        ).to.deep.equal({
            value: {
                action: { kind: "selectGrid", resultSetIndex: 3, selection: "all" },
            },
        });
        expect(
            normalizeQueryStudioPerfInteractionArgs({
                action: {
                    kind: "copyGrid",
                    resultSetIndex: 4,
                    selection: "all",
                    includeHeaders: true,
                    selector: "#arbitrary",
                },
            }),
        ).to.deep.equal({
            value: {
                action: {
                    kind: "copyGrid",
                    resultSetIndex: 4,
                    selection: "all",
                    includeHeaders: true,
                },
            },
        });
    });

    test("rejects arbitrary selectors, coordinates, and unsupported targets", () => {
        for (const action of [
            { kind: "scrollGrid", resultSetIndex: -1, axis: "vertical", target: "end" },
            { kind: "scrollGrid", resultSetIndex: 0, axis: "diagonal", target: "end" },
            { kind: "scrollGrid", resultSetIndex: 0, axis: "vertical", target: "42px" },
            { kind: "selectGrid", resultSetIndex: 0, selection: "rectangle" },
            { kind: "copyGrid", resultSetIndex: 0, selection: "all" },
            { kind: "sweepResultStack", steps: 1 },
            { kind: "sweepResultStack", steps: 65 },
            { kind: "click", selector: "#anything", target: "end" },
        ]) {
            expect(normalizeQueryStudioPerfInteractionArgs({ action })).to.have.property("error");
        }
    });

    test("routes a closed Messages Copy All action through its mounted controller", async () => {
        const dispose = registerQueryStudioPerfMessagesController({
            copyAll: async () => "applied",
        });
        expect(await performRegisteredQueryStudioPerfMessagesCopy()).to.equal("applied");
        dispose();
        expect(await performRegisteredQueryStudioPerfMessagesCopy()).to.equal(
            "messagesUnavailable",
        );
    });
});
