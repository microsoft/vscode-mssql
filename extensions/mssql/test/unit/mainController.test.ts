/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubTelemetry, stubExtensionContext, stubVscodeWrapper, stubMessageBoxes } from "./utils";
import * as Constants from "../../src/constants/constants";
import { HttpClient } from "../../src/http/httpClient";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { SchemaDesignerWebviewManager } from "../../src/schemaDesigner/schemaDesignerWebviewManager";
import { CopilotChat } from "../../src/sharedInterfaces/copilotChat";
import * as Prompts from "../../src/copilot/prompts";
import { DabTool } from "../../src/copilot/tools/dabTool";
import { SchemaDesignerWebviewController } from "../../src/schemaDesigner/schemaDesignerWebviewController";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";

chai.use(sinonChai);

type MainControllerTestAccess = {
    validateTextDocumentHasFocus(): boolean;
    _vscodeWrapper: {
        activeTextEditorUri?: string;
        activeTextEditor?: vscode.TextEditor;
        isEditingSqlFile?: boolean;
    };
    _outputContentProvider: {
        runCurrentStatement: sinon.SinonStub;
        runQuery: sinon.SinonStub;
    };
    _statusview: unknown;
    openCopilotChatFromUi(args?: CopilotChat.OpenFromUiArgs): Promise<void>;
    findChatOpenAgentCommand(): Promise<string | undefined>;
    registerLanguageModelTools(): void;
    migrateTransferActiveEditorConnectionsSetting(): Promise<void>;
};

function accessMainController(controller: MainController): MainControllerTestAccess {
    return controller as unknown as MainControllerTestAccess;
}

