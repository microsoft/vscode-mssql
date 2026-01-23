/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as sd from "../../src/sharedInterfaces/schemaDesigner";
import {
    calculateSchemaDiff,
    type SchemaChange,
    type SchemaChangesSummary,
    type TableChangeGroup,
} from "../../src/reactviews/pages/SchemaDesigner/diff/diffUtils";
import { describeChange } from "../../src/reactviews/pages/SchemaDesigner/diff/schemaDiff";

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function loadLargeSchema(): sd.SchemaDesigner.Schema {
    const schemaPath = path.join(__dirname, "../../../test/resources/testSchema.json");
    const raw = fs.readFileSync(schemaPath, { encoding: "utf8" });
    return JSON.parse(raw) as sd.SchemaDesigner.Schema;
}

function findGroup(summary: SchemaChangesSummary, tableId: string): TableChangeGroup {
    const group = summary.groups.find((g) => g.tableId === tableId);
    expect(group, `Expected table group for tableId ${tableId}`).to.exist;
    return group!;
}

function findChange(
    group: TableChangeGroup,
    predicate: (c: SchemaChange) => boolean,
): SchemaChange {
    const change = group.changes.find(predicate);
    expect(change, "Expected matching change").to.exist;
    return change!;
}

suite("SchemaDesigner diff utils", () => {
    const sampleSchema = JSON.parse(
        `{
    "tables": [
        {
            "id": "fae49816-b614-4a62-8787-4b497782b4fa",
            "name": "users",
            "schema": "dbo",
            "columns": [
                {
                    "id": "2f7bad91-04cb-46d0-b737-457ce2aae3a9",
                    "name": "user_id",
                    "dataType": "int",
                    "maxLength": null,
                    "precision": null,
                    "scale": null,
                    "isPrimaryKey": true,
                    "isIdentity": true,
                    "identitySeed": 1,
                    "identityIncrement": 1,
                    "isNullable": false,
                    "defaultValue": null,
                    "isComputed": false,
                    "computedFormula": null,
                    "computedPersisted": null
                },
                {
                    "id": "ca31b960-f211-4b0f-93c7-a6ea8d32e8d2",
                    "name": "phone_number",
                    "dataType": "nvarchar",
                    "maxLength": "25",
                    "precision": null,
                    "scale": null,
                    "isPrimaryKey": false,
                    "isIdentity": false,
                    "identitySeed": null,
                    "identityIncrement": null,
                    "isNullable": true,
                    "defaultValue": null,
                    "isComputed": false,
                    "computedFormula": null,
                    "computedPersisted": null
                }
            ],
            "foreignKeys": []
        },
        {
            "id": "6256e1cf-b4df-45e3-a09f-e1da5e246fa9",
            "name": "returns",
            "schema": "dbo",
            "columns": [
                {
                    "id": "457002c3-7ffd-4b80-a073-39a8d2aa4791",
                    "name": "return_id",
                    "dataType": "bigint",
                    "maxLength": null,
                    "precision": null,
                    "scale": null,
                    "isPrimaryKey": true,
                    "isIdentity": true,
                    "identitySeed": 1,
                    "identityIncrement": 1,
                    "isNullable": false,
                    "defaultValue": null,
                    "isComputed": false,
                    "computedFormula": null,
                    "computedPersisted": null
                },
                {
                    "id": "fe92dd38-2c17-41e3-8b5d-a724b012d818",
                    "name": "order_item_id",
                    "dataType": "bigint",
                    "maxLength": null,
                    "precision": null,
                    "scale": null,
                    "isPrimaryKey": false,
                    "isIdentity": false,
                    "identitySeed": null,
                    "identityIncrement": null,
                    "isNullable": false,
                    "defaultValue": null,
                    "isComputed": false,
                    "computedFormula": null,
                    "computedPersisted": null
                }
            ],
            "foreignKeys": [
                {
                    "id": "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
                    "name": "FK_returns_order_item",
                    "columns": ["order_item_id"],
                    "referencedSchemaName": "dbo",
                    "referencedTableName": "order_items",
                    "referencedColumns": ["order_item_id"],
                    "onDeleteAction": 1,
                    "onUpdateAction": 1
                }
            ]
        },
        {
            "id": "05c6e408-7ef9-440c-a22a-40da754770ff",
            "name": "promotions",
            "schema": "dbo",
            "columns": [
                {
                    "id": "b8289d44-399a-4c79-b5cb-a56f014ad602",
                    "name": "promotion_id",
                    "dataType": "int",
                    "maxLength": null,
                    "precision": null,
                    "scale": null,
                    "isPrimaryKey": true,
                    "isIdentity": true,
                    "identitySeed": 1,
                    "identityIncrement": 1,
                    "isNullable": false,
                    "defaultValue": null,
                    "isComputed": false,
                    "computedFormula": null,
                    "computedPersisted": null
                }
            ],
            "foreignKeys": []
        }
    ]
}`,
    ) as unknown as sd.SchemaDesigner.Schema;

    test("returns no changes for empty schemas", () => {
        const emptySchema: sd.SchemaDesigner.Schema = { tables: [] };
        const summary = calculateSchemaDiff(emptySchema, emptySchema);
        expect(summary.hasChanges).to.equal(false);
        expect(summary.totalChanges).to.equal(0);
        expect(summary.groups).to.have.length(0);
    });

    test("returns no changes for identical schemas", () => {
        const summary = calculateSchemaDiff(sampleSchema, sampleSchema);
        expect(summary.hasChanges).to.equal(false);
        expect(summary.totalChanges).to.equal(0);
        expect(summary.groups).to.have.length(0);
    });

    test("detects added/deleted/modified tables and describes them", () => {
        const updated = deepClone(sampleSchema);

        // Table rename (modify)
        const usersTable = updated.tables.find(
            (t) => t.id === "fae49816-b614-4a62-8787-4b497782b4fa",
        );
        expect(usersTable).to.exist;
        const users = usersTable!;
        users.name = "app_users";

        // Column modify (dataType + isNullable)
        const userIdCol = users.columns.find(
            (c) => c.id === "2f7bad91-04cb-46d0-b737-457ce2aae3a9",
        );
        expect(userIdCol).to.exist;
        const userId = userIdCol!;
        userId.dataType = "bigint";
        userId.isNullable = true;

        // Foreign key modify
        const returnsTable = updated.tables.find(
            (t) => t.id === "6256e1cf-b4df-45e3-a09f-e1da5e246fa9",
        );
        expect(returnsTable).to.exist;
        const returnsT = returnsTable!;
        const returnsFk = returnsT.foreignKeys.find(
            (fk) => fk.id === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(returnsFk).to.exist;
        const fk = returnsFk!;
        fk.referencedTableName = "order_items_v2";

        // Table deleted
        updated.tables = updated.tables.filter(
            (t) => t.id !== "05c6e408-7ef9-440c-a22a-40da754770ff",
        );

        // Table added
        updated.tables.push({
            id: "00000000-0000-0000-0000-000000000001",
            name: "audit_log",
            schema: "dbo",
            columns: [],
            foreignKeys: [],
        } as unknown as sd.SchemaDesigner.Table);

        const summary = calculateSchemaDiff(sampleSchema, updated);
        expect(summary.hasChanges).to.equal(true);
        expect(summary.totalChanges).to.be.greaterThan(0);

        // New table
        const addedGroup = findGroup(summary, "00000000-0000-0000-0000-000000000001");
        expect(addedGroup.isNew).to.equal(true);
        const tableAdd = findChange(
            addedGroup,
            (c) => c.category === "table" && c.action === "add",
        );
        expect(describeChange(tableAdd)).to.equal("Created table [dbo].[audit_log]");

        // Deleted table
        const deletedGroup = findGroup(summary, "05c6e408-7ef9-440c-a22a-40da754770ff");
        expect(deletedGroup.isDeleted).to.equal(true);
        const tableDelete = findChange(
            deletedGroup,
            (c) => c.category === "table" && c.action === "delete",
        );
        expect(describeChange(tableDelete)).to.equal("Deleted table [dbo].[promotions]");

        // Renamed table
        const usersGroup = findGroup(summary, "fae49816-b614-4a62-8787-4b497782b4fa");
        const tableModify = findChange(
            usersGroup,
            (c) => c.category === "table" && c.action === "modify",
        );
        expect(describeChange(tableModify)).to.equal(
            "Modified table [dbo].[app_users]: Name changed from 'users' to 'app_users'",
        );

        // Modified column
        const colModify = findChange(
            usersGroup,
            (c) =>
                c.category === "column" &&
                c.action === "modify" &&
                c.objectId === "2f7bad91-04cb-46d0-b737-457ce2aae3a9",
        );
        expect(describeChange(colModify)).to.equal(
            "Modified column 'user_id': Data Type changed from 'int' to 'bigint', Nullable changed from 'false' to 'true'",
        );

        // Modified FK
        const returnsGroup = findGroup(summary, "6256e1cf-b4df-45e3-a09f-e1da5e246fa9");
        const fkModify = findChange(
            returnsGroup,
            (c) =>
                c.category === "foreignKey" &&
                c.action === "modify" &&
                c.objectId === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(describeChange(fkModify)).to.equal(
            "Modified foreign key 'FK_returns_order_item': Referenced Table changed from 'order_items' to 'order_items_v2'",
        );
    });

    test("detects added/deleted/modified columns and validates propertyChanges", () => {
        const updated = deepClone(sampleSchema);

        const usersTable = updated.tables.find(
            (t) => t.id === "fae49816-b614-4a62-8787-4b497782b4fa",
        );
        expect(usersTable).to.exist;
        const users = usersTable!;

        // Delete a column
        users.columns = users.columns.filter(
            (c) => c.id !== "ca31b960-f211-4b0f-93c7-a6ea8d32e8d2",
        );

        // Add a new column
        users.columns.push({
            id: "00000000-0000-0000-0000-0000000000c1",
            name: "middle_name",
            dataType: "nvarchar",
            maxLength: "100",
            precision: undefined,
            scale: undefined,
            isPrimaryKey: false,
            isIdentity: false,
            identitySeed: undefined,
            identityIncrement: undefined,
            isNullable: true,
            defaultValue: undefined,
            isComputed: false,
            computedFormula: undefined,
            computedPersisted: false,
        } as unknown as sd.SchemaDesigner.Column);

        // Modify an existing column and validate propertyChanges
        const userIdCol = users.columns.find(
            (c) => c.id === "2f7bad91-04cb-46d0-b737-457ce2aae3a9",
        );
        expect(userIdCol).to.exist;
        const userId = userIdCol!;
        userId.dataType = "bigint";
        userId.isNullable = true;

        const summary = calculateSchemaDiff(sampleSchema, updated);
        const usersGroup = findGroup(summary, "fae49816-b614-4a62-8787-4b497782b4fa");

        const colAdd = findChange(
            usersGroup,
            (c) =>
                c.category === "column" &&
                c.action === "add" &&
                c.objectId === "00000000-0000-0000-0000-0000000000c1",
        );
        expect(describeChange(colAdd)).to.equal("Added column 'middle_name'");

        const colDelete = findChange(
            usersGroup,
            (c) =>
                c.category === "column" &&
                c.action === "delete" &&
                c.objectId === "ca31b960-f211-4b0f-93c7-a6ea8d32e8d2",
        );
        expect(describeChange(colDelete)).to.equal("Deleted column 'phone_number'");

        const colModify = findChange(
            usersGroup,
            (c) =>
                c.category === "column" &&
                c.action === "modify" &&
                c.objectId === "2f7bad91-04cb-46d0-b737-457ce2aae3a9",
        );

        expect(colModify.propertyChanges).to.deep.equal([
            {
                property: "dataType",
                displayName: "Data Type",
                oldValue: "int",
                newValue: "bigint",
            },
            {
                property: "isNullable",
                displayName: "Nullable",
                oldValue: false,
                newValue: true,
            },
        ]);
    });

    test("detects added/deleted/modified foreign keys (including deep array equality)", () => {
        const updated = deepClone(sampleSchema);

        const returnsTable = updated.tables.find(
            (t) => t.id === "6256e1cf-b4df-45e3-a09f-e1da5e246fa9",
        );
        expect(returnsTable).to.exist;
        const returnsT = returnsTable!;

        // Modify existing FK array properties
        const existingFk = returnsT.foreignKeys.find(
            (fk) => fk.id === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(existingFk).to.exist;
        const fk = existingFk!;
        fk.columns = ["order_item_id", "return_id"];
        fk.referencedColumns = ["order_item_id", "return_id"];

        // Delete old FK and add a new FK (add/delete paths)
        returnsT.foreignKeys = returnsT.foreignKeys.filter(
            (f) => f.id !== "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        returnsT.foreignKeys.push({
            id: "00000000-0000-0000-0000-00000000f001",
            name: "FK_returns_order_item_v2",
            columns: ["order_item_id"],
            referencedSchemaName: "dbo",
            referencedTableName: "order_items",
            referencedColumns: ["order_item_id"],
            onDeleteAction: 1,
            onUpdateAction: 1,
        } as unknown as sd.SchemaDesigner.ForeignKey);

        const summary = calculateSchemaDiff(sampleSchema, updated);
        const returnsGroup = findGroup(summary, "6256e1cf-b4df-45e3-a09f-e1da5e246fa9");

        const fkAdd = findChange(
            returnsGroup,
            (c) =>
                c.category === "foreignKey" &&
                c.action === "add" &&
                c.objectId === "00000000-0000-0000-0000-00000000f001",
        );
        expect(describeChange(fkAdd)).to.equal("Added foreign key 'FK_returns_order_item_v2'");

        const fkDelete = findChange(
            returnsGroup,
            (c) =>
                c.category === "foreignKey" &&
                c.action === "delete" &&
                c.objectId === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(describeChange(fkDelete)).to.equal("Deleted foreign key 'FK_returns_order_item'");

        // Also validate deep array equality on modify using a separate updated schema
        const updated2 = deepClone(sampleSchema);
        const returnsTable2 = updated2.tables.find(
            (t) => t.id === "6256e1cf-b4df-45e3-a09f-e1da5e246fa9",
        );
        expect(returnsTable2).to.exist;
        const returnsT2 = returnsTable2!;
        const fk2 = returnsT2.foreignKeys.find(
            (f) => f.id === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(fk2).to.exist;
        fk2!.columns = ["order_item_id", "return_id"];
        fk2!.referencedColumns = ["order_item_id", "return_id"];

        const summary2 = calculateSchemaDiff(sampleSchema, updated2);
        const returnsGroup2 = findGroup(summary2, "6256e1cf-b4df-45e3-a09f-e1da5e246fa9");
        const fkModify = findChange(
            returnsGroup2,
            (c) =>
                c.category === "foreignKey" &&
                c.action === "modify" &&
                c.objectId === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );

        expect(fkModify.propertyChanges).to.deep.equal([
            {
                property: "columns",
                displayName: "Columns",
                oldValue: ["order_item_id"],
                newValue: ["order_item_id", "return_id"],
            },
            {
                property: "referencedColumns",
                displayName: "Referenced Columns",
                oldValue: ["order_item_id"],
                newValue: ["order_item_id", "return_id"],
            },
        ]);
    });

    test("handles multiple changes across multiple tables using large fixture", () => {
        const baseline = loadLargeSchema();
        const updated = deepClone(baseline);

        expect(baseline.tables.length).to.be.greaterThan(2);

        // Modify first table name
        const firstTable = updated.tables[0];
        firstTable.name = `${firstTable.name}_v2`;

        // Delete last table
        const deletedTableId = updated.tables[updated.tables.length - 1].id;
        updated.tables = updated.tables.filter((t) => t.id !== deletedTableId);

        // Add new table
        updated.tables.push({
            id: "00000000-0000-0000-0000-00000000aaaa",
            name: "audit_log",
            schema: "dbo",
            columns: [],
            foreignKeys: [],
        } as unknown as sd.SchemaDesigner.Table);

        // Modify a column on second table (if present)
        const secondTable = updated.tables[1];
        if (secondTable.columns.length > 0) {
            secondTable.columns[0].name = `${secondTable.columns[0].name}_v2`;
        }

        const summary = calculateSchemaDiff(baseline, updated);
        expect(summary.hasChanges).to.equal(true);
        expect(summary.groups.length).to.be.greaterThan(0);

        const firstGroup = findGroup(summary, baseline.tables[0].id);
        const firstTableModify = findChange(
            firstGroup,
            (c) => c.category === "table" && c.action === "modify",
        );
        expect(firstTableModify.propertyChanges).to.exist;
        expect(firstTableModify.propertyChanges!.some((p) => p.property === "name")).to.equal(true);
    });
});
