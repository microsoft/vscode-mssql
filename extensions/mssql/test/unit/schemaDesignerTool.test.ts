/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { createHash } from "crypto";
import {
    SchemaDesignerTool,
    SchemaDesignerToolParams,
} from "../../src/copilot/tools/schemaDesignerTool";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { SchemaDesignerWebviewManager } from "../../src/schemaDesigner/schemaDesignerWebviewManager";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { MssqlChatAgent as loc } from "../../src/constants/locConstants";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("SchemaDesignerTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockToken: vscode.CancellationToken;
    let showSchemaStub: sinon.SinonStub;
    let schemaDesignerTool: SchemaDesignerTool;

    const sampleConnectionId = "connection-schema-123";
    const sampleDatabase = "SampleDb";

    const mockSchema: SchemaDesigner.Schema = {
        tables: [
            {
                id: "t1",
                name: "Orders",
                schema: "dbo",
                columns: [],
                foreignKeys: [],
            },
        ],
    };

    const mockTable: SchemaDesigner.Table = {
        id: "t2",
        name: "Customers",
        schema: "dbo",
        columns: [],
        foreignKeys: [],
    };

    const computeSchemaHash = (schema: SchemaDesigner.Schema) =>
        createHash("sha256")
            .update(JSON.stringify(normalizeSchemaForHash(schema)))
            .digest("hex");

    const normalizeSchemaForHash = (schema: SchemaDesigner.Schema): SchemaDesigner.Schema => {
        const tables = [...(schema.tables ?? [])].sort((a, b) =>
            compareKeys(tableSortKey(a), tableSortKey(b)),
        );
        return {
            tables: tables.map((table) => ({
                id: table.id,
                name: table.name,
                schema: table.schema,
                columns: [...(table.columns ?? [])]
                    .sort((a, b) => compareKeys(columnSortKey(a), columnSortKey(b)))
                    .map((column) => ({
                        id: column.id,
                        name: column.name,
                        dataType: column.dataType,
                        maxLength: column.maxLength,
                        precision: column.precision,
                        scale: column.scale,
                        isPrimaryKey: column.isPrimaryKey,
                        isIdentity: column.isIdentity,
                        identitySeed: column.identitySeed,
                        identityIncrement: column.identityIncrement,
                        isNullable: column.isNullable,
                        defaultValue: column.defaultValue,
                        isComputed: column.isComputed,
                        computedFormula: column.computedFormula,
                        computedPersisted: column.computedPersisted,
                    })),
                foreignKeys: [...(table.foreignKeys ?? [])]
                    .sort((a, b) => compareKeys(foreignKeySortKey(a), foreignKeySortKey(b)))
                    .map((foreignKey) => ({
                        id: foreignKey.id,
                        name: foreignKey.name,
                        columns: [...(foreignKey.columns ?? [])],
                        referencedSchemaName: foreignKey.referencedSchemaName,
                        referencedTableName: foreignKey.referencedTableName,
                        referencedColumns: [...(foreignKey.referencedColumns ?? [])],
                        onDeleteAction: foreignKey.onDeleteAction,
                        onUpdateAction: foreignKey.onUpdateAction,
                    })),
            })),
        };
    };

    const tableSortKey = (table: SchemaDesigner.Table) =>
        `${table.schema ?? ""}.${table.name ?? ""}.${table.id ?? ""}`;
    const columnSortKey = (column: SchemaDesigner.Column) =>
        `${column.id ?? ""}.${column.name ?? ""}.${column.dataType ?? ""}`;
    const foreignKeySortKey = (foreignKey: SchemaDesigner.ForeignKey) =>
        `${foreignKey.id ?? ""}.${foreignKey.name ?? ""}.${foreignKey.referencedSchemaName ?? ""}.${foreignKey.referencedTableName ?? ""}`;
    const compareKeys = (left: string, right: string) => left.localeCompare(right);

    setup(() => {
        sandbox = sinon.createSandbox();

        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        showSchemaStub = sandbox.stub().resolves();
        mockToken = {} as vscode.CancellationToken;

        schemaDesignerTool = new SchemaDesignerTool(mockConnectionManager, showSchemaStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("call - show", () => {
        test("should return error when connectionId is missing", async () => {
            const options = {
                input: {
                    operation: "show",
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerMissingConnectionId);
            expect(showSchemaStub).to.not.have.been.called;
        });

        test("should return error when connection is not found", async () => {
            mockConnectionManager.getConnectionInfo.returns(undefined as any);

            const options = {
                input: {
                    operation: "show",
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.noConnectionError(sampleConnectionId));
            expect(showSchemaStub).to.not.have.been.called;
        });

        test("should open designer when connectionId is provided", async () => {
            const mockCredentials = {
                database: sampleDatabase,
            } as IConnectionProfile;

            const mockConnectionInfo = {
                connectionId: sampleConnectionId,
                credentials: mockCredentials,
            } as unknown as ConnectionInfo;

            mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

            const options = {
                input: {
                    operation: "show",
                    connectionId: sampleConnectionId,
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.showSchemaToolSuccessMessage);
            expect(showSchemaStub).to.have.been.calledOnceWith(sampleConnectionId, sampleDatabase);
        });
    });

    suite("call - active designer operations", () => {
        function stubActiveDesigner(
            designer: any,
            schema: SchemaDesigner.Schema = mockSchema,
            previousHash?: string,
        ) {
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(designer),
                getSchemaHash: sandbox.stub().returns(previousHash),
                setSchemaHash: sandbox.stub(),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);
            if (designer) {
                designer.designerKey = designer.designerKey ?? "designer-key";
                designer.getSchemaState = sandbox.stub().resolves(schema);
            }
            return managerStub;
        }

        test("should return error when no active designer exists", async () => {
            stubActiveDesigner(undefined);

            const options = {
                input: {
                    operation: "add_table",
                    payload: {
                        tableName: "Orders",
                        schemaName: "dbo",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerNoActiveDesigner);
        });

        test("should return stale state when schema changes between calls", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, "stale-hash");

            const options = {
                input: {
                    operation: "add_table",
                    payload: {
                        tableName: "Orders",
                        schemaName: "dbo",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("stale_state");
            expect(parsedResult.message).to.equal(loc.schemaDesignerStaleState);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
        });

        test("should return stale state on first call for a new designer", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, undefined);

            const options = {
                input: {
                    operation: "add_table",
                    payload: {
                        tableName: "Orders",
                        schemaName: "dbo",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("stale_state");
            expect(parsedResult.message).to.equal(loc.schemaDesignerStaleState);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
        });

        test("should add a table", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
                addTable: sandbox.stub().resolves({ success: true, schema: mockSchema }),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "add_table",
                    payload: {
                        tableName: "Orders",
                        schemaName: "dbo",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.schemaDesignerAddTableSuccess);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
            expect(mockDesigner.addTable).to.have.been.calledOnceWith("Orders", "dbo", undefined);
        });

        test("should return error when update_table payload is missing", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "update_table",
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerMissingTable);
            expect(mockDesigner.revealToForeground).to.not.have.been.called;
        });

        test("should update a table", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
                updateTable: sandbox.stub().resolves({ success: true, schema: mockSchema }),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "update_table",
                    payload: {
                        table: mockTable,
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.schemaDesignerUpdateTableSuccess);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
            expect(mockDesigner.updateTable).to.have.been.calledOnceWith(mockTable);
        });

        test("should return error when delete_table has no target", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "delete_table",
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerMissingDeleteTableTarget);
            expect(mockDesigner.revealToForeground).to.not.have.been.called;
        });

        test("should delete a table", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
                deleteTable: sandbox.stub().resolves({ success: true, schema: mockSchema }),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "delete_table",
                    payload: {
                        tableName: "Orders",
                        schemaName: "dbo",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.schemaDesignerDeleteTableSuccess);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
            expect(mockDesigner.deleteTable).to.have.been.calledOnceWith({
                tableId: undefined,
                tableName: "Orders",
                schemaName: "dbo",
            });
        });

        test("should return error when replace_schema payload is missing", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "replace_schema",
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerMissingSchema);
            expect(mockDesigner.revealToForeground).to.not.have.been.called;
        });

        test("should replace schema", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
                replaceSchemaState: sandbox.stub().resolves({ success: true, schema: mockSchema }),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "replace_schema",
                    payload: {
                        schema: mockSchema,
                    },
                    options: {
                        keepPositions: false,
                        focusTableId: "t1",
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.schemaDesignerReplaceSchemaSuccess);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
            expect(mockDesigner.replaceSchemaState).to.have.been.calledOnceWith(
                mockSchema,
                false,
                "t1",
            );
        });

        test("should return schema state", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            const managerStub = stubActiveDesigner(
                mockDesigner,
                mockSchema,
                computeSchemaHash(mockSchema),
            );

            const options = {
                input: {
                    operation: "get_schema",
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.message).to.equal(loc.schemaDesignerGetSchemaSuccess);
            expect(parsedResult.schema).to.deep.equal(mockSchema);
            expect(parsedResult.designerKey).to.equal(mockDesigner.designerKey);
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
            expect(mockDesigner.getSchemaState).to.have.been.calledOnce;
            expect(managerStub.setSchemaHash).to.have.been.calledOnceWith(
                mockDesigner.designerKey,
                computeSchemaHash(mockSchema),
            );
        });

        test("should return error for unknown operation", async () => {
            const mockDesigner = {
                revealToForeground: sandbox.stub(),
            } as any;

            stubActiveDesigner(mockDesigner, mockSchema, computeSchemaHash(mockSchema));

            const options = {
                input: {
                    operation: "unknown" as any,
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.message).to.equal(loc.schemaDesignerUnknownOperation("unknown"));
            expect(mockDesigner.revealToForeground).to.not.have.been.called;
        });
    });

    suite("prepareInvocation", () => {
        test("should include operation in confirmation and invocation messages", async () => {
            const options = {
                input: {
                    operation: "add_table",
                },
            } as vscode.LanguageModelToolInvocationPrepareOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.prepareInvocation(options, mockToken);

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.title).to.include("Schema Designer");
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.confirmationMessages.message.value).to.include("add_table");
            expect(result.invocationMessage).to.include("add_table");
        });
    });
});
