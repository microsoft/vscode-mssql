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
import { stubTelemetry, stubExtensionContext, stubVscodeWrapper } from "./utils";
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
        isEditingSqlFile?: boolean;
        showInformationMessage(message: string): Thenable<unknown> | void;
    };
    openCopilotChatFromUi(args?: CopilotChat.OpenFromUiArgs): Promise<void>;
    findChatOpenAgentCommand(): Promise<string | undefined>;
    registerLanguageModelTools(): void;
};

function accessMainController(controller: MainController): MainControllerTestAccess {
    return controller as unknown as MainControllerTestAccess;
}

suite("MainController Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
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

    setup(() => {
        sandbox = sinon.createSandbox();

        // Setting up a stubbed connectionManager
        connectionManager = sandbox.createStubInstance(ConnectionManager);

        vscodeWrapper = stubVscodeWrapper(sandbox);
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
        test("returns false and shows info message when connection is in progress", async () => {
            const testUri = "file:///test/connecting.sql";
            const controllerAccess = accessMainController(mainController);

            // Stub the private _vscodeWrapper so ensureActiveSqlFile passes
            // and the isConnecting path is exercised
            const originalWrapper = controllerAccess._vscodeWrapper;
            const showInfoStub = sandbox.stub().resolves();
            controllerAccess._vscodeWrapper = {
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
            return { isolatedController, isolatedVscodeWrapper };
        };

        test("shows error when no active schema designer exists", async () => {
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const { sendActionEvent } = stubTelemetry(sandbox);
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
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
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
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
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
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
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const { sendActionEvent } = stubTelemetry(sandbox);
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
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
            const { isolatedController, isolatedVscodeWrapper } = createIsolatedController();
            const controllerAccess = accessMainController(isolatedController);
            const showErrorMessageStub = isolatedVscodeWrapper.showErrorMessage as sinon.SinonStub;
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
});
