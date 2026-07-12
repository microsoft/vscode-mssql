/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { normalizeQueryStudioPerfActivateTabArgs } from "../../src/queryStudio/queryStudioPerfAction";
import { resolveVectorPerfSearchTarget } from "../../src/webviews/pages/QueryStudio/vectorPerfAction";
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
