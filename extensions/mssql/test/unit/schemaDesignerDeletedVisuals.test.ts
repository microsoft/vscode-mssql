/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MarkerType, type Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import {
    buildDeletedForeignKeyEdges,
    mergeColumnsWithDeleted,
} from "../../src/reactviews/pages/SchemaDesigner/diff/deletedVisualUtils";

function makeColumn(id: string, name: string): SchemaDesigner.Column {
    return {
        id,
        name,
        dataType: "int",
        maxLength: "",
        precision: 0,
        scale: 0,
        isPrimaryKey: false,
        isIdentity: false,
        identitySeed: 0,
        identityIncrement: 0,
        isNullable: true,
        defaultValue: "",
        isComputed: false,
        computedFormula: "",
        computedPersisted: false,
    };
}

function makeTable(
    id: string,
    name: string,
    columns: SchemaDesigner.Column[],
    foreignKeys: SchemaDesigner.ForeignKey[] = [],
): SchemaDesigner.Table {
    return {
        id,
        name,
        schema: "dbo",
        columns,
        foreignKeys,
    };
}

function makeForeignKey(
    id: string,
    name: string,
    columns: string[],
    referencedTableName: string,
    referencedColumns: string[],
): SchemaDesigner.ForeignKey {
    return {
        id,
        name,
        columns,
        referencedSchemaName: "dbo",
        referencedTableName,
        referencedColumns,
        onDeleteAction: 0,
        onUpdateAction: 0,
    };
}

suite("SchemaDesigner deleted visuals utils", () => {
    test("mergeColumnsWithDeleted preserves baseline ordering", () => {
        const colA = makeColumn("col-a", "a");
        const colB = makeColumn("col-b", "b");
        const colC = makeColumn("col-c", "c");

        const merged = mergeColumnsWithDeleted([colA, colC], [colB], [colA.id, colB.id, colC.id]);

        const ids = merged.map((c) => c.id);
        expect(ids).to.deep.equal([colA.id, colB.id, colC.id]);
        const deleted = merged[1] as { isDeleted?: boolean };
        expect(deleted.isDeleted).to.equal(true);
    });

    test("buildDeletedForeignKeyEdges uses baseline column ids when current column is missing", () => {
        const baselineSchema: SchemaDesigner.Schema = {
            tables: [
                makeTable(
                    "table-1",
                    "users",
                    [makeColumn("col-1", "user_id"), makeColumn("col-2", "email")],
                    [
                        makeForeignKey("fk-1", "FK_users_orders", ["user_id"], "orders", [
                            "order_id",
                        ]),
                    ],
                ),
                makeTable("table-2", "orders", [makeColumn("col-3", "order_id")]),
            ],
        };

        const currentNodes: Node<SchemaDesigner.Table>[] = [
            {
                id: "table-1",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: makeTable("table-1", "users", [makeColumn("col-2", "email")]),
            },
            {
                id: "table-2",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: makeTable("table-2", "orders", [makeColumn("col-3", "order_id")]),
            },
        ];

        const edges = buildDeletedForeignKeyEdges({
            baselineSchema,
            currentNodes,
            deletedForeignKeyIds: new Set(["fk-1"]),
        });

        expect(edges).to.have.length(1);
        expect(edges[0].source).to.equal("table-1");
        expect(edges[0].target).to.equal("table-2");
        expect(edges[0].sourceHandle).to.equal("right-col-1");
        expect(edges[0].targetHandle).to.equal("left-col-3");
        expect(edges[0].markerEnd).to.deep.equal({ type: MarkerType.ArrowClosed });
        expect((edges[0].data as { isDeleted?: boolean }).isDeleted).to.equal(true);
    });
});
