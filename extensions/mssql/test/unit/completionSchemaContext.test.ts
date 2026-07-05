/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MD-4 golden parity (B6): the catalog-backed schema-context bridge must
 * render byte-identical prompt text through the VERBATIM-ported selection
 * pipeline + provider formatter — connection header, PK-first column
 * definitions with PK/FK annotations, routine signatures, name-only
 * inventories past the detail caps, engine-gated curated system objects,
 * and deterministic repeat renders.
 */

import { expect } from "chai";
import { CatalogBuilder, CatalogSnapshot } from "../../src/services/metadata/catalogModel";
import { buildRawSchemaContextPayload } from "../../src/copilot/catalogSchemaContextPayload";
import {
    buildSchemaContextFromRawPayload,
    extractSchemaContextRelevanceTerms,
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    selectSchemaContextForPrompt,
    SqlInlineCompletionSchemaContext,
} from "../../src/copilot/completionSchemaContextCore";
import { formatSchemaContextForPrompt } from "../../src/copilot/sqlInlineCompletionProvider";
import {
    CompletionSchemaContextService,
    CompletionMetadataResolver,
} from "../../src/copilot/completionSchemaContextService";

function fixtureSnapshot(engineEdition: number | "unknown" = 5): CatalogSnapshot {
    const b = new CatalogBuilder();
    b.setEnvironment({
        // Explicit undefined would trigger the parameter default, so the
        // unknown-edition case travels as a sentinel.
        engineEdition: engineEdition === "unknown" ? undefined : engineEdition,
        defaultSchema: "dbo",
        collationName: "SQL_Latin1_General_CP1_CI_AS",
        caseSensitive: false,
    });
    b.addSchema(1, "dbo");
    b.addSchema(2, "sales");
    b.addObject(101, 1, "Orders", "table");
    b.addObject(102, 1, "Customers", "table");
    b.addObject(103, 1, "OrdersView", "view");
    b.addObject(104, 2, "Orders", "table");
    b.addObject(105, 1, "GetOrderTotals", "procedure");
    b.addObject(106, 1, "OrdersByCustomer", "tableFunction");
    b.addObject(107, 1, "OrderCount", "scalarFunction");
    b.addColumn(101, "OrderId", "int", false);
    b.addColumn(101, "CustomerId", "int", true);
    b.addColumn(101, "Total", "decimal(18,2)", true);
    b.addColumn(102, "CustomerId", "int", false);
    b.addColumn(102, "Name", "nvarchar(100)", false);
    b.addColumn(103, "OrderId", "int", true);
    b.addColumn(104, "OrderId", "int", false);
    b.addColumn(106, "OrderId", "int", true);
    b.markPrimaryKeyColumn(101, "OrderId");
    b.markPrimaryKeyColumn(102, "CustomerId");
    b.addForeignKey(101, 102, "FK_Orders_Customers", 900);
    b.addForeignKeyColumn(900, "CustomerId", "CustomerId");
    b.addParameter(105, 1, "@CustomerId", "int", false);
    b.addParameter(105, 2, "@Total", "decimal(18,2)", true);
    b.addParameter(106, 1, "@CustomerId", "int", false);
    b.addParameter(107, 0, "", "int", false);
    b.addParameter(107, 1, "@CustomerId", "int", false);
    return b.build(
        3,
        {
            schemas: "ready",
            objects: "ready",
            columns: "ready",
            keys: "ready",
            foreignKeys: "ready",
            parameters: "ready",
        },
        "full",
    );
}

function renderFixture(options?: {
    engineEdition?: number | "unknown";
    relevanceText?: string;
    overrides?: Record<string, unknown>;
}): { text: string; context: SqlInlineCompletionSchemaContext | undefined } {
    const snapshot = fixtureSnapshot(options?.engineEdition ?? 5);
    const settings = getSqlInlineCompletionSchemaContextRuntimeSettings(
        undefined,
        (options?.overrides as never) ?? {},
    );
    const payload = buildRawSchemaContextPayload(snapshot, settings.budget, {
        server: "srv",
        database: "Db1",
    });
    const full = buildSchemaContextFromRawPayload(payload, settings.budget);
    const terms = extractSchemaContextRelevanceTerms(
        options?.relevanceText ?? "SELECT * FROM Orders o JOIN Customers c ON o.",
        settings.budget,
    );
    const context = selectSchemaContextForPrompt(full, terms, settings);
    return { text: formatSchemaContextForPrompt(context, false), context };
}

