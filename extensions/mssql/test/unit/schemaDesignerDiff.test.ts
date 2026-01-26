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
    ChangeAction,
    ChangeCategory,
    type SchemaChange,
    type SchemaChangesSummary,
    type TableChangeGroup,
} from "../../src/reactviews/pages/SchemaDesigner/diff/diffUtils";
import { describeChange } from "../../src/reactviews/pages/SchemaDesigner/diff/schemaDiff";
import {
    canRevertChange,
    computeRevertedSchema,
    type RevertMessages,
    type SchemaState,
} from "../../src/reactviews/pages/SchemaDesigner/diff/revertChange";

// Test messages for revert validation
const testRevertMessages: RevertMessages = {
    cannotRevertForeignKey:
        "Cannot revert: The referenced table or columns no longer exist in the current schema.",
    cannotRevertDeletedColumn: "Cannot revert: This column is referenced by a deleted foreign key.",
};

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
            (c) => c.category === ChangeCategory.Table && c.action === ChangeAction.Add,
        );
        expect(describeChange(tableAdd)).to.equal("Created table [dbo].[audit_log]");

        // Deleted table
        const deletedGroup = findGroup(summary, "05c6e408-7ef9-440c-a22a-40da754770ff");
        expect(deletedGroup.isDeleted).to.equal(true);
        const tableDelete = findChange(
            deletedGroup,
            (c) => c.category === ChangeCategory.Table && c.action === ChangeAction.Delete,
        );
        expect(describeChange(tableDelete)).to.equal("Deleted table [dbo].[promotions]");

        // Renamed table
        const usersGroup = findGroup(summary, "fae49816-b614-4a62-8787-4b497782b4fa");
        const tableModify = findChange(
            usersGroup,
            (c) => c.category === ChangeCategory.Table && c.action === ChangeAction.Modify,
        );
        expect(describeChange(tableModify)).to.equal(
            "Modified table [dbo].[app_users]: Name changed from 'users' to 'app_users'",
        );

        // Modified column
        const colModify = findChange(
            usersGroup,
            (c) =>
                c.category === ChangeCategory.Column &&
                c.action === ChangeAction.Modify &&
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
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Modify &&
                c.objectId === "415ccfc3-f8cf-4a23-89ee-9a59f9f02d75",
        );
        expect(describeChange(fkModify)).to.equal(
            "Modified foreign key 'FK_returns_order_item': Referenced Table changed from 'order_items' to 'order_items_v2'",
        );
    });

    test("includes foreign key add entries for newly added tables", () => {
        const baseline: sd.SchemaDesigner.Schema = { tables: [] };
        const updated: sd.SchemaDesigner.Schema = {
            tables: [
                {
                    id: "table-new",
                    name: "new_table",
                    schema: "dbo",
                    columns: [
                        {
                            id: "col-id",
                            name: "id",
                            dataType: "int",
                            maxLength: "",
                            precision: 0,
                            scale: 0,
                            isPrimaryKey: true,
                            isIdentity: true,
                            identitySeed: 1,
                            identityIncrement: 1,
                            isNullable: false,
                            defaultValue: "",
                            isComputed: false,
                            computedFormula: "",
                            computedPersisted: false,
                        },
                    ],
                    foreignKeys: [
                        {
                            id: "fk-new-ref",
                            name: "FK_new_ref",
                            columns: ["id"],
                            referencedSchemaName: "dbo",
                            referencedTableName: "ref",
                            referencedColumns: ["id"],
                            onDeleteAction: 1,
                            onUpdateAction: 1,
                        },
                    ],
                } as unknown as sd.SchemaDesigner.Table,
            ],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        expect(summary.hasChanges).to.equal(true);

        const group = findGroup(summary, "table-new");
        expect(group.isNew).to.equal(true);

        const tableAdd = findChange(
            group,
            (c) => c.category === ChangeCategory.Table && c.action === ChangeAction.Add,
        );
        expect(tableAdd).to.exist;

        const fkAdd = findChange(
            group,
            (c) =>
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Add &&
                c.objectId === "fk-new-ref",
        );
        expect(fkAdd.objectName).to.equal("FK_new_ref");
    });

    test("renaming a referenced column does not surface a derived FK modify change", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [
                {
                    id: "table-users",
                    name: "users",
                    schema: "dbo",
                    columns: [
                        {
                            id: "col-user-id",
                            name: "user_id",
                            dataType: "int",
                            maxLength: "",
                            precision: 0,
                            scale: 0,
                            isPrimaryKey: true,
                            isIdentity: true,
                            identitySeed: 1,
                            identityIncrement: 1,
                            isNullable: false,
                            defaultValue: "",
                            isComputed: false,
                            computedFormula: "",
                            computedPersisted: false,
                        },
                    ],
                    foreignKeys: [],
                } as unknown as sd.SchemaDesigner.Table,
                {
                    id: "table-orders",
                    name: "orders",
                    schema: "dbo",
                    columns: [
                        {
                            id: "col-user-ref",
                            name: "user_id",
                            dataType: "int",
                            maxLength: "",
                            precision: 0,
                            scale: 0,
                            isPrimaryKey: false,
                            isIdentity: false,
                            identitySeed: 0,
                            identityIncrement: 0,
                            isNullable: false,
                            defaultValue: "",
                            isComputed: false,
                            computedFormula: "",
                            computedPersisted: false,
                        },
                    ],
                    foreignKeys: [
                        {
                            id: "fk-orders-users",
                            name: "FK_orders_users",
                            columns: ["user_id"],
                            referencedSchemaName: "dbo",
                            referencedTableName: "users",
                            referencedColumns: ["user_id"],
                            onDeleteAction: 1,
                            onUpdateAction: 1,
                        },
                    ],
                } as unknown as sd.SchemaDesigner.Table,
            ],
        };

        const updated: sd.SchemaDesigner.Schema = deepClone(baseline);
        updated.tables[0].columns[0].name = "user_id_new";
        updated.tables[1].foreignKeys[0].referencedColumns = ["user_id_new"];

        const summary = calculateSchemaDiff(baseline, updated);
        const allChanges = summary.groups.flatMap((g) => g.changes);

        const userColChange = allChanges.find(
            (c) =>
                c.category === ChangeCategory.Column &&
                c.action === ChangeAction.Modify &&
                c.tableId === "table-users",
        );
        expect(userColChange).to.exist;

        const fkModify = allChanges.find(
            (c) =>
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Modify &&
                c.tableId === "table-orders",
        );
        expect(fkModify).to.be.undefined;
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
                c.category === ChangeCategory.Column &&
                c.action === ChangeAction.Add &&
                c.objectId === "00000000-0000-0000-0000-0000000000c1",
        );
        expect(describeChange(colAdd)).to.equal("Added column 'middle_name'");

        const colDelete = findChange(
            usersGroup,
            (c) =>
                c.category === ChangeCategory.Column &&
                c.action === ChangeAction.Delete &&
                c.objectId === "ca31b960-f211-4b0f-93c7-a6ea8d32e8d2",
        );
        expect(describeChange(colDelete)).to.equal("Deleted column 'phone_number'");

        const colModify = findChange(
            usersGroup,
            (c) =>
                c.category === ChangeCategory.Column &&
                c.action === ChangeAction.Modify &&
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
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Add &&
                c.objectId === "00000000-0000-0000-0000-00000000f001",
        );
        expect(describeChange(fkAdd)).to.equal("Added foreign key 'FK_returns_order_item_v2'");

        const fkDelete = findChange(
            returnsGroup,
            (c) =>
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Delete &&
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
                c.category === ChangeCategory.ForeignKey &&
                c.action === ChangeAction.Modify &&
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
            (c) => c.category === ChangeCategory.Table && c.action === ChangeAction.Modify,
        );
        expect(firstTableModify.propertyChanges).to.exist;
        expect(firstTableModify.propertyChanges!.some((p) => p.property === "name")).to.equal(true);
    });
});

