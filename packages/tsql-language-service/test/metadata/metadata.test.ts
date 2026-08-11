/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DatabaseMetadataLoader,
    MetadataAnalysisCatalogAdapter,
    MetadataCatalogSnapshot,
    MetadataRepository,
    type SqlMetadataLoader,
    type SqlQueryColumn,
    type SqlQueryExecutor,
} from "../../src/metadata";
import { parseSqlServerConnectionString } from "../../src/metadata/connectionString";

describe("metadata layer", () => {
    test("parses SQL-password connection strings without exposing secrets", () => {
        const configuration = parseSqlServerConnectionString(
            "Data Source=localhost,1444;User ID=test-user;Password=test-secret;" +
                "Encrypt=True;Trust Server Certificate=True;Authentication=SqlPassword",
        );

        expect(configuration).toMatchObject({
            server: "localhost",
            authentication: {
                type: "default",
                options: { userName: "test-user", password: "test-secret" },
            },
            options: { port: 1444, encrypt: true, trustServerCertificate: true },
        });
    });

    test("loads normalized objects through an executor strategy", async () => {
        let metadataQuery = "";
        const executor: SqlQueryExecutor = {
            execute: async (sql, mapRow) => {
                metadataQuery = sql;
                return rows
                    .map((row) =>
                        mapRow(
                            Object.entries(row).map(
                                ([name, value]): SqlQueryColumn => ({
                                    name,
                                    value,
                                }),
                            ),
                        ),
                    )
                    .filter((value) => value !== undefined);
            },
        };
        const loader = new DatabaseMetadataLoader(executor);
        const result = await loader.load();
        const catalog = new MetadataCatalogSnapshot(7, result);

        expect(catalog.resolve(["dbo", "Customers"])).toMatchObject({
            kind: "table",
            columns: [
                { name: "CustomerId", type: "int", nullable: false, ordinal: 1 },
                { name: "Name", type: "nvarchar(120)", nullable: true, ordinal: 2 },
            ],
        });
        expect(catalog.resolve(["TESTDB", "DBO", "CUSTOMERS"])).toBeDefined();
        expect(catalog.search(["cust"])).toHaveLength(1);
        expect(catalog.resolve(["dbo", "PhoneNumber"])).toMatchObject({
            kind: "type",
            typeKind: "alias",
            baseType: "nvarchar(24)",
        });
        expect(catalog.resolve(["sales", "OrderLine"])).toMatchObject({
            kind: "type",
            typeKind: "table",
            columns: [{ name: "OrderId", type: "int", nullable: false, ordinal: 1 }],
        });
        expect(catalog.resolve(["dbo", "InvoiceSchemaCollection"])).toMatchObject({
            kind: "type",
            typeKind: "xmlSchema",
        });
        expect(metadataQuery).toContain(
            "o.is_ms_shipped = 0 OR s.name IN (N'sys', N'INFORMATION_SCHEMA')",
        );
        expect(metadataQuery).toContain("FROM sys.all_objects AS o");
        expect(metadataQuery).toContain("FROM sys.all_columns AS c");
        expect(metadataQuery).toContain("FROM sys.all_parameters AS p");
        expect(metadataQuery).toContain("FROM sys.types AS t");
        expect(metadataQuery).toContain("LEFT JOIN sys.table_types AS tt");
    });

    test("preserves relation and type metadata that share a schema-qualified name", async () => {
        const overlappingRows = [
            {
                database_name: "TestDb",
                schema_name: "dbo",
                object_name: "SharedName",
                object_type: "U",
                member_kind: "column",
                member_name: "Id",
                type_name: "int",
                is_nullable: false,
                ordinal: 1,
                is_output: false,
                synonym_target: null,
                type_kind: null,
                base_type: null,
            },
            {
                database_name: "TestDb",
                schema_name: "dbo",
                object_name: "SharedName",
                object_type: "TYPE",
                member_kind: "object",
                member_name: null,
                type_name: null,
                is_nullable: null,
                ordinal: null,
                is_output: false,
                synonym_target: null,
                type_kind: "alias",
                base_type: "int",
            },
        ];
        const loader = new DatabaseMetadataLoader({
            execute: async (_sql, mapRow) =>
                overlappingRows
                    .map((row) =>
                        mapRow(Object.entries(row).map(([name, value]) => ({ name, value }))),
                    )
                    .filter((value) => value !== undefined),
        });
        const result = await loader.load();
        const catalog = new MetadataCatalogSnapshot(1, result);
        const analysisCatalog = new MetadataAnalysisCatalogAdapter(catalog);

        expect(result.objects).toHaveLength(2);
        expect(catalog.resolve(["dbo", "SharedName"])?.kind).toBe("table");
        expect(analysisCatalog.typeCandidates(["dbo", "Shared"])).toEqual([
            expect.objectContaining({ kind: "type", typeKind: "alias", baseType: "int" }),
        ]);
    });

    test("deduplicates concurrent repository refreshes", async () => {
        let calls = 0;
        const loader: SqlMetadataLoader = {
            load: async () => {
                calls++;
                await Promise.resolve();
                return { database: "TestDb", objects: [] };
            },
        };
        const repository = new MetadataRepository(loader);

        const [first, second] = await Promise.all([repository.refresh(), repository.refresh()]);

        expect(first).toBe(second);
        expect(calls).toBe(1);
    });
});

const rows = [
    {
        database_name: "TestDb",
        schema_name: "dbo",
        object_name: "Customers",
        object_type: "U",
        member_kind: "column",
        member_name: "CustomerId",
        type_name: "int",
        is_nullable: false,
        ordinal: 1,
        is_output: false,
        synonym_target: null,
    },
    {
        database_name: "TestDb",
        schema_name: "dbo",
        object_name: "Customers",
        object_type: "U",
        member_kind: "column",
        member_name: "Name",
        type_name: "nvarchar(120)",
        is_nullable: true,
        ordinal: 2,
        is_output: false,
        synonym_target: null,
    },
    {
        database_name: "TestDb",
        schema_name: "dbo",
        object_name: "PhoneNumber",
        object_type: "TYPE",
        member_kind: "object",
        member_name: null,
        type_name: null,
        is_nullable: null,
        ordinal: null,
        is_output: false,
        synonym_target: null,
        type_kind: "alias",
        base_type: "nvarchar(24)",
    },
    {
        database_name: "TestDb",
        schema_name: "sales",
        object_name: "OrderLine",
        object_type: "TYPE",
        member_kind: "column",
        member_name: "OrderId",
        type_name: "int",
        is_nullable: false,
        ordinal: 1,
        is_output: false,
        synonym_target: null,
        type_kind: "table",
        base_type: null,
    },
    {
        database_name: "TestDb",
        schema_name: "dbo",
        object_name: "InvoiceSchemaCollection",
        object_type: "TYPE",
        member_kind: "object",
        member_name: null,
        type_name: null,
        is_nullable: null,
        ordinal: null,
        is_output: false,
        synonym_target: null,
        type_kind: "xmlSchema",
        base_type: null,
    },
];
