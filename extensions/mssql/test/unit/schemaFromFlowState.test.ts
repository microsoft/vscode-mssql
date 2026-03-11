/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { buildSchemaFromFlowState } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner schema from flow state", () => {
    function createColumn(id: string, name: string): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey: name === "Id",
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
            columns: [createColumn(`${id}-id`, "Id")],
            foreignKeys: [],
        };
    }

    test("builds schema and aggregates multi-edge foreign key mappings", () => {
        const sourceTable = createTable("t1", "Users");
        const targetTable = {
            ...createTable("t2", "Orders"),
            columns: [createColumn("t2-id", "Id"), createColumn("t2-alt", "AltId")],
        };

        const nodes: Node<SchemaDesigner.Table>[] = [
            {
                id: sourceTable.id,
                type: "tableNode",
                data: sourceTable,
                position: { x: 0, y: 0 },
            } as Node<SchemaDesigner.Table>,
            {
                id: targetTable.id,
                type: "tableNode",
                data: targetTable,
                position: { x: 100, y: 0 },
            } as Node<SchemaDesigner.Table>,
        ];

        const edges: Edge<SchemaDesigner.ForeignKey>[] = [
            {
                id: "e1",
                source: "t1",
                target: "t2",
                data: {
                    id: "fk1",
                    name: "FK_t1_t2",
                    columnsIds: ["t1-id"],
                    referencedTableId: "t2",
                    referencedColumnsIds: ["t2-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
            {
                id: "e2",
                source: "t1",
                target: "t2",
                data: {
                    id: "fk1",
                    name: "FK_t1_t2",
                    columnsIds: ["t1-alt"],
                    referencedTableId: "t2",
                    referencedColumnsIds: ["t2-alt"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
        ];

        const schema = buildSchemaFromFlowState(nodes, edges);
        const fk = schema.tables.find((table) => table.id === "t1")?.foreignKeys[0];

        expect(fk?.id).to.equal("fk1");
        expect(fk?.columnsIds).to.deep.equal(["t1-id", "t1-alt"]);
        expect(fk?.referencedColumnsIds).to.deep.equal(["t2-id", "t2-alt"]);
    });

    test("ignores deleted nodes and deleted edges", () => {
        const sourceTable = createTable("t1", "Users");
        const targetTable = createTable("t2", "Orders");

        const nodes: Node<SchemaDesigner.TableWithDeletedFlag>[] = [
            {
                id: sourceTable.id,
                type: "tableNode",
                data: sourceTable,
                position: { x: 0, y: 0 },
            } as Node<SchemaDesigner.TableWithDeletedFlag>,
            {
                id: targetTable.id,
                type: "tableNode",
                data: { ...targetTable, isDeleted: true },
                position: { x: 100, y: 0 },
            } as Node<SchemaDesigner.TableWithDeletedFlag>,
        ];

        const edges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[] = [
            {
                id: "e-deleted",
                source: "t1",
                target: "t2",
                data: {
                    id: "fk-deleted",
                    name: "FK_deleted",
                    columnsIds: ["t1-id"],
                    referencedTableId: "t2",
                    referencedColumnsIds: ["t2-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    isDeleted: true,
                },
            } as Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>,
        ];

        const schema = buildSchemaFromFlowState(nodes, edges);
        expect(schema.tables.map((table) => table.id)).to.deep.equal(["t1"]);
        expect(schema.tables[0].foreignKeys).to.deep.equal([]);
    });
});
