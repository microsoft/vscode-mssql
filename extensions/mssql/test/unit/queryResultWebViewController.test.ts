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
import { stubExtensionContext, stubVscodeWrapper, stubVscodeWorkspace } from "./utils";

chai.use(sinonChai);

suite("QueryResultWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let executionPlanService: sinon.SinonStubbedInstance<ExecutionPlanService>;
    let sqlOutputContentProvider: sinon.SinonStubbedInstance<SqlOutputContentProvider>;
    let controller: QueryResultWebviewController;
    let clipboardWriteTextStub: sinon.SinonStub;
    let configuration: {
        get: sinon.SinonStub;
        update: sinon.SinonStub;
    };
    let onDidChangeConfigurationHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    let openResultsInTabByDefault = false;
    let vscodeWorkspace: ReturnType<typeof stubVscodeWorkspace>;

    const testUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

        vscodeWrapper = stubVscodeWrapper(sandbox);
        executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        sqlOutputContentProvider = sandbox.createStubInstance(SqlOutputContentProvider);

        clipboardWriteTextStub = sandbox.stub().resolves();
        sandbox.stub(vscode.env, "clipboard").value({ writeText: clipboardWriteTextStub });

        const context = stubExtensionContext(sandbox);
        const disposable = new vscode.Disposable(() => undefined);
        vscodeWorkspace = stubVscodeWorkspace(sandbox);
        vscodeWorkspace.onDidChangeConfiguration.callsFake(
            (handler: (e: vscode.ConfigurationChangeEvent) => void) => {
                onDidChangeConfigurationHandler = handler;
                return disposable;
            },
        );

        sandbox.stub(vscode.commands, "registerCommand").returns(disposable);
        sandbox.stub(vscode.window, "createStatusBarItem").returns({
            text: "",
            tooltip: "",
            command: undefined,
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.StatusBarItem);

        const activeEditor = {
            document: {
                uri: vscode.Uri.parse(testUri),
            },
            viewColumn: vscode.ViewColumn.One,
        } as unknown as vscode.TextEditor;
        sandbox.stub(vscode.window, "activeTextEditor").get(() => activeEditor);

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

        expect(createPanelControllerStub).to.have.been.calledWithExactly(testUri);
    });

    test("copies messages to the clipboard", async () => {
        controller.setQueryResultState(testUri, {
            ...controller.getQueryResultState(testUri),
            messages: [
                { message: "first message", isError: false },
                { message: "second message", isError: false },
            ],
        });
        controller.state = controller.getQueryResultState(testUri);

        await controller.copyAllMessagesToClipboard(testUri);

        expect(clipboardWriteTextStub).to.have.been.calledWithExactly(
            "first message\nsecond message",
        );
    });
});
