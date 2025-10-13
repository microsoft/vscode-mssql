/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage of the Table Migration Service
 * This file demonstrates how to use the table migration functionality
 */

import { TableMigrationService } from "./tableMigrationService";

// Example 1: Simple column addition (no data loss)
function exampleAddColumn() {
    console.log("=== Example 1: Add Column (No Data Loss) ===\n");

    const databaseSQL = `
CREATE TABLE [dbo].[Users] (
    [UserId] INT NOT NULL IDENTITY(1,1),
    [Username] NVARCHAR(50) NOT NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([UserId] ASC)
)
`;

    const gitSQL = `
CREATE TABLE [dbo].[Users] (
    [UserId] INT NOT NULL IDENTITY(1,1),
    [Username] NVARCHAR(50) NOT NULL,
    [Email] NVARCHAR(100) NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([UserId] ASC)
)
`;

    const service = new TableMigrationService({
        includeDrop: true,
        includeComments: true,
    });

    // Analyze data loss
    const dataLoss = service.analyzeDataLoss(databaseSQL, gitSQL);
    console.log("Data Loss Analysis:");
    console.log(service.formatDataLossSummary(dataLoss));
    console.log();

    // Generate migration script
    const migrationScript = service.generateMigrationScript(databaseSQL, gitSQL);
    console.log("Migration Script:");
    console.log(migrationScript);
    console.log("\n");
}

// Example 2: Column removal (data loss)
function exampleDropColumn() {
    console.log("=== Example 2: Drop Column (Data Loss) ===\n");

    const databaseSQL = `
CREATE TABLE [dbo].[Products] (
    [ProductId] INT NOT NULL IDENTITY(1,1),
    [Name] NVARCHAR(100) NOT NULL,
    [LegacyCode] NVARCHAR(50) NULL,
    [Description] NVARCHAR(500) NULL,
    CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED ([ProductId] ASC)
)
`;

    const gitSQL = `
CREATE TABLE [dbo].[Products] (
    [ProductId] INT NOT NULL IDENTITY(1,1),
    [Name] NVARCHAR(100) NOT NULL,
    [Description] NVARCHAR(500) NULL,
    CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED ([ProductId] ASC)
)
`;

    const service = new TableMigrationService({
        includeDrop: true,
        includeComments: true,
    });

    // Analyze data loss
    const dataLoss = service.analyzeDataLoss(databaseSQL, gitSQL);
    console.log("Data Loss Analysis:");
    console.log(service.formatDataLossSummary(dataLoss));
    console.log();

    // Generate migration script
    const migrationScript = service.generateMigrationScript(databaseSQL, gitSQL);
    console.log("Migration Script:");
    console.log(migrationScript);
    console.log("\n");
}

// Example 3: Complex schema changes
function exampleComplexChanges() {
    console.log("=== Example 3: Complex Schema Changes ===\n");

    const databaseSQL = `
CREATE TABLE [dbo].[Orders] (
    [OrderId] INT NOT NULL IDENTITY(1,1),
    [CustomerId] INT NOT NULL,
    [OrderDate] DATETIME NOT NULL,
    [TotalAmount] DECIMAL(18,2) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [LegacyOrderNumber] NVARCHAR(50) NULL,
    CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderId] ASC),
    CONSTRAINT [FK_Orders_Customers] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customers]([CustomerId])
)
GO

CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] ([CustomerId] ASC)
GO

CREATE NONCLUSTERED INDEX [IX_Orders_LegacyOrderNumber] ON [dbo].[Orders] ([LegacyOrderNumber] ASC)
GO
`;

    const gitSQL = `
CREATE TABLE [dbo].[Orders] (
    [OrderId] INT NOT NULL IDENTITY(1,1),
    [CustomerId] INT NOT NULL,
    [OrderDate] DATETIME NOT NULL,
    [TotalAmount] DECIMAL(18,2) NOT NULL,
    [Status] NVARCHAR(50) NOT NULL,
    [ShippingAddress] NVARCHAR(500) NULL,
    CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderId] ASC),
    CONSTRAINT [FK_Orders_Customers] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customers]([CustomerId]),
    CONSTRAINT [UQ_Orders_OrderDate_CustomerId] UNIQUE ([OrderDate], [CustomerId])
)
GO

CREATE NONCLUSTERED INDEX [IX_Orders_CustomerId] ON [dbo].[Orders] ([CustomerId] ASC)
GO

CREATE NONCLUSTERED INDEX [IX_Orders_Status] ON [dbo].[Orders] ([Status] ASC)
GO
`;

    const service = new TableMigrationService({
        includeDrop: true,
        includeComments: true,
    });

    // Analyze data loss
    const dataLoss = service.analyzeDataLoss(databaseSQL, gitSQL);
    console.log("Data Loss Analysis:");
    console.log(service.formatDataLossSummary(dataLoss));
    console.log();

    // Generate migration script
    const migrationScript = service.generateMigrationScript(databaseSQL, gitSQL);
    console.log("Migration Script:");
    console.log(migrationScript);
    console.log("\n");
}

// Example 4: Get structured differences
function exampleGetDifferences() {
    console.log("=== Example 4: Get Structured Differences ===\n");

    const databaseSQL = `
CREATE TABLE [dbo].[Employees] (
    [EmployeeId] INT NOT NULL IDENTITY(1,1),
    [FirstName] NVARCHAR(50) NOT NULL,
    [LastName] NVARCHAR(50) NOT NULL,
    [Email] NVARCHAR(100) NOT NULL,
    [MiddleName] NVARCHAR(50) NULL,
    CONSTRAINT [PK_Employees] PRIMARY KEY CLUSTERED ([EmployeeId] ASC)
)
`;

    const gitSQL = `
CREATE TABLE [dbo].[Employees] (
    [EmployeeId] INT NOT NULL IDENTITY(1,1),
    [FirstName] NVARCHAR(50) NOT NULL,
    [LastName] NVARCHAR(50) NOT NULL,
    [Email] NVARCHAR(150) NOT NULL,
    [PhoneNumber] NVARCHAR(20) NULL,
    CONSTRAINT [PK_Employees] PRIMARY KEY CLUSTERED ([EmployeeId] ASC)
)
`;

    const service = new TableMigrationService();

    // Get structured differences
    const differences = service.getDifferences(databaseSQL, gitSQL);

    console.log("Column Differences:");
    differences.columnDifferences.forEach((diff) => {
        console.log(`  - ${diff.type.toUpperCase()}: ${diff.column.name}`);
        if (diff.type === "modified" && diff.oldColumn) {
            console.log(`    Old: ${diff.oldColumn.dataType}, New: ${diff.column.dataType}`);
        }
    });

    console.log("\nConstraint Differences:");
    differences.constraintDifferences.forEach((diff) => {
        console.log(`  - ${diff.type.toUpperCase()}: ${diff.constraint.name}`);
    });

    console.log("\nIndex Differences:");
    differences.indexDifferences.forEach((diff) => {
        console.log(`  - ${diff.type.toUpperCase()}: ${diff.index.name}`);
    });

    console.log("\n");
}

// Run all examples
export function runExamples() {
    exampleAddColumn();
    exampleDropColumn();
    exampleComplexChanges();
    exampleGetDifferences();
}

// Uncomment to run examples
// runExamples();
