/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { SchemaDesignerWebviewController } from "../../src/schemaDesigner/schemaDesignerWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { Dab } from "../../src/sharedInterfaces/dab";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import MainController from "../../src/controllers/mainController";
import {
    stubExtensionContext,
    stubUserSurvey,
    stubWebviewPanel,
    stubWebviewConnectionRpc,
} from "./utils";

chai.use(sinonChai);

suite("SchemaDesignerWebviewController tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let mockSchemaDesignerService: sinon.SinonStubbedInstance<SchemaDesigner.ISchemaDesignerService>;
    let treeNode: sinon.SinonStubbedInstance<TreeNodeInfo>;
    let schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem>;
    let mockPanel: vscode.WebviewPanel;
    let requestHandlers: Map<string, (params: any) => Promise<any>>;
    let notificationHandlers: Map<string, (params: any) => void>;

    const connectionString = "Server=localhost;Database=testdb;";
    const accessToken = "test-token";
    const databaseName = "testdb";
    const connectionUri = "localhost,1433_testdb_sa_undefined";

    const mockSchema: SchemaDesigner.Schema = {
        tables: [
            {
                id: "1",
                name: "Users",
                schema: "dbo",
                columns: [
                    {
                        id: "1",
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
            },
        ],
    };

    const mockCreateSessionResponse: SchemaDesigner.CreateSessionResponse = {
        schema: mockSchema,
        dataTypes: ["int", "varchar", "datetime"],
        schemaNames: ["dbo", "sys"],
        sessionId: "test-session-id",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = stubExtensionContext(sandbox);
        stubUserSurvey(sandbox);

        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockMainController = sandbox.createStubInstance(MainController);
        mockSchemaDesignerService = {
            createSession: sandbox.stub(),
            disposeSession: sandbox.stub(),
            publishSession: sandbox.stub(),
            getDefinition: sandbox.stub(),
            generateScript: sandbox.stub(),
            getReport: sandbox.stub(),
            onSchemaReady: sandbox.stub(),
        } as any;

        schemaDesignerCache = new Map();

        treeNode = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(treeNode, "connectionProfile").get(
            () =>
                ({
                    server: "localhost",
                    database: databaseName,
                    authenticationType: "SqlLogin",
                }) as any,
        );

        mockPanel = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(mockPanel);

        const rpc = stubWebviewConnectionRpc(sandbox);
        requestHandlers = rpc.requestHandlers;
        notificationHandlers = rpc.notificationHandlers;

        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(rpc.connection as unknown as jsonRpc.MessageConnection);

        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(true),
        } as any);

        mockMainController.sqlDocumentService = {
            newQuery: sandbox.stub().resolves(),
        } as any;

        mockMainController.connectionManager = {
            getConnectionInfo: sandbox.stub().returns({
                credentials: {
                    server: "localhost",
                    database: databaseName,
                },
            }),
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): SchemaDesignerWebviewController {
        const ctrl = new SchemaDesignerWebviewController(
            mockContext,
            mockVscodeWrapper,
            mockMainController,
            mockSchemaDesignerService,
            connectionString,
            accessToken,
            databaseName,
            schemaDesignerCache,
            treeNode,
            connectionUri,
        );
        return ctrl;
    }

    suite("Constructor and Initialization", () => {
        test("should create controller with correct parameters", () => {
            const ctrl = createController();
            expect(ctrl).to.not.be.undefined;
            expect(ctrl.schemaDesignerDetails).to.be.undefined;
        });

        test("should register all request handlers", () => {
            createController();

            expect(requestHandlers.has(SchemaDesigner.InitializeSchemaDesignerRequest.type.method))
                .to.be.true;
            expect(requestHandlers.has(SchemaDesigner.GetDefinitionRequest.type.method)).to.be.true;
            expect(requestHandlers.has(SchemaDesigner.GetReportWebviewRequest.type.method)).to.be
                .true;
            expect(requestHandlers.has(SchemaDesigner.PublishSessionRequest.type.method)).to.be
                .true;
        });

        test("should register all notification handlers", () => {
            createController();

            expect(notificationHandlers.has(SchemaDesigner.ExportToFileNotification.type.method)).to
                .be.true;
            expect(notificationHandlers.has(SchemaDesigner.CopyToClipboardNotification.type.method))
                .to.be.true;
            expect(notificationHandlers.has(SchemaDesigner.OpenInEditorNotification.type.method)).to
                .be.true;
            expect(
                notificationHandlers.has(
                    SchemaDesigner.OpenInEditorWithConnectionNotification.type.method,
                ),
            ).to.be.true;
            expect(
                notificationHandlers.has(
                    SchemaDesigner.CloseSchemaDesignerNotification.type.method,
                ),
            ).to.be.true;
        });
    });

    suite("InitializeSchemaDesignerRequest handler", () => {
        test("should create new session when not in cache", async () => {
            mockSchemaDesignerService.createSession.resolves(mockCreateSessionResponse);
            const ctrl = createController();

            const handler = requestHandlers.get(
                SchemaDesigner.InitializeSchemaDesignerRequest.type.method,
            );
            expect(handler).to.be.a("function");

            const params = {};
            const result = await handler(params);

            expect(mockSchemaDesignerService.createSession).to.have.been.calledOnceWithExactly({
                connectionString,
                accessToken,
                databaseName,
            });
            expect(result).to.deep.equal(mockCreateSessionResponse);
            expect(ctrl.schemaDesignerDetails).to.deep.equal(mockCreateSessionResponse);
            expect(schemaDesignerCache.size).to.equal(1);
        });

        test("should reuse cached session when available", async () => {
            const cacheKey = `${connectionString}-${databaseName}`;
            schemaDesignerCache.set(cacheKey, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: true,
            });

            createController();

            const handler = requestHandlers.get(
                SchemaDesigner.InitializeSchemaDesignerRequest.type.method,
            );
            const params = {};
            const result = await handler(params);

            expect(mockSchemaDesignerService.createSession).to.not.have.been.called;
            expect(result).to.deep.equal(mockCreateSessionResponse);
            expect(schemaDesignerCache.get(cacheKey)?.isDirty).to.be.true;
        });

        test("should handle initialization error", async () => {
            const error = new Error("Initialization failed");
            mockSchemaDesignerService.createSession.rejects(error);

            createController();

            const handler = requestHandlers.get(
                SchemaDesigner.InitializeSchemaDesignerRequest.type.method,
            );

            try {
                const params = {};
                await handler(params);
                expect.fail("Should have thrown");
            } catch (err) {
                expect(err).to.equal(error);
            }
        });
    });

    suite("GetDefinitionRequest handler", () => {
        test("should get definition and update cache", async () => {
            const updatedSchema: SchemaDesigner.Schema = {
                tables: [
                    {
                        ...mockSchema.tables[0],
                        name: "ModifiedUsers",
                    },
                ],
            };
            const scriptResponse: SchemaDesigner.GetDefinitionResponse = {
                script: "CREATE TABLE Users (Id INT);",
            };

            mockSchemaDesignerService.getDefinition.resolves(scriptResponse);
            schemaDesignerCache.set(`${connectionString}-${databaseName}`, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: false,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;
            (ctrl as any)._sessionId = "test-session-id";

            const handler = requestHandlers.get(SchemaDesigner.GetDefinitionRequest.type.method);
            const result = await handler({ updatedSchema });

            expect(mockSchemaDesignerService.getDefinition).to.have.been.calledOnceWithExactly({
                updatedSchema,
                sessionId: "test-session-id",
            });
            expect(result).to.deep.equal(scriptResponse);
            expect(schemaDesignerCache.get(`${connectionString}-${databaseName}`)?.isDirty).to.be
                .false;
        });
    });

    suite("GetReportWebviewRequest handler", () => {
        test("should get report successfully", async () => {
            const updatedSchema = mockSchema;
            const reportResponse: SchemaDesigner.GetReportResponse = {
                hasSchemaChanged: true,
                dacReport: {
                    report: "Report content",
                    requireTableRecreation: false,
                    possibleDataLoss: false,
                    hasWarnings: false,
                },
            };

            mockSchemaDesignerService.getReport.resolves(reportResponse);
            schemaDesignerCache.set(`${connectionString}-${databaseName}`, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: false,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;
            (ctrl as any)._sessionId = "test-session-id";

            const withProgressStub = sandbox.stub(vscode.window, "withProgress");
            withProgressStub.callsFake(async (options, task) => {
                return await task({} as any, {} as any);
            });

            const handler = requestHandlers.get(SchemaDesigner.GetReportWebviewRequest.type.method);
            const result = await handler({ updatedSchema });

            expect(result.report).to.deep.equal(reportResponse);
            expect(result.error).to.be.undefined;
            expect(schemaDesignerCache.get(`${connectionString}-${databaseName}`)?.isDirty).to.be
                .false;
        });

        test("should handle report generation error", async () => {
            const updatedSchema = mockSchema;
            const error = new Error("Report failed");

            mockSchemaDesignerService.getReport.rejects(error);
            schemaDesignerCache.set(`${connectionString}-${databaseName}`, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: false,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;
            (ctrl as any)._sessionId = "test-session-id";

            const withProgressStub = sandbox.stub(vscode.window, "withProgress");
            withProgressStub.callsFake(async (options, task) => {
                return await task({} as any, {} as any);
            });

            const handler = requestHandlers.get(SchemaDesigner.GetReportWebviewRequest.type.method);
            const result = await handler({ updatedSchema });

            expect(result.error).to.equal(error.toString());
        });
    });

    suite("PublishSessionRequest handler", () => {
        test("should publish session successfully", async () => {
            mockSchemaDesignerService.publishSession.resolves();
            schemaDesignerCache.set(`${connectionString}-${databaseName}`, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: true,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;
            (ctrl as any)._sessionId = "test-session-id";

            const handler = requestHandlers.get(SchemaDesigner.PublishSessionRequest.type.method);
            const result = await handler({ schema: mockSchema });

            expect(mockSchemaDesignerService.publishSession).to.have.been.calledOnceWithExactly({
                sessionId: "test-session-id",
            });
            expect(result.success).to.be.true;
            expect(schemaDesignerCache.get(`${connectionString}-${databaseName}`)?.isDirty).to.be
                .false;
        });

        test("should handle publish error", async () => {
            const error = new Error("Publish failed");
            mockSchemaDesignerService.publishSession.rejects(error);
            schemaDesignerCache.set(`${connectionString}-${databaseName}`, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: true,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;
            (ctrl as any)._sessionId = "test-session-id";

            const handler = requestHandlers.get(SchemaDesigner.PublishSessionRequest.type.method);
            const result = await handler({ schema: mockSchema });

            expect(result.success).to.be.false;
            expect(result.error).to.equal(error.toString());
        });
    });

    suite("ExportToFileNotification handler", () => {
        test("should register ExportToFileNotification handler", () => {
            createController();

            const handler = notificationHandlers.get(
                SchemaDesigner.ExportToFileNotification.type.method,
            );
            expect(handler).to.be.a("function");
        });
    });

    suite("CopyToClipboardNotification handler", () => {
        test("should register CopyToClipboardNotification handler", () => {
            createController();

            const handler = notificationHandlers.get(
                SchemaDesigner.CopyToClipboardNotification.type.method,
            );
            expect(handler).to.be.a("function");
        });
    });

    suite("OpenInEditorNotification handler", () => {
        test("should open script in editor without connection", async () => {
            mockSchemaDesignerService.getDefinition.resolves({ script: "CREATE TABLE Test;" });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;

            const handler = notificationHandlers.get(
                SchemaDesigner.OpenInEditorNotification.type.method,
            );
            expect(handler).to.be.a("function");

            await handler({});

            expect(mockSchemaDesignerService.getDefinition).to.have.been.calledOnce;
            expect(mockMainController.sqlDocumentService.newQuery).to.have.been.calledWith({
                content: "CREATE TABLE Test;",
                connectionStrategy: sinon.match.any,
            });
        });
    });

    suite("OpenInEditorWithConnectionNotification handler", () => {
        test("should open script with connection from TreeNode", async () => {
            mockSchemaDesignerService.generateScript.resolves({ script: "ALTER TABLE Test;" });

            createController();

            const handler = notificationHandlers.get(
                SchemaDesigner.OpenInEditorWithConnectionNotification.type.method,
            );
            expect(handler).to.be.a("function");

            handler({});

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockSchemaDesignerService.generateScript).to.have.been.calledOnce;
        });

        test("should open script with connection from connectionUri", async () => {
            mockSchemaDesignerService.generateScript.resolves({ script: "ALTER TABLE Test;" });

            // Create controller without TreeNode to use connectionUri path
            new SchemaDesignerWebviewController(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                connectionString,
                accessToken,
                databaseName,
                schemaDesignerCache,
                undefined, // no treeNode
                connectionUri,
            );

            const handler = notificationHandlers.get(
                SchemaDesigner.OpenInEditorWithConnectionNotification.type.method,
            );

            handler({});

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockSchemaDesignerService.generateScript).to.have.been.calledOnce;
            expect(mockMainController.connectionManager.getConnectionInfo).to.have.been.calledWith(
                connectionUri,
            );
        });

        test("should handle script generation error", async () => {
            const error = new Error("Script generation failed");
            mockSchemaDesignerService.generateScript.rejects(error);

            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

            createController();

            const handler = notificationHandlers.get(
                SchemaDesigner.OpenInEditorWithConnectionNotification.type.method,
            );

            handler({});

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockSchemaDesignerService.generateScript).to.have.been.calledOnce;
            expect(showErrorStub).to.have.been.calledOnce;
        });
    });

    suite("CloseSchemaDesignerNotification handler", () => {
        test("should close the panel", () => {
            createController();

            const handler = notificationHandlers.get(
                SchemaDesigner.CloseSchemaDesignerNotification.type.method,
            );
            expect(handler).to.be.a("function");

            handler({});

            expect(mockPanel.dispose).to.have.been.calledOnce;
        });
    });

    suite("updateCacheItem", () => {
        test("should update schema in cache", () => {
            const cacheKey = `${connectionString}-${databaseName}`;
            const initialSchema = JSON.parse(JSON.stringify(mockSchema));
            schemaDesignerCache.set(cacheKey, {
                schemaDesignerDetails: { ...mockCreateSessionResponse, schema: initialSchema },
                baselineSchema: initialSchema,
                isDirty: false,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = { ...mockCreateSessionResponse, schema: initialSchema };

            const updatedSchema: SchemaDesigner.Schema = {
                tables: [
                    {
                        id: "2",
                        name: "Products",
                        schema: "dbo",
                        columns: [],
                        foreignKeys: [],
                    },
                ],
            };

            (ctrl as any).updateCacheItem(updatedSchema, true);

            const cachedItem = schemaDesignerCache.get(cacheKey);
            expect(cachedItem?.schemaDesignerDetails.schema).to.deep.equal(updatedSchema);
            expect(cachedItem?.isDirty).to.be.true;
        });

        test("should preserve isDirty when not provided", () => {
            const cacheKey = `${connectionString}-${databaseName}`;
            schemaDesignerCache.set(cacheKey, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: true,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;

            (ctrl as any).updateCacheItem(undefined, undefined);

            const cachedItem = schemaDesignerCache.get(cacheKey);
            expect(cachedItem?.isDirty).to.be.true;
        });

        test("should update only isDirty when schema not provided", () => {
            const cacheKey = `${connectionString}-${databaseName}`;
            const initialSchema = JSON.parse(JSON.stringify(mockSchema));
            schemaDesignerCache.set(cacheKey, {
                schemaDesignerDetails: { ...mockCreateSessionResponse, schema: initialSchema },
                baselineSchema: initialSchema,
                isDirty: true,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = { ...mockCreateSessionResponse, schema: initialSchema };

            (ctrl as any).updateCacheItem(undefined, false);

            const cachedItem = schemaDesignerCache.get(cacheKey);
            expect(cachedItem?.isDirty).to.be.false;
        });
    });

    suite("dispose", () => {
        test("should update cache on dispose", async () => {
            const cacheKey = `${connectionString}-${databaseName}`;
            schemaDesignerCache.set(cacheKey, {
                schemaDesignerDetails: mockCreateSessionResponse,
                baselineSchema: mockCreateSessionResponse.schema,
                isDirty: false,
            });

            const ctrl = createController();
            ctrl.schemaDesignerDetails = mockCreateSessionResponse;

            const updateCacheItemSpy = sandbox.spy(ctrl as any, "updateCacheItem");

            await ctrl.dispose();

            expect(updateCacheItemSpy).to.have.been.calledOnce;
        });

        test("should not call updateCacheItem when schemaDesignerDetails is undefined", async () => {
            const ctrl = createController();
            ctrl.schemaDesignerDetails = undefined;

            const updateCacheItemSpy = sandbox.spy(ctrl as any, "updateCacheItem");

            await ctrl.dispose();

            expect(updateCacheItemSpy).to.not.have.been.called;
        });
    });

    suite("DAB Request Handlers", () => {
        const mockDabConfig: Dab.DabConfig = {
            apiTypes: [Dab.ApiType.Rest],
            entities: [
                {
                    id: "1",
                    tableName: "Users",
                    schemaName: "dbo",
                    isEnabled: true,
                    enabledActions: [
                        Dab.EntityAction.Create,
                        Dab.EntityAction.Read,
                        Dab.EntityAction.Update,
                        Dab.EntityAction.Delete,
                    ],
                    advancedSettings: {
                        entityName: "Users",
                        authorizationRole: Dab.AuthorizationRole.Anonymous,
                    },
                },
            ],
        };

        suite("GenerateConfigRequest handler", () => {
            test("should register GenerateConfigRequest handler", () => {
                createController();

                expect(requestHandlers.has(Dab.GenerateConfigRequest.type.method)).to.be.true;
            });

            test("should generate config and return success response", async () => {
                createController();

                const handler = requestHandlers.get(Dab.GenerateConfigRequest.type.method);
                expect(handler).to.be.a("function");

                const result = await handler({ config: mockDabConfig });

                expect(result.success).to.be.true;
                expect(result.configContent).to.be.a("string");
                expect(result.configContent.length).to.be.greaterThan(0);

                // Verify the generated config is valid JSON
                const parsedConfig = JSON.parse(result.configContent);
                expect(parsedConfig).to.have.property("$schema");
                expect(parsedConfig).to.have.property("data-source");
                expect(parsedConfig).to.have.property("entities");
            });

            test("should include connection string in generated config", async () => {
                createController();

                const handler = requestHandlers.get(Dab.GenerateConfigRequest.type.method);
                const result = await handler({ config: mockDabConfig });

                const parsedConfig = JSON.parse(result.configContent);
                expect(parsedConfig["data-source"]["connection-string"]).to.equal(connectionString);
            });
        });

        suite("OpenConfigInEditorNotification handler", () => {
            test("should register OpenConfigInEditorNotification handler", () => {
                createController();

                expect(notificationHandlers.has(Dab.OpenConfigInEditorNotification.type.method)).to
                    .be.true;
            });

            test("should open config content in a new editor", async () => {
                const mockDocument = { uri: { fsPath: "test.json" } };
                const openTextDocumentStub = sandbox
                    .stub(vscode.workspace, "openTextDocument")
                    .resolves(mockDocument as any);
                const showTextDocumentStub = sandbox
                    .stub(vscode.window, "showTextDocument")
                    .resolves();

                createController();

                const handler = notificationHandlers.get(
                    Dab.OpenConfigInEditorNotification.type.method,
                );
                expect(handler).to.be.a("function");

                const configContent = '{"$schema": "test"}';
                await handler({ configContent });

                expect(openTextDocumentStub).to.have.been.calledOnceWith({
                    content: configContent,
                    language: "json",
                });
                expect(showTextDocumentStub).to.have.been.calledOnceWith(mockDocument);
            });
        });

        suite("CopyConfigNotification handler", () => {
            test("should register CopyConfigNotification handler", () => {
                createController();

                expect(notificationHandlers.has(Dab.CopyConfigNotification.type.method)).to.be.true;
            });

            test("should copy config content to clipboard and show notification", async () => {
                const writeTextStub = sandbox.stub().resolves();
                sandbox.stub(vscode.env, "clipboard").value({
                    writeText: writeTextStub,
                });
                const showInfoStub = sandbox
                    .stub(vscode.window, "showInformationMessage")
                    .resolves();

                createController();

                const handler = notificationHandlers.get(Dab.CopyConfigNotification.type.method);
                expect(handler).to.be.a("function");

                const configContent = '{"$schema": "test"}';
                await handler({ configContent });

                expect(writeTextStub).to.have.been.calledOnceWith(configContent);
                expect(showInfoStub).to.have.been.calledOnce;
            });
        });
    });
});
