/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { TableMigrationService } from "../../src/sourceControl/tableMigrationService";

suite("TableMigrationService Tests", () => {
    let service: TableMigrationService;

    setup(() => {
        service = new TableMigrationService({ includeComments: false });
    });

    suite("End-to-End Migration Script Generation", () => {
        test("should generate migration script for added column", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Name] NVARCHAR(100) NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Name] NVARCHAR(100) NULL,
                    [Email] VARCHAR(255) NOT NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include(
                "ALTER TABLE [dbo].[Users] ADD [Email] VARCHAR(255) NOT NULL",
            );
        });

        test("should generate migration script for removed column", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [OldColumn] VARCHAR(50) NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("ALTER TABLE [dbo].[Users] DROP COLUMN [OldColumn]");
        });

        test("should generate migration script for modified column", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Age] INT NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Age] BIGINT NOT NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include(
                "ALTER TABLE [dbo].[Users] ALTER COLUMN [Age] BIGINT NOT NULL",
            );
        });

        test("should generate migration script for added constraint", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id])
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("ADD CONSTRAINT [PK_Users]");
        });

        test("should generate migration script for added index", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL
                )
                GO
                CREATE INDEX [IX_Users_Email] ON [dbo].[Users] ([Email])
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("CREATE");
            expect(script).to.include("INDEX [IX_Users_Email]");
        });
    });

    suite("Complex Schema Changes", () => {
        test("should handle multiple column changes", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [OldColumn] VARCHAR(50) NULL,
                    [Age] INT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Email] VARCHAR(255) NOT NULL,
                    [Age] BIGINT NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("DROP COLUMN [OldColumn]");
            expect(script).to.include("ADD [Email]");
            expect(script).to.include("ALTER COLUMN [Age] BIGINT");
        });

        test("should handle table with constraints and indexes", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Orders] (
                    [OrderId] INT NOT NULL,
                    [UserId] INT NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Orders] (
                    [OrderId] INT NOT NULL,
                    [UserId] INT NOT NULL,
                    CONSTRAINT [PK_Orders] PRIMARY KEY ([OrderId]),
                    CONSTRAINT [FK_Orders_Users] FOREIGN KEY ([UserId]) REFERENCES [Users]([Id])
                )
                GO
                CREATE INDEX [IX_Orders_UserId] ON [dbo].[Orders] ([UserId])
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("ADD CONSTRAINT [PK_Orders]");
            expect(script).to.include("ADD CONSTRAINT [FK_Orders_Users]");
            expect(script).to.include("CREATE");
            expect(script).to.include("INDEX [IX_Orders_UserId]");
        });
    });

    suite("Data Loss Analysis", () => {
        test("should analyze data loss for dropped column", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [OldData] VARCHAR(100) NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);

            expect(summary.hasDataLoss).to.be.true;
            expect(summary.droppedColumns).to.include("OldData");
        });

        test("should analyze data loss for column size reduction", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Name] VARCHAR(200) NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Name] VARCHAR(50) NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);

            expect(summary.hasDataLoss).to.be.true;
            expect(summary.modifiedColumns).to.have.lengthOf(1);
            expect(summary.modifiedColumns[0].name).to.equal("Name");
        });

        test("should not report data loss for safe changes", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Age] INT NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Age] BIGINT NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);

            expect(summary.hasDataLoss).to.be.false;
        });
    });

    suite("Data Loss Summary Formatting", () => {
        test("should format summary for dropped columns", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Col1] VARCHAR(50) NULL,
                    [Col2] INT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);
            const formatted = service.formatDataLossSummary(summary);

            expect(formatted).to.include("Dropped columns");
            expect(formatted).to.include("Col1");
            expect(formatted).to.include("Col2");
        });

        test("should format summary for modified columns", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Name] VARCHAR(200) NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Name] VARCHAR(50) NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);
            const formatted = service.formatDataLossSummary(summary);

            expect(formatted).to.include("Modified columns");
            expect(formatted).to.include("Name");
            expect(formatted).to.include("VARCHAR(200)");
            expect(formatted).to.include("VARCHAR(50)");
        });

        test("should format summary for dropped constraints", () => {
            const databaseSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL,
                    CONSTRAINT [UQ_Users_Email] UNIQUE ([Email])
                )
            `;

            const gitSQL = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL
                )
            `;

            const summary = service.analyzeDataLoss(databaseSQL, gitSQL);
            const formatted = service.formatDataLossSummary(summary);

            expect(formatted).to.include("Dropped constraints");
            expect(formatted).to.include("UQ_Users_Email");
        });
    });

    suite("Edge Cases", () => {
        test("should handle identical schemas", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Name] NVARCHAR(100) NULL
                )
            `;

            const script = service.generateMigrationScript(sql, sql);

            // Should generate empty or minimal script
            expect(script.trim().length).to.be.lessThan(100);
        });

        test("should handle tables with comments", () => {
            const databaseSQL = `
                -- This is a comment
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL -- ID column
                )
            `;

            const gitSQL = `
                /* Multi-line comment */
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Email] VARCHAR(255) NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("ADD [Email]");
        });

        test("should handle different schema names", () => {
            const databaseSQL = `
                CREATE TABLE [sales].[Orders] (
                    [OrderId] INT NOT NULL
                )
            `;

            const gitSQL = `
                CREATE TABLE [sales].[Orders] (
                    [OrderId] INT NOT NULL,
                    [Total] DECIMAL(10,2) NOT NULL
                )
            `;

            const script = service.generateMigrationScript(databaseSQL, gitSQL);

            expect(script).to.include("[sales].[Orders]");
            expect(script).to.include("ADD [Total]");
        });
    });
});
