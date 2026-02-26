/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    CopilotChange,
    CopilotOperation,
    computeEditedEntityIds,
    reconcileTrackedChangesWithSchema,
    removeTrackedChangesForEditedEntities,
    processCopilotChanges,
} from "../../src/reactviews/pages/SchemaDesigner/definition/copilot/copilotLedger";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function makeColumn(overrides: Partial<SchemaDesigner.Column> = {}): SchemaDesigner.Column {
    return {
        id: "col-1",
        name: "Column1",
        dataType: "int",
        maxLength: "",
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

function makeForeignKey(
    overrides: Partial<SchemaDesigner.ForeignKey> = {},
): SchemaDesigner.ForeignKey {
    return {
        id: "fk-1",
        name: "FK_Test",
        columnsIds: ["col-1"],
        referencedTableId: "table-2",
        referencedColumnsIds: ["col-2"],
        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        ...overrides,
    };
}

function makeTable(overrides: Partial<SchemaDesigner.Table> = {}): SchemaDesigner.Table {
    return {
        id: "table-1",
        name: "TestTable",
        schema: "dbo",
        columns: [makeColumn()],
        foreignKeys: [],
        ...overrides,
    };
}

suite("computeEditedEntityIds", () => {
    test("should return empty set when tables are identical", () => {
        const original = makeTable();
        const updated = deepClone(original);

        const result = computeEditedEntityIds(original, updated);
        expect(result.size).to.equal(0);
    });

    test("should detect table name change", () => {
        const original = makeTable();
        const updated = deepClone(original);
        updated.name = "RenamedTable";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("table-1")).to.be.true;
        expect(result.size).to.equal(1);
    });

    test("should detect table schema change", () => {
        const original = makeTable();
        const updated = deepClone(original);
        updated.schema = "sales";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("table-1")).to.be.true;
        expect(result.size).to.equal(1);
    });

    test("should detect column name change", () => {
        const original = makeTable();
        const updated = deepClone(original);
        updated.columns[0].name = "RenamedColumn";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("col-1")).to.be.true;
        expect(result.has("table-1")).to.be.false;
        expect(result.size).to.equal(1);
    });

    test("should detect column dataType change", () => {
        const original = makeTable();
        const updated = deepClone(original);
        updated.columns[0].dataType = "varchar";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("col-1")).to.be.true;
        expect(result.size).to.equal(1);
    });

    test("should detect column deletion", () => {
        const original = makeTable({
            columns: [makeColumn({ id: "col-1" }), makeColumn({ id: "col-2", name: "Column2" })],
        });
        const updated = deepClone(original);
        updated.columns = [updated.columns[0]];

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("col-2")).to.be.true;
        expect(result.has("col-1")).to.be.false;
        expect(result.size).to.equal(1);
    });

    test("should detect foreign key modification", () => {
        const original = makeTable({
            foreignKeys: [makeForeignKey()],
        });
        const updated = deepClone(original);
        updated.foreignKeys[0].name = "FK_Renamed";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("fk-1")).to.be.true;
        expect(result.size).to.equal(1);
    });

    test("should detect foreign key deletion", () => {
        const original = makeTable({
            foreignKeys: [makeForeignKey()],
        });
        const updated = deepClone(original);
        updated.foreignKeys = [];

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("fk-1")).to.be.true;
        expect(result.size).to.equal(1);
    });

    test("should detect multiple simultaneous changes", () => {
        const original = makeTable({
            columns: [makeColumn({ id: "col-1" }), makeColumn({ id: "col-2", name: "Column2" })],
            foreignKeys: [makeForeignKey()],
        });
        const updated = deepClone(original);
        updated.name = "RenamedTable";
        updated.columns[0].dataType = "bigint";
        updated.columns.splice(1, 1);
        updated.foreignKeys[0].onDeleteAction = SchemaDesigner.OnAction.CASCADE;

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("table-1")).to.be.true;
        expect(result.has("col-1")).to.be.true;
        expect(result.has("col-2")).to.be.true;
        expect(result.has("fk-1")).to.be.true;
        expect(result.size).to.equal(4);
    });

    test("should not flag newly added columns", () => {
        const original = makeTable();
        const updated = deepClone(original);
        updated.columns.push(makeColumn({ id: "col-new", name: "NewColumn" }));

        const result = computeEditedEntityIds(original, updated);
        expect(result.size).to.equal(0);
    });

    test("should not flag unchanged columns when only table-level changes", () => {
        const original = makeTable({
            columns: [makeColumn({ id: "col-1" }), makeColumn({ id: "col-2", name: "Column2" })],
        });
        const updated = deepClone(original);
        updated.name = "RenamedTable";

        const result = computeEditedEntityIds(original, updated);
        expect(result.has("table-1")).to.be.true;
        expect(result.has("col-1")).to.be.false;
        expect(result.has("col-2")).to.be.false;
        expect(result.size).to.equal(1);
    });
});

