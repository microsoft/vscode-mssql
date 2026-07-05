/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The standard test catalog (design 05 §17.2 WideWorldImporters-like shape):
 * a small Sales schema with an FK pair (incl. a composite key), a procedure
 * with parameters, a view, a TVF, and a synonym. Shared by fourslash suites
 * and provider-equivalence tests so expectations stay comparable across
 * providers.
 */

import { FixtureCatalogSpec } from "../provider/fixtureProvider";

export const STANDARD_FIXTURE_CATALOG: FixtureCatalogSpec = {
    databases: ["FixtureDb", "master", "tempdb"],
    env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: false },
    objects: [
        {
            schema: "Sales",
            name: "Orders",
            kind: "table",
            columns: [
                { name: "OrderID", typeDisplay: "int", nullable: false, isPrimaryKey: true },
                { name: "CustomerID", typeDisplay: "int", nullable: false },
                { name: "OrderDate", typeDisplay: "datetime2(7)", nullable: false },
                { name: "Comments", typeDisplay: "nvarchar(max)", nullable: true },
            ],
        },
        {
            schema: "Sales",
            name: "Customers",
            kind: "table",
            columns: [
                { name: "CustomerID", typeDisplay: "int", nullable: false, isPrimaryKey: true },
                { name: "CustomerName", typeDisplay: "nvarchar(100)", nullable: false },
            ],
        },
        {
            schema: "Sales",
            name: "OrderLines",
            kind: "table",
            columns: [
                { name: "OrderID", typeDisplay: "int", nullable: false, isPrimaryKey: true },
                { name: "LineNumber", typeDisplay: "int", nullable: false, isPrimaryKey: true },
                { name: "Quantity", typeDisplay: "int", nullable: false },
            ],
        },
        {
            schema: "dbo",
            name: "Orders",
            kind: "table",
            columns: [{ name: "LegacyID", typeDisplay: "int", nullable: false }],
        },
        {
            schema: "Sales",
            name: "vOrderSummary",
            kind: "view",
            columns: [
                { name: "OrderID", typeDisplay: "int", nullable: false },
                { name: "CustomerName", typeDisplay: "nvarchar(100)", nullable: false },
            ],
        },
        {
            schema: "Sales",
            name: "GetOrders",
            kind: "procedure",
            parameters: [
                { ordinal: 1, name: "@CustomerID", typeDisplay: "int", isOutput: false },
                { ordinal: 2, name: "@Since", typeDisplay: "datetime2(7)", isOutput: false },
                { ordinal: 3, name: "@Total", typeDisplay: "money", isOutput: true },
            ],
            definition:
                "CREATE PROCEDURE Sales.GetOrders @CustomerID int, @Since datetime2(7), @Total money OUTPUT\nAS\nSELECT 1;",
        },
        {
            schema: "dbo",
            name: "OrdersByCustomer",
            kind: "tableFunction",
            parameters: [{ ordinal: 1, name: "@CustomerID", typeDisplay: "int", isOutput: false }],
            columns: [{ name: "OrderID", typeDisplay: "int", nullable: false }],
        },
        { schema: "dbo", name: "OrdersSynonym", kind: "synonym" },
    ],
    foreignKeys: [
        {
            name: "FK_Orders_Customers",
            from: "Sales.Orders",
            to: "Sales.Customers",
            columns: [{ fromColumn: "CustomerID", toColumn: "CustomerID" }],
        },
        {
            name: "FK_OrderLines_Orders",
            from: "Sales.OrderLines",
            to: "Sales.Orders",
            columns: [{ fromColumn: "OrderID", toColumn: "OrderID" }],
        },
    ],
};