suite("Completion schema context bridge (MD-4 golden parity)", () => {
    test("golden render: header, PK-first definitions with PK/FK annotations", () => {
        const { text } = renderFixture();
        const lines = text.split("\n");
        expect(lines[0]).to.equal(
            "-- connection: srv / Db1, default schema dbo, engine: Azure SQL Database",
        );
        expect(lines[1]).to.equal("-- inferred system query: no");
        expect(text).to.include("-- schemas (user): dbo, sales");
        expect(text).to.include(
            "TABLE dbo.Orders (OrderId int NOT NULL PK, CustomerId int FK->dbo.Customers.CustomerId, Total decimal(18,2))",
        );
        expect(text).to.include(
            "TABLE dbo.Customers (CustomerId int NOT NULL PK, Name nvarchar(100) NOT NULL)",
        );
        expect(text).to.include("TABLE sales.Orders (OrderId int NOT NULL)");
        expect(text).to.include("VIEW dbo.OrdersView (OrderId int)");
    });

    test("golden render: routine signatures (proc / TVF / scalar)", () => {
        const { text } = renderFixture();
        expect(text).to.include(
            "PROCEDURE dbo.GetOrderTotals(@CustomerId int, @Total decimal(18,2) OUTPUT)",
        );
        // Return columns render as names only (normalizeRoutines keeps
        // definitions separately in returnColumnDefinitions).
        expect(text).to.include(
            "TABLE FUNCTION dbo.OrdersByCustomer(@CustomerId int) RETURNS TABLE (OrderId)",
        );
        expect(text).to.include("SCALAR FUNCTION dbo.OrderCount(@CustomerId int) RETURNS int");
    });

    test("byte-identical determinism for repeated renders", () => {
        const first = renderFixture();
        const second = renderFixture();
        expect(first.text).to.equal(second.text);
    });

    test("system objects: engine-gated curated catalog; DMVs need a known edition", () => {
        const azure = renderFixture({ engineEdition: 5 });
        expect(azure.text).to.include("-- system catalog / DMVs available:");
        expect(azure.text).to.include(
            "sys.dm_exec_requests (session_id, request_id, status, command, database_id, blocking_session_id, wait_type, wait_time, cpu_time, total_elapsed_time, sql_handle, plan_handle)",
        );
        expect(azure.text).to.include("INFORMATION_SCHEMA.TABLES");

        const unknown = renderFixture({ engineEdition: "unknown" });
        expect(unknown.text).to.include("INFORMATION_SCHEMA.TABLES");
        expect(unknown.text).to.not.include("sys.dm_exec_requests");
        expect(unknown.text.split("\n")[0]).to.equal(
            "-- connection: srv / Db1, default schema dbo, engine: unknown",
        );
    });

    test("detail caps overflow into name-only inventories", () => {
        const { text } = renderFixture({
            overrides: {
                budgetOverrides: { maxFetchedTables: 1, maxTables: 1 },
            },
        });
        expect(text).to.include("-- user tables: detailed 1 of 3");
        expect(text).to.include("-- additional tables listed without columns");
        expect(text).to.match(/TABLE NAMES (dbo|sales) \(/);
    });

    test("relevance selection: mentioned objects rank ahead of unmentioned ones", () => {
        const { text } = renderFixture({
            relevanceText: "SELECT c.Name FROM Customers c WHERE",
        });
        const customersIndex = text.indexOf("TABLE dbo.Customers");
        const salesOrdersIndex = text.indexOf("TABLE sales.Orders");
        expect(customersIndex).to.be.greaterThan(-1);
        expect(salesOrdersIndex).to.be.greaterThan(-1);
        expect(customersIndex).to.be.lessThan(salesOrdersIndex);
    });

    test("empty catalog renders as unavailable", () => {
        expect(formatSchemaContextForPrompt(undefined, false)).to.equal("-- unavailable");
    });

    test("service: normalized context cached per generation, selection per call", async () => {
        const snapshot = fixtureSnapshot();
        let resolveCalls = 0;
        const resolver: CompletionMetadataResolver = {
            resolve: async () => {
                resolveCalls++;
                return {
                    snapshot,
                    generation: snapshot.generation,
                    facts: { server: "srv", database: "Db1" },
                    fingerprint: "test|srv|Db1",
                };
            },
        };
        const service = new CompletionSchemaContextService([resolver]);
        try {
            const document = {
                uri: { toString: () => "untitled:test.sql" },
                getText: () => "SELECT * FROM Orders",
            } as never;
            const first = await service.getSchemaContext(document, "SELECT * FROM Orders");
            const second = await service.getSchemaContext(document, "SELECT * FROM Customers");
            expect(first?.tables.map((t) => t.name)).to.include("dbo.Orders");
            expect(second?.tables.map((t) => t.name)).to.include("dbo.Customers");
            expect(resolveCalls).to.equal(2);
            expect(first?.selectionMetadata?.budgetProfile).to.equal("balanced");
        } finally {
            service.dispose();
        }
    });
});