suite("removeTrackedChangesForEditedEntities", () => {
    const trackedChanges: CopilotChange[] = [
        {
            operation: CopilotOperation.AddColumn,
            description: "Added column 'Email'",
            tableId: "table-1",
            groupId: "copilot-1",
            before: undefined,
            after: makeColumn({ id: "col-email", name: "Email", dataType: "varchar" }),
        },
        {
            operation: CopilotOperation.SetColumn,
            description: "Updated column 'Name'",
            tableId: "table-1",
            groupId: "copilot-1",
            before: makeColumn({ id: "col-name", name: "Name", dataType: "varchar" }),
            after: makeColumn({ id: "col-name", name: "Name", dataType: "nvarchar" }),
        },
        {
            operation: CopilotOperation.AddTable,
            description: "Added table [dbo].[Orders]",
            tableId: "table-orders",
            groupId: "copilot-2",
            before: undefined,
            after: makeTable({ id: "table-orders", name: "Orders" }),
        },
    ];

    test("should remove only changes matching edited entity IDs", () => {
        const editedIds = new Set(["col-email"]);
        const result = removeTrackedChangesForEditedEntities(trackedChanges, editedIds);

        expect(result.length).to.equal(2);
        expect(result[0].description).to.equal("Updated column 'Name'");
        expect(result[1].description).to.equal("Added table [dbo].[Orders]");
    });

    test("should remove multiple matching changes", () => {
        const editedIds = new Set(["col-email", "col-name"]);
        const result = removeTrackedChangesForEditedEntities(trackedChanges, editedIds);

        expect(result.length).to.equal(1);
        expect(result[0].description).to.equal("Added table [dbo].[Orders]");
    });

    test("should return original array when no entity IDs match", () => {
        const editedIds = new Set(["col-unknown"]);
        const result = removeTrackedChangesForEditedEntities(trackedChanges, editedIds);

        expect(result.length).to.equal(3);
    });

    test("should return original array when editedEntityIds is empty", () => {
        const editedIds = new Set<string>();
        const result = removeTrackedChangesForEditedEntities(trackedChanges, editedIds);

        expect(result).to.equal(trackedChanges);
    });

    test("should handle changes without entity IDs gracefully", () => {
        const changesWithUndefined: CopilotChange[] = [
            {
                operation: CopilotOperation.DropTable,
                description: "Dropped table",
                before: undefined,
                after: undefined,
            },
            ...trackedChanges,
        ];

        const editedIds = new Set(["col-email"]);
        const result = removeTrackedChangesForEditedEntities(changesWithUndefined, editedIds);

        expect(result.length).to.equal(3);
        expect(result[0].description).to.equal("Dropped table");
    });

    test("should remove table-level change when table ID is in edited set", () => {
        const editedIds = new Set(["table-orders"]);
        const result = removeTrackedChangesForEditedEntities(trackedChanges, editedIds);

        expect(result.length).to.equal(2);
        expect(result.every((c) => c.description !== "Added table [dbo].[Orders]")).to.be.true;
    });
});

