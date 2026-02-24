/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import {
    createSchemaDesignerIndex,
    getColumnById,
    getColumnByName,
    getForeignKeyById,
    getTableById,
    getTableByQualifiedName,
} from "../../src/reactviews/pages/SchemaDesigner/model/schemaDesignerIndexing";

suite("SchemaDesigner indexing", () => {
    function buildSchema(): SchemaDesigner.Schema {
        const customersTable: SchemaDesigner.Table = {
            id: "table-customers",
            schema: "dbo",
            name: "Customers",
            columns: [
                {
                    id: "col-customer-id",
                    name: "CustomerId",
                    dataType: "int",
                    maxLength: "",
                    precision: 10,
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
        };

        const ordersTable: SchemaDesigner.Table = {
            id: "table-orders",
            schema: "Sales",
            name: "Orders",
            columns: [
                {
                    id: "col-order-id",
                    name: "OrderId",
                    dataType: "int",
                    maxLength: "",
                    precision: 10,
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
                    id: "col-order-customer-id",
                    name: "CustomerId",
                    dataType: "int",
                    maxLength: "",
                    precision: 10,
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
                    id: "fk-orders-customers",
                    name: "FK_Orders_Customers",
                    columnIds: ["col-order-customer-id"],
                    referencedTableId: "table-customers",
                    referencedColumnIds: ["col-customer-id"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        };

        return {
            tables: [customersTable, ordersTable],
        };
    }

    test("createSchemaDesignerIndex indexes tables, columns, and foreign keys", () => {
        const schema = buildSchema();
        const index = createSchemaDesignerIndex(schema);

        expect(index.tableById.size).to.equal(2);
        expect(index.columnByIdByTableId.get("table-orders")?.size).to.equal(2);
        expect(index.foreignKeyByIdByTableId.get("table-orders")?.size).to.equal(1);
    });

    test("getTableById returns table when present and undefined when missing", () => {
        const index = createSchemaDesignerIndex(buildSchema());

        expect(getTableById(index, "table-orders")?.name).to.equal("Orders");
        expect(getTableById(index, "missing-table")).to.equal(undefined);
    });

    test("getTableByQualifiedName is case-insensitive", () => {
        const index = createSchemaDesignerIndex(buildSchema());

        const resolved = getTableByQualifiedName(index, "sales", "orders");
        expect(resolved?.id).to.equal("table-orders");
        expect(getTableByQualifiedName(index, "missing", "orders")).to.equal(undefined);
    });

    test("getColumnById and getColumnByName resolve from table-scoped indexes", () => {
        const index = createSchemaDesignerIndex(buildSchema());

        expect(getColumnById(index, "table-orders", "col-order-id")?.name).to.equal("OrderId");
        expect(getColumnByName(index, "table-orders", "customerid")?.id).to.equal(
            "col-order-customer-id",
        );
        expect(getColumnByName(index, "table-orders", "missing-column")).to.equal(undefined);
    });

    test("getForeignKeyById returns FK for matching source table", () => {
        const index = createSchemaDesignerIndex(buildSchema());

        expect(getForeignKeyById(index, "table-orders", "fk-orders-customers")?.name).to.equal(
            "FK_Orders_Customers",
        );
        expect(getForeignKeyById(index, "table-customers", "fk-orders-customers")).to.equal(
            undefined,
        );
    });
});