suite("MainController Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let messageBoxes: ReturnType<typeof stubMessageBoxes>;
    let context: vscode.ExtensionContext;

    function createMockTextEditor(
        uri: string,
        languageId: string = Constants.languageId,
    ): vscode.TextEditor {
        return {
            document: {
                uri: vscode.Uri.parse(uri),
                languageId,
            },
        } as unknown as vscode.TextEditor;
    }

    function createQueryTextEditor(
        selection: vscode.Selection,
        fullText: string,
        selectedText?: string,
        selections: vscode.Selection[] = [selection],
    ): vscode.TextEditor {
        return {
            document: {
                uri: vscode.Uri.parse("file:///test/query.sql"),
                fileName: "query.sql",
                languageId: Constants.languageId,
                getText: (range?: vscode.Range) => (range ? (selectedText ?? "") : fullText),
            },
            selection,
            selections,
        } as unknown as vscode.TextEditor;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        // Setting up a stubbed connectionManager
        connectionManager = sandbox.createStubInstance(ConnectionManager);

        vscodeWrapper = stubVscodeWrapper(sandbox);
        messageBoxes = stubMessageBoxes(sandbox);
        context = stubExtensionContext(sandbox);
        mainController = new MainController(context, connectionManager, vscodeWrapper);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("validateTextDocumentHasFocus returns false if there is no active text document", () => {
        const vscodeWrapper = stubVscodeWrapper(sandbox);
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
        const controllerAccess = accessMainController(controller);

        const result = controllerAccess.validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return false when the active document URI is undefined",
        ).to.be.false;
        expect(getterCalls).to.equal(1);
    });

    test("validateTextDocumentHasFocus returns true if there is an active text document", () => {
        const vscodeWrapper = stubVscodeWrapper(sandbox);
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => "test_uri");
        const controller: MainController = new MainController(
            context,
            undefined, // ConnectionManager
            vscodeWrapper,
        );
        const controllerAccess = accessMainController(controller);

        const result = controllerAccess.validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return true when the active document URI is not undefined",
        ).to.be.true;
    });

    test("onManageProfiles should call the connection manager to manage profiles", async () => {
        const vscodeWrapper = stubVscodeWrapper(sandbox);
        connectionManager.onManageProfiles.resolves();

        const controller: MainController = new MainController(
            context,
            connectionManager,
            vscodeWrapper,
        );

        await controller.onManageProfiles();

        expect(connectionManager.onManageProfiles).to.have.been.called;
    });

    suite("onRunCurrentStatement Tests", () => {
        let controllerAccess: MainControllerTestAccess;
        let runCurrentStatementStub: sinon.SinonStub;
        let runQueryStub: sinon.SinonStub;
        let ensureReadyToExecuteQueryStub: sinon.SinonStub;
        let statusView: unknown;

        setup(() => {
            controllerAccess = accessMainController(mainController);
            ensureReadyToExecuteQueryStub = sandbox
                .stub(mainController, "ensureReadyToExecuteQuery")
                .resolves(true);
            sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => "file:///test/query.sql");

            runCurrentStatementStub = sandbox.stub().resolves();
            runQueryStub = sandbox.stub().resolves();
            controllerAccess._outputContentProvider = {
                runCurrentStatement: runCurrentStatementStub,
                runQuery: runQueryStub,
            };
            statusView = {};
            controllerAccess._statusview = statusView;
        });

        test("runs the current statement when there is no selection", async () => {
            const selection = new vscode.Selection(1, 7, 1, 7);
            sandbox
                .stub(vscode.window, "activeTextEditor")
                .get(() => createQueryTextEditor(selection, "select 'a';\nselect 'b';"));

            await mainController.onRunCurrentStatement();

            expect(runCurrentStatementStub).to.have.been.calledOnceWithExactly(
                statusView,
                "file:///test/query.sql",
                {
                    startLine: 1,
                    startColumn: 7,
                    endLine: 0,
                    endColumn: 0,
                },
                "query.sql",
            );
            expect(runQueryStub).to.not.have.been.called;
        });

        test("runs selected text when there is a non-empty selection", async () => {
            const selection = new vscode.Selection(0, 0, 0, 11);
            sandbox
                .stub(vscode.window, "activeTextEditor")
                .get(() =>
                    createQueryTextEditor(selection, "select 'a'; select 'b';", "select 'a';"),
                );

            await mainController.onRunCurrentStatement();

            expect(runQueryStub).to.have.been.calledOnceWithExactly(
                statusView,
                "file:///test/query.sql",
                {
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 11,
                },
                "query.sql",
            );
            expect(runCurrentStatementStub).to.not.have.been.called;
        });

        test("runs the originally selected text when selection changes while connecting", async () => {
            const originalSelection = new vscode.Selection(0, 0, 0, 11);
            const changedSelection = new vscode.Selection(1, 0, 1, 11);
            let activeEditor = createQueryTextEditor(
                originalSelection,
                "select 'a';\nselect 'b';",
                "select 'a';",
            );
            sandbox.stub(vscode.window, "activeTextEditor").get(() => activeEditor);
            ensureReadyToExecuteQueryStub.callsFake(async () => {
                activeEditor = createQueryTextEditor(
                    changedSelection,
                    "select 'a';\nselect 'b';",
                    "select 'b';",
                );
                return true;
            });

            await mainController.onRunCurrentStatement();

            expect(runQueryStub).to.have.been.calledOnceWithExactly(
                statusView,
                "file:///test/query.sql",
                {
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 11,
                },
                "query.sql",
            );
            expect(runCurrentStatementStub).to.not.have.been.called;
        });

        test("runs the original current statement when cursor changes while connecting", async () => {
            const originalSelection = new vscode.Selection(0, 7, 0, 7);
            const changedSelection = new vscode.Selection(1, 7, 1, 7);
            let activeEditor = createQueryTextEditor(originalSelection, "select 'a';\nselect 'b';");
            sandbox.stub(vscode.window, "activeTextEditor").get(() => activeEditor);
            ensureReadyToExecuteQueryStub.callsFake(async () => {
                activeEditor = createQueryTextEditor(changedSelection, "select 'a';\nselect 'b';");
                return true;
            });

            await mainController.onRunCurrentStatement();

            expect(runCurrentStatementStub).to.have.been.calledOnceWithExactly(
                statusView,
                "file:///test/query.sql",
                {
                    startLine: 0,
                    startColumn: 7,
                    endLine: 0,
                    endColumn: 0,
                },
                "query.sql",
            );
            expect(runQueryStub).to.not.have.been.called;
        });

        test("does not execute when the selection contains only whitespace", async () => {
            const selection = new vscode.Selection(0, 0, 0, 4);
            sandbox
                .stub(vscode.window, "activeTextEditor")
                .get(() => createQueryTextEditor(selection, "    select 'a';", "    "));

            await mainController.onRunCurrentStatement();

            expect(runQueryStub).to.not.have.been.called;
            expect(runCurrentStatementStub).to.not.have.been.called;
        });

        test("shows an error and does not execute when there are multiple selections", async () => {
            const selection = new vscode.Selection(0, 0, 0, 11);
            const secondSelection = new vscode.Selection(1, 0, 1, 11);
            sandbox
                .stub(vscode.window, "activeTextEditor")
                .get(() =>
                    createQueryTextEditor(selection, "select 'a';\nselect 'b';", "select 'a';", [
                        selection,
                        secondSelection,
                    ]),
                );

            await mainController.onRunCurrentStatement();

            expect(messageBoxes.showErrorMessage).to.have.been.calledOnceWithExactly(
                LocalizedConstants.msgMultipleSelectionModeNotSupported,
            );
            expect(runQueryStub).to.not.have.been.called;
            expect(runCurrentStatementStub).to.not.have.been.called;
        });

        test("does not execute when the document is empty", async () => {
            const selection = new vscode.Selection(0, 0, 0, 0);
            sandbox
                .stub(vscode.window, "activeTextEditor")
                .get(() => createQueryTextEditor(selection, ""));

            await mainController.onRunCurrentStatement();

            expect(runQueryStub).to.not.have.been.called;
            expect(runCurrentStatementStub).to.not.have.been.called;
        });
    });

    suite("onRunQuery Tests", () => {
        let controllerAccess: MainControllerTestAccess;
        let runQueryStub: sinon.SinonStub;
        let ensureReadyToExecuteQueryStub: sinon.SinonStub;
        let statusView: unknown;

        setup(() => {
            controllerAccess = accessMainController(mainController);
            ensureReadyToExecuteQueryStub = sandbox
                .stub(mainController, "ensureReadyToExecuteQuery")
                .resolves(true);
            sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => "file:///test/query.sql");

            runQueryStub = sandbox.stub().resolves();
            controllerAccess._outputContentProvider = {
                runCurrentStatement: sandbox.stub().resolves(),
                runQuery: runQueryStub,
            };
            statusView = {};
            controllerAccess._statusview = statusView;
            connectionManager.refreshAzureAccountToken.resolves();
        });

        test("runs the originally selected query when selection changes while connecting", async () => {
            const originalSelection = new vscode.Selection(0, 0, 0, 11);
            const changedSelection = new vscode.Selection(1, 0, 1, 11);
            let activeEditor = createQueryTextEditor(
                originalSelection,
                "select 'a';\nselect 'b';",
                "select 'a';",
            );
            sandbox.stub(vscode.window, "activeTextEditor").get(() => activeEditor);
            ensureReadyToExecuteQueryStub.callsFake(async () => {
                activeEditor = createQueryTextEditor(
                    changedSelection,
                    "select 'a';\nselect 'b';",
                    "select 'b';",
                );
                return true;
            });

            await mainController.onRunQuery();

            expect(connectionManager.refreshAzureAccountToken).to.have.been.calledOnceWithExactly(
                "file:///test/query.sql",
            );
            expect(runQueryStub).to.have.been.calledOnceWithExactly(
                statusView,
                "file:///test/query.sql",
                {
                    startLine: 0,
                    startColumn: 0,
                    endLine: 0,
                    endColumn: 11,
                },
                "query.sql",
                undefined,
            );
        });
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
        setup(() => {
            stubTelemetry(sandbox);
        });

        test("does nothing when already connected to SQL editor without force flags", async () => {
            const uri = "file:///already-connected.sql";
            sandbox.stub(vscode.window, "activeTextEditor").value(createMockTextEditor(uri));
            connectionManager.isConnected.withArgs(uri).returns(true);
            const openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
            const showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.onNewQueryWithConnection();

            expect(result).to.equal(true);
            expect(openTextDocumentStub).to.not.have.been.called;
            expect(showTextDocumentStub).to.not.have.been.called;
            expect(promptToConnectStub).to.not.have.been.called;
        });

        test("opens new editor when no active editor exists", async () => {
            sandbox.stub(vscode.window, "activeTextEditor").value(undefined);
            const sqlDocument = {
                uri: vscode.Uri.parse("untitled:query.sql"),
                languageId: "sql",
            } as vscode.TextDocument;
            const shownEditor = createMockTextEditor("untitled:query.sql");
            const openTextDocumentStub = sandbox
                .stub(vscode.workspace, "openTextDocument")
                .resolves(sqlDocument);
            const showTextDocumentStub = sandbox
                .stub(vscode.window, "showTextDocument")
                .resolves(shownEditor);
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.onNewQueryWithConnection();

            expect(result).to.equal(true);
            expect(openTextDocumentStub).to.have.been.calledWithMatch({
                language: "sql",
                content: "",
            });
            expect(showTextDocumentStub).to.have.been.calledWith(sqlDocument);
            expect(promptToConnectStub).to.have.been.called;
        });

        test("forces new editor when forceNewEditor is true", async () => {
            const uri = "file:///existing-editor.sql";
            sandbox.stub(vscode.window, "activeTextEditor").value(createMockTextEditor(uri));
            connectionManager.isConnected.returns(true);
            const sqlDocument = {
                uri: vscode.Uri.parse("untitled:forced.sql"),
                languageId: "sql",
            } as vscode.TextDocument;
            const shownEditor = createMockTextEditor("untitled:forced.sql");
            const openTextDocumentStub = sandbox
                .stub(vscode.workspace, "openTextDocument")
                .resolves(sqlDocument);
            const showTextDocumentStub = sandbox
                .stub(vscode.window, "showTextDocument")
                .resolves(shownEditor);
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.onNewQueryWithConnection(true, false);

            expect(result).to.equal(true);
            expect(openTextDocumentStub).to.have.been.calledWithMatch({
                language: "sql",
                content: "",
            });
            expect(showTextDocumentStub).to.have.been.calledWith(sqlDocument);
            expect(promptToConnectStub).to.not.have.been.called;
        });

        test("forces connection when forceConnect is true even when connected", async () => {
            const uri = "file:///force-connect.sql";
            sandbox.stub(vscode.window, "activeTextEditor").value(createMockTextEditor(uri));
            connectionManager.isConnected.withArgs(uri).returns(true);
            const openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
            const showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.onNewQueryWithConnection(false, true);

            expect(result).to.equal(true);
            expect(openTextDocumentStub).to.not.have.been.called;
            expect(showTextDocumentStub).to.not.have.been.called;
            expect(promptToConnectStub).to.have.been.called;
        });

        test("connects to existing SQL editor when not connected", async () => {
            const uri = "file:///disconnected.sql";
            sandbox.stub(vscode.window, "activeTextEditor").value(createMockTextEditor(uri));
            connectionManager.isConnected.withArgs(uri).returns(false);
            const openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
            const showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.onNewQueryWithConnection();

            expect(result).to.equal(true);
            expect(openTextDocumentStub).to.not.have.been.called;
            expect(showTextDocumentStub).to.not.have.been.called;
            expect(promptToConnectStub).to.have.been.called;
        });
    });

    suite("ensureReadyToExecuteQuery Tests", () => {
        test("returns true when the active SQL editor is already connected", async () => {
            const testUri = "file:///test/connected.sql";
            sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => testUri);
            sandbox.stub(vscodeWrapper, "isEditingSqlFile").get(() => true);
            connectionManager.isConnected.withArgs(testUri).returns(true);

            const result = await mainController.ensureReadyToExecuteQuery();

            expect(result).to.equal(true);
            expect(connectionManager.isConnecting).to.not.have.been.called;
        });

        test("returns true after prompting and connecting", async () => {
            const testUri = "file:///test/notConnected.sql";
            sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => testUri);
            sandbox.stub(vscodeWrapper, "isEditingSqlFile").get(() => true);
            connectionManager.isConnected.withArgs(testUri).returns(false);
            connectionManager.isConnecting.withArgs(testUri).returns(false);
            const promptToConnectStub = sandbox
                .stub(mainController, "promptToConnect")
                .resolves(true);

            const result = await mainController.ensureReadyToExecuteQuery();

            expect(result).to.equal(true);
            expect(promptToConnectStub).to.have.been.calledOnce;
        });

        test("returns false and shows info message when connection is in progress", async () => {
            const testUri = "file:///test/connecting.sql";
            const controllerAccess = accessMainController(mainController);

            // Stub the private _vscodeWrapper so ensureActiveSqlFile passes
            // and the isConnecting path is exercised
            const originalWrapper = controllerAccess._vscodeWrapper;
            controllerAccess._vscodeWrapper = {
                activeTextEditorUri: testUri,
                isEditingSqlFile: true,
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
                expect(messageBoxes.showInformationMessage).to.have.been.calledOnceWith(
                    LocalizedConstants.msgConnectionInProgress,
                );
                expect(promptToConnectCalled).to.equal(
                    false,
                    "promptToConnect should not be called when connection is already in progress",
                );
            } finally {
                controllerAccess._vscodeWrapper = originalWrapper;
                mainController.promptToConnect = originalPromptToConnect;
            }
        });
    });

    suite("Schema Designer Copilot Agent Command", () => {
        const createIsolatedController = () => {
            const isolatedConnectionManager = sandbox.createStubInstance(ConnectionManager);
            const isolatedVscodeWrapper = stubVscodeWrapper(sandbox);
            const isolatedContext = stubExtensionContext(sandbox);
            const isolatedController = new MainController(
                isolatedContext,
                isolatedConnectionManager,
                isolatedVscodeWrapper,
            );
            return { isolatedController };
        };

        test("shows error when no active schema designer exists", async () => {
            const { isolatedController } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const { sendActionEvent } = stubTelemetry(sandbox);
            const showErrorMessageStub = messageBoxes.showErrorMessage;
            const findChatOpenAgentCommandStub = sandbox.stub(
                controllerAccess,
                "findChatOpenAgentCommand",
            );
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns(undefined),
            } as unknown as SchemaDesignerWebviewManager);

            await controllerAccess.openCopilotChatFromUi({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerToolbar",
            });

            expect(findChatOpenAgentCommandStub).to.not.have.been.called;
            expect(showErrorMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.MssqlChatAgent.schemaDesignerNoActiveDesigner,
            );
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.Open,
                {
                    entryPoint: "schemaDesignerToolbar",
                    scenario: "schemaDesigner",
                    mode: "agent",
                    success: "false",
                    reason: "noActiveDesigner",
                },
            );
        });

        test("shows error when chat command is unavailable", async () => {
            const { isolatedController } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = messageBoxes.showErrorMessage;
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as unknown as SchemaDesignerWebviewManager);
            sandbox.stub(controllerAccess, "findChatOpenAgentCommand").resolves(undefined);

            await controllerAccess.openCopilotChatFromUi({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerToolbar",
            });

            expect(showErrorMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.MssqlChatAgent.chatCommandNotAvailable,
            );
        });

        test("opens chat with schema designer starter prompt when chat command is available", async () => {
            const { isolatedController } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = messageBoxes.showErrorMessage;
            const executeCommandStub = sandbox
                .stub(vscode.commands, "executeCommand")
                .resolves(undefined);
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as unknown as SchemaDesignerWebviewManager);
            sandbox
                .stub(controllerAccess, "findChatOpenAgentCommand")
                .resolves(Constants.vscodeWorkbenchChatOpenAgent);

            await controllerAccess.openCopilotChatFromUi({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerToolbar",
            });

            expect(showErrorMessageStub).to.not.have.been.called;
            expect(executeCommandStub).to.have.been.calledWith(
                Constants.vscodeWorkbenchChatOpenAgent,
                Prompts.schemaDesignerAgentPrompt,
            );
        });

        test("opens chat with dab starter prompt and sends telemetry", async () => {
            const { isolatedController } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const { sendActionEvent } = stubTelemetry(sandbox);
            const showErrorMessageStub = messageBoxes.showErrorMessage;
            const executeCommandStub = sandbox
                .stub(vscode.commands, "executeCommand")
                .resolves(undefined);
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as unknown as SchemaDesignerWebviewManager);
            sandbox
                .stub(controllerAccess, "findChatOpenAgentCommand")
                .resolves(Constants.vscodeWorkbenchChatOpenAgent);

            await controllerAccess.openCopilotChatFromUi({
                scenario: "dab",
                entryPoint: "dabToolbar",
            });

            expect(showErrorMessageStub).to.not.have.been.called;
            expect(executeCommandStub).to.have.been.calledWith(
                Constants.vscodeWorkbenchChatOpenAgent,
                Prompts.dabAgentPrompt,
            );
            expect(sendActionEvent).to.have.been.calledWith(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.Open,
                {
                    entryPoint: "dabToolbar",
                    scenario: "dab",
                    mode: "agent",
                    success: "true",
                },
            );
        });

        test("opens chat with prompt override when provided", async () => {
            const { isolatedController } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = messageBoxes.showErrorMessage;
            const executeCommandStub = sandbox
                .stub(vscode.commands, "executeCommand")
                .resolves(undefined);
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getActiveDesigner: sandbox.stub().returns({}),
            } as unknown as SchemaDesignerWebviewManager);
            sandbox
                .stub(controllerAccess, "findChatOpenAgentCommand")
                .resolves(Constants.vscodeWorkbenchChatOpenAgent);

            await controllerAccess.openCopilotChatFromUi({
                scenario: "schemaDesigner",
                entryPoint: "schemaDesignerPublishDialogError",
                prompt: "custom GHCP fix prompt",
            });

            expect(showErrorMessageStub).to.not.have.been.called;
            expect(executeCommandStub).to.have.been.calledWith(
                Constants.vscodeWorkbenchChatOpenAgent,
                "custom GHCP fix prompt",
            );
        });
    });

    suite("DAB tool registration", () => {
        test("registers mssql_dab with a show callback that opens the DAB view", async () => {
            const registerToolStub = sandbox
                .stub(vscode.lm, "registerTool")
                .returns({ dispose: sandbox.stub() } as vscode.Disposable);
            const isolatedConnectionManager = sandbox.createStubInstance(ConnectionManager);
            const isolatedVscodeWrapper = stubVscodeWrapper(sandbox);
            const isolatedContext = stubExtensionContext(sandbox);
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            const getSchemaDesignerStub = sandbox.stub().resolves(mockDesigner);
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns({
                getSchemaDesigner: getSchemaDesignerStub,
            } as unknown as SchemaDesignerWebviewManager);

            isolatedConnectionManager.getConnectionInfo.withArgs("dab-connection").returns({
                credentials: { database: "AdventureWorks" },
            } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);

            const isolatedController = new MainController(
                isolatedContext,
                isolatedConnectionManager,
                isolatedVscodeWrapper,
            );
            const controllerAccess = accessMainController(isolatedController);
            controllerAccess.registerLanguageModelTools();

            const dabToolRegistration = registerToolStub
                .getCalls()
                .find((call) => call.args[0] === Constants.copilotDabToolName);

            expect(dabToolRegistration, "Expected mssql_dab tool registration").to.not.be.undefined;

            const dabTool = dabToolRegistration?.args[1] as DabTool;
            const result = JSON.parse(
                await dabTool.call(
                    {
                        input: {
                            operation: "show",
                            connectionId: "dab-connection",
                        },
                    } as unknown as Parameters<DabTool["call"]>[0],
                    {} as vscode.CancellationToken,
                ),
            );

            expect(result.success).to.equal(true);
            expect(getSchemaDesignerStub).to.have.been.calledOnceWith(
                isolatedContext,
                isolatedVscodeWrapper,
                isolatedController,
                isolatedController.schemaDesignerService,
                "AdventureWorks",
                undefined,
                "dab-connection",
            );
            expect(mockDesigner.showView).to.have.been.calledOnceWith(
                SchemaDesigner.SchemaDesignerActiveView.Dab,
            );
            expect(mockDesigner.revealToForeground).to.have.been.calledOnce;
        });
    });

    suite("migrateTransferActiveEditorConnectionsSetting", () => {
        let controller: MainController;
        let controllerAccess: MainControllerTestAccess;
        let configStub: sinon.SinonStub;
        let inspectStub: sinon.SinonStub;
        let updateStub: sinon.SinonStub;
        let sendActionEvent: sinon.SinonStub;
        let sendErrorEvent: sinon.SinonStub;

        setup(() => {
            controller = new MainController(context, connectionManager, vscodeWrapper);
            controllerAccess = accessMainController(controller);

            ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));

            inspectStub = sandbox.stub();
            updateStub = sandbox.stub().resolves();

            // WorkspaceConfiguration is an interface — plain stub object is required
            const mockConfig = {
                inspect: inspectStub,
                update: updateStub,
            } as unknown as vscode.WorkspaceConfiguration;

            configStub = sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig);
        });
        /* eslint-disable @typescript-eslint/no-deprecated */
        test("migrates true → transferActive at Global scope and clears old setting", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: true, workspaceValue: undefined });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(updateStub).to.have.been.calledWith(
                Constants.configNewEditorConnectionBehavior,
                Constants.NewEditorConnectionBehavior.TransferActive,
                vscode.ConfigurationTarget.Global,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configTransferActiveEditorConnections,
                undefined,
                vscode.ConfigurationTarget.Global,
            );
            // workspace scope was undefined — no workspace writes
            expect(
                updateStub.args.filter(
                    ([, , scope]) => scope === vscode.ConfigurationTarget.Workspace,
                ),
            ).to.have.lengthOf(0);
            expect(sendActionEvent).to.have.been.calledOnceWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                {
                    migratedValue: Constants.NewEditorConnectionBehavior.TransferActive,
                    scope: "global",
                },
            );
            expect(sendErrorEvent).to.not.have.been.called;
        });

        test("migrates false → none at Global scope and clears old setting", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: false, workspaceValue: undefined });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(updateStub).to.have.been.calledWith(
                Constants.configNewEditorConnectionBehavior,
                Constants.NewEditorConnectionBehavior.None,
                vscode.ConfigurationTarget.Global,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configTransferActiveEditorConnections,
                undefined,
                vscode.ConfigurationTarget.Global,
            );
            expect(sendActionEvent).to.have.been.calledOnceWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                { migratedValue: Constants.NewEditorConnectionBehavior.None, scope: "global" },
            );
        });

        test("migrates true → transferActive at Workspace scope and clears old setting", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: undefined, workspaceValue: true });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(updateStub).to.have.been.calledWith(
                Constants.configNewEditorConnectionBehavior,
                Constants.NewEditorConnectionBehavior.TransferActive,
                vscode.ConfigurationTarget.Workspace,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configTransferActiveEditorConnections,
                undefined,
                vscode.ConfigurationTarget.Workspace,
            );
            // global scope was undefined — no global writes
            expect(
                updateStub.args.filter(
                    ([, , scope]) => scope === vscode.ConfigurationTarget.Global,
                ),
            ).to.have.lengthOf(0);
            expect(sendActionEvent).to.have.been.calledOnceWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                {
                    migratedValue: Constants.NewEditorConnectionBehavior.TransferActive,
                    scope: "workspace",
                },
            );
        });

        test("migrates both Global and Workspace scopes when both are explicitly set", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: true, workspaceValue: false });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(updateStub).to.have.been.calledWith(
                Constants.configNewEditorConnectionBehavior,
                Constants.NewEditorConnectionBehavior.TransferActive,
                vscode.ConfigurationTarget.Global,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configTransferActiveEditorConnections,
                undefined,
                vscode.ConfigurationTarget.Global,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configNewEditorConnectionBehavior,
                Constants.NewEditorConnectionBehavior.None,
                vscode.ConfigurationTarget.Workspace,
            );
            expect(updateStub).to.have.been.calledWith(
                Constants.configTransferActiveEditorConnections,
                undefined,
                vscode.ConfigurationTarget.Workspace,
            );
            expect(sendActionEvent).to.have.been.calledTwice;
            expect(sendActionEvent.firstCall).to.have.been.calledWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                {
                    migratedValue: Constants.NewEditorConnectionBehavior.TransferActive,
                    scope: "global",
                },
            );
            expect(sendActionEvent.secondCall).to.have.been.calledWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                { migratedValue: Constants.NewEditorConnectionBehavior.None, scope: "workspace" },
            );
        });

        test("is a no-op when the old setting was never explicitly set", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: undefined, workspaceValue: undefined });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(updateStub).to.not.have.been.called;
            expect(sendActionEvent).to.not.have.been.called;
            expect(sendErrorEvent).to.not.have.been.called;
        });

        test("sends error telemetry and does not throw when config.update fails", async () => {
            const writeError = new Error("write failed");
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: true, workspaceValue: undefined });

            updateStub.rejects(writeError);

            // Should not throw
            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(sendActionEvent).to.not.have.been.called;
            expect(sendErrorEvent).to.have.been.calledOnceWith(
                TelemetryViews.General,
                TelemetryActions.MigrateEditorConnectionBehavior,
                writeError,
                false,
                undefined,
                undefined,
                { scope: "global" },
            );
        });

        test("uses getConfiguration() without a section argument", async () => {
            inspectStub
                .withArgs(Constants.configTransferActiveEditorConnections)
                .returns({ globalValue: undefined, workspaceValue: undefined });

            await controllerAccess.migrateTransferActiveEditorConnectionsSetting();

            expect(configStub).to.have.been.calledWithExactly();
        });
        /* eslint-enable @typescript-eslint/no-deprecated */
    });
});