suite("SchemaDesigner revert logic", () => {
    // Sample schema with foreign key relationships for testing revert scenarios
    const baselineSchema: sd.SchemaDesigner.Schema = {
        tables: [
            {
                id: "table-users",
                name: "users",
                schema: "dbo",
                columns: [
                    {
                        id: "col-user-id",
                        name: "user_id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                    {
                        id: "col-email",
                        name: "email",
                        dataType: "nvarchar",
                        maxLength: "255",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: false,
                        isIdentity: false,
                        identitySeed: 0,
                        identityIncrement: 0,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                ],
                foreignKeys: [],
            },
            {
                id: "table-orders",
                name: "orders",
                schema: "dbo",
                columns: [
                    {
                        id: "col-order-id",
                        name: "order_id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                    {
                        id: "col-user-ref",
                        name: "user_id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: false,
                        isIdentity: false,
                        identitySeed: 0,
                        identityIncrement: 0,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                ],
                foreignKeys: [
                    {
                        id: "fk-orders-users",
                        name: "FK_orders_users",
                        columns: ["user_id"],
                        referencedSchemaName: "dbo",
                        referencedTableName: "users",
                        referencedColumns: ["user_id"],
                        onDeleteAction: 1,
                        onUpdateAction: 1,
                    },
                ],
            },
        ],
    };

    suite("canRevertChange", () => {
        test("allows reverting simple table modifications", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].name = "app_users"; // Modified table name

            const change: SchemaChange = {
                id: "table:modify:table-users",
                action: ChangeAction.Modify,
                category: ChangeCategory.Table,
                tableId: "table-users",
                tableName: "app_users",
                tableSchema: "dbo",
            };

            const result = canRevertChange(
                change,
                baselineSchema,
                currentSchema,
                [change],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(true);
            expect(result.reason).to.be.undefined;
        });

        test("allows reverting column additions", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].columns.push({
                id: "col-new",
                name: "new_column",
                dataType: "varchar",
                maxLength: "100",
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
            });

            const change: SchemaChange = {
                id: "column:add:table-users:col-new",
                action: ChangeAction.Add,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-new",
                objectName: "new_column",
            };

            const result = canRevertChange(
                change,
                baselineSchema,
                currentSchema,
                [change],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(true);
        });

        test("prevents reverting FK deletion when referenced table is deleted", () => {
            // Current schema without the users table
            const currentSchema: SchemaState = {
                tables: [deepClone(baselineSchema.tables[1])], // Only orders table
            };
            currentSchema.tables[0].foreignKeys = []; // FK is deleted

            const fkDeleteChange: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = canRevertChange(
                fkDeleteChange,
                baselineSchema,
                currentSchema,
                [fkDeleteChange],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(false);
            expect(result.reason).to.equal(testRevertMessages.cannotRevertForeignKey);
        });

        test("prevents reverting FK deletion when referenced column is deleted", () => {
            // Current schema with users table but without the user_id column
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].columns = currentSchema.tables[0].columns.filter(
                (c) => c.name !== "user_id",
            );
            currentSchema.tables[1].foreignKeys = []; // FK is deleted

            const fkDeleteChange: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = canRevertChange(
                fkDeleteChange,
                baselineSchema,
                currentSchema,
                [fkDeleteChange],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(false);
            expect(result.reason).to.equal(testRevertMessages.cannotRevertForeignKey);
        });

        test("allows reverting FK deletion when referenced table and columns exist", () => {
            // Current schema with all tables and columns intact, just FK removed
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[1].foreignKeys = []; // Only FK is deleted

            const fkDeleteChange: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = canRevertChange(
                fkDeleteChange,
                baselineSchema,
                currentSchema,
                [fkDeleteChange],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(true);
        });

        test("prevents reverting FK modification when referenced table no longer exists", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].name = "members"; // Rename users table

            const fkModifyChange: SchemaChange = {
                id: "foreignKey:modify:table-orders:fk-orders-users",
                action: ChangeAction.Modify,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = canRevertChange(
                fkModifyChange,
                baselineSchema,
                currentSchema,
                [fkModifyChange],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(false);
            expect(result.reason).to.equal(testRevertMessages.cannotRevertForeignKey);
        });

        test("allows reverting column deletion even when a related FK was deleted", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            // Delete the user_id column from users table
            currentSchema.tables[0].columns = currentSchema.tables[0].columns.filter(
                (c) => c.name !== "user_id",
            );
            // Also delete the FK (since it references the deleted column)
            currentSchema.tables[1].foreignKeys = [];

            const colDeleteChange: SchemaChange = {
                id: "column:delete:table-users:col-user-id",
                action: ChangeAction.Delete,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-user-id",
                objectName: "user_id",
            };

            const fkDeleteChange: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = canRevertChange(
                colDeleteChange,
                baselineSchema,
                currentSchema,
                [colDeleteChange, fkDeleteChange],
                testRevertMessages,
            );
            expect(result.canRevert).to.equal(true);
            expect(result.reason).to.be.undefined;
        });

        test("repro: delete FK1 then column, add FK2", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });

            // FK1 is the baseline FK from orders(user_id) -> users(user_id). Delete it.
            currentSchema.tables[1].foreignKeys = [];
            // Delete the referenced column (users.user_id)
            currentSchema.tables[0].columns = currentSchema.tables[0].columns.filter(
                (c) => c.name !== "user_id",
            );
            // Add another FK (FK2)
            currentSchema.tables[1].foreignKeys.push({
                id: "fk-orders-users-2",
                name: "FK_orders_users_2",
                columns: ["user_id"],
                referencedSchemaName: "dbo",
                referencedTableName: "users",
                referencedColumns: ["user_id"],
                onDeleteAction: 1,
                onUpdateAction: 1,
            });

            const fk1DeleteChange: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const colDeleteChange: SchemaChange = {
                id: "column:delete:table-users:col-user-id",
                action: ChangeAction.Delete,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-user-id",
                objectName: "user_id",
            };

            const fk2AddChange: SchemaChange = {
                id: "foreignKey:add:table-orders:fk-orders-users-2",
                action: ChangeAction.Add,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users-2",
                objectName: "FK_orders_users_2",
            };

            const allChanges = [fk1DeleteChange, colDeleteChange, fk2AddChange];

            // Cannot revert FK1 deletion while referenced column is missing
            const fk1CanRevert = canRevertChange(
                fk1DeleteChange,
                baselineSchema,
                currentSchema,
                allChanges,
                testRevertMessages,
            );
            expect(fk1CanRevert.canRevert).to.equal(false);
            expect(fk1CanRevert.reason).to.equal(testRevertMessages.cannotRevertForeignKey);

            // Can revert the column deletion (restore column)
            const colCanRevert = canRevertChange(
                colDeleteChange,
                baselineSchema,
                currentSchema,
                allChanges,
                testRevertMessages,
            );
            expect(colCanRevert.canRevert).to.equal(true);

            // Can revert FK2 add (remove FK2)
            const fk2CanRevert = canRevertChange(
                fk2AddChange,
                baselineSchema,
                currentSchema,
                allChanges,
                testRevertMessages,
            );
            expect(fk2CanRevert.canRevert).to.equal(true);

            const fk2Reverted = computeRevertedSchema(fk2AddChange, baselineSchema, currentSchema);
            expect(fk2Reverted.success).to.equal(true);
            const orders = fk2Reverted.tables.find((t) => t.id === "table-orders");
            expect(orders).to.exist;
            expect(orders!.foreignKeys.find((fk) => fk.id === "fk-orders-users-2")).to.be.undefined;
        });
    });

    suite("computeRevertedSchema", () => {
        test("reverts table addition by removing the table", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables.push({
                id: "table-new",
                name: "new_table",
                schema: "dbo",
                columns: [],
                foreignKeys: [],
            });

            const change: SchemaChange = {
                id: "table:add:table-new",
                action: ChangeAction.Add,
                category: ChangeCategory.Table,
                tableId: "table-new",
                tableName: "new_table",
                tableSchema: "dbo",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            expect(result.tables.length).to.equal(2); // Original 2 tables
            expect(result.tables.find((t) => t.id === "table-new")).to.be.undefined;
        });

        test("reverts table deletion by restoring the table (without FKs)", () => {
            // Current schema without users table
            const currentSchema: SchemaState = {
                tables: [deepClone(baselineSchema.tables[1])],
            };

            const change: SchemaChange = {
                id: "table:delete:table-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.Table,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            expect(result.tables.length).to.equal(2);
            const restoredTable = result.tables.find((t) => t.id === "table-users");
            expect(restoredTable).to.exist;
            expect(restoredTable!.name).to.equal("users");
            expect(restoredTable!.columns.length).to.equal(2);
            expect(restoredTable!.foreignKeys.length).to.equal(0); // FKs not restored with table
        });

        test("reverts column deletion by restoring the column at its baseline position", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });

            // Baseline users columns are: user_id, username
            // Create a 3-column baseline ordering for this test by inserting a middle column.
            const baselineWithThreeCols = deepClone(baselineSchema);
            baselineWithThreeCols.tables[0].columns = [
                baselineWithThreeCols.tables[0].columns[0],
                {
                    id: "col-middle",
                    name: "middle",
                    dataType: "int",
                    maxLength: "",
                    precision: 0,
                    scale: 0,
                    isPrimaryKey: false,
                    isIdentity: false,
                    identitySeed: 0,
                    identityIncrement: 0,
                    isNullable: false,
                    defaultValue: "",
                    isComputed: false,
                    computedFormula: "",
                    computedPersisted: false,
                },
                baselineWithThreeCols.tables[0].columns[1],
            ];

            // Current schema deletes the middle column
            currentSchema.tables[0].columns = baselineWithThreeCols.tables[0].columns.filter(
                (c) => c.id !== "col-middle",
            );

            const change: SchemaChange = {
                id: "column:delete:table-users:col-middle",
                action: ChangeAction.Delete,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-middle",
                objectName: "middle",
            };

            const result = computeRevertedSchema(change, baselineWithThreeCols, currentSchema);
            expect(result.success).to.equal(true);

            const users = result.tables.find((t) => t.id === "table-users");
            expect(users).to.exist;
            expect(users!.columns.map((c) => c.id)).to.deep.equal([
                baselineWithThreeCols.tables[0].columns[0].id,
                "col-middle",
                baselineWithThreeCols.tables[0].columns[2].id,
            ]);
        });

        test("reverts table modification by restoring original name/schema", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].name = "app_users";
            currentSchema.tables[0].schema = "app";

            const change: SchemaChange = {
                id: "table:modify:table-users",
                action: ChangeAction.Modify,
                category: ChangeCategory.Table,
                tableId: "table-users",
                tableName: "app_users",
                tableSchema: "app",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const revertedTable = result.tables.find((t) => t.id === "table-users");
            expect(revertedTable!.name).to.equal("users");
            expect(revertedTable!.schema).to.equal("dbo");
        });

        test("reverts column addition by removing the column", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].columns.push({
                id: "col-new",
                name: "new_column",
                dataType: "varchar",
                maxLength: "100",
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
            });

            const change: SchemaChange = {
                id: "column:add:table-users:col-new",
                action: ChangeAction.Add,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-new",
                objectName: "new_column",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const usersTable = result.tables.find((t) => t.id === "table-users");
            expect(usersTable!.columns.length).to.equal(2); // Original 2 columns
            expect(usersTable!.columns.find((c) => c.id === "col-new")).to.be.undefined;
        });

        test("reverts column deletion by restoring the column", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].columns = currentSchema.tables[0].columns.filter(
                (c) => c.id !== "col-email",
            );

            const change: SchemaChange = {
                id: "column:delete:table-users:col-email",
                action: ChangeAction.Delete,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-email",
                objectName: "email",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const usersTable = result.tables.find((t) => t.id === "table-users");
            expect(usersTable!.columns.length).to.equal(2);
            const restoredCol = usersTable!.columns.find((c) => c.id === "col-email");
            expect(restoredCol).to.exist;
            expect(restoredCol!.name).to.equal("email");
        });

        test("reverts column modification by restoring original properties", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            const emailCol = currentSchema.tables[0].columns.find((c) => c.id === "col-email");
            emailCol!.dataType = "varchar";
            emailCol!.maxLength = "500";
            emailCol!.isNullable = true;

            const change: SchemaChange = {
                id: "column:modify:table-users:col-email",
                action: ChangeAction.Modify,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-email",
                objectName: "email",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const usersTable = result.tables.find((t) => t.id === "table-users");
            const revertedCol = usersTable!.columns.find((c) => c.id === "col-email");
            expect(revertedCol!.dataType).to.equal("nvarchar");
            expect(revertedCol!.maxLength).to.equal("255");
            expect(revertedCol!.isNullable).to.equal(false);
        });

        test("reverts FK addition by removing the FK", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[0].foreignKeys.push({
                id: "fk-new",
                name: "FK_new",
                columns: ["email"],
                referencedSchemaName: "dbo",
                referencedTableName: "emails",
                referencedColumns: ["email"],
                onDeleteAction: 1,
                onUpdateAction: 1,
            });

            const change: SchemaChange = {
                id: "foreignKey:add:table-users:fk-new",
                action: ChangeAction.Add,
                category: ChangeCategory.ForeignKey,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "fk-new",
                objectName: "FK_new",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const usersTable = result.tables.find((t) => t.id === "table-users");
            expect(usersTable!.foreignKeys.length).to.equal(0); // Original had no FKs
        });

        test("reverts FK addition on a newly added table by removing the FK", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables.push({
                id: "table-new",
                name: "new_table",
                schema: "dbo",
                columns: [
                    {
                        id: "col-new-user-id",
                        name: "user_id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: false,
                        isIdentity: false,
                        identitySeed: 0,
                        identityIncrement: 0,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                ],
                foreignKeys: [
                    {
                        id: "fk-new-users",
                        name: "FK_new_users",
                        columns: ["user_id"],
                        referencedSchemaName: "dbo",
                        referencedTableName: "users",
                        referencedColumns: ["user_id"],
                        onDeleteAction: 1,
                        onUpdateAction: 1,
                    },
                ],
            });

            const change: SchemaChange = {
                id: "foreignKey:add:table-new:fk-new-users",
                action: ChangeAction.Add,
                category: ChangeCategory.ForeignKey,
                tableId: "table-new",
                tableName: "new_table",
                tableSchema: "dbo",
                objectId: "fk-new-users",
                objectName: "FK_new_users",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const newTable = result.tables.find((t) => t.id === "table-new");
            expect(newTable).to.exist;
            expect(newTable!.foreignKeys.length).to.equal(0);
        });

        test("reverts FK deletion by restoring the FK", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[1].foreignKeys = []; // Remove the FK

            const change: SchemaChange = {
                id: "foreignKey:delete:table-orders:fk-orders-users",
                action: ChangeAction.Delete,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const ordersTable = result.tables.find((t) => t.id === "table-orders");
            expect(ordersTable!.foreignKeys.length).to.equal(1);
            expect(ordersTable!.foreignKeys[0].id).to.equal("fk-orders-users");
        });

        test("reverts FK modification by restoring original FK properties", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            currentSchema.tables[1].foreignKeys[0].referencedTableName = "users_v2";
            currentSchema.tables[1].foreignKeys[0].onDeleteAction = 2;

            const change: SchemaChange = {
                id: "foreignKey:modify:table-orders:fk-orders-users",
                action: ChangeAction.Modify,
                category: ChangeCategory.ForeignKey,
                tableId: "table-orders",
                tableName: "orders",
                tableSchema: "dbo",
                objectId: "fk-orders-users",
                objectName: "FK_orders_users",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(true);
            const ordersTable = result.tables.find((t) => t.id === "table-orders");
            expect(ordersTable!.foreignKeys[0].referencedTableName).to.equal("users");
            expect(ordersTable!.foreignKeys[0].onDeleteAction).to.equal(1);
        });

        test("returns error when table not found for column revert", () => {
            const currentSchema: SchemaState = { tables: [] };

            const change: SchemaChange = {
                id: "column:add:table-users:col-new",
                action: ChangeAction.Add,
                category: ChangeCategory.Column,
                tableId: "table-users",
                tableName: "users",
                tableSchema: "dbo",
                objectId: "col-new",
                objectName: "new_column",
            };

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);
            expect(result.success).to.equal(false);
            expect(result.error).to.equal("Table not found");
        });

        test("does not mutate input schema", () => {
            const currentSchema: SchemaState = deepClone({ tables: baselineSchema.tables });
            const originalTables = JSON.stringify(currentSchema.tables);

            const change: SchemaChange = {
                id: "table:modify:table-users",
                action: ChangeAction.Modify,
                category: ChangeCategory.Table,
                tableId: "table-users",
                tableName: "app_users",
                tableSchema: "dbo",
            };

            computeRevertedSchema(change, baselineSchema, currentSchema);

            // Verify input was not mutated
            expect(JSON.stringify(currentSchema.tables)).to.equal(originalTables);
        });
    });
});
