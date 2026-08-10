/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DatabaseMetadataLoader,
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
        const executor: SqlQueryExecutor = {
            execute: async (_sql, mapRow) =>
                rows
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
                    .filter((value) => value !== undefined),
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
];
