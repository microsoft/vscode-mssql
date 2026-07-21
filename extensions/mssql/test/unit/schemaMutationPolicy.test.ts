/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildTransactionalCreateTableSql,
    validateLocalCreateTableSql,
} from "../../src/runbookStudio/schemaMutationPolicy";

suite("schemaMutationPolicy", () => {
    test("accepts one bounded CREATE TABLE and returns a stable target identity", () => {
        const policy = validateLocalCreateTableSql(
            "CREATE TABLE dbo.RunLog (Id bigint NOT NULL PRIMARY KEY, Note nvarchar(100) NULL);",
        );

        expect(policy).to.include({
            schemaName: "dbo",
            tableName: "RunLog",
            qualifiedTableName: "dbo.RunLog",
        });
        expect(policy?.sqlSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("accepts quoted identifiers and harmless literals or comments", () => {
        const policy = validateLocalCreateTableSql(
            "/* reviewed */ CREATE TABLE [dev].[Run Log] ([Id] int, [Text] nvarchar(50) DEFAULT('DROP TABLE x')); -- done",
        );

        expect(policy).to.include({
            schemaName: "dev",
            tableName: "Run Log",
            qualifiedTableName: "dev.Run Log",
        });
    });

    test("refuses extra statements, server effects, cross-database names, and non-create DDL", () => {
        for (const sql of [
            "CREATE TABLE dbo.A (Id int); DROP TABLE dbo.B;",
            "CREATE TABLE OtherDb.dbo.A (Id int);",
            "CREATE TABLE dbo.A (Id int); EXEC xp_cmdshell 'whoami';",
            "CREATE EXTERNAL TABLE dbo.A (Id int) WITH (LOCATION = 'x');",
            "ALTER TABLE dbo.A ADD B int;",
            "CREATE TABLE dbo.A AS SELECT * FROM dbo.B;",
            "CREATE TABLE dbo.A ();",
            "CREATE TABLE dbo.A (Id int)\nGO\nDROP TABLE dbo.B;",
        ]) {
            expect(validateLocalCreateTableSql(sql), sql).to.equal(undefined);
        }
    });

    test("builds a host-authored transactional wrapper with existence evidence", () => {
        const policy = validateLocalCreateTableSql("CREATE TABLE dbo.RunLog (Id int NOT NULL)")!;
        const batch = buildTransactionalCreateTableSql(policy);

        expect(batch).to.include("SET XACT_ABORT ON");
        expect(batch).to.include("BEGIN TRANSACTION");
        expect(batch).to.include(policy.sql);
        expect(batch).to.include("OBJECT_ID(N'dbo.RunLog', N'U')");
        expect(batch).to.include("ROLLBACK TRANSACTION");
    });
});
