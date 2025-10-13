/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { TableMigrationGenerator } from "../../src/sourceControl/tableMigrationGenerator";
import { SchemaDifference } from "../../src/sourceControl/tableMigrationTypes";

suite("TableMigrationGenerator Tests", () => {
    let generator: TableMigrationGenerator;

    setup(() => {
        generator = new TableMigrationGenerator({ includeComments: false });
    });

    suite("Column Migration Scripts", () => {
        test("should generate script to add column", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "added",
                        column: { name: "Email", dataType: "VARCHAR(255)", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include(
                "ALTER TABLE [dbo].[Users] ADD [Email] VARCHAR(255) NOT NULL",
            );
        });

        test("should generate script to drop column", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "removed",
                        column: { name: "OldColumn", dataType: "INT", nullable: true },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("ALTER TABLE [dbo].[Users] DROP COLUMN [OldColumn]");
        });

        test("should generate script to modify column", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "modified",
                        column: { name: "Age", dataType: "BIGINT", nullable: false },
                        oldColumn: { name: "Age", dataType: "INT", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include(
                "ALTER TABLE [dbo].[Users] ALTER COLUMN [Age] BIGINT NOT NULL",
            );
        });

        test("should generate script with default value", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "added",
                        column: {
                            name: "IsActive",
                            dataType: "BIT",
                            nullable: false,
                            defaultValue: "1",
                        },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("DEFAULT 1");
        });

        test("should handle nullable columns", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "added",
                        column: { name: "MiddleName", dataType: "NVARCHAR(50)", nullable: true },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("NULL");
            expect(script).to.not.include("NOT NULL");
        });
    });

    suite("Constraint Migration Scripts", () => {
        test("should generate script to add primary key", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [
                    {
                        type: "added",
                        constraint: {
                            name: "PK_Users",
                            type: "PRIMARY KEY",
                            columns: ["Id"],
                            definition: "PRIMARY KEY CLUSTERED ([Id])",
                            clustered: true,
                        },
                    },
                ],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include(
                "ALTER TABLE [dbo].[Users] ADD CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id])",
            );
        });

        test("should generate script to drop constraint", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [
                    {
                        type: "removed",
                        constraint: {
                            name: "UQ_Users_Email",
                            type: "UNIQUE",
                            columns: ["Email"],
                        },
                    },
                ],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("ALTER TABLE [dbo].[Users] DROP CONSTRAINT [UQ_Users_Email]");
        });

        test("should generate script to add foreign key", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [
                    {
                        type: "added",
                        constraint: {
                            name: "FK_Orders_Users",
                            type: "FOREIGN KEY",
                            definition: "FOREIGN KEY ([UserId]) REFERENCES [Users]([Id])",
                        },
                    },
                ],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Orders", "dbo");

            expect(script).to.include("ADD CONSTRAINT [FK_Orders_Users]");
            expect(script).to.include("FOREIGN KEY");
        });
    });

    suite("Index Migration Scripts", () => {
        test("should generate script to create nonclustered index", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [],
                indexDifferences: [
                    {
                        type: "added",
                        index: {
                            name: "IX_Users_Email",
                            columns: ["Email"],
                            type: "NONCLUSTERED",
                            unique: false,
                        },
                    },
                ],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include(
                "CREATE NONCLUSTERED INDEX [IX_Users_Email] ON [dbo].[Users] (Email)",
            );
        });

        test("should generate script to create unique index", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [],
                indexDifferences: [
                    {
                        type: "added",
                        index: {
                            name: "UX_Users_Email",
                            columns: ["Email"],
                            type: "NONCLUSTERED",
                            unique: true,
                        },
                    },
                ],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("CREATE UNIQUE NONCLUSTERED INDEX");
        });

        test("should generate script to drop index", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [],
                indexDifferences: [
                    {
                        type: "removed",
                        index: {
                            name: "IX_Users_OldIndex",
                            columns: ["OldColumn"],
                            type: "NONCLUSTERED",
                            unique: false,
                        },
                    },
                ],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.include("DROP INDEX [IX_Users_OldIndex] ON [dbo].[Users]");
        });

        test("should generate script for composite index", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [],
                indexDifferences: [
                    {
                        type: "added",
                        index: {
                            name: "IX_Orders_UserId_OrderDate",
                            columns: ["UserId", "OrderDate"],
                            type: "NONCLUSTERED",
                            unique: false,
                        },
                    },
                ],
            };

            const script = generator.generate(diff, "Orders", "dbo");

            expect(script).to.include("(UserId, OrderDate)");
        });
    });

    suite("Data Loss Analysis", () => {
        test("should detect data loss from dropped columns", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "removed",
                        column: { name: "OldColumn", dataType: "VARCHAR(50)", nullable: true },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const summary = generator.analyzeDataLoss(diff);

            expect(summary.hasDataLoss).to.be.true;
            expect(summary.droppedColumns).to.include("OldColumn");
        });

        test("should detect data loss from varchar size reduction", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "modified",
                        column: { name: "Name", dataType: "VARCHAR(50)", nullable: false },
                        oldColumn: { name: "Name", dataType: "VARCHAR(100)", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const summary = generator.analyzeDataLoss(diff);

            expect(summary.hasDataLoss).to.be.true;
            expect(summary.modifiedColumns).to.have.lengthOf(1);
            expect(summary.modifiedColumns[0].name).to.equal("Name");
            expect(summary.modifiedColumns[0].oldType).to.equal("VARCHAR(100)");
            expect(summary.modifiedColumns[0].newType).to.equal("VARCHAR(50)");
        });

        test("should detect data loss from int to smallint conversion", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "modified",
                        column: { name: "Count", dataType: "SMALLINT", nullable: false },
                        oldColumn: { name: "Count", dataType: "INT", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const summary = generator.analyzeDataLoss(diff);

            expect(summary.hasDataLoss).to.be.true;
        });

        test("should not detect data loss for safe type changes", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "modified",
                        column: { name: "Age", dataType: "BIGINT", nullable: false },
                        oldColumn: { name: "Age", dataType: "INT", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const summary = generator.analyzeDataLoss(diff);

            expect(summary.hasDataLoss).to.be.false;
        });

        test("should track dropped constraints", () => {
            const diff: SchemaDifference = {
                columnDifferences: [],
                constraintDifferences: [
                    {
                        type: "removed",
                        constraint: {
                            name: "UQ_Users_Email",
                            type: "UNIQUE",
                        },
                    },
                ],
                indexDifferences: [],
            };

            const summary = generator.analyzeDataLoss(diff);

            expect(summary.droppedConstraints).to.include("UQ_Users_Email");
        });
    });

    suite("Script Formatting", () => {
        test("should include comments when enabled", () => {
            const generatorWithComments = new TableMigrationGenerator({ includeComments: true });

            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "added",
                        column: { name: "Email", dataType: "VARCHAR(255)", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generatorWithComments.generate(diff, "Users", "dbo");

            expect(script).to.include("-- Migration script for table");
            expect(script).to.include("-- Add column Email");
        });

        test("should not include comments when disabled", () => {
            const diff: SchemaDifference = {
                columnDifferences: [
                    {
                        type: "added",
                        column: { name: "Email", dataType: "VARCHAR(255)", nullable: false },
                    },
                ],
                constraintDifferences: [],
                indexDifferences: [],
            };

            const script = generator.generate(diff, "Users", "dbo");

            expect(script).to.not.include("--");
        });
    });
});
