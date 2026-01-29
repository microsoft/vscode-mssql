/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import { SchemaDesignerWebviewManager } from "../../src/schemaDesigner/schemaDesignerWebviewManager";
import { SchemaDesignerWebviewController } from "../../src/schemaDesigner/schemaDesignerWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import MainController from "../../src/controllers/mainController";
import { stubExtensionContext, stubUserSurvey, stubWebviewPanel } from "./utils";
import * as LocConstants from "../../src/constants/locConstants";

chai.use(sinonChai);

suite("SchemaDesignerWebviewManager tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let mockSchemaDesignerService: sinon.SinonStubbedInstance<SchemaDesigner.ISchemaDesignerService>;
    let manager: SchemaDesignerWebviewManager;
    let treeNode: sinon.SinonStubbedInstance<TreeNodeInfo>;
    let mockPanel: vscode.WebviewPanel;

    const databaseName = "testdb";
    const connectionString = "Server=localhost;Database=testdb;";
    const connectionUri = "localhost,1433_testdb_sa_undefined";

    const mockSchema: SchemaDesigner.Schema = {
        tables: [
            {
                id: "1",
                name: "Users",
                schema: "dbo",
                columns: [],
                foreignKeys: [],
            },
        ],
    };

    const mockCreateSessionResponse: SchemaDesigner.CreateSessionResponse = {
        schema: mockSchema,
        dataTypes: ["int", "varchar"],
        schemaNames: ["dbo"],
        sessionId: "test-session-id",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = stubExtensionContext(sandbox);
        stubUserSurvey(sandbox);

        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockMainController = sandbox.createStubInstance(MainController);
        mockSchemaDesignerService = {
            createSession: sandbox.stub().resolves(mockCreateSessionResponse),
            disposeSession: sandbox.stub().resolves(),
            publishSession: sandbox.stub().resolves(),
            getDefinition: sandbox.stub().resolves({ script: "" }),
            generateScript: sandbox.stub().resolves({ script: "" }),
            getReport: sandbox.stub().resolves(),
            onSchemaReady: sandbox.stub(),
        } as any;

        treeNode = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(treeNode, "connectionProfile").get(
            () =>
                ({
                    server: "localhost",
                    database: databaseName,
                    authenticationType: "SqlLogin",
                    azureAccountToken: "token-from-tree",
                }) as any,
        );

        treeNode.updateConnectionProfile = sandbox.stub();

        mockMainController.connectionManager = {
            createConnectionDetails: sandbox.stub().resolves({
                server: "localhost",
                database: databaseName,
            }),
            getConnectionString: sandbox.stub().resolves(connectionString),
            prepareConnectionInfo: sandbox
                .stub()
                .callsFake((connInfo) => Promise.resolve(connInfo)),
            getConnectionInfo: sandbox.stub().returns({
                credentials: {
                    server: "localhost",
                    database: databaseName,
                    azureAccountToken: "token-from-uri",
                },
            }),
        } as any;

        mockMainController.sqlDocumentService = {
            newQuery: sandbox.stub().resolves(),
        } as any;

        mockPanel = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(mockPanel);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns(true),
        } as any);

        manager = SchemaDesignerWebviewManager.getInstance();
        // Clear internal state
        (manager as any).schemaDesigners.clear();
        (manager as any).schemaDesignerCache.clear();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("getInstance", () => {
        test("should return singleton instance", () => {
            const instance1 = SchemaDesignerWebviewManager.getInstance();
            const instance2 = SchemaDesignerWebviewManager.getInstance();

            expect(instance1).to.equal(instance2);
        });
    });

    suite("getSchemaDesigner with TreeNode", () => {
        test("should create new schema designer when not cached", async () => {
            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            expect(designer).to.be.instanceOf(SchemaDesignerWebviewController);
            expect(mockMainController.connectionManager.createConnectionDetails).to.have.been
                .calledOnce;
            expect(mockMainController.connectionManager.prepareConnectionInfo).to.have.been
                .calledOnce;
            expect(mockMainController.connectionManager.getConnectionString).to.have.been
                .calledOnce;
        });

        test("should update connection profile with database name", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            expect(treeNode.updateConnectionProfile).to.have.been.calledOnce;
        });
    });

    suite("getSchemaDesigner with connectionUri", () => {
        test("should create new schema designer using connection URI", async () => {
            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                undefined,
                connectionUri,
            );

            expect(designer).to.be.instanceOf(SchemaDesignerWebviewController);
            expect(
                mockMainController.connectionManager.getConnectionInfo,
            ).to.have.been.calledOnceWith(connectionUri);
            expect(
                mockMainController.connectionManager.getConnectionString,
            ).to.have.been.calledWith(connectionUri, true, true);
        });

        test("should use azureAccountToken from connection URI", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                undefined,
                connectionUri,
            );

            expect(mockMainController.connectionManager.getConnectionInfo).to.have.been.calledOnce;
        });
    });

    suite("Recreate designer after disposal", () => {
        test("should create new designer after previous one is disposed", async () => {
            const designer1 = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            // Mark as disposed
            sandbox.stub(designer1, "isDisposed").get(() => true);

            const designer2 = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            expect(designer2).to.not.equal(designer1);
            expect(designer2).to.be.instanceOf(SchemaDesignerWebviewController);
        });
    });

    suite("Multiple databases", () => {
        test("should maintain separate designers for different databases", async () => {
            const database1 = "testdb1";
            const database2 = "testdb2";

            const designer1 = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                database1,
                treeNode,
                undefined,
            );

            const designer2 = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                database2,
                treeNode,
                undefined,
            );

            expect(designer1).to.not.equal(designer2);
            expect((manager as any).schemaDesigners.size).to.equal(2);
        });
    });

    suite("Connection string handling", () => {
        test("should use connection string with includePassword and includeApplicationName", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const getConnectionStringStub = mockMainController.connectionManager
                .getConnectionString as sinon.SinonStub;
            expect(getConnectionStringStub).to.have.been.calledWith(sinon.match.any, true, true);
        });

        test("should handle connectionUri with connection string parameters", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                undefined,
                connectionUri,
            );

            const getConnectionStringStub = mockMainController.connectionManager
                .getConnectionString as sinon.SinonStub;
            expect(getConnectionStringStub).to.have.been.calledWith(connectionUri, true, true);
        });
    });

    suite("Cache management", () => {
        test("should maintain cache across multiple getSchemaDesigner calls", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            // Simulate some work that marks cache as dirty
            const key = `${connectionString}-${databaseName}`;
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: true,
            });

            const cachedItem = (manager as any).schemaDesignerCache.get(key);
            expect(cachedItem.isDirty).to.be.true;
        });
    });

    suite("Active designer tracking", () => {
        test("should update active designer based on visibility changes", async () => {
            const panel = stubWebviewPanel(sandbox) as any;
            let viewStateHandler:
                | ((event: vscode.WebviewPanelOnDidChangeViewStateEvent) => void)
                | undefined;
            panel.visible = false;
            panel.onDidChangeViewState = sandbox.stub().callsFake((handler) => {
                viewStateHandler = handler;
                return { dispose: sandbox.stub() } as vscode.Disposable;
            });

            (vscode.window.createWebviewPanel as sinon.SinonStub).returns(panel);

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            expect(viewStateHandler).to.exist;
            expect(manager.getActiveDesigner()).to.be.undefined;

            panel.visible = true;
            viewStateHandler!({
                webviewPanel: panel,
            } as vscode.WebviewPanelOnDidChangeViewStateEvent);
            expect(manager.getActiveDesigner()).to.equal(designer);

            panel.visible = false;
            viewStateHandler!({
                webviewPanel: panel,
            } as vscode.WebviewPanelOnDidChangeViewStateEvent);
            expect(manager.getActiveDesigner()).to.be.undefined;
        });
    });

    suite("Azure account token handling", () => {
        test("should use azureAccountToken from tree node connection profile", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const connectionProfile = treeNode.connectionProfile;
            expect(connectionProfile.azureAccountToken).to.equal("token-from-tree");
        });

        test("should use azureAccountToken from connection info when using URI", async () => {
            await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                undefined,
                connectionUri,
            );

            expect(mockMainController.connectionManager.getConnectionInfo).to.have.been.calledWith(
                connectionUri,
            );
        });
    });

    suite("Error handling", () => {
        test("should propagate connection manager errors", async () => {
            const error = new Error("Connection failed");
            (
                mockMainController.connectionManager.createConnectionDetails as sinon.SinonStub
            ).rejects(error);

            try {
                await manager.getSchemaDesigner(
                    mockContext,
                    mockVscodeWrapper,
                    mockMainController,
                    mockSchemaDesignerService,
                    databaseName,
                    treeNode,
                    undefined,
                );
                expect.fail("Should have thrown error");
            } catch (err) {
                expect(err).to.equal(error);
            }
        });

        test("should propagate getConnectionString errors", async () => {
            const error = new Error("Connection string failed");
            (mockMainController.connectionManager.getConnectionString as sinon.SinonStub).rejects(
                error,
            );

            try {
                await manager.getSchemaDesigner(
                    mockContext,
                    mockVscodeWrapper,
                    mockMainController,
                    mockSchemaDesignerService,
                    databaseName,
                    treeNode,
                    undefined,
                );
                expect.fail("Should have thrown error");
            } catch (err) {
                expect(err).to.equal(error);
            }
        });
    });

    suite("onDisposed handler", () => {
        test("should clean up designer from map when disposed with clean cache", async () => {
            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;
            expect((manager as any).schemaDesigners.has(key)).to.be.true;

            // Set cache as not dirty
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: false,
            });

            // Trigger disposal
            await designer.dispose();

            expect((manager as any).schemaDesigners.has(key)).to.be.false;
        });

        test("should show restore prompt when disposed with dirty cache", async () => {
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
            showInfoStub.resolves(undefined); // User doesn't choose restore

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;

            // Set cache as dirty
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: true,
            });

            // Trigger disposal
            await designer.dispose();

            // Allow async handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(showInfoStub).to.have.been.calledOnce;
        });

        test("should not show restore prompt when cache is clean", async () => {
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
            showInfoStub.resolves(undefined);

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;

            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: false,
            });

            await designer.dispose();

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(showInfoStub).to.not.have.been.called;
        });

        test("should restore designer when user chooses Restore", async () => {
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
            showInfoStub.resolves(LocConstants.Webview.Restore as any);

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;

            // Set cache as dirty
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: true,
            });

            // Trigger disposal
            await designer.dispose();

            // Allow async handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(showInfoStub).to.have.been.calledOnce;
            // Designer should be recreated
            expect((manager as any).schemaDesigners.has(key)).to.be.true;
        });

        test("should dispose session on backend when cache is cleaned", async () => {
            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;
            const sessionId = "test-session-id";

            // Set cache with session
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: { ...mockCreateSessionResponse, sessionId },
                isDirty: false,
            });

            // Trigger disposal
            await designer.dispose();

            // Allow async handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockSchemaDesignerService.disposeSession).to.have.been.calledWith({
                sessionId,
            });
        });

        test("should delete cache after disposal when not restoring", async () => {
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
            showInfoStub.resolves(undefined); // User doesn't choose restore

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;

            // Set cache as dirty
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: mockCreateSessionResponse,
                isDirty: true,
            });

            expect((manager as any).schemaDesignerCache.has(key)).to.be.true;

            // Trigger disposal
            await designer.dispose();

            // Allow async handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect((manager as any).schemaDesignerCache.has(key)).to.be.false;
        });

        test("should call disposeSession and clean cache even if it fails", async () => {
            // Reset the stub from previous tests
            mockSchemaDesignerService.disposeSession.reset();

            const designer = await manager.getSchemaDesigner(
                mockContext,
                mockVscodeWrapper,
                mockMainController,
                mockSchemaDesignerService,
                databaseName,
                treeNode,
                undefined,
            );

            const key = `${connectionString}-${databaseName}`;
            const sessionId = "test-session-id";

            // Set cache
            (manager as any).schemaDesignerCache.set(key, {
                schemaDesignerDetails: { ...mockCreateSessionResponse, sessionId },
                isDirty: false,
            });

            // Now configure disposeSession to fail
            const error = new Error("Dispose session failed");
            mockSchemaDesignerService.disposeSession.rejects(error);

            // Trigger disposal - should not throw even if disposeSession fails
            await designer.dispose();

            // Allow async handler to execute
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Verify disposeSession was called (error is logged to console but not thrown)
            expect(mockSchemaDesignerService.disposeSession).to.have.been.calledOnce;

            // Cache should still be deleted even if disposeSession fails
            expect((manager as any).schemaDesignerCache.has(key)).to.be.false;
        });
    });
});
