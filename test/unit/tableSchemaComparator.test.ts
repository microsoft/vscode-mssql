/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { TableSchemaComparator } from "../../src/sourceControl/tableSchemaComparator";
import { TableSchema } from "../../src/sourceControl/tableMigrationTypes";

suite("TableSchemaComparator Tests", () => {
    let comparator: TableSchemaComparator;

    setup(() => {
        comparator = new TableSchemaComparator();
    });

    suite("Column Comparison", () => {
        test("should detect no changes when schemas are identical", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "Id", dataType: "INT", nullable: false },
                    { name: "Name", dataType: "NVARCHAR(100)", nullable: true },
                ],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "Id", dataType: "INT", nullable: false },
                    { name: "Name", dataType: "NVARCHAR(100)", nullable: true },
                ],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(0);
        });

        test("should detect added columns", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Id", dataType: "INT", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "Id", dataType: "INT", nullable: false },
                    { name: "Email", dataType: "VARCHAR(255)", nullable: false },
                ],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("added");
            expect(diff.columnDifferences[0].column.name).to.equal("Email");
        });

        test("should detect removed columns", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "Id", dataType: "INT", nullable: false },
                    { name: "OldColumn", dataType: "VARCHAR(50)", nullable: true },
                ],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Id", dataType: "INT", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("removed");
            expect(diff.columnDifferences[0].column.name).to.equal("OldColumn");
        });

        test("should detect modified column data type", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Age", dataType: "INT", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Age", dataType: "BIGINT", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("modified");
            expect(diff.columnDifferences[0].column.dataType).to.equal("BIGINT");
            expect(diff.columnDifferences[0].oldColumn?.dataType).to.equal("INT");
        });

        test("should detect modified column nullability", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Email", dataType: "VARCHAR(255)", nullable: true }],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Email", dataType: "VARCHAR(255)", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("modified");
            expect(diff.columnDifferences[0].column.nullable).to.be.false;
            expect(diff.columnDifferences[0].oldColumn?.nullable).to.be.true;
        });

        test("should detect modified column default value", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "IsActive", dataType: "BIT", nullable: false, defaultValue: "0" },
                ],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    { name: "IsActive", dataType: "BIT", nullable: false, defaultValue: "1" },
                ],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("modified");
        });

        test("should detect identity changes", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [{ name: "Id", dataType: "INT", nullable: false }],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [
                    {
                        name: "Id",
                        dataType: "INT",
                        nullable: false,
                        identity: { seed: 1, increment: 1 },
                    },
                ],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.columnDifferences).to.have.lengthOf(1);
            expect(diff.columnDifferences[0].type).to.equal("modified");
        });
    });

    suite("Constraint Comparison", () => {
        test("should detect added constraints", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [
                    {
                        name: "PK_Users",
                        type: "PRIMARY KEY",
                        columns: ["Id"],
                        clustered: true,
                    },
                ],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.constraintDifferences).to.have.lengthOf(1);
            expect(diff.constraintDifferences[0].type).to.equal("added");
            expect(diff.constraintDifferences[0].constraint.name).to.equal("PK_Users");
        });

        test("should detect removed constraints", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [
                    {
                        name: "UQ_Users_Email",
                        type: "UNIQUE",
                        columns: ["Email"],
                    },
                ],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.constraintDifferences).to.have.lengthOf(1);
            expect(diff.constraintDifferences[0].type).to.equal("removed");
            expect(diff.constraintDifferences[0].constraint.name).to.equal("UQ_Users_Email");
        });
    });

    suite("Index Comparison", () => {
        test("should detect added indexes", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [
                    {
                        name: "IX_Users_Email",
                        columns: ["Email"],
                        type: "NONCLUSTERED",
                        unique: false,
                    },
                ],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.indexDifferences).to.have.lengthOf(1);
            expect(diff.indexDifferences[0].type).to.equal("added");
            expect(diff.indexDifferences[0].index.name).to.equal("IX_Users_Email");
        });

        test("should detect removed indexes", () => {
            const schema1: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [
                    {
                        name: "IX_Users_OldIndex",
                        columns: ["OldColumn"],
                        type: "NONCLUSTERED",
                        unique: false,
                    },
                ],
            };

            const schema2: TableSchema = {
                name: "Users",
                schema: "dbo",
                columns: [],
                constraints: [],
                indexes: [],
            };

            const diff = comparator.compare(schema1, schema2);

            expect(diff.indexDifferences).to.have.lengthOf(1);
            expect(diff.indexDifferences[0].type).to.equal("removed");
            expect(diff.indexDifferences[0].index.name).to.equal("IX_Users_OldIndex");
        });
    });
});
