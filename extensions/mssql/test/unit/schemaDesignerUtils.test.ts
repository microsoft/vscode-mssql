/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { buildSchemaFromFlowState } from "../../src/reactviews/pages/SchemaDesigner/model";

type DeletedTable = SchemaDesigner.Table & { isDeleted: true };
type DeletedForeignKey = SchemaDesigner.ForeignKey & { isDeleted: true };

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
): SchemaDesigner.Table {
    return {
        id,
        name,
        schema: "dbo",
        columns,
        foreignKeys: [],
    };
}

function markDeletedTable(table: SchemaDesigner.Table): DeletedTable {
    return { ...table, isDeleted: true };
}

function markDeletedForeignKey(foreignKey: SchemaDesigner.ForeignKey): DeletedForeignKey {
    return { ...foreignKey, isDeleted: true };
}

suite("SchemaDesigner utils", () => {
    test("buildSchemaFromFlowState ignores deleted edges", () => {
        const nodes: Node<SchemaDesigner.Table>[] = [
            {
                id: "table-1",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: makeTable("table-1", "users", [makeColumn("col-1", "id")]),
            },
            {
                id: "table-2",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: makeTable("table-2", "orders", [makeColumn("col-2", "order_id")]),
            },
        ];

        const edges: Edge<SchemaDesigner.ForeignKey>[] = [
            {
                id: "edge-live",
                source: "table-1",
                target: "table-2",
                sourceHandle: "right-col-1",
                targetHandle: "left-col-2",
                markerEnd: { type: MarkerType.ArrowClosed },
                data: {
                    id: "fk-live",
                    name: "FK_live",
                    columnsIds: ["col-1"],
                    referencedTableId: "table-2",
                    referencedColumnsIds: ["col-2"],
                    onDeleteAction: 0,
                    onUpdateAction: 0,
                },
            },
            {
                id: "edge-deleted",
                source: "table-1",
                target: "table-2",
                sourceHandle: "right-col-1",
                targetHandle: "left-col-2",
                markerEnd: { type: MarkerType.ArrowClosed },
                data: markDeletedForeignKey({
                    id: "fk-deleted",
                    name: "FK_deleted",
                    columnsIds: ["col-1"],
                    referencedTableId: "table-2",
                    referencedColumnsIds: ["col-2"],
                    onDeleteAction: 0,
                    onUpdateAction: 0,
                }),
            },
        ];

        const schema = buildSchemaFromFlowState(nodes, edges);
        const table = schema.tables.find((t) => t.id === "table-1");

        expect(table).to.exist;
        expect(table?.foreignKeys.map((fk) => fk.id)).to.deep.equal(["fk-live"]);
    });

    test("buildSchemaFromFlowState ignores deleted nodes", () => {
        const nodes: Node<SchemaDesigner.Table>[] = [
            {
                id: "table-1",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: makeTable("table-1", "users", [makeColumn("col-1", "id")]),
            },
            {
                id: "table-2",
                type: "tableNode",
                position: { x: 0, y: 0 },
                data: markDeletedTable(
                    makeTable("table-2", "orders", [makeColumn("col-2", "order_id")]),
                ),
            },
        ];

        const schema = buildSchemaFromFlowState(nodes, []);
        expect(schema.tables.map((table) => table.id)).to.deep.equal(["table-1"]);
    });
});
