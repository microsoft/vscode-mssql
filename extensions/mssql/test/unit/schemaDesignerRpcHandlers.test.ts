/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect } from "chai";
import * as sinon from "sinon";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { registerSchemaDesignerApplyEditsHandler } from "../../src/reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers";
import { normalizeColumn } from "../../src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils";
import { locConstants } from "../../src/reactviews/common/locConstants";

suite("schemaDesignerRpcHandlers", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    const createApplyEditsHarness = (initialSchema: SchemaDesigner.Schema) => {
        let currentSchema: SchemaDesigner.Schema = initialSchema;

        const applyHandlerStub = sandbox.stub();
        const extensionRpc = {
            onRequest: sandbox.stub().callsFake((_type: any, handler: any) => {
                applyHandlerStub.callsFake(handler);
            }),
        };

        const onMaybeAutoArrange = sandbox.stub();
        const onRequestScriptRefresh = sandbox.stub();

        const addTable = sandbox.stub().callsFake(async (table: SchemaDesigner.Table) => {
            currentSchema = { tables: [...currentSchema.tables, { ...table, foreignKeys: [] }] };
            return true;
        });

        const updateTable = sandbox.stub().callsFake(async (table: SchemaDesigner.Table) => {
            currentSchema = {
                tables: currentSchema.tables.map((t) => (t.id === table.id ? table : t)),
            };
            return true;
        });

        const deleteTable = sandbox.stub().callsFake(async (table: SchemaDesigner.Table) => {
            currentSchema = { tables: currentSchema.tables.filter((t) => t.id !== table.id) };
            return true;
        });

        registerSchemaDesignerApplyEditsHandler({
            isInitialized: true,
            extensionRpc: extensionRpc as any,
            schemaNames: ["dbo"],
            datatypes: [],
            waitForNextFrame: async () => {},
            extractSchema: () => currentSchema,
            onMaybeAutoArrange,
            addTable,
            updateTable,
            deleteTable,
            normalizeColumn: (c) => normalizeColumn(c),
            normalizeTable: (t) => t,
            validateTable: () => undefined,
            onPushUndoState: sandbox.stub(),
            onRequestScriptRefresh,
        });

        return {
            applyEdits: (edits: SchemaDesigner.SchemaDesignerEdit[]) => applyHandlerStub({ edits }),
            onMaybeAutoArrange,
            onRequestScriptRefresh,
            getSchema: () => currentSchema,
        };
    };

    test("apply_edits handler calls onMaybeAutoArrange with table/fk pre+post counts", async () => {
        const { applyEdits, onMaybeAutoArrange } = createApplyEditsHarness({ tables: [] });

        const edits: SchemaDesigner.SchemaDesignerEdit[] = [
            { op: "add_table", table: { schema: "dbo", name: "T1" } } as any,
            { op: "add_table", table: { schema: "dbo", name: "T2" } } as any,
            { op: "add_table", table: { schema: "dbo", name: "T3" } } as any,
            { op: "add_table", table: { schema: "dbo", name: "T4" } } as any,
            { op: "add_table", table: { schema: "dbo", name: "T5" } } as any,
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T3" },
                foreignKey: {
                    name: "FK_T3_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T4" },
                foreignKey: {
                    name: "FK_T4_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ];

        const result = await applyEdits(edits);
        expect(result.success).to.equal(true);

        expect(onMaybeAutoArrange.calledOnce).to.equal(true);
        expect(onMaybeAutoArrange.getCall(0).args).to.deep.equal([0, 5, 0, 3]);
    });

    test("apply_edits handler counts existing foreign keys in preSchema", async () => {
        const { applyEdits, onMaybeAutoArrange } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
                {
                    id: "t2",
                    schema: "dbo",
                    name: "T2",
                    columns: [normalizeColumn({ id: "c2", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [
                        {
                            id: "fk0",
                            name: "FK_existing",
                            columns: ["Id"],
                            referencedSchemaName: "dbo",
                            referencedTableName: "T1",
                            referencedColumns: ["Id"],
                            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                        },
                    ],
                },
            ],
        });

        const edits: SchemaDesigner.SchemaDesignerEdit[] = [
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_new",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ];

        const result = await applyEdits(edits);
        expect(result.success).to.equal(true);

        expect(onMaybeAutoArrange.calledOnce).to.equal(true);
        expect(onMaybeAutoArrange.getCall(0).args).to.deep.equal([2, 2, 1, 2]);
    });

    test("add_column fails when table ref is not found (covers resolved.success===false)", async () => {
        const { applyEdits, onRequestScriptRefresh } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_column",
                table: { schema: "dbo", name: "Missing" },
                column: { name: "C1", dataType: "int" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
        expect(onRequestScriptRefresh.called).to.equal(false);
    });

    test("drop_table fails when table ref is not found (covers resolved.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "drop_table",
                table: { schema: "dbo", name: "Missing" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_table fails when table ref is not found (covers resolved.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_table",
                table: { schema: "dbo", name: "Missing" },
                set: { name: "T2" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("add_foreign_key fails when mapping references missing source column (covers src.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits, onRequestScriptRefresh } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "DoesNotExist", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
        expect(onRequestScriptRefresh.called).to.equal(false);
    });

    test("add_foreign_key fails when mapping references missing referenced column (covers tgt.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits, onRequestScriptRefresh } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const missingRefCol = "MissingRef";
        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: missingRefCol }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
        expect(result.message).to.equal(
            locConstants.schemaDesigner.referencedColumnNotFound(missingRefCol),
        );
        expect(onRequestScriptRefresh.called).to.equal(false);
    });

    test("add_foreign_key fails when referenced table is missing (covers referenced.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_Missing",
                    referencedTable: { schema: "dbo", name: "Missing" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("add_foreign_key fails on empty mappings (covers mappingsResult.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("validation_error");
    });

    test("add_foreign_key fails on invalid mapping item (covers invalid_request mapping shape)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: {
                    name: "FK_T2_T1",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{}],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("invalid_request");
    });

    test("drop_foreign_key fails when foreign key is missing (covers resolvedForeignKey.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "drop_foreign_key",
                table: { schema: "dbo", name: "T1" },
                foreignKey: { name: "FK_missing" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_foreign_key fails when foreign key is missing (covers resolvedForeignKey.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "T1" },
                foreignKey: { name: "FK_missing" },
                set: { name: "FK_new" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("add_foreign_key fails when source table is missing (covers resolvedTable.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
            ],
        });

        const result = await applyEdits([
            {
                op: "add_foreign_key",
                table: { schema: "dbo", name: "Missing" },
                foreignKey: {
                    name: "FK_missing",
                    referencedTable: { schema: "dbo", name: "T1" },
                    mappings: [{ column: "Id", referencedColumn: "Id" }],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("drop_foreign_key fails when table is missing (covers resolvedTable.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [],
        });

        const result = await applyEdits([
            {
                op: "drop_foreign_key",
                table: { schema: "dbo", name: "Missing" },
                foreignKey: { name: "FK_missing" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_foreign_key fails when table is missing (covers resolvedTable.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "Missing" },
                foreignKey: { name: "FK_missing" },
                set: { name: "FK_new" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("drop_column fails when column is missing (covers resolvedColumn.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "drop_column",
                table: { schema: "dbo", name: "T1" },
                column: { name: "MissingCol" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("drop_column fails when table is missing (covers resolvedTable.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [],
        });

        const result = await applyEdits([
            {
                op: "drop_column",
                table: { schema: "dbo", name: "Missing" },
                column: { name: "Id" },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_column fails when column is missing (covers resolvedColumn.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [
                {
                    id: "t1",
                    schema: "dbo",
                    name: "T1",
                    columns: [normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any)],
                    foreignKeys: [],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_column",
                table: { schema: "dbo", name: "T1" },
                column: { name: "MissingCol" },
                set: { isNullable: true },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_column fails when table is missing (covers resolvedTable.success===false)", async () => {
        const { applyEdits } = createApplyEditsHarness({
            tables: [],
        });

        const result = await applyEdits([
            {
                op: "set_column",
                table: { schema: "dbo", name: "Missing" },
                column: { name: "Id" },
                set: { isNullable: true },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_foreign_key fails when referenced table update is missing (covers referenced.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const fk: SchemaDesigner.ForeignKey = {
            id: "fk1",
            name: "FK_T2_T1",
            columns: ["Id"],
            referencedSchemaName: "dbo",
            referencedTableName: "T1",
            referencedColumns: ["Id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [fk] },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: { name: "FK_T2_T1" },
                set: { referencedTable: { schema: "dbo", name: "Missing" } },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_foreign_key fails when referencedTableForMappings is missing (covers referencedTableForMappings.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const fkBroken: SchemaDesigner.ForeignKey = {
            id: "fk1",
            name: "FK_T2_Missing",
            columns: ["Id"],
            referencedSchemaName: "dbo",
            referencedTableName: "Missing",
            referencedColumns: ["Id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const { applyEdits } = createApplyEditsHarness({
            tables: [
                {
                    id: "t2",
                    schema: "dbo",
                    name: "T2",
                    columns: [baseColumn],
                    foreignKeys: [fkBroken],
                },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: { name: "FK_T2_Missing" },
                set: { mappings: [{ column: "Id", referencedColumn: "Id" }] },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("not_found");
    });

    test("set_foreign_key fails on empty mappings (covers mappingsResult.success===false)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const fk: SchemaDesigner.ForeignKey = {
            id: "fk1",
            name: "FK_T2_T1",
            columns: ["Id"],
            referencedSchemaName: "dbo",
            referencedTableName: "T1",
            referencedColumns: ["Id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [fk] },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: { name: "FK_T2_T1" },
                set: { mappings: [] },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("validation_error");
    });

    test("set_foreign_key fails on invalid mapping item (covers invalid_request mapping shape)", async () => {
        const baseColumn = normalizeColumn({ id: "c1", name: "Id", dataType: "int" } as any);
        const fk: SchemaDesigner.ForeignKey = {
            id: "fk1",
            name: "FK_T2_T1",
            columns: ["Id"],
            referencedSchemaName: "dbo",
            referencedTableName: "T1",
            referencedColumns: ["Id"],
            onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
            onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        };

        const { applyEdits } = createApplyEditsHarness({
            tables: [
                { id: "t1", schema: "dbo", name: "T1", columns: [baseColumn], foreignKeys: [] },
                { id: "t2", schema: "dbo", name: "T2", columns: [baseColumn], foreignKeys: [fk] },
            ],
        });

        const result = await applyEdits([
            {
                op: "set_foreign_key",
                table: { schema: "dbo", name: "T2" },
                foreignKey: { name: "FK_T2_T1" },
                set: { mappings: [{}] },
            } as any,
        ]);

        expect(result.success).to.equal(false);
        expect(result.reason).to.equal("invalid_request");
    });
});
