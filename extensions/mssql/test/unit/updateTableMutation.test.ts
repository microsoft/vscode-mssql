/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { applyUpdateTableMutation } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner update table mutation", () => {
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

    function createNode(table: SchemaDesigner.Table): Node<SchemaDesigner.Table> {
        return {
            id: table.id,
            type: "tableNode",
            data: table,
            position: { x: 0, y: 0 },
        } as Node<SchemaDesigner.Table>;
    }

    test("returns failure when target table node does not exist", () => {
        const updated = createTable("missing", "Missing");

        const result = applyUpdateTableMutation({
            existingNodes: [],
            existingEdges: [],
            updatedTable: updated,
        });

        expect(result.success).to.equal(false);
    });

    test("updates node data, removes old outgoing edges, and adds edges for updated foreign keys", () => {
        const source = createTable("t-source", "Source");
        const target = createTable("t-target", "Target");

        const updatedSource: SchemaDesigner.Table = {
            ...source,
            columns: [
                createColumn("t-source-pk", "Id"),
                createColumn("t-source-target-id", "TargetId"),
            ],
            foreignKeys: [
                {
                    id: "fk-source-target",
                    name: "FK_Source_Target",
                    columnsIds: ["t-source-target-id"],
                    referencedTableId: target.id,
                    referencedColumnsIds: ["t-target-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const existingEdges: Edge<SchemaDesigner.ForeignKey>[] = [
            {
                id: "old-source-edge",
                source: source.id,
                target: target.id,
                sourceHandle: "right-t-source-pk",
                targetHandle: "left-t-target-pk",
                data: {
                    id: "fk-old-source",
                    name: "FK_Old_Source",
                    columnsIds: ["t-source-pk"],
                    referencedTableId: target.id,
                    referencedColumnsIds: ["t-target-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
            {
                id: "incoming-to-source",
                source: target.id,
                target: source.id,
                sourceHandle: "right-t-target-pk",
                targetHandle: "left-t-source-pk",
                data: {
                    id: "fk-incoming",
                    name: "FK_Incoming",
                    columnsIds: ["t-target-pk"],
                    referencedTableId: source.id,
                    referencedColumnsIds: ["t-source-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as Edge<SchemaDesigner.ForeignKey>,
        ];

        const result = applyUpdateTableMutation({
            existingNodes: [createNode(source), createNode(target)],
            existingEdges,
            updatedTable: updatedSource,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        const updatedNode = result.nodes.find((node) => node.id === source.id);
        expect(updatedNode?.data).to.equal(updatedSource);

        expect(result.edges.map((edge) => edge.id)).to.deep.equal([
            "incoming-to-source",
            "t-source-t-target-t-source-target-id-t-target-pk",
        ]);
    });

    test("keeps incoming edges when only column names change but ids stay stable", () => {
        const source = createTable("t-source", "Source");
        const target: SchemaDesigner.Table = {
            ...createTable("t-target", "Target"),
            columns: [createColumn("t-target-pk", "Id")],
        };

        const updatedTarget: SchemaDesigner.Table = {
            ...target,
            columns: [createColumn("t-target-pk", "TargetId")],
        };

        const incomingEdge: Edge<SchemaDesigner.ForeignKey> = {
            id: "incoming-to-target",
            source: source.id,
            target: target.id,
            sourceHandle: "right-t-source-pk",
            targetHandle: "left-t-target-pk",
            data: {
                id: "fk-source-target",
                name: "FK_Source_Target",
                columnsIds: ["t-source-pk"],
                referencedTableId: target.id,
                referencedColumnsIds: ["t-target-pk"],
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            },
        } as Edge<SchemaDesigner.ForeignKey>;

        const result = applyUpdateTableMutation({
            existingNodes: [createNode(source), createNode(target)],
            existingEdges: [incomingEdge],
            updatedTable: updatedTarget,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.edges.map((edge) => edge.id)).to.deep.equal(["incoming-to-target"]);
    });

    test("removes incoming edges that reference deleted columns by id", () => {
        const source = createTable("t-source", "Source");
        const target: SchemaDesigner.Table = {
            ...createTable("t-target", "Target"),
            columns: [createColumn("t-target-pk", "Id"), createColumn("t-target-legacy", "Legacy")],
        };

        const updatedTarget: SchemaDesigner.Table = {
            ...target,
            columns: [createColumn("t-target-pk", "Id")],
        };

        const incomingToDeletedColumn: Edge<SchemaDesigner.ForeignKey> = {
            id: "incoming-to-deleted",
            source: source.id,
            target: target.id,
            sourceHandle: "right-t-source-pk",
            targetHandle: "left-t-target-legacy",
            data: {
                id: "fk-source-target-legacy",
                name: "FK_Source_Target_Legacy",
                columnsIds: ["t-source-pk"],
                referencedTableId: target.id,
                referencedColumnsIds: ["t-target-legacy"],
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            },
        } as Edge<SchemaDesigner.ForeignKey>;

        const result = applyUpdateTableMutation({
            existingNodes: [createNode(source), createNode(target)],
            existingEdges: [incomingToDeletedColumn],
            updatedTable: updatedTarget,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.edges).to.have.length(0);
    });

    test("does not add edge entries for foreign key references to missing tables", () => {
        const source = createTable("t-source", "Source");
        const updatedSource: SchemaDesigner.Table = {
            ...source,
            columns: [createColumn("t-source-pk", "Id"), createColumn("t-source-x-id", "XId")],
            foreignKeys: [
                {
                    id: "fk-source-missing",
                    name: "FK_Source_Missing",
                    columnsIds: ["t-source-x-id"],
                    referencedTableId: "t-missing",
                    referencedColumnsIds: ["t-missing-pk"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const result = applyUpdateTableMutation({
            existingNodes: [createNode(source)],
            existingEdges: [],
            updatedTable: updatedSource,
        });

        expect(result.success).to.equal(true);
        if (!result.success) {
            return;
        }

        expect(result.edges).to.have.length(0);
    });
});