suite("processCopilotChanges", () => {
    test("should merge and reconcile changes correctly", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [
                        makeColumn({ id: "col-1" }),
                        makeColumn({ id: "col-2", name: "Column2" }),
                    ],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: makeColumn({ id: "col-2", name: "Column2" }),
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
    });

    test("should cancel add followed by drop of same entity", () => {
        const col = makeColumn({ id: "col-new", name: "NewCol" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: col,
            },
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: col,
                after: undefined,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(0);
    });

    test("should fold add + set into add with latest after", () => {
        const colV1 = makeColumn({ id: "col-new", name: "NewCol", dataType: "int" });
        const colV2 = makeColumn({ id: "col-new", name: "NewCol", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" }), colV2],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: colV1,
            },
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                tableId: "table-1",
                before: colV1,
                after: colV2,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.AddColumn);
        expect((result[0].after as SchemaDesigner.Column).dataType).to.equal("bigint");
        expect(result[0].before).to.be.undefined;
    });

    test("should fold set + set preserving earliest before and latest after", () => {
        const colOriginal = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const colV1 = makeColumn({ id: "col-1", name: "Column1", dataType: "bigint" });
        const colV2 = makeColumn({ id: "col-1", name: "Column1", dataType: "varchar" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colV2],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Changed to bigint",
                tableId: "table-1",
                before: colOriginal,
                after: colV1,
            },
            {
                operation: CopilotOperation.SetColumn,
                description: "Changed to varchar",
                tableId: "table-1",
                before: colV1,
                after: colV2,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.SetColumn);
        expect((result[0].before as SchemaDesigner.Column).dataType).to.equal("int");
        expect((result[0].after as SchemaDesigner.Column).dataType).to.equal("varchar");
    });

    test("should fold set + drop preserving earliest before", () => {
        const colOriginal = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const colV1 = makeColumn({ id: "col-1", name: "Column1", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", columns: [] })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Changed to bigint",
                tableId: "table-1",
                before: colOriginal,
                after: colV1,
            },
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: colV1,
                after: undefined,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.DropColumn);
        expect((result[0].before as SchemaDesigner.Column).dataType).to.equal("int");
    });

    test("should fold drop + add into set (re-add after drop)", () => {
        const colBefore = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const colAfter = makeColumn({ id: "col-1", name: "Column1", dataType: "nvarchar" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colAfter],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: colBefore,
                after: undefined,
            },
            {
                operation: CopilotOperation.AddColumn,
                description: "Re-added column",
                tableId: "table-1",
                before: undefined,
                after: colAfter,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.SetColumn);
        expect((result[0].before as SchemaDesigner.Column).dataType).to.equal("int");
        expect((result[0].after as SchemaDesigner.Column).dataType).to.equal("nvarchar");
    });

    test("should fold drop + drop preserving earliest before", () => {
        const colBefore = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", columns: [] })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column first",
                tableId: "table-1",
                before: colBefore,
                after: undefined,
            },
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column again",
                tableId: "table-1",
                before: undefined,
                after: undefined,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.DropColumn);
        expect((result[0].before as SchemaDesigner.Column).dataType).to.equal("int");
    });

    test("should propagate groupId from incoming change", () => {
        const col = makeColumn({ id: "col-new", name: "NewCol" });
        const colUpdated = makeColumn({ id: "col-new", name: "NewCol", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" }), colUpdated],
                }),
            ],
        };

        const tracked: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                groupId: "group-1",
                before: undefined,
                after: col,
            },
        ];

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                tableId: "table-1",
                groupId: "group-2",
                before: col,
                after: colUpdated,
            },
        ];

        const result = processCopilotChanges(batch, tracked, schema);
        expect(result.length).to.equal(1);
        expect(result[0].groupId).to.equal("group-2");
    });

    test("should fall back to existing groupId when incoming has none", () => {
        const col = makeColumn({ id: "col-new", name: "NewCol" });
        const colUpdated = makeColumn({ id: "col-new", name: "NewCol", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" }), colUpdated],
                }),
            ],
        };

        const tracked: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                groupId: "group-1",
                before: undefined,
                after: col,
            },
        ];

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                tableId: "table-1",
                before: col,
                after: colUpdated,
            },
        ];

        const result = processCopilotChanges(batch, tracked, schema);
        expect(result.length).to.equal(1);
        expect(result[0].groupId).to.equal("group-1");
    });

    test("should handle multiple independent changes without merging", () => {
        const col1 = makeColumn({ id: "col-new-1", name: "ColA" });
        const col2 = makeColumn({ id: "col-new-2", name: "ColB" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" }), col1, col2],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added ColA",
                tableId: "table-1",
                before: undefined,
                after: col1,
            },
            {
                operation: CopilotOperation.AddColumn,
                description: "Added ColB",
                tableId: "table-1",
                before: undefined,
                after: col2,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(2);
    });

    test("should merge tracked and batch changes for the same entity", () => {
        const colOriginal = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const colTracked = makeColumn({ id: "col-1", name: "Column1", dataType: "bigint" });
        const colBatch = makeColumn({ id: "col-1", name: "Column1", dataType: "varchar" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colBatch],
                }),
            ],
        };

        const tracked: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Changed to bigint",
                tableId: "table-1",
                before: colOriginal,
                after: colTracked,
            },
        ];

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Changed to varchar",
                tableId: "table-1",
                before: colTracked,
                after: colBatch,
            },
        ];

        const result = processCopilotChanges(batch, tracked, schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.SetColumn);
        expect((result[0].before as SchemaDesigner.Column).dataType).to.equal("int");
        expect((result[0].after as SchemaDesigner.Column).dataType).to.equal("varchar");
    });

    test("should handle table-level add and drop cancellation", () => {
        const table = makeTable({ id: "table-new", name: "NewTable" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddTable,
                description: "Added table",
                before: undefined,
                after: table,
            },
            {
                operation: CopilotOperation.DropTable,
                description: "Dropped table",
                before: table,
                after: undefined,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(0);
    });

    test("should handle foreign key operations", () => {
        const fk = makeForeignKey({ id: "fk-new", name: "FK_New" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    foreignKeys: [fk],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddForeignKey,
                description: "Added FK",
                tableId: "table-1",
                before: undefined,
                after: fk,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.AddForeignKey);
    });

    test("should resolve tableId from schema when not provided", () => {
        const col = makeColumn({ id: "col-1", name: "Column1" });
        const colUpdated = makeColumn({ id: "col-1", name: "Column1", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colUpdated],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                // tableId intentionally omitted
                before: col,
                after: colUpdated,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].tableId).to.equal("table-1");
    });

    test("should resolve tableId for foreign key from schema when not provided", () => {
        const fk = makeForeignKey({ id: "fk-1" });
        const fkUpdated = makeForeignKey({ id: "fk-1", name: "FK_Updated" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    foreignKeys: [fkUpdated],
                }),
            ],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetForeignKey,
                description: "Updated FK",
                // tableId intentionally omitted
                before: fk,
                after: fkUpdated,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].tableId).to.equal("table-1");
    });

    test("should handle empty batch with existing tracked changes", () => {
        const col = makeColumn({ id: "col-new", name: "NewCol" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" }), col],
                }),
            ],
        };

        const tracked: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: col,
            },
        ];

        const result = processCopilotChanges([], tracked, schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.AddColumn);
    });

    test("should handle empty batch and empty tracked changes", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const result = processCopilotChanges([], [], schema);
        expect(result.length).to.equal(0);
    });

    test("should handle changes without entity IDs using unresolved keys", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Mystery column 1",
                tableId: "table-1",
                before: undefined,
                after: undefined,
            },
            {
                operation: CopilotOperation.AddColumn,
                description: "Mystery column 2",
                tableId: "table-1",
                before: undefined,
                after: undefined,
            },
        ];

        // Both should survive as separate entries (unresolved keys are unique)
        const result = processCopilotChanges(batch, [], schema);
        // After reconciliation, add-changes without an entity present are removed
        expect(result.length).to.equal(0);
    });

    test("should handle SetTable operation", () => {
        const original = makeTable({ id: "table-1", name: "OldName" });
        const updated = makeTable({ id: "table-1", name: "NewName" });
        const schema: SchemaDesigner.Schema = {
            tables: [updated],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.SetTable,
                description: "Renamed table",
                before: original,
                after: updated,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.SetTable);
        expect((result[0].after as SchemaDesigner.Table).name).to.equal("NewName");
    });

    test("should handle DropForeignKey operation", () => {
        const fk = makeForeignKey({ id: "fk-1" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [] })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.DropForeignKey,
                description: "Dropped FK",
                tableId: "table-1",
                before: fk,
                after: undefined,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.DropForeignKey);
    });

    test("should add + set FK fold into add with latest after", () => {
        const fkV1 = makeForeignKey({ id: "fk-new", name: "FK_V1" });
        const fkV2 = makeForeignKey({
            id: "fk-new",
            name: "FK_V2",
            onDeleteAction: SchemaDesigner.OnAction.CASCADE,
        });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [fkV2] })],
        };

        const batch: CopilotChange[] = [
            {
                operation: CopilotOperation.AddForeignKey,
                description: "Added FK",
                tableId: "table-1",
                before: undefined,
                after: fkV1,
            },
            {
                operation: CopilotOperation.SetForeignKey,
                description: "Updated FK",
                tableId: "table-1",
                before: fkV1,
                after: fkV2,
            },
        ];

        const result = processCopilotChanges(batch, [], schema);
        expect(result.length).to.equal(1);
        expect(result[0].operation).to.equal(CopilotOperation.AddForeignKey);
        expect((result[0].after as SchemaDesigner.ForeignKey).name).to.equal("FK_V2");
    });
});

