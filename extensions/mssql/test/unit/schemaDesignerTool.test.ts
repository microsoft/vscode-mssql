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
import { SchemaDesignerWebviewController } from "../../src/schemaDesigner/schemaDesignerWebviewController";

chai.use(sinonChai);

suite("SchemaDesignerTool Tests (vNext)", () => {
    let sandbox: sinon.SinonSandbox;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockToken: vscode.CancellationToken;
    let showSchemaStub: sinon.SinonStub;
    let schemaDesignerTool: SchemaDesignerTool;

    const sampleConnectionId = "connection-schema-123";
    const sampleDatabase = "SampleDb";
    const sampleServer = "testserver";

    const mockSchema: SchemaDesigner.Schema = {
        tables: [
            {
                id: "t1",
                name: "Orders",
                schema: "dbo",
                columns: [
                    {
                        id: "c1",
                        name: "OrderId",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                ],
                foreignKeys: [],
            },
        ],
    };

    const computeSchemaVersion = (schema: SchemaDesigner.Schema) =>
        createHash("sha256")
            .update(JSON.stringify(normalizeSchemaForVersion(schema)))
            .digest("hex");

    const normalizeSchemaForVersion = (schema: SchemaDesigner.Schema): SchemaDesigner.Schema => {
        const tables = [...(schema.tables ?? [])]
            .map((t) => ({
                ...t,
                name: (t.name ?? "").toLowerCase(),
                schema: (t.schema ?? "").toLowerCase(),
                columns: (t.columns ?? []).map((c) => ({
                    ...c,
                    name: (c.name ?? "").toLowerCase(),
                    dataType: (c.dataType ?? "").toLowerCase(),
                })),
                foreignKeys: (t.foreignKeys ?? []).map((fk) => ({
                    ...fk,
                    name: (fk.name ?? "").toLowerCase(),
                    columns: (fk.columns ?? []).map((c) => c.toLowerCase()),
                    referencedSchemaName: (fk.referencedSchemaName ?? "").toLowerCase(),
                    referencedTableName: (fk.referencedTableName ?? "").toLowerCase(),
                    referencedColumns: (fk.referencedColumns ?? []).map((c) => c.toLowerCase()),
                })),
            }))
            .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));

        return {
            tables: tables.map((t) => ({
                name: t.name,
                schema: t.schema,
                columns: [...(t.columns ?? [])]
                    .sort((a, b) =>
                        `${a.name}.${a.dataType}`.localeCompare(`${b.name}.${b.dataType}`),
                    )
                    .map((c) => ({
                        name: c.name,
                        dataType: c.dataType,
                        maxLength: c.maxLength,
                        precision: c.precision,
                        scale: c.scale,
                        isPrimaryKey: c.isPrimaryKey,
                        isIdentity: c.isIdentity,
                        identitySeed: c.identitySeed,
                        identityIncrement: c.identityIncrement,
                        isNullable: c.isNullable,
                        defaultValue: c.defaultValue,
                        isComputed: c.isComputed,
                        computedFormula: c.computedFormula,
                        computedPersisted: c.computedPersisted,
                    })) as any,
                foreignKeys: [...(t.foreignKeys ?? [])]
                    .sort((a, b) =>
                        `${a.name}.${a.referencedSchemaName}.${a.referencedTableName}`.localeCompare(
                            `${b.name}.${b.referencedSchemaName}.${b.referencedTableName}`,
                        ),
                    )
                    .map((fk) => ({
                        name: fk.name,
                        columns: fk.columns,
                        referencedSchemaName: fk.referencedSchemaName,
                        referencedTableName: fk.referencedTableName,
                        referencedColumns: fk.referencedColumns,
                        onDeleteAction: fk.onDeleteAction,
                        onUpdateAction: fk.onUpdateAction,
                    })) as any,
            })) as any,
        };
    };

    const expectNoSchemaDump = (parsed: any) => {
        expect(parsed).to.not.have.property("schema");
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockToken = {} as vscode.CancellationToken;
        showSchemaStub = sandbox.stub();

        schemaDesignerTool = new SchemaDesignerTool(mockConnectionManager, showSchemaStub as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("show", () => {
        test("returns invalid_request when connectionId is missing", async () => {
            const options = {
                input: {
                    operation: "show",
                },
            } as any as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("invalid_request");
            expect(parsedResult.message).to.equal(loc.schemaDesignerMissingConnectionId);
            expect(showSchemaStub).to.not.have.been.called;
            expectNoSchemaDump(parsedResult);
        });

        test("opens designer and returns a version (no schema)", async () => {
            const mockCredentials = {
                database: sampleDatabase,
            } as IConnectionProfile;

            const mockConnectionInfo = {
                connectionId: sampleConnectionId,
                credentials: mockCredentials,
            } as unknown as ConnectionInfo;

            mockConnectionManager.getConnectionInfo.returns(mockConnectionInfo);

            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.getSchemaState.resolves(mockSchema);

            showSchemaStub.resolves(mockDesigner);

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
            expect(parsedResult.version).to.equal(computeSchemaVersion(mockSchema));
            expect(parsedResult.server).to.equal(sampleServer);
            expect(parsedResult.database).to.equal(sampleDatabase);
            expect(showSchemaStub).to.have.been.calledOnceWith(sampleConnectionId, sampleDatabase);
            expectNoSchemaDump(parsedResult);
        });
    });

    suite("get_overview", () => {
        test("returns no_active_designer when no active designer exists", async () => {
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(undefined),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_overview" },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("no_active_designer");
            expect(parsedResult.message).to.equal(loc.schemaDesignerNoActiveDesigner);
            expectNoSchemaDump(parsedResult);
        });

        test("omits columns over threshold (>40 tables)", async () => {
            const largeSchema: SchemaDesigner.Schema = {
                tables: Array.from({ length: 41 }).map((_, i) => ({
                    id: `t${i}`,
                    name: `T${i}`,
                    schema: "dbo",
                    columns: [
                        {
                            id: `c${i}`,
                            name: "Id",
                            dataType: "int",
                            maxLength: "",
                            precision: 0,
                            scale: 0,
                            isPrimaryKey: true,
                            isIdentity: true,
                            identitySeed: 1,
                            identityIncrement: 1,
                            isNullable: false,
                            defaultValue: "",
                            isComputed: false,
                            computedFormula: "",
                            computedPersisted: false,
                        },
                    ],
                    foreignKeys: [],
                })),
            };

            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.getSchemaState.resolves(largeSchema);

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_overview", options: { includeColumns: "namesAndTypes" } },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.version).to.equal(computeSchemaVersion(largeSchema));
            expect(parsedResult.overview.columnsOmitted).to.equal(true);
            expect(parsedResult.overview.tables).to.have.length(41);
            expect(parsedResult.overview.tables[0]).to.not.have.property("columns");
            expectNoSchemaDump(parsedResult);
        });
    });

    suite("get_table", () => {
        test("returns not_found for unknown table ref", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.getSchemaState.resolves(mockSchema);

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "get_table",
                    payload: { table: { schema: "dbo", name: "Missing" } },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("not_found");
            expect(parsedResult.server).to.equal(sampleServer);
            expect(parsedResult.database).to.equal(sampleDatabase);
            expectNoSchemaDump(parsedResult);
        });
    });

    suite("apply_edits", () => {
        test("returns target_mismatch when targetHint does not match active designer", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.getSchemaState.resolves(mockSchema);

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_edits",
                    payload: {
                        expectedVersion: computeSchemaVersion(mockSchema),
                        targetHint: { server: "otherserver", database: sampleDatabase },
                        edits: [{ op: "add_table", table: { schema: "dbo", name: "X" } }],
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("target_mismatch");
            expect(parsedResult.activeTarget).to.deep.equal({
                server: sampleServer,
                database: sampleDatabase,
            });
            expect(parsedResult.targetHint).to.deep.equal({
                server: "otherserver",
                database: sampleDatabase,
            });
            expectNoSchemaDump(parsedResult);
        });

        test("returns stale_state with currentVersion + bounded currentOverview", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.getSchemaState.resolves(mockSchema);

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_edits",
                    payload: {
                        expectedVersion: "some-other-version",
                        edits: [{ op: "add_table", table: { schema: "dbo", name: "X" } }],
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("stale_state");
            expect(parsedResult.currentVersion).to.equal(computeSchemaVersion(mockSchema));
            expect(parsedResult.currentOverview).to.exist;
            expect(parsedResult.currentOverview.columnsOmitted).to.equal(false);
            expect(parsedResult.currentOverview.tables[0]).to.have.property("columns");
            expect(parsedResult.suggestedNextCall).to.deep.equal({
                operation: "get_overview",
                options: { includeColumns: "namesAndTypes" },
            });
            expectNoSchemaDump(parsedResult);
        });

        test("returns validation_error with failedEditIndex/appliedEdits and post-partial currentVersion", async () => {
            const startSchema = mockSchema;
            const expectedVersion = computeSchemaVersion(startSchema);

            const postPartialSchema: SchemaDesigner.Schema = {
                tables: [
                    ...startSchema.tables,
                    {
                        id: "t2",
                        name: "X",
                        schema: "dbo",
                        columns: [],
                        foreignKeys: [],
                    },
                ],
            };

            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.revealToForeground = sandbox.stub() as any;
            mockDesigner.getSchemaState.resolves(startSchema);
            mockDesigner.applyEdits.resolves({
                success: false,
                reason: "validation_error",
                message: "Column already exists",
                failedEditIndex: 1,
                appliedEdits: 1,
                schema: postPartialSchema,
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_edits",
                    payload: {
                        expectedVersion,
                        edits: [
                            { op: "add_table", table: { schema: "dbo", name: "X" } },
                            {
                                op: "add_column",
                                table: { schema: "dbo", name: "X" },
                                column: { name: "Id", dataType: "int" },
                            },
                        ],
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.false;
            expect(parsedResult.reason).to.equal("validation_error");
            expect(parsedResult.failedEditIndex).to.equal(1);
            expect(parsedResult.appliedEdits).to.equal(1);
            expect(parsedResult.currentVersion).to.equal(computeSchemaVersion(postPartialSchema));
            expectNoSchemaDump(parsedResult);
        });

        test("returns receipt + new version on success (no schema)", async () => {
            const startSchema = mockSchema;
            const expectedVersion = computeSchemaVersion(startSchema);

            const postSchema: SchemaDesigner.Schema = {
                tables: [
                    ...startSchema.tables,
                    {
                        id: "t2",
                        name: "X",
                        schema: "dbo",
                        columns: [],
                        foreignKeys: [],
                    },
                ],
            };

            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => sampleServer);
            sandbox.stub(mockDesigner as any, "database").get(() => sampleDatabase);
            mockDesigner.revealToForeground = sandbox.stub() as any;
            mockDesigner.getSchemaState.resolves(startSchema);
            mockDesigner.applyEdits.resolves({
                success: true,
                appliedEdits: 1,
                schema: postSchema,
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_edits",
                    payload: {
                        expectedVersion,
                        edits: [{ op: "add_table", table: { schema: "dbo", name: "X" } }],
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>;

            const result = await schemaDesignerTool.call(options, mockToken);
            const parsedResult = JSON.parse(result);

            expect(parsedResult.success).to.be.true;
            expect(parsedResult.version).to.equal(computeSchemaVersion(postSchema));
            expect(parsedResult.receipt.appliedEdits).to.equal(1);
            expect(parsedResult.receipt).to.have.property("changes");
            expectNoSchemaDump(parsedResult);
        });
    });
});
