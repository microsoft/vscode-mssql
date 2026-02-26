/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import * as Extension from "../../src/extension";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    activateExtension,
    initializeIconUtils,
    stubExtensionContext,
    stubVscodeWrapper,
} from "./utils";
import { SchemaCompareEndpointInfo } from "vscode-mssql";
import * as Constants from "../../src/constants/constants";
import { UserSurvey } from "../../src/nps/userSurvey";
import { HttpClient } from "../../src/http/httpClient";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { SchemaDesignerWebviewManager } from "../../src/schemaDesigner/schemaDesignerWebviewManager";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import * as Prompts from "../../src/copilot/prompts";

chai.use(sinonChai);

suite("MainController Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let context: vscode.ExtensionContext;

    setup(async () => {
        sandbox = sinon.createSandbox();
        // Need to activate the extension to get the mainController
        await activateExtension();

        // Using the mainController that was instantiated with the extension
        mainController = await Extension.getController();

        // Setting up a stubbed connectionManager
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        mainController.connectionManager = connectionManager;
        (mainController.sqlDocumentService as any)["_connectionMgr"] = connectionManager;

        vscodeWrapper = stubVscodeWrapper(sandbox);
        context = stubExtensionContext(sandbox);

        UserSurvey.createInstance(context, vscodeWrapper);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("validateTextDocumentHasFocus returns false if there is no active text document", () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        let getterCalls = 0;
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => {
            getterCalls += 1;
            return undefined;
        });
        const controller: MainController = new MainController(
            context,
            undefined, // ConnectionManager
            vscodeWrapper,
        );

        const result = (controller as any).validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return false when the active document URI is undefined",
        ).to.be.false;
        expect(getterCalls).to.equal(1);
    });

    test("validateTextDocumentHasFocus returns true if there is an active text document", () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => "test_uri");
        const controller: MainController = new MainController(
            context,
            undefined, // ConnectionManager
            vscodeWrapper,
        );

        const result = (controller as any).validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return true when the active document URI is not undefined",
        ).to.be.true;
    });

    test("onManageProfiles should call the connection manager to manage profiles", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        connectionManager.onManageProfiles.resolves();

        const controller: MainController = new MainController(
            context,
            connectionManager,
            vscodeWrapper,
        );

        await controller.onManageProfiles();

        expect(connectionManager.onManageProfiles).to.have.been.calledOnce;
    });

    test("runComparison command should call onSchemaCompare on the controller", async () => {
        let called = false;
        let gotMaybeSource: any = undefined;
        let gotMaybeTarget: any = undefined;
        let gotRunComparison: boolean | undefined;

        const originalHandler = (mainController as any).onSchemaCompare;
        (mainController as any).onSchemaCompare = async (
            maybeSource?: SchemaCompareEndpointInfo,
            maybeTarget?: SchemaCompareEndpointInfo,
            runComparison?: boolean,
        ) => {
            called = true;
            gotMaybeSource = maybeSource;
            gotMaybeTarget = maybeTarget;
            gotRunComparison = runComparison ?? false;
        };

        const src = { endpointType: 1, serverName: "srcServer", databaseName: "srcDb" };
        const tgt = { endpointType: 1, serverName: "tgtServer", databaseName: "tgtDb" };

        try {
            await vscode.commands.executeCommand(Constants.cmdSchemaCompare, src, tgt);

            // Normalize in-case the command forwarded a single object { source, target }
            if (
                gotMaybeSource &&
                typeof gotMaybeSource === "object" &&
                ("source" in gotMaybeSource || "target" in gotMaybeSource)
            ) {
                const wrapped = gotMaybeSource as any;
                gotMaybeSource = wrapped.source;
                gotMaybeTarget = wrapped.target;
                gotRunComparison = wrapped.runComparison ?? false;
            }

            expect(called, "Expected onSchemaCompare to be called").to.be.true;
            expect(gotMaybeSource, "Expected source passed through to handler").to.deep.equal(src);
            expect(gotMaybeTarget, "Expected target passed through to handler").to.deep.equal(tgt);
            expect(gotRunComparison, "Expected runComparison to be false").to.be.false;
        } finally {
            // restore original handler so the test doesn't leak state
            (mainController as any).onSchemaCompare = originalHandler;
        }
    });

    test("publishDatabaseProject command should call onPublishDatabaseProject on the controller", async () => {
        let called = false;
        let gotProjectFilePath: string | undefined;

        const originalHandler: (projectFilePath: string) => Promise<void> =
            mainController.onPublishDatabaseProject.bind(mainController);
        mainController.onPublishDatabaseProject = async (
            projectFilePath: string,
        ): Promise<void> => {
            called = true;
            gotProjectFilePath = projectFilePath;
        };

        const testProjectPath = "C:\\test\\project\\database.sqlproj";

        try {
            await vscode.commands.executeCommand(
                Constants.cmdPublishDatabaseProject,
                testProjectPath,
            );

            expect(called, "Expected onPublishDatabaseProject to be called").to.be.true;
            expect(
                gotProjectFilePath,
                "Expected projectFilePath passed through to handler",
            ).to.equal(testProjectPath);
        } finally {
            // restore original handler so the test doesn't leak state
            mainController.onPublishDatabaseProject = originalHandler;
        }
    });

    test("Proxy settings are checked on initialization", async () => {
        const httpHelperWarnSpy = sandbox.spy(HttpClient.prototype, "warnOnInvalidProxySettings");

        new MainController(context, connectionManager, vscodeWrapper);

        expect(
            httpHelperWarnSpy.calledOnce,
            "Expected warnOnInvalidProxySettings to be called once during initialization",
        ).to.be.true;
    });

    suite("onNewQueryWithConnection Tests", () => {
        test("does nothing when already connected to SQL editor without force flags", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);

            // Mock connection
            const uri = editor.document.uri.toString();
            connectionManager.isConnected.withArgs(uri).returns(true);

            // Call method
            const result = await mainController.onNewQueryWithConnection();

            // Should return true without opening new editor
            expect(result).to.equal(true);

            // Close the document
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        });

        test("opens new editor when no active editor exists", async () => {
            // Close all editors first
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");

            // Mock promptToConnect to track if it's called
            let promptToConnectCalled = false;
            const originalPromptToConnect = mainController.promptToConnect.bind(mainController);
            mainController.promptToConnect = async () => {
                promptToConnectCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection();

                expect(result).to.equal(true);
                expect(promptToConnectCalled).to.equal(
                    true,
                    "Expected promptToConnect to be called",
                );

                // Verify a SQL editor was opened
                const activeEditor = vscode.window.activeTextEditor;
                expect(activeEditor).to.not.be.undefined;
                expect(activeEditor?.document.languageId).to.equal("sql");

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.promptToConnect = originalPromptToConnect;
            }
        });

        test("forces new editor when forceNewEditor is true", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "-- existing editor",
            });
            await vscode.window.showTextDocument(doc);
            const initialDocumentCount = vscode.workspace.textDocuments.length;

            // Mock connection - existing editor is connected
            connectionManager.isConnected.returns(true);

            try {
                const result = await mainController.onNewQueryWithConnection(true, false);

                expect(result).to.equal(true);

                // Verify a new editor was created - document count should increase
                const finalDocumentCount = vscode.workspace.textDocuments.length;
                expect(finalDocumentCount).to.be.greaterThan(
                    initialDocumentCount,
                    "Expected a new document to be created",
                );

                // Verify the active editor is SQL
                const activeEditor = vscode.window.activeTextEditor;
                expect(activeEditor).to.not.be.undefined;
                expect(activeEditor?.document.languageId).to.equal("sql");

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            } finally {
                // No cleanup needed
            }
        });

        test("forces connection when forceConnect is true even when connected", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);
            const uri = editor.document.uri.toString();

            // Mock already connected
            connectionManager.isConnected.withArgs(uri).returns(true);

            // Mock promptToConnect to verify it's called
            let promptToConnectCalled = false;
            const originalPromptToConnect = mainController.promptToConnect.bind(mainController);
            mainController.promptToConnect = async () => {
                promptToConnectCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection(false, true);

                expect(result).to.equal(true);
                expect(promptToConnectCalled).to.equal(
                    true,
                    "Expected promptToConnect to be called despite already being connected",
                );

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.promptToConnect = originalPromptToConnect;
            }
        });

        test("connects to existing SQL editor when not connected", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);
            const uri = editor.document.uri.toString();

            // Mock NOT connected
            connectionManager.isConnected.withArgs(uri).returns(false);

            // Mock promptToConnect
            let promptToConnectCalled = false;
            const originalPromptToConnect = mainController.promptToConnect.bind(mainController);
            mainController.promptToConnect = async () => {
                promptToConnectCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection();

                expect(result).to.equal(true);
                expect(promptToConnectCalled).to.equal(
                    true,
                    "Expected promptToConnect to be called for disconnected editor",
                );

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.promptToConnect = originalPromptToConnect;
            }
        });
    });

    suite("Copy Connection String Command", () => {
        let clipboardWriteTextStub: sinon.SinonStub;
        let showInformationMessageStub: sinon.SinonStub;

        setup(() => {
            initializeIconUtils();
            clipboardWriteTextStub = sandbox.stub();
            sandbox.stub(vscode.env, "clipboard").value({
                writeText: clipboardWriteTextStub.resolves(),
            });
            showInformationMessageStub = sandbox
                .stub(vscode.window, "showInformationMessage")
                .resolves();
        });

        function createMockTreeNode(
            nodeType: string,
            connectionProfile?: IConnectionProfile,
        ): TreeNodeInfo {
            const baseProfile: IConnectionProfile =
                connectionProfile ??
                ({
                    id: "test-id",
                    profileName: "Test Profile",
                    groupId: "test-group",
                    savePassword: false,
                    emptyPasswordInput: false,
                    azureAuthType: 0,
                    accountStore: undefined,
                    server: "testServer",
                    database: "testDb",
                    user: "testUser",
                } as IConnectionProfile);

            return new TreeNodeInfo(
                "Test Server",
                { type: nodeType, filterable: false, hasFilters: false, subType: undefined },
                vscode.TreeItemCollapsibleState.Collapsed,
                "nodePath",
                "ready",
                nodeType,
                "session",
                baseProfile,
                undefined as unknown as TreeNodeInfo,
                [],
                undefined,
                undefined,
                undefined,
            );
        }

        test("cmdCopyConnectionString command is registered", async () => {
            const commands = await vscode.commands.getCommands(true);
            expect(commands).to.include(Constants.cmdCopyConnectionString);
        });

        test("copies connection string to clipboard for server node", async () => {
            const testConnectionString = "Server=testServer;Database=testDb;User Id=testUser;";
            connectionManager.createConnectionDetails.returns({} as any);
            connectionManager.getConnectionString.resolves(testConnectionString);

            const node = createMockTreeNode(Constants.serverLabel);

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, node);

            expect(connectionManager.createConnectionDetails).to.have.been.calledOnce;
            expect(connectionManager.getConnectionString).to.have.been.calledOnce;
            expect(connectionManager.getConnectionString).to.have.been.calledWith(
                sinon.match.any,
                true, // include password
                false, // do not include application name
            );
            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(testConnectionString);
            expect(showInformationMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.ObjectExplorer.ConnectionStringCopied,
            );
        });

        test("copies connection string to clipboard for disconnected server node", async () => {
            const testConnectionString = "Server=testServer;Database=testDb;";
            connectionManager.createConnectionDetails.returns({} as any);
            connectionManager.getConnectionString.resolves(testConnectionString);

            const node = createMockTreeNode(Constants.disconnectedServerNodeType);

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, node);

            expect(connectionManager.createConnectionDetails).to.have.been.calledOnce;
            expect(connectionManager.getConnectionString).to.have.been.calledOnce;
            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(testConnectionString);
            expect(showInformationMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.ObjectExplorer.ConnectionStringCopied,
            );
        });

        test("does nothing when node has no connection profile", async () => {
            const node = createMockTreeNode(Constants.serverLabel);
            // Remove the connection profile
            (node as any)._connectionProfile = undefined;

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, node);

            expect(connectionManager.createConnectionDetails).to.not.have.been.called;
            expect(connectionManager.getConnectionString).to.not.have.been.called;
            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("does nothing when node is not a server type", async () => {
            // Use a different node type like "Database" or "Table"
            const node = createMockTreeNode("Database");

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, node);

            expect(connectionManager.createConnectionDetails).to.not.have.been.called;
            expect(connectionManager.getConnectionString).to.not.have.been.called;
            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("does nothing when getConnectionString returns empty string", async () => {
            connectionManager.createConnectionDetails.returns({} as any);
            connectionManager.getConnectionString.resolves("");

            const node = createMockTreeNode(Constants.serverLabel);

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, node);

            expect(connectionManager.createConnectionDetails).to.have.been.calledOnce;
            expect(connectionManager.getConnectionString).to.have.been.calledOnce;
            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("uses tree selection when node is not provided", async () => {
            const testConnectionString = "Server=testServer;Database=testDb;";
            connectionManager.createConnectionDetails.returns({} as any);
            connectionManager.getConnectionString.resolves(testConnectionString);

            const node = createMockTreeNode(Constants.serverLabel);

            // Mock the objectExplorerTree selection
            mainController.objectExplorerTree = {
                selection: [node],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, undefined);

            expect(connectionManager.createConnectionDetails).to.have.been.calledOnce;
            expect(connectionManager.getConnectionString).to.have.been.calledOnce;
            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(testConnectionString);
        });

        test("does nothing when no node and no tree selection", async () => {
            // Mock empty selection
            mainController.objectExplorerTree = {
                selection: [],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, undefined);

            expect(connectionManager.createConnectionDetails).to.not.have.been.called;
            expect(connectionManager.getConnectionString).to.not.have.been.called;
            expect(clipboardWriteTextStub).to.not.have.been.called;
        });

        test("does nothing when no node and multiple selections", async () => {
            const node1 = createMockTreeNode(Constants.serverLabel);
            const node2 = createMockTreeNode(Constants.serverLabel);

            // Mock multiple selection
            mainController.objectExplorerTree = {
                selection: [node1, node2],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyConnectionString, undefined);

            expect(connectionManager.createConnectionDetails).to.not.have.been.called;
            expect(connectionManager.getConnectionString).to.not.have.been.called;
            expect(clipboardWriteTextStub).to.not.have.been.called;
        });
    });

    suite("ensureReadyToExecuteQuery Tests", () => {
        test("returns false and shows info message when connection is in progress", async () => {
            const testUri = "file:///test/connecting.sql";

            // Stub the private _vscodeWrapper so ensureActiveSqlFile passes
            // and the isConnecting path is exercised
            const originalWrapper = (mainController as any)._vscodeWrapper;
            const showInfoStub = sandbox.stub().resolves();
            (mainController as any)._vscodeWrapper = {
                activeTextEditorUri: testUri,
                isEditingSqlFile: true,
                showInformationMessage: showInfoStub,
            };

            // connectionManager is already a stub from the outer setup
            connectionManager.isConnected.withArgs(testUri).returns(false);
            connectionManager.isConnecting.withArgs(testUri).returns(true);

            // Mock promptToConnect to detect if it's accidentally called
            let promptToConnectCalled = false;
            const originalPromptToConnect = mainController.promptToConnect.bind(mainController);
            mainController.promptToConnect = async () => {
                promptToConnectCalled = true;
                return true;
            };

            try {
                const result = await mainController.ensureReadyToExecuteQuery();

                expect(result).to.equal(
                    false,
                    "Should return false when connection is in progress",
                );
                expect(showInfoStub).to.have.been.calledOnceWith(
                    LocalizedConstants.msgConnectionInProgress,
                );
                expect(promptToConnectCalled).to.equal(
                    false,
                    "promptToConnect should not be called when connection is already in progress",
                );
            } finally {
                (mainController as any)._vscodeWrapper = originalWrapper;
                mainController.promptToConnect = originalPromptToConnect;
            }
        });
    });

    suite("Copy Object Name Command", () => {
        let clipboardWriteTextStub: sinon.SinonStub;

        setup(() => {
            initializeIconUtils();
            // Stub the clipboard on the mainController's vscodeWrapper
            clipboardWriteTextStub = sandbox.stub();
            (mainController as any)._vscodeWrapper = {
                clipboardWriteText: clipboardWriteTextStub.resolves(),
            };
        });

        function createMockTreeNodeWithMetadata(
            metadataTypeName: string,
            schema: string,
            name: string,
        ): TreeNodeInfo {
            const baseProfile: IConnectionProfile = {
                id: "test-id",
                profileName: "Test Profile",
                groupId: "test-group",
                savePassword: false,
                emptyPasswordInput: false,
                azureAuthType: 0,
                accountStore: undefined,
                server: "testServer",
                database: "testDb",
                user: "testUser",
            } as IConnectionProfile;

            return new TreeNodeInfo(
                "Test Node",
                { type: "Table", filterable: false, hasFilters: false, subType: undefined },
                vscode.TreeItemCollapsibleState.None,
                "nodePath",
                "ready",
                "Table",
                "session",
                baseProfile,
                undefined as unknown as TreeNodeInfo,
                [],
                undefined,
                { metadataTypeName, schema, name } as any,
                undefined,
            );
        }

        test("cmdCopyObjectName command is registered", async () => {
            const commands = await vscode.commands.getCommands(true);
            expect(commands).to.include(Constants.cmdCopyObjectName);
        });

        test("copies qualified name to clipboard for table node", async () => {
            const node = createMockTreeNodeWithMetadata("Table", "dbo", "MyTable");

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, node);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("[dbo].[MyTable]");
        });

        test("copies qualified name to clipboard for stored procedure node", async () => {
            const node = createMockTreeNodeWithMetadata("StoredProcedure", "dbo", "MyProc");

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, node);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("[dbo].[MyProc]");
        });

        test("copies simple name to clipboard for non-schema objects", async () => {
            const node = createMockTreeNodeWithMetadata("Database", "", "MyDatabase");

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, node);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("[MyDatabase]");
        });

        test("uses tree selection when node is not provided", async () => {
            const node = createMockTreeNodeWithMetadata("Table", "dbo", "SelectedTable");

            // Mock the objectExplorerTree selection
            mainController.objectExplorerTree = {
                selection: [node],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, undefined);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("[dbo].[SelectedTable]");
        });

        test("does nothing when no node and no tree selection", async () => {
            // Mock empty selection
            mainController.objectExplorerTree = {
                selection: [],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, undefined);

            expect(clipboardWriteTextStub).to.not.have.been.called;
        });

        test("does nothing when no node and multiple selections", async () => {
            const node1 = createMockTreeNodeWithMetadata("Table", "dbo", "Table1");
            const node2 = createMockTreeNodeWithMetadata("Table", "dbo", "Table2");

            // Mock multiple selection
            mainController.objectExplorerTree = {
                selection: [node1, node2],
            } as unknown as vscode.TreeView<TreeNodeInfo>;

            await vscode.commands.executeCommand(Constants.cmdCopyObjectName, undefined);

            expect(clipboardWriteTextStub).to.not.have.been.called;
        });
    });

    suite("Schema Designer Copilot Agent Command", () => {
        const flushAsyncHandlers = async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        };

        const createIsolatedController = () => {
            const isolatedConnectionManager = sandbox.createStubInstance(ConnectionManager);
            const isolatedVscodeWrapper = stubVscodeWrapper(sandbox);
            const isolatedContext = stubExtensionContext(sandbox);
            const isolatedController = new MainController(
                isolatedContext,
                isolatedConnectionManager,
                isolatedVscodeWrapper,
            );
            return { isolatedController, isolatedVscodeWrapper };
        };

        test("command is registered", async () => {
            const commands = await vscode.commands.getCommands(true);
            expect(commands).to.include(SchemaDesigner.openCopilotAgentCommand);
        });

        test("shows error when no active schema designer exists", async () => {
            const showErrorMessageStub = sandbox.stub().resolves(undefined);
            (mainController as any)._vscodeWrapper = {
                showErrorMessage: showErrorMessageStub,
            };
            const findChatOpenAgentCommandStub = sandbox.stub(
                mainController as any,
                "findChatOpenAgentCommand",
            );
            (SchemaDesignerWebviewManager.getInstance() as any)._activeDesigner = undefined;

            await vscode.commands.executeCommand(SchemaDesigner.openCopilotAgentCommand);
            await flushAsyncHandlers();

            expect(findChatOpenAgentCommandStub).to.not.have.been.called;
            expect(showErrorMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.MssqlChatAgent.schemaDesignerNoActiveDesigner,
            );
        });

        test("shows error when chat command is unavailable", async () => {
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as any);
            sandbox.stub(isolatedController as any, "findChatOpenAgentCommand").resolves(undefined);

            await (isolatedController as any).openSchemaDesignerCopilotChat();

            expect(showErrorMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.MssqlChatAgent.chatCommandNotAvailable,
            );
        });

        test("opens chat with schema designer starter prompt when chat command is available", async () => {
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
            const executeCommandStub = sandbox
                .stub(vscode.commands, "executeCommand")
                .resolves(undefined);
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as any);
            sandbox
                .stub(isolatedController as any, "findChatOpenAgentCommand")
                .resolves(Constants.vscodeWorkbenchChatOpenAgent);

            await (isolatedController as any).openSchemaDesignerCopilotChat();

            expect(showErrorMessageStub).to.not.have.been.called;
            expect(executeCommandStub).to.have.been.calledWith(
                Constants.vscodeWorkbenchChatOpenAgent,
                Prompts.schemaDesignerAgentPrompt,
            );
        });
    });
});
