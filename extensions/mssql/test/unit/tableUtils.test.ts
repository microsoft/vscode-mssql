/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants } from "../../src/reactviews/common/locConstants";
import { tableUtils } from "../../src/reactviews/pages/SchemaDesigner/model";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

suite("SchemaDesigner table utils", () => {
    function createTable(id: string, schemaName: string, name: string): SchemaDesigner.Table {
        return {
            id,
            schema: schemaName,
            name,
            columns: [],
            foreignKeys: [],
        };
    }

    test("getAllTables excludes current table by id", () => {
        const t1 = createTable("t1", "dbo", "Users");
        const t2 = createTable("t2", "dbo", "Orders");
        const schema: SchemaDesigner.Schema = { tables: [t1, t2] };

        const all = tableUtils.getAllTables(schema, t1);
        expect(all.map((t) => t.id)).to.deep.equal(["t2"]);
    });

    test("getTableFromDisplayName resolves schema-qualified names", () => {
        const users = createTable("t1", "dbo", "Users");
        const orders = createTable("t2", "sales", "Orders");
        const schema: SchemaDesigner.Schema = { tables: [users, orders] };

        const resolved = tableUtils.getTableFromDisplayName(schema, "sales.Orders");
        expect(resolved.id).to.equal("t2");
    });

    test("tableNameValidationError handles duplicates and empty names", () => {
        const existing = createTable("t1", "dbo", "Users");
        const schema: SchemaDesigner.Schema = { tables: [existing] };

        const duplicate = tableUtils.tableNameValidationError(
            schema,
            createTable("t2", "dbo", "users"),
        );
        expect(duplicate).to.equal(locConstants.schemaDesigner.tableNameRepeatedError("users"));

        const empty = tableUtils.tableNameValidationError(schema, createTable("t3", "dbo", ""));
        expect(empty).to.equal(locConstants.schemaDesigner.tableNameEmptyError);

        const valid = tableUtils.tableNameValidationError(
            schema,
            createTable("t4", "dbo", "Products"),
        );
        expect(valid).to.equal(undefined);
    });

    test("createNewTable creates default Id column and uses first schema", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [createTable("t1", "dbo", "table_1")],
        };

        const table = tableUtils.createNewTable(schema, ["sales", "dbo"]);

        expect(table.name).to.equal("table_2");
        expect(table.schema).to.equal("sales");
        expect(table.columns).to.have.length(1);

        const idColumn = table.columns[0];
        expect(idColumn.name).to.equal("Id");
        expect(idColumn.dataType).to.equal("int");
        expect(idColumn.isPrimaryKey).to.equal(true);
        expect(idColumn.isIdentity).to.equal(true);
        expect(idColumn.identitySeed).to.equal(1);
        expect(idColumn.identityIncrement).to.equal(1);
        expect(table.id).to.be.a("string").and.not.empty;
        expect(idColumn.id).to.be.a("string").and.not.empty;
    });
});
