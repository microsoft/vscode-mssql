/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { applyAddTableMutation } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner add table mutation", () => {
    function createColumn(id: string, name: string): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey: id.endsWith("pk"),
            isIdentity: false,
            identitySeed: 0,
            identityIncrement: 0,
            isNullable: false,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
        };
    }

    function createTable(id: string, name: string): SchemaDesigner.Table {
        return {
            id,
            name,
            schema: "dbo",
            columns: [createColumn(`${id}-pk`, "Id")],
            foreignKeys: [],
        };
    }

    test("positions first visible table at default location", () => {
        const newTable = createTable("t-new", "NewTable");

        const result = applyAddTableMutation({
            existingNodes: [],
            existingEdges: [],
            table: newTable,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        const addedNode = result.nodes.find((node) => node.id === newTable.id);
        expect(addedNode?.position).to.deep.equal({ x: 100, y: 100 });
    });

    test("positions new table below bottom-most visible node", () => {
        const existingA = createTable("t-a", "A");
        const existingB = createTable("t-b", "B");
        existingB.columns = [
            createColumn("t-b-c1", "Id"),
            createColumn("t-b-c2", "Code"),
            createColumn("t-b-c3", "Name"),
        ];
        const newTable = createTable("t-new", "NewTable");

        const existingNodes: Node<SchemaDesigner.Table>[] = [
            {
                id: existingA.id,
                type: "tableNode",
                data: existingA,
                position: { x: 10, y: 10 },
            } as Node<SchemaDesigner.Table>,
            {
                id: existingB.id,
                type: "tableNode",
                data: existingB,
                position: { x: 50, y: 220 },
            } as Node<SchemaDesigner.Table>,
        ];

        const result = applyAddTableMutation({
            existingNodes,
            existingEdges: [],
            table: newTable,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        const addedNode = result.nodes.find((node) => node.id === newTable.id);
        // bottom-most is existingB => y:220 + height(3 cols => 160), then +50 spacing
        expect(addedNode?.position).to.deep.equal({ x: 50, y: 430 });
    });

    test("includes only edges connected to added table", () => {
        const sourceTable = createTable("t-source", "Source");
        const targetTable = createTable("t-target", "Target");
        const newTable: SchemaDesigner.Table = {
            ...createTable("t-new", "NewTable"),
            columns: [createColumn("t-new-pk", "Id"), createColumn("t-new-source-id", "SourceId")],
            foreignKeys: [
                {
                    id: "fk-new-source",
                    name: "FK_New_Source",
                    columnIds: ["t-new-source-id"],
                    referencedTableId: sourceTable.id,
                    referencedColumnIds: ["t-source-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const existingEdges: Edge<SchemaDesigner.ForeignKey>[] = [
            {
                id: "e-unrelated",
                source: sourceTable.id,
                target: targetTable.id,
                sourceHandle: "right-t-source-pk",
                targetHandle: "left-t-target-pk",
                data: {
                    id: "fk-existing",
                    name: "FK_Existing",
                    columnIds: ["t-source-pk"],
                    referencedTableId: targetTable.id,
                    referencedColumnIds: ["t-target-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
        ];

        const result = applyAddTableMutation({
            existingNodes: [
                {
                    id: sourceTable.id,
                    type: "tableNode",
                    data: sourceTable,
                    position: { x: 10, y: 20 },
                } as Node<SchemaDesigner.Table>,
            ],
            existingEdges,
            table: newTable,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.edges.map((edge) => edge.id)).to.deep.equal([
            "e-unrelated",
            "t-new-t-source-t-new-source-id-t-source-pk",
        ]);
    });
});