suite("reconcileTrackedChangesWithSchema", () => {
    test("should remove add changes when entity no longer exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" })],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: makeColumn({ id: "col-deleted", name: "DeletedCol" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should keep add changes when entity still exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [
                        makeColumn({ id: "col-1" }),
                        makeColumn({ id: "col-2", name: "NewCol" }),
                    ],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-1",
                before: undefined,
                after: makeColumn({ id: "col-2", name: "NewCol" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should keep drop change when entity is no longer in schema", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [makeColumn({ id: "col-1" })],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: makeColumn({ id: "col-dropped", name: "DroppedCol" }),
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should remove drop change when entity reappears in schema", () => {
        const col = makeColumn({ id: "col-1", name: "Column1" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [col],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: col,
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should remove drop change when before has no id", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropColumn,
                description: "Dropped column",
                tableId: "table-1",
                before: undefined,
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should keep set change when after entity still exists in schema", () => {
        const colAfter = makeColumn({ id: "col-1", name: "UpdatedCol", dataType: "bigint" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colAfter],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                tableId: "table-1",
                before: makeColumn({ id: "col-1", name: "Column1", dataType: "int" }),
                after: colAfter,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should remove set change when before entity shape matches current (reverted)", () => {
        const colOriginal = makeColumn({ id: "col-1", name: "Column1", dataType: "int" });
        const schema: SchemaDesigner.Schema = {
            tables: [
                makeTable({
                    id: "table-1",
                    columns: [colOriginal],
                }),
            ],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated column",
                tableId: "table-1",
                before: colOriginal,
                after: makeColumn({ id: "col-modified", name: "Changed", dataType: "bigint" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should remove set change when neither before nor after entity exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", columns: [] })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.SetColumn,
                description: "Updated phantom column",
                tableId: "table-1",
                before: makeColumn({ id: "col-gone-1", name: "Gone1" }),
                after: makeColumn({ id: "col-gone-2", name: "Gone2" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should handle AddTable reconciliation when table exists", () => {
        const table = makeTable({ id: "table-new", name: "NewTable" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" }), table],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddTable,
                description: "Added table",
                before: undefined,
                after: table,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should remove AddTable when table no longer exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddTable,
                description: "Added table",
                before: undefined,
                after: makeTable({ id: "table-gone", name: "GoneTable" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should keep DropTable when table no longer exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropTable,
                description: "Dropped table",
                before: makeTable({ id: "table-dropped", name: "DroppedTable" }),
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should remove DropTable when table still exists", () => {
        const table = makeTable({ id: "table-1" });
        const schema: SchemaDesigner.Schema = {
            tables: [table],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropTable,
                description: "Dropped table",
                before: table,
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should handle AddForeignKey reconciliation when FK exists", () => {
        const fk = makeForeignKey({ id: "fk-new", name: "FK_New" });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [fk] })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddForeignKey,
                description: "Added FK",
                tableId: "table-1",
                before: undefined,
                after: fk,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should remove AddForeignKey when FK no longer exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [] })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddForeignKey,
                description: "Added FK",
                tableId: "table-1",
                before: undefined,
                after: makeForeignKey({ id: "fk-gone", name: "FK_Gone" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should handle mixed entity types in a single reconciliation", () => {
        const colNew = makeColumn({ id: "col-new", name: "NewCol" });
        const fkNew = makeForeignKey({ id: "fk-new", name: "FK_New" });
        const tableNew = makeTable({
            id: "table-new",
            name: "NewTable",
            columns: [colNew],
            foreignKeys: [fkNew],
        });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" }), tableNew],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddTable,
                description: "Added table",
                before: undefined,
                after: tableNew,
            },
            {
                operation: CopilotOperation.AddColumn,
                description: "Added column",
                tableId: "table-new",
                before: undefined,
                after: colNew,
            },
            {
                operation: CopilotOperation.AddForeignKey,
                description: "Added FK",
                tableId: "table-new",
                before: undefined,
                after: fkNew,
            },
            // This one no longer exists
            {
                operation: CopilotOperation.AddColumn,
                description: "Added ghost column",
                tableId: "table-1",
                before: undefined,
                after: makeColumn({ id: "col-ghost", name: "Ghost" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(3);
        expect(result.some((c) => c.description === "Added ghost column")).to.be.false;
    });

    test("should handle DropForeignKey when FK no longer exists", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [] })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.DropForeignKey,
                description: "Dropped FK",
                tableId: "table-1",
                before: makeForeignKey({ id: "fk-dropped", name: "FK_Dropped" }),
                after: undefined,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });

    test("should handle empty changes array", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1" })],
        };

        const result = reconcileTrackedChangesWithSchema([], schema);
        expect(result.length).to.equal(0);
    });

    test("should handle schema with no tables", () => {
        const schema: SchemaDesigner.Schema = {
            tables: [],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.AddTable,
                description: "Added table",
                before: undefined,
                after: makeTable({ id: "table-new", name: "NewTable" }),
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(0);
    });

    test("should handle SetForeignKey when after FK exists", () => {
        const fkBefore = makeForeignKey({ id: "fk-1", name: "FK_Before" });
        const fkAfter = makeForeignKey({
            id: "fk-1",
            name: "FK_After",
            onDeleteAction: SchemaDesigner.OnAction.CASCADE,
        });
        const schema: SchemaDesigner.Schema = {
            tables: [makeTable({ id: "table-1", foreignKeys: [fkAfter] })],
        };

        const changes: CopilotChange[] = [
            {
                operation: CopilotOperation.SetForeignKey,
                description: "Updated FK",
                tableId: "table-1",
                before: fkBefore,
                after: fkAfter,
            },
        ];

        const result = reconcileTrackedChangesWithSchema(changes, schema);
        expect(result.length).to.equal(1);
    });
});
