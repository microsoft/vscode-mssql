/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { namingUtils } from "../../src/reactviews/pages/SchemaDesigner/model";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

suite("SchemaDesigner naming utils", () => {
    function createColumn(id: string, name: string): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType: "int",
            maxLength: "",
            precision: 10,
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

    function createTable(id: string, name: string): SchemaDesigner.Table {
        return {
            id,
            schema: "dbo",
            name,
            columns: [],
            foreignKeys: [],
        };
    }

    test("getNextColumnName returns first available generated name", () => {
        const columns = [
            createColumn("c1", "column_1"),
            createColumn("c2", "column_2"),
            createColumn("c3", "Other"),
        ];

        expect(namingUtils.getNextColumnName(columns)).to.equal("column_3");
    });

    test("getNextTableName returns first available generated table name", () => {
        const tables = [
            createTable("t1", "table_1"),
            createTable("t2", "table_3"),
            createTable("t3", "Users"),
        ];

        expect(namingUtils.getNextTableName(tables)).to.equal("table_2");
    });

    test("getNextForeignKeyName considers names across schema tables and provided foreign keys", () => {
        const schemaTables: SchemaDesigner.Table[] = [
            {
                ...createTable("t1", "Users"),
                foreignKeys: [
                    {
                        id: "fk1",
                        name: "FK_1",
                        columnIds: ["c1"],
                        referencedTableId: "t2",
                        referencedColumnIds: ["c2"],
                        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    },
                ],
            },
            {
                ...createTable("t2", "Orders"),
                foreignKeys: [
                    {
                        id: "fk2",
                        name: "FK_3",
                        columnIds: ["c2"],
                        referencedTableId: "t1",
                        referencedColumnIds: ["c1"],
                        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    },
                ],
            },
        ];

        const currentTableForeignKeys: SchemaDesigner.ForeignKey[] = [
            {
                id: "fk-local",
                name: "FK_2",
                columnIds: ["c3"],
                referencedTableId: "t1",
                referencedColumnIds: ["c1"],
                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            },
        ];

        expect(namingUtils.getNextForeignKeyName(currentTableForeignKeys, schemaTables)).to.equal(
            "FK_4",
        );
    });
});
