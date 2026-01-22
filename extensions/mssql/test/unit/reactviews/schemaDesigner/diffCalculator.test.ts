/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { SchemaDesigner } from "../../../../src/sharedInterfaces/schemaDesigner";
import {
    DiffCalculator,
    getDiffCalculator,
} from "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator";

suite("DiffCalculator", () => {
    let calculator: DiffCalculator;

    // Helper to create a basic table
    function createTable(
        id: string,
        name: string,
        schema: string = "dbo",
        columns: SchemaDesigner.Column[] = [],
        foreignKeys: SchemaDesigner.ForeignKey[] = [],
    ): SchemaDesigner.Table {
        return { id, name, schema, columns, foreignKeys };
    }

    // Helper to create a basic column
    function createColumn(
        id: string,
        name: string,
        dataType: string = "nvarchar",
        overrides: Partial<SchemaDesigner.Column> = {},
    ): SchemaDesigner.Column {
        return {
            id,
            name,
            dataType,
            maxLength: "50",
            precision: 0,
            scale: 0,
            isPrimaryKey: false,
            isIdentity: false,
            identitySeed: 0,
            identityIncrement: 0,
            isNullable: true,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
            ...overrides,
        };
    }

    // Helper to create a basic foreign key
    function createForeignKey(
        id: string,
        name: string,
        referencedTableName: string,
        overrides: Partial<SchemaDesigner.ForeignKey> = {},
    ): SchemaDesigner.ForeignKey {
        return {
            id,
            name,
            columns: ["col1"],
            referencedSchemaName: "dbo",
            referencedTableName,
            referencedColumns: ["id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
            ...overrides,
        };
    }

    setup(() => {
        calculator = new DiffCalculator();
    });

    suite("calculateDiff - No Changes", () => {
        test("should return empty result when schemas are identical", () => {
            const schema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users")],
            };

            const result = calculator.calculateDiff({
                originalSchema: schema,
                currentSchema: schema,
            });

            assert.strictEqual(result.hasChanges, false);
            assert.strictEqual(result.changes.length, 0);
            assert.strictEqual(result.changeGroups.length, 0);
            assert.strictEqual(result.summary.total, 0);
        });

        test("should return empty result for empty schemas", () => {
            const result = calculator.calculateDiff({
                originalSchema: { tables: [] },
                currentSchema: { tables: [] },
            });

            assert.strictEqual(result.hasChanges, false);
            assert.strictEqual(result.changes.length, 0);
        });
    });

    suite("calculateDiff - Table Changes", () => {
        test("should detect added table", () => {
            const originalSchema: SchemaDesigner.Schema = { tables: [] };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users")],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Addition,
            );
            assert.strictEqual(result.changes[0].entityType, SchemaDesigner.SchemaEntityType.Table);
            assert.strictEqual(result.summary.additions, 1);
        });

        test("should detect deleted table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users")],
            };
            const currentSchema: SchemaDesigner.Schema = { tables: [] };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Deletion,
            );
            assert.strictEqual(result.summary.deletions, 1);
        });

        test("should detect renamed table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users")],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Customers")],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            const tableChange = result.changes.find(
                (c) => c.entityType === SchemaDesigner.SchemaEntityType.Table,
            );
            assert.notStrictEqual(tableChange, undefined);
            assert.strictEqual(
                tableChange!.changeType,
                SchemaDesigner.SchemaChangeType.Modification,
            );
        });

        test("should detect schema change for table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo")],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "sales")],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.summary.modifications, 1);
        });
    });

    suite("calculateDiff - Column Changes", () => {
        test("should detect added column", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [])],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [createColumn("c1", "Email")])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Addition,
            );
            assert.strictEqual(
                result.changes[0].entityType,
                SchemaDesigner.SchemaEntityType.Column,
            );
            assert.strictEqual(result.changes[0].entityName, "Email");
        });

        test("should detect deleted column", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [createColumn("c1", "Email")])],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Deletion,
            );
            assert.strictEqual(
                result.changes[0].entityType,
                SchemaDesigner.SchemaEntityType.Column,
            );
        });

        test("should detect modified column - data type change", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [createColumn("c1", "Name", "nvarchar")]),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [createColumn("c1", "Name", "varchar")]),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Modification,
            );
        });

        test("should detect modified column - nullable change", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Name", "nvarchar", { isNullable: true }),
                    ]),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Name", "nvarchar", { isNullable: false }),
                    ]),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Modification,
            );
        });

        test("should detect modified column - primary key change", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Id", "int", { isPrimaryKey: false }),
                    ]),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Id", "int", { isPrimaryKey: true }),
                    ]),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.summary.modifications, 1);
        });

        test("should not detect change for identical columns", () => {
            const column = createColumn("c1", "Name", "nvarchar");
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [column])],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [{ ...column }])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, false);
        });
    });

    suite("calculateDiff - Foreign Key Changes", () => {
        test("should detect added foreign key", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Orders", "dbo", [], [])],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [createForeignKey("fk1", "FK_Orders_Users", "Users")],
                    ),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.changes.length, 1);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Addition,
            );
            assert.strictEqual(
                result.changes[0].entityType,
                SchemaDesigner.SchemaEntityType.ForeignKey,
            );
        });

        test("should detect deleted foreign key", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [createForeignKey("fk1", "FK_Orders_Users", "Users")],
                    ),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Orders", "dbo", [], [])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Deletion,
            );
            assert.strictEqual(
                result.changes[0].entityType,
                SchemaDesigner.SchemaEntityType.ForeignKey,
            );
        });

        test("should detect modified foreign key - reference change", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [createForeignKey("fk1", "FK_Orders_Users", "Users")],
                    ),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [createForeignKey("fk1", "FK_Orders_Users", "Customers")],
                    ),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(
                result.changes[0].changeType,
                SchemaDesigner.SchemaChangeType.Modification,
            );
        });

        test("should detect modified foreign key - action change", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [
                            createForeignKey("fk1", "FK_Orders_Users", "Users", {
                                onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                            }),
                        ],
                    ),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable(
                        "t1",
                        "Orders",
                        "dbo",
                        [],
                        [
                            createForeignKey("fk1", "FK_Orders_Users", "Users", {
                                onDeleteAction: SchemaDesigner.OnAction.CASCADE,
                            }),
                        ],
                    ),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.hasChanges, true);
            assert.strictEqual(result.summary.modifications, 1);
        });
    });

    suite("calculateDiff - Change Groups", () => {
        test("should group changes by table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [createColumn("c1", "Name")]),
                    createTable("t2", "Orders", "dbo", [createColumn("c2", "Total")]),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Name"),
                        createColumn("c3", "Email"),
                    ]),
                    createTable("t2", "Orders", "dbo", [
                        createColumn("c2", "Total"),
                        createColumn("c4", "Status"),
                    ]),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.changeGroups.length, 2);
            assert.strictEqual(result.changes.length, 2);
        });

        test("should set correct aggregate state for new table", () => {
            const originalSchema: SchemaDesigner.Schema = { tables: [] };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [createColumn("c1", "Name")])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.changeGroups.length, 1);
            assert.strictEqual(
                result.changeGroups[0].aggregateState,
                SchemaDesigner.SchemaChangeType.Addition,
            );
        });

        test("should set correct aggregate state for deleted table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users")],
            };
            const currentSchema: SchemaDesigner.Schema = { tables: [] };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.changeGroups.length, 1);
            assert.strictEqual(
                result.changeGroups[0].aggregateState,
                SchemaDesigner.SchemaChangeType.Deletion,
            );
        });

        test("should set correct aggregate state for modified table", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [])],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [createTable("t1", "Users", "dbo", [createColumn("c1", "Email")])],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.changeGroups.length, 1);
            assert.strictEqual(
                result.changeGroups[0].aggregateState,
                SchemaDesigner.SchemaChangeType.Modification,
            );
        });

        test("should sort groups by table name", () => {
            const originalSchema: SchemaDesigner.Schema = { tables: [] };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t3", "Zebra"),
                    createTable("t1", "Apple"),
                    createTable("t2", "Banana"),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.changeGroups[0].tableName, "dbo.Apple");
            assert.strictEqual(result.changeGroups[1].tableName, "dbo.Banana");
            assert.strictEqual(result.changeGroups[2].tableName, "dbo.Zebra");
        });
    });

    suite("calculateDiff - Summary", () => {
        test("should calculate correct summary counts", () => {
            const originalSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "Name"),
                        createColumn("c2", "Email"),
                    ]),
                ],
            };
            const currentSchema: SchemaDesigner.Schema = {
                tables: [
                    createTable("t1", "Users", "dbo", [
                        createColumn("c1", "FullName"), // Modified (renamed)
                        // c2 deleted
                        createColumn("c3", "Phone"), // Added
                    ]),
                ],
            };

            const result = calculator.calculateDiff({
                originalSchema,
                currentSchema,
            });

            assert.strictEqual(result.summary.additions, 1);
            assert.strictEqual(result.summary.modifications, 1);
            assert.strictEqual(result.summary.deletions, 1);
            assert.strictEqual(result.summary.total, 3);
        });
    });

    suite("singleton", () => {
        test("should return same instance from getDiffCalculator", () => {
            const instance1 = getDiffCalculator();
            const instance2 = getDiffCalculator();
            assert.strictEqual(instance1, instance2);
        });
    });
});
