/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    type ObjectMetadata,
} from "../../../../src/index.ts";

const uri = "file:///github-definition-regressions.sql";

function object(
    id: string,
    database: string,
    schema: string,
    name: string,
    kind: ObjectMetadata["kind"],
): ObjectMetadata {
    return { ref: { id, database }, database, schema, name, kind };
}

function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "ApplicationDb", defaultSchema: "dbo" },
        databases: [{ name: "ApplicationDb" }, { name: "ArchiveDb" }],
        schemas: [
            { database: "ApplicationDb", name: "dbo" },
            { database: "ArchiveDb", name: "history" },
        ],
        objects: [
            object("customers", "ApplicationDb", "dbo", "Customers", "table"),
            object("active", "ApplicationDb", "dbo", "ActiveCustomers", "view"),
            object("rate", "ApplicationDb", "dbo", "fn_Rate", "scalarFunction"),
            object("rows", "ApplicationDb", "dbo", "fn_Rows", "tableFunction"),
            object("refresh", "ApplicationDb", "dbo", "usp_Refresh", "procedure"),
            object("code", "ApplicationDb", "dbo", "OrderCode", "type"),
            object("archive-orders", "ArchiveDb", "history", "Orders2024", "table"),
        ],
    });
}

async function open(sql: string) {
    const provider = metadata();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    await runtime.open(uri, 1, sql);
    return new TsqlLanguageFeatureService(runtime, provider);
}

suite("GitHub issue definition regressions", () => {
    test("resolves functions instead of their schema (vscode-mssql#1564, #21614; azuredatastudio#3248, #12030, #13311, #21597)", async () => {
        const sql = "SELECT dbo.fn_Rate(1);";
        const target = (await open(sql)).definitionTarget(uri, 1, sql.indexOf("fn_Rate") + 2);

        assert.deepEqual(target.object, {
            database: "ApplicationDb",
            schema: "dbo",
            name: "fn_Rate",
            kind: "scalarFunction",
        });
    });

    test("resolves stored procedures and views (vscode-mssql#648, #672, #776, #873, #17831, #18662; azuredatastudio#120)", async () => {
        const sql = "EXEC dbo.usp_Refresh; SELECT * FROM dbo.ActiveCustomers;";
        const features = await open(sql);

        assert.equal(
            features.definitionTarget(uri, 1, sql.indexOf("usp_Refresh") + 2).object?.kind,
            "procedure",
        );
        assert.equal(
            features.definitionTarget(uri, 1, sql.indexOf("ActiveCustomers") + 2).object?.kind,
            "view",
        );
    });

    test("resolves cross-database objects (vscode-mssql#1132; azuredatastudio#25032)", async () => {
        const sql = "SELECT * FROM ArchiveDb.history.Orders2024;";
        const target = (await open(sql)).definitionTarget(uri, 1, sql.indexOf("Orders2024") + 2);

        assert.deepEqual(target.object, {
            database: "ArchiveDb",
            schema: "history",
            name: "Orders2024",
            kind: "table",
        });
    });

    test("resolves names from any cursor position inside the identifier (vscode-mssql#741, #936)", async () => {
        const sql = "SELECT * FROM dbo.Customers;";
        const features = await open(sql);
        const start = sql.indexOf("Customers");

        for (const offset of [start, start + 3, start + "Customers".length - 1]) {
            assert.equal(features.definitionTarget(uri, 1, offset).object?.name, "Customers");
        }
    });

    test("resolves a local temp-table use to its declaration (azuredatastudio#21648)", async () => {
        const sql = "CREATE TABLE #work (Id int); SELECT * FROM #work;";
        const features = await open(sql);
        const use = sql.lastIndexOf("#work");

        assert.deepEqual(features.definition(uri, 1, use + 1), [
            { uri, range: { start: sql.indexOf("#work"), end: sql.indexOf("#work") + 5 } },
        ]);
    });

    test("resolves user-defined types and table-valued functions (vscode-mssql#1126)", async () => {
        const sql = `
DECLARE @code dbo.OrderCode;
SELECT * FROM dbo.fn_Rows();
`;
        const features = await open(sql);

        assert.equal(
            features.definitionTarget(uri, 1, sql.indexOf("OrderCode") + 2).object?.kind,
            "type",
        );
        assert.equal(
            features.definitionTarget(uri, 1, sql.indexOf("fn_Rows") + 2).object?.kind,
            "tableFunction",
        );
    });

    test("resolves objects after a USE database statement (vscode-mssql#21160)", async () => {
        const sql = "USE ArchiveDb; SELECT * FROM history.Orders2024;";
        const target = (await open(sql)).definitionTarget(uri, 1, sql.indexOf("Orders2024") + 2);

        assert.deepEqual(target.object, {
            database: "ArchiveDb",
            schema: "history",
            name: "Orders2024",
            kind: "table",
        });
    });
});
