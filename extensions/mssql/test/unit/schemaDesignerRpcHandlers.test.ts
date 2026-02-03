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

suite("schemaDesignerRpcHandlers", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("apply_edits handler calls onMaybeAutoArrange with table/fk pre+post counts", async () => {
        let currentSchema: SchemaDesigner.Schema = { tables: [] };

        const applyHandlerStub = sandbox.stub();
        const extensionRpc = {
            onRequest: sandbox.stub().callsFake((_type: any, handler: any) => {
                applyHandlerStub.callsFake(handler);
            }),
        };

        const onMaybeAutoArrange = sandbox.stub();

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
            deleteTable: sandbox.stub().resolves(true),
            normalizeColumn: (c) => normalizeColumn(c),
            normalizeTable: (t) => t,
            validateTable: () => undefined,
            onPushUndoState: sandbox.stub(),
            onRequestScriptRefresh: sandbox.stub(),
        });

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

        const result = await applyHandlerStub({ edits } as any);
        expect(result.success).to.equal(true);

        expect(onMaybeAutoArrange.calledOnce).to.equal(true);
        expect(onMaybeAutoArrange.getCall(0).args).to.deep.equal([0, 5, 0, 3]);
    });

    test("apply_edits handler counts existing foreign keys in preSchema", async () => {
        let currentSchema: SchemaDesigner.Schema = {
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
        };

        const applyHandlerStub = sandbox.stub();
        const extensionRpc = {
            onRequest: sandbox.stub().callsFake((_type: any, handler: any) => {
                applyHandlerStub.callsFake(handler);
            }),
        };

        const onMaybeAutoArrange = sandbox.stub();

        const updateTable = sandbox.stub().callsFake(async (table: SchemaDesigner.Table) => {
            currentSchema = {
                tables: currentSchema.tables.map((t) => (t.id === table.id ? table : t)),
            };
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
            addTable: sandbox.stub().resolves(true),
            updateTable,
            deleteTable: sandbox.stub().resolves(true),
            normalizeColumn: (c) => normalizeColumn(c),
            normalizeTable: (t) => t,
            validateTable: () => undefined,
            onPushUndoState: sandbox.stub(),
            onRequestScriptRefresh: sandbox.stub(),
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

        const result = await applyHandlerStub({ edits } as any);
        expect(result.success).to.equal(true);

        expect(onMaybeAutoArrange.calledOnce).to.equal(true);
        expect(onMaybeAutoArrange.getCall(0).args).to.deep.equal([2, 2, 1, 2]);
    });
});
