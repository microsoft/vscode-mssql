/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildSchemaContextFromRawPayload,
    extractSchemaContextRelevanceTerms,
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    RawSchemaObject,
    selectSchemaContextForPrompt,
} from "../../src/copilot/completionSchemaContextCore";
import { InlineCompletionDebugSchemaContextOverrides } from "../../src/sharedInterfaces/inlineCompletionDebug";

// AdventureWorks-shaped joins, with enough similarly named tables to exhaust the
// detail budget. A product/customer question needs three connecting tables.
function purchaseTables(): RawSchemaObject[] {
    return [
        {
            schema: "Production",
            name: "Product",
            columns: [{ name: "ProductID", isPrimaryKey: true }, { name: "Name" }],
        },
        {
            schema: "Sales",
            name: "Customer",
            columns: [{ name: "CustomerID", isPrimaryKey: true }, { name: "Name" }],
        },
        {
            schema: "Sales",
            name: "SalesOrderHeader",
            columns: [
                { name: "SalesOrderID", isPrimaryKey: true },
                { name: "CustomerID" },
                { name: "OrderDate" },
            ],
            foreignKeys: [
                {
                    column: "CustomerID",
                    referencedTable: "Sales.Customer",
                    referencedColumn: "CustomerID",
                },
            ],
        },
        {
            schema: "Sales",
            name: "SalesOrderDetail",
            columns: [{ name: "SalesOrderID" }, { name: "ProductID" }, { name: "SpecialOfferID" }],
            foreignKeys: [
                {
                    column: "SalesOrderID",
                    referencedTable: "Sales.SalesOrderHeader",
                    referencedColumn: "SalesOrderID",
                },
                {
                    column: "ProductID",
                    referencedTable: "Sales.SpecialOfferProduct",
                    referencedColumn: "ProductID",
                },
                {
                    column: "SpecialOfferID",
                    referencedTable: "Sales.SpecialOfferProduct",
                    referencedColumn: "SpecialOfferID",
                },
            ],
        },
        {
            schema: "Sales",
            name: "SpecialOfferProduct",
            columns: [{ name: "ProductID" }, { name: "SpecialOfferID" }],
            foreignKeys: [
                {
                    column: "ProductID",
                    referencedTable: "Production.Product",
                    referencedColumn: "ProductID",
                },
            ],
        },
        ...Array.from({ length: 15 }, (_, i) => ({
            schema: "Production",
            name: `ProductExtra${i}`,
            columns: [{ name: "ProductID" }, { name: "Name" }],
            foreignKeys: [
                {
                    column: "ProductID",
                    referencedTable: "Production.Product",
                    referencedColumn: "ProductID",
                },
            ],
        })),
    ];
}

function selectPurchases(
    overrides: InlineCompletionDebugSchemaContextOverrides = {},
    tables = purchaseTables(),
) {
    const settings = getSqlInlineCompletionSchemaContextRuntimeSettings(undefined, overrides);
    const full = buildSchemaContextFromRawPayload(
        { defaultSchema: "dbo", tables },
        settings.budget,
    )!;
    const original = JSON.stringify(full);
    const terms = extractSchemaContextRelevanceTerms(
        "-- which customers bought which products in the past three months?",
        settings.budget,
    );
    const context = selectSchemaContextForPrompt(full, terms, settings)!;
    expect(JSON.stringify(full)).to.equal(original);
    return { context, settings };
}

suite("Completion schema join selection", () => {
    test("balanced context includes the complete purchase join and date columns", () => {
        const { context, settings } = selectPurchases();
        expect(context.tables.map((table) => table.name)).to.include.members([
            "Production.Product",
            "Sales.Customer",
            "Sales.SalesOrderHeader",
            "Sales.SalesOrderDetail",
            "Sales.SpecialOfferProduct",
        ]);
        expect(
            context.tables.find((table) => table.name === "Sales.SalesOrderHeader")?.columns,
        ).to.include.members(["SalesOrderID", "CustomerID", "OrderDate"]);
        expect(
            context.tables.find((table) => table.name === "Sales.SalesOrderDetail")?.columns,
        ).to.include.members(["SalesOrderID", "ProductID", "SpecialOfferID"]);
        expect(context.tables).to.have.length(settings.budget.maxTables);
        expect(JSON.stringify(context).length).to.be.at.most(settings.budget.maxPromptChars);
        expect(context).to.deep.equal(selectPurchases().context);
    });

    test("tables displaced by join expansion remain in the names-only inventory", () => {
        const { context } = selectPurchases();
        const names = [
            ...context.tables.map((table) => table.name),
            ...context.tableNameOnlyInventory!,
        ];
        expect(names).to.have.members(
            purchaseTables().map((table) => `${table.schema}.${table.name}`),
        );
        expect(new Set(names).size).to.equal(names.length);
    });

    test("disabled expansion does not force a connecting path into the prompt", () => {
        const { context } = selectPurchases({ budgetOverrides: { foreignKeyExpansionDepth: 0 } });
        expect(context.tables.map((table) => table.name)).not.to.include("Sales.SalesOrderHeader");
        expect(context.tables.map((table) => table.name)).not.to.include("Sales.SalesOrderDetail");
    });

    test("one-hop expansion does not traverse a four-edge purchase path", () => {
        const { context } = selectPurchases({ budgetOverrides: { foreignKeyExpansionDepth: 1 } });
        expect(context.tables.map((table) => table.name)).not.to.include("Sales.SalesOrderDetail");
    });

    test("a small expansion cap keeps the detail limit and cannot add a whole purchase path", () => {
        const { context } = selectPurchases({
            budgetOverrides: { maxTables: 4, foreignKeyExpansionObjectCap: 1 },
        });
        expect(context.tables).to.have.length(4);
        expect(context.tables.map((table) => table.name)).not.to.include("Sales.SalesOrderDetail");
    });

    test("missing foreign keys never cause inferred joins or invented schema", () => {
        const tables = purchaseTables().map((table) => ({ ...table, foreignKeys: [] }));
        const { context } = selectPurchases({}, tables);
        expect(context.tables.map((table) => table.name)).not.to.include("Sales.SalesOrderHeader");
        expect(context.tables.every((table) => !table.foreignKeys?.length)).to.equal(true);
    });

    test("cycles and foreign keys to unavailable tables do not prevent a complete known join", () => {
        const tables = purchaseTables();
        tables[0].foreignKeys = [
            {
                column: "ProductID",
                referencedTable: "Production.Product",
                referencedColumn: "ProductID",
            },
            {
                column: "ProductID",
                referencedTable: "Production.Unavailable",
                referencedColumn: "ProductID",
            },
        ];
        const { context } = selectPurchases({}, tables);
        const names = context.tables.map((table) => table.name);
        expect(names).to.include.members(["Sales.SalesOrderHeader", "Sales.SalesOrderDetail"]);
        expect(names).not.to.include("Production.Unavailable");
        expect(new Set(names).size).to.equal(names.length);
    });
});
