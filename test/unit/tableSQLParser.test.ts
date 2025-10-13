/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { TableSQLParser } from "../../src/sourceControl/tableSQLParser";

suite("TableSQLParser Tests", () => {
    let parser: TableSQLParser;

    setup(() => {
        parser = new TableSQLParser();
    });

    suite("Basic Table Parsing", () => {
        test("should parse simple table with basic columns", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    [Name] NVARCHAR(100) NULL,
                    [Email] VARCHAR(255) NOT NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Users");
            expect(schema.schema).to.equal("dbo");
            expect(schema.columns).to.have.lengthOf(3);

            expect(schema.columns[0].name).to.equal("Id");
            expect(schema.columns[0].dataType).to.equal("INT");
            expect(schema.columns[0].nullable).to.be.false;

            expect(schema.columns[1].name).to.equal("Name");
            expect(schema.columns[1].dataType).to.equal("NVARCHAR(100)");
            expect(schema.columns[1].nullable).to.be.true;

            expect(schema.columns[2].name).to.equal("Email");
            expect(schema.columns[2].dataType).to.equal("VARCHAR(255)");
            expect(schema.columns[2].nullable).to.be.false;
        });

        test("should parse table without schema prefix", () => {
            const sql = `
                CREATE TABLE Users (
                    [Id] INT NOT NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Users");
            expect(schema.schema).to.equal("dbo");
        });

        test("should parse table with custom schema", () => {
            const sql = `
                CREATE TABLE [sales].[Orders] (
                    [OrderId] INT NOT NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Orders");
            expect(schema.schema).to.equal("sales");
        });
    });

    suite("Column Parsing", () => {
        test("should parse identity columns", () => {
            const sql = `
                CREATE TABLE [dbo].[Products] (
                    [Id] INT IDENTITY(1,1) NOT NULL,
                    [Name] NVARCHAR(100) NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.columns[0].identity).to.exist;
            expect(schema.columns[0].identity?.seed).to.equal(1);
            expect(schema.columns[0].identity?.increment).to.equal(1);
        });

        test("should parse columns with default values", () => {
            const sql = `
                CREATE TABLE [dbo].[Settings] (
                    [IsActive] BIT NOT NULL DEFAULT 1,
                    [CreatedDate] DATETIME NOT NULL DEFAULT GETDATE()
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.columns[0].defaultValue).to.equal("1");
            expect(schema.columns[1].defaultValue).to.equal("GETDATE()");
        });

        test("should parse various data types", () => {
            const sql = `
                CREATE TABLE [dbo].[DataTypes] (
                    [IntCol] INT NULL,
                    [BigIntCol] BIGINT NULL,
                    [DecimalCol] DECIMAL(10,2) NULL,
                    [VarcharCol] VARCHAR(50) NULL,
                    [NVarcharCol] NVARCHAR(MAX) NULL,
                    [DateCol] DATE NULL,
                    [DateTimeCol] DATETIME2(7) NULL,
                    [BitCol] BIT NULL,
                    [UniqueIdCol] UNIQUEIDENTIFIER NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.columns).to.have.lengthOf(9);
            expect(schema.columns[0].dataType).to.equal("INT");
            expect(schema.columns[1].dataType).to.equal("BIGINT");
            expect(schema.columns[2].dataType).to.equal("DECIMAL(10,2)");
            expect(schema.columns[3].dataType).to.equal("VARCHAR(50)");
            expect(schema.columns[4].dataType).to.equal("NVARCHAR(MAX)");
            expect(schema.columns[5].dataType).to.equal("DATE");
            expect(schema.columns[6].dataType).to.equal("DATETIME2(7)");
            expect(schema.columns[7].dataType).to.equal("BIT");
            expect(schema.columns[8].dataType).to.equal("UNIQUEIDENTIFIER");
        });
    });

    suite("Constraint Parsing", () => {
        test("should parse primary key constraint", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL,
                    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id])
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.constraints).to.have.lengthOf(1);
            expect(schema.constraints[0].name).to.equal("PK_Users");
            expect(schema.constraints[0].type).to.equal("PRIMARY KEY");
            expect(schema.constraints[0].clustered).to.be.true;
            expect(schema.constraints[0].columns).to.deep.equal(["Id"]);
        });

        test("should parse foreign key constraint", () => {
            const sql = `
                CREATE TABLE [dbo].[Orders] (
                    [OrderId] INT NOT NULL,
                    [UserId] INT NOT NULL,
                    CONSTRAINT [FK_Orders_Users] FOREIGN KEY ([UserId]) REFERENCES [dbo].[Users]([Id])
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.constraints).to.have.lengthOf(1);
            expect(schema.constraints[0].name).to.equal("FK_Orders_Users");
            expect(schema.constraints[0].type).to.equal("FOREIGN KEY");
            expect(schema.constraints[0].definition).to.include("REFERENCES");
        });

        test("should parse unique constraint", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL,
                    CONSTRAINT [UQ_Users_Email] UNIQUE ([Email])
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.constraints).to.have.lengthOf(1);
            expect(schema.constraints[0].name).to.equal("UQ_Users_Email");
            expect(schema.constraints[0].type).to.equal("UNIQUE");
        });

        test("should parse check constraint", () => {
            const sql = `
                CREATE TABLE [dbo].[Products] (
                    [Price] DECIMAL(10,2) NOT NULL,
                    CONSTRAINT [CK_Products_Price] CHECK ([Price] > 0)
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.constraints).to.have.lengthOf(1);
            expect(schema.constraints[0].name).to.equal("CK_Products_Price");
            expect(schema.constraints[0].type).to.equal("CHECK");
        });

        test("should parse multiple constraints", () => {
            const sql = `
                CREATE TABLE [dbo].[Orders] (
                    [OrderId] INT NOT NULL,
                    [UserId] INT NOT NULL,
                    [Total] DECIMAL(10,2) NOT NULL,
                    CONSTRAINT [PK_Orders] PRIMARY KEY ([OrderId]),
                    CONSTRAINT [FK_Orders_Users] FOREIGN KEY ([UserId]) REFERENCES [Users]([Id]),
                    CONSTRAINT [CK_Orders_Total] CHECK ([Total] >= 0)
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.constraints).to.have.lengthOf(3);
        });
    });

    suite("Index Parsing", () => {
        test("should parse clustered index", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
                GO
                CREATE CLUSTERED INDEX [IX_Users_Id] ON [dbo].[Users] ([Id])
            `;

            const schema = parser.parse(sql);

            expect(schema.indexes).to.have.lengthOf(1);
            expect(schema.indexes[0].name).to.equal("IX_Users_Id");
            expect(schema.indexes[0].type).to.equal("CLUSTERED");
            expect(schema.indexes[0].unique).to.be.false;
            expect(schema.indexes[0].columns).to.deep.equal(["Id"]);
        });

        test("should parse nonclustered index", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL
                )
                GO
                CREATE NONCLUSTERED INDEX [IX_Users_Email] ON [dbo].[Users] ([Email])
            `;

            const schema = parser.parse(sql);

            expect(schema.indexes).to.have.lengthOf(1);
            expect(schema.indexes[0].type).to.equal("NONCLUSTERED");
        });

        test("should parse unique index", () => {
            const sql = `
                CREATE TABLE [dbo].[Users] (
                    [Email] VARCHAR(255) NOT NULL
                )
                GO
                CREATE UNIQUE INDEX [UX_Users_Email] ON [dbo].[Users] ([Email])
            `;

            const schema = parser.parse(sql);

            expect(schema.indexes).to.have.lengthOf(1);
            expect(schema.indexes[0].unique).to.be.true;
        });

        test("should parse composite index", () => {
            const sql = `
                CREATE TABLE [dbo].[Orders] (
                    [UserId] INT NOT NULL,
                    [OrderDate] DATETIME NOT NULL
                )
                GO
                CREATE INDEX [IX_Orders_UserId_OrderDate] ON [dbo].[Orders] ([UserId], [OrderDate])
            `;

            const schema = parser.parse(sql);

            expect(schema.indexes).to.have.lengthOf(1);
            expect(schema.indexes[0].columns).to.deep.equal(["UserId", "OrderDate"]);
        });
    });

    suite("SQL Cleaning", () => {
        test("should remove single-line comments", () => {
            const sql = `
                -- This is a comment
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL -- ID column
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Users");
        });

        test("should remove multi-line comments", () => {
            const sql = `
                /*
                 * This is a multi-line comment
                 * describing the table
                 */
                CREATE TABLE [dbo].[Users] (
                    [Id] INT NOT NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Users");
        });

        test("should handle extra whitespace", () => {
            const sql = `
                CREATE    TABLE    [dbo].[Users]    (
                    [Id]    INT    NOT    NULL
                )
            `;

            const schema = parser.parse(sql);

            expect(schema.name).to.equal("Users");
            expect(schema.columns).to.have.lengthOf(1);
        });
    });
});
