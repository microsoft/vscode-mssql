/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    applyColumnRenamesToIncomingForeignKeyEdges,
    applyColumnRenamesToOutgoingForeignKeyEdges,
    buildForeignKeyEdgeId,
    removeEdgesForForeignKey,
    type ForeignKeyEdgeLike,
} from "../../src/reactviews/pages/SchemaDesigner/schemaDesignerEdgeUtils";

suite("SchemaDesigner FK edge utils", () => {
    test("buildForeignKeyEdgeId is stable and per-column", () => {
        expect(buildForeignKeyEdgeId("t1", "t2", "col1", "col2")).to.equal("t1-t2-col1-col2");
        expect(buildForeignKeyEdgeId("t1", "t2", "col1", "col3")).to.equal("t1-t2-col1-col3");
    });

    test("removeEdgesForForeignKey filters by edge.data.id (not edge.id)", () => {
        const edges: ForeignKeyEdgeLike[] = [
            { id: "edge-1", data: { id: "fk-1" } },
            { id: "fk-2", data: { id: "fk-2" } },
            { id: "edge-3", data: { id: "fk-2" } },
            { id: "edge-4", data: undefined },
        ];

        const remaining = removeEdgesForForeignKey(edges, "fk-2");
        expect(remaining.map((e) => e.id)).to.deep.equal(["edge-1", "edge-4"]);
    });

    test("applyColumnRenamesToIncomingForeignKeyEdges updates incoming referencedColumns (does not touch handles)", () => {
        type TestEdge = ForeignKeyEdgeLike & {
            source: string;
            target: string;
            sourceHandle: string;
            targetHandle: string;
            data: ForeignKeyEdgeLike["data"] & {
                columns: string[];
                referencedColumns: string[];
            };
        };

        const edges: TestEdge[] = [
            {
                id: buildForeignKeyEdgeId("t1", "t2", "srcColId", "refColId"),
                source: "t1",
                target: "t2",
                sourceHandle: "right-srcColId",
                targetHandle: "left-refColId",
                data: {
                    id: "fk1",
                    columns: ["c1"],
                    referencedColumns: ["refOld"],
                },
            },
            // Not incoming to t2; should remain unchanged
            {
                id: buildForeignKeyEdgeId("t1", "t3", "srcColId", "refColId"),
                source: "t1",
                target: "t3",
                sourceHandle: "right-srcColId",
                targetHandle: "left-refColId",
                data: {
                    id: "fk2",
                    columns: ["c1"],
                    referencedColumns: ["refOld"],
                },
            },
        ];

        const renamedColumns = new Map<string, string>([["refOld", "refNew"]]);
        applyColumnRenamesToIncomingForeignKeyEdges(edges, "t2", renamedColumns);

        expect(edges[0].targetHandle).to.equal("left-refColId");
        expect(edges[0].data.referencedColumns).to.deep.equal(["refNew"]);
        expect(edges[0].id).to.equal(buildForeignKeyEdgeId("t1", "t2", "srcColId", "refColId"));

        expect(edges[1].targetHandle).to.equal("left-refColId");
        expect(edges[1].data.referencedColumns).to.deep.equal(["refOld"]);
        expect(edges[1].id).to.equal(buildForeignKeyEdgeId("t1", "t3", "srcColId", "refColId"));
    });

    test("applyColumnRenamesToOutgoingForeignKeyEdges updates outgoing columns (does not touch handles)", () => {
        type TestEdge = ForeignKeyEdgeLike & {
            source: string;
            target: string;
            sourceHandle: string;
            targetHandle: string;
            data: ForeignKeyEdgeLike["data"] & {
                columns: string[];
                referencedColumns: string[];
            };
        };

        const edges: TestEdge[] = [
            {
                id: buildForeignKeyEdgeId("t1", "t2", "oldColId", "refColId"),
                source: "t1",
                target: "t2",
                sourceHandle: "right-oldColId",
                targetHandle: "left-refColId",
                data: {
                    id: "fk1",
                    columns: ["oldCol"],
                    referencedColumns: ["ref"],
                },
            },
            // Not outgoing from t1; should remain unchanged
            {
                id: buildForeignKeyEdgeId("tX", "t2", "oldColId", "refColId"),
                source: "tX",
                target: "t2",
                sourceHandle: "right-oldColId",
                targetHandle: "left-refColId",
                data: {
                    id: "fk2",
                    columns: ["oldCol"],
                    referencedColumns: ["ref"],
                },
            },
        ];

        const renamedColumns = new Map<string, string>([["oldCol", "newCol"]]);
        applyColumnRenamesToOutgoingForeignKeyEdges(edges, "t1", renamedColumns);

        expect(edges[0].sourceHandle).to.equal("right-oldColId");
        expect(edges[0].data.columns).to.deep.equal(["newCol"]);
        expect(edges[0].id).to.equal(buildForeignKeyEdgeId("t1", "t2", "oldColId", "refColId"));

        expect(edges[1].sourceHandle).to.equal("right-oldColId");
        expect(edges[1].data.columns).to.deep.equal(["oldCol"]);
        expect(edges[1].id).to.equal(buildForeignKeyEdgeId("tX", "t2", "oldColId", "refColId"));
    });
});
