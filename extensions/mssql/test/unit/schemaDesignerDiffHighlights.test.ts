/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sd from "../../src/sharedInterfaces/schemaDesigner";
import { calculateSchemaDiff } from "../../src/reactviews/pages/SchemaDesigner/diff/diffUtils";
import {
    getNewColumnIds,
    getNewForeignKeyIds,
    getNewTableIds,
    getModifiedColumnHighlights,
} from "../../src/reactviews/pages/SchemaDesigner/diff/diffHighlights";

function makeColumn(id: string, name: string): sd.SchemaDesigner.Column {
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
    columns: sd.SchemaDesigner.Column[],
    foreignKeys: sd.SchemaDesigner.ForeignKey[] = [],
): sd.SchemaDesigner.Table {
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
): sd.SchemaDesigner.ForeignKey {
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

suite("SchemaDesigner diff highlights", () => {
    test("returns empty sets when summary is undefined", () => {
        expect(getNewTableIds(undefined).size).to.equal(0);
        expect(getNewColumnIds(undefined).size).to.equal(0);
        expect(getNewForeignKeyIds(undefined).size).to.equal(0);
    });

    test("returns added table ids from summary", () => {
        const baseline: sd.SchemaDesigner.Schema = { tables: [] };
        const updated: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "id")])],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const newTableIds = getNewTableIds(summary);

        expect(newTableIds.has("table-1")).to.equal(true);
    });

    test("returns added columns for existing tables only", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "id")])],
        };
        const updated: sd.SchemaDesigner.Schema = {
            tables: [
                makeTable("table-1", "users", [
                    makeColumn("col-1", "id"),
                    makeColumn("col-2", "email"),
                ]),
                makeTable("table-2", "orders", [makeColumn("col-3", "order_id")]),
            ],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const newColumnIds = getNewColumnIds(summary);

        expect(newColumnIds.has("col-2")).to.equal(true);
        expect(newColumnIds.has("col-3")).to.equal(false);
    });

    test("returns added foreign keys for existing and new tables", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [
                makeTable("table-1", "users", [makeColumn("col-1", "id")]),
                makeTable("table-2", "orders", [makeColumn("col-2", "order_id")]),
            ],
        };

        const updated: sd.SchemaDesigner.Schema = {
            tables: [
                makeTable(
                    "table-1",
                    "users",
                    [makeColumn("col-1", "id")],
                    [makeForeignKey("fk-1", "FK_users_orders", ["id"], "orders", ["order_id"])],
                ),
                makeTable("table-2", "orders", [makeColumn("col-2", "order_id")]),
                makeTable(
                    "table-3",
                    "invoices",
                    [makeColumn("col-3", "invoice_id")],
                    [
                        makeForeignKey("fk-2", "FK_invoices_orders", ["invoice_id"], "orders", [
                            "order_id",
                        ]),
                    ],
                ),
            ],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const newForeignKeyIds = getNewForeignKeyIds(summary);

        expect(newForeignKeyIds.has("fk-1")).to.equal(true);
        expect(newForeignKeyIds.has("fk-2")).to.equal(true);
    });

    test("returns modified column details for name changes", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "id")])],
        };
        const updated: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "user_id")])],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const highlights = getModifiedColumnHighlights(summary);
        const highlight = highlights.get("col-1");

        expect(highlight).to.exist;
        expect(highlight?.nameChange?.oldValue).to.equal("id");
        expect(highlight?.nameChange?.newValue).to.equal("user_id");
        expect(highlight?.hasOtherChanges).to.equal(false);
    });

    test("returns modified column details for data type changes", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "id")])],
        };
        const updatedColumn = makeColumn("col-1", "id");
        updatedColumn.dataType = "bigint";
        const updated: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [updatedColumn])],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const highlights = getModifiedColumnHighlights(summary);
        const highlight = highlights.get("col-1");

        expect(highlight).to.exist;
        expect(highlight?.dataTypeChange?.oldValue).to.equal("int");
        expect(highlight?.dataTypeChange?.newValue).to.equal("bigint");
        expect(highlight?.hasOtherChanges).to.equal(false);
    });

    test("returns modified column details for other property changes", () => {
        const baseline: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [makeColumn("col-1", "id")])],
        };
        const updatedColumn = makeColumn("col-1", "id");
        updatedColumn.isNullable = false;
        const updated: sd.SchemaDesigner.Schema = {
            tables: [makeTable("table-1", "users", [updatedColumn])],
        };

        const summary = calculateSchemaDiff(baseline, updated);
        const highlights = getModifiedColumnHighlights(summary);
        const highlight = highlights.get("col-1");

        expect(highlight).to.exist;
        expect(highlight?.nameChange).to.equal(undefined);
        expect(highlight?.dataTypeChange).to.equal(undefined);
        expect(highlight?.hasOtherChanges).to.equal(true);
    });
});
