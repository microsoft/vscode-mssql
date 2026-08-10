/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SaralSqlAnalysisEngine } from "../../src/adapters";
import {
    DatabaseMetadataLoader,
    MetadataAnalysisCatalogAdapter,
    MetadataRepository,
} from "../../src/metadata";
import { parseSqlServerConnectionString } from "../../src/metadata/connectionString";
import { TediousQueryExecutor } from "../../src/metadata/tediousQueryExecutor";

const connectionString = process.env.MSSQL_TEST_CONNECTION_STRING;
const liveTest = connectionString ? test : test.skip;

describe("Tedious metadata integration", () => {
    liveTest("executes a query against the opt-in test server", async () => {
        const executor = new TediousQueryExecutor(
            parseSqlServerConnectionString(connectionString!),
        );
        const rows = await executor.execute(
            "SELECT value = CONVERT(int, 1), database_name = DB_NAME();",
            (columns) => Object.fromEntries(columns.map((column) => [column.name, column.value])),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ value: 1 });
        expect(typeof rows[0]?.database_name).toBe("string");
    });

    liveTest("loads live metadata and diagnoses a missing INSERT target", async () => {
        const executor = new TediousQueryExecutor(
            parseSqlServerConnectionString(connectionString!),
        );
        const repository = new MetadataRepository(new DatabaseMetadataLoader(executor));
        const metadata = await repository.load();
        const catalog = new MetadataAnalysisCatalogAdapter(metadata);
        const text = "INSERT INTO dbo.hhh (Name, CreatedDate) VALUES (NULL, NULL);";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog });

        expect(metadata.resolve(["dbo", "hhh"])).toBeUndefined();
        expect(snapshot.semanticDiagnostics).toContainEqual({
            kind: "semantic",
            code: "MSSQL208",
            message: "Invalid object name 'dbo.hhh'.",
            span: { start: text.indexOf("dbo.hhh"), end: text.indexOf("dbo.hhh") + 7 },
            severity: "error",
        });
    });
});
