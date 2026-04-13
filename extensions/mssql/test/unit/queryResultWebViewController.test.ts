/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import { QueryResultWebviewController } from "../../src/queryResult/queryResultWebViewController";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import * as qr from "../../src/sharedInterfaces/queryResult";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("QueryResultWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let executionPlanService: sinon.SinonStubbedInstance<ExecutionPlanService>;
    let sqlOutputContentProvider: sinon.SinonStubbedInstance<SqlOutputContentProvider>;
    let controller: QueryResultWebviewController;
    let configuration: {
        get: sinon.SinonStub;
        update: sinon.SinonStub;
    };
    let onDidChangeConfigurationHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    let openResultsInTabByDefault = false;

    const testUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

        vscodeWrapper = stubVscodeWrapper(sandbox);
        executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        sqlOutputContentProvider = sandbox.createStubInstance(SqlOutputContentProvider);

        const context = stubExtensionContext(sandbox);
        const disposable = new vscode.Disposable(() => undefined);

        sandbox.stub(vscode.commands, "registerCommand").returns(disposable);
        sandbox.stub(vscode.window, "createStatusBarItem").returns({
            text: "",
            tooltip: "",
            command: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.StatusBarItem);

        sandbox.stub(vscodeWrapper, "onDidCloseTextDocument").get(() => {
            return () => disposable;
        });

        sandbox.stub(vscodeWrapper, "onDidChangeConfiguration").get(() => {
            return (handler: (e: vscode.ConfigurationChangeEvent) => void) => {
                onDidChangeConfigurationHandler = handler;
                return disposable;
            };
        });

        const activeEditor = {
            document: {
                uri: vscode.Uri.parse(testUri),
            },
            viewColumn: vscode.ViewColumn.One,
        } as unknown as vscode.TextEditor;
        sandbox.stub(vscodeWrapper, "activeTextEditor").get(() => activeEditor);

        configuration = {
            get: sandbox.stub().callsFake((key: string, defaultValue?: unknown) => {
                if (key === Constants.configOpenQueryResultsInTabByDefault) {
                    return openResultsInTabByDefault;
                }
                return defaultValue;
            }),
            update: sandbox.stub().resolves(),
        };

        vscodeWrapper.getConfiguration.callsFake(() => {
            return configuration as unknown as vscode.WorkspaceConfiguration;
        });

        controller = new QueryResultWebviewController(
            context,
            vscodeWrapper,
            executionPlanService as unknown as ExecutionPlanService,
            sqlOutputContentProvider as unknown as SqlOutputContentProvider,
        );

        controller.addQueryResultState(testUri, "test-query");
        controller.state = controller.getQueryResultState(testUri);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("moves current result to a tab when open-by-default is enabled via request handler", async () => {
        openResultsInTabByDefault = false;
        const createPanelControllerStub = sandbox
            .stub(controller, "createPanelController")
            .resolves();

        await controller.setOpenQueryResultsInTabByDefaultRequestHandler(true);

        expect(createPanelControllerStub).to.have.been.calledOnceWithExactly(testUri);
        expect(configuration.update).to.have.been.calledWith(
            Constants.configOpenQueryResultsInTabByDefault,
            true,
            vscode.ConfigurationTarget.Global,
        );
    });

    test("does not move current result when open-by-default is disabled via request handler", async () => {
        openResultsInTabByDefault = true;
        const createPanelControllerStub = sandbox
            .stub(controller, "createPanelController")
            .resolves();

        await controller.setOpenQueryResultsInTabByDefaultRequestHandler(false);

        expect(createPanelControllerStub).to.not.have.been.called;
    });

    test("moves current result to a tab when the setting is enabled through configuration change", async () => {
        openResultsInTabByDefault = true;
        const createPanelControllerStub = sandbox
            .stub(controller, "createPanelController")
            .resolves();

        onDidChangeConfigurationHandler?.({
            affectsConfiguration: (section: string) => {
                return section === Constants.configOpenQueryResultsInTabByDefault;
            },
        } as vscode.ConfigurationChangeEvent);

        await Promise.resolve();

        expect(createPanelControllerStub).to.have.been.calledOnceWithExactly(testUri);
    });

    test("notifies the active webview when messages are copied to the clipboard", async () => {
        controller.setQueryResultState(testUri, {
            ...controller.getQueryResultState(testUri),
            messages: [
                { message: "first message", isError: false },
                { message: "second message", isError: false },
            ],
        });
        controller.state = controller.getQueryResultState(testUri);
        const sendNotificationStub = sandbox.stub(controller, "sendNotification").resolves();

        await controller.copyAllMessagesToClipboard(testUri);

        expect(vscodeWrapper.clipboardWriteText).to.have.been.calledOnceWithExactly(
            "first message\nsecond message",
        );
        expect(sendNotificationStub).to.have.been.calledOnceWithExactly(
            qr.ShowCopySuccessNotification.type,
            undefined,
        );
    });
});
