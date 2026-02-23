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
        columns: ["Column1"],
        referencedSchemaName: "dbo",
        referencedTableName: "OtherTable",
        referencedColumns: ["Id"],
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
});
