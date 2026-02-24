/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Edge, Node } from "@xyflow/react";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { foreignKeyUtils } from "../../src/reactviews/pages/SchemaDesigner/model";

suite("SchemaDesigner foreign key utils", () => {
    function createColumn(id: string, name: string, isPrimaryKey = false): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey,
            isIdentity: false,
            identitySeed: 0,
            identityIncrement: 0,
            isNullable: !isPrimaryKey,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
        };
    }

    function createTable(
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

    function createNode(table: SchemaDesigner.Table): Node<SchemaDesigner.Table> {
        return {
            id: table.id,
            type: "tableNode",
            data: table,
            position: { x: 0, y: 0 },
        } as Node<SchemaDesigner.Table>;
    }

    test("isForeignKeyValid returns true for valid id-based mapping", () => {
        const sourceTable = createTable("t-source", "Source", [
            createColumn("c-source-id", "SourceId", true),
            createColumn("c-source-target", "TargetId"),
        ]);
        const targetTable = createTable("t-target", "Target", [
            createColumn("c-target-id", "TargetId", true),
        ]);

        const foreignKey: SchemaDesigner.ForeignKey = {
            id: "fk-source-target",
            name: "FK_Source_Target",
            columnIds: ["c-source-target"],
            referencedTableId: "t-target",
            referencedColumnIds: ["c-target-id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const result = foreignKeyUtils.isForeignKeyValid(
            [sourceTable, targetTable],
            sourceTable,
            foreignKey,
        );
        expect(result.isValid).to.equal(true);
    });

    test("isForeignKeyValid rejects duplicate source column usage", () => {
        const sourceTable = createTable(
            "t-source",
            "Source",
            [createColumn("c-source-id", "SourceId", true), createColumn("c-shared", "SharedId")],
            [
                {
                    id: "fk-existing",
                    name: "FK_Existing",
                    columnIds: ["c-shared"],
                    referencedTableId: "t-target",
                    referencedColumnIds: ["c-target-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        );
        const targetTable = createTable("t-target", "Target", [
            createColumn("c-target-id", "TargetId", true),
        ]);

        const foreignKey: SchemaDesigner.ForeignKey = {
            id: "fk-new",
            name: "FK_New",
            columnIds: ["c-shared"],
            referencedTableId: "t-target",
            referencedColumnIds: ["c-target-id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const result = foreignKeyUtils.isForeignKeyValid(
            [sourceTable, targetTable],
            sourceTable,
            foreignKey,
        );
        expect(result.isValid).to.equal(false);
    });

    test("isCyclicForeignKey detects cycle and allows direct self-reference", () => {
        const tableA: SchemaDesigner.Table = {
            id: "a",
            name: "A",
            schema: "dbo",
            columns: [createColumn("a-id", "Id", true)],
            foreignKeys: [
                {
                    id: "fk-a-b",
                    name: "FK_A_B",
                    columnIds: ["a-id"],
                    referencedTableId: "b",
                    referencedColumnIds: ["b-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };
        const tableB: SchemaDesigner.Table = {
            id: "b",
            name: "B",
            schema: "dbo",
            columns: [createColumn("b-id", "Id", true)],
            foreignKeys: [
                {
                    id: "fk-b-a",
                    name: "FK_B_A",
                    columnIds: ["b-id"],
                    referencedTableId: "a",
                    referencedColumnIds: ["a-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        const cyclic = foreignKeyUtils.isCyclicForeignKey([tableA, tableB], tableA, tableB);
        expect(cyclic).to.equal(true);

        const selfReferenceAllowed = foreignKeyUtils.isCyclicForeignKey([tableA], tableA, tableA);
        expect(selfReferenceAllowed).to.equal(false);
    });

    test("extractColumnIdFromHandle parses left/right handles", () => {
        expect(foreignKeyUtils.extractColumnIdFromHandle("left-col-1")).to.equal("col-1");
        expect(foreignKeyUtils.extractColumnIdFromHandle("right-col-2")).to.equal("col-2");
    });

    test("createForeignKeyFromConnection builds id-based payload", () => {
        const sourceNode = createNode(
            createTable("t-source", "Source", [createColumn("c-source-id", "SourceId", true)]),
        );
        const targetNode = createNode(
            createTable("t-target", "Target", [createColumn("c-target-id", "TargetId", true)]),
        );

        const foreignKey = foreignKeyUtils.createForeignKeyFromConnection(
            sourceNode,
            targetNode,
            "c-source-id",
            "c-target-id",
            "fk-id",
            "FK_Name",
        );

        expect(foreignKey.id).to.equal("fk-id");
        expect(foreignKey.name).to.equal("FK_Name");
        expect(foreignKey.columnIds).to.deep.equal(["c-source-id"]);
        expect(foreignKey.referencedTableId).to.equal("t-target");
        expect(foreignKey.referencedColumnIds).to.deep.equal(["c-target-id"]);
    });

    test("validateConnection returns invalid when source/target columns are missing", () => {
        const sourceTable = createTable("t-source", "Source", [
            createColumn("c-source-id", "SourceId", true),
        ]);
        const targetTable = createTable("t-target", "Target", [
            createColumn("c-target-id", "TargetId", true),
        ]);

        const result = foreignKeyUtils.validateConnection(
            {
                source: "t-source",
                target: "t-target",
                sourceHandle: "right-missing-col",
                targetHandle: "left-c-target-id",
            },
            [createNode(sourceTable), createNode(targetTable)],
            [],
        );

        expect(result.isValid).to.equal(false);
    });

    test("validateConnection returns valid for compatible id-based connection", () => {
        const sourceTable = createTable("t-source", "Source", [
            createColumn("c-source-id", "SourceId", true),
            createColumn("c-source-target", "TargetId"),
        ]);
        const targetTable = createTable("t-target", "Target", [
            createColumn("c-target-id", "TargetId", true),
        ]);

        const edges: Edge<SchemaDesigner.ForeignKey>[] = [];
        const result = foreignKeyUtils.validateConnection(
            {
                source: "t-source",
                target: "t-target",
                sourceHandle: "right-c-source-target",
                targetHandle: "left-c-target-id",
            },
            [createNode(sourceTable), createNode(targetTable)],
            edges,
        );

        expect(result.isValid).to.equal(true);
    });

    test("on-action conversion helpers round-trip expected values", () => {
        const cascadeLabel = foreignKeyUtils.convertOnActionToString(
            SchemaDesigner.OnAction.CASCADE,
        );
        expect(foreignKeyUtils.convertStringToOnAction(cascadeLabel)).to.equal(
            SchemaDesigner.OnAction.CASCADE,
        );

        expect(foreignKeyUtils.getOnActionOptions().map((option) => option.value)).to.deep.equal([
            SchemaDesigner.OnAction.CASCADE,
            SchemaDesigner.OnAction.NO_ACTION,
            SchemaDesigner.OnAction.SET_NULL,
            SchemaDesigner.OnAction.SET_DEFAULT,
        ]);
    });
});
