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
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import { QueryResultWebviewController } from "../../src/queryResult/queryResultWebViewController";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import { getPreviewConfigKey, PreviewFeature } from "../../src/previews/previewService";
import { stubExtensionContext, stubVscodeWorkspace } from "./utils";
import { QueryCompletionAudioService } from "../../src/services/queryCompletionAudioService";
import { PlayQueryCompletionSoundNotification } from "../../src/sharedInterfaces/queryResult";

chai.use(sinonChai);

suite("QueryResultWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
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
    let betaExecutionPlanEnabled = false;
    let vscodeWorkspace: ReturnType<typeof stubVscodeWorkspace>;
    let queryCompletionAudioService: sinon.SinonStubbedInstance<QueryCompletionAudioService>;

    const testUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

        executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        sqlOutputContentProvider = sandbox.createStubInstance(SqlOutputContentProvider);
        queryCompletionAudioService = sandbox.createStubInstance(QueryCompletionAudioService);

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
                if (key === getPreviewConfigKey(PreviewFeature.BetaExecutionPlan)) {
                    return betaExecutionPlanEnabled;
                }
                return defaultValue;
            }),
            update: sandbox.stub().resolves(),
        };

        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .returns(configuration as unknown as vscode.WorkspaceConfiguration);

        controller = new QueryResultWebviewController(
            context,
            executionPlanService as unknown as ExecutionPlanService,
            sqlOutputContentProvider as unknown as SqlOutputContentProvider,
            queryCompletionAudioService,
        );

        controller.addQueryResultState(testUri, "test-query");
        controller.state = controller.getQueryResultState(testUri);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("resolves the selection summary continuation for a known result", () => {
        const resolve = sandbox.stub();
        controller["_selectionSummaryContinuations"].set(testUri, {
            resolve,
        } as any);

        controller.handleSelectionSummary(testUri);

        expect(resolve).to.have.been.calledOnce;
    });

    test("ignores a selection summary request for an unknown result", () => {
        const resolve = sandbox.stub();
        controller["_selectionSummaryContinuations"].set("file:///unknown.sql", {
            resolve,
        } as any);

        controller.handleSelectionSummary("file:///unknown.sql");

        expect(resolve).to.not.have.been.called;
    });

    test("sends query completion audio sources to the webview", async () => {
        const audioSources = {
            audioSource: "data:audio/mpeg;base64,YXVkaW8=",
            fallbackAudioSource: "data:audio/wav;base64,d2F2",
        };
        queryCompletionAudioService.getAudioSources.resolves(audioSources);
        sandbox.stub(controller, "whenWebviewReady").resolves();
        const sendNotificationStub = sandbox.stub(controller, "sendNotification").resolves();

        await controller.playQueryCompletionSound(testUri);

        expect(sendNotificationStub).to.have.been.calledWith(
            PlayQueryCompletionSoundNotification.type,
            audioSources,
        );
    });

    test("does not notify the webview when completion sounds are disabled", async () => {
        queryCompletionAudioService.getAudioSources.resolves(undefined);
        const sendNotificationStub = sandbox.stub(controller, "sendNotification").resolves();

        await controller.playQueryCompletionSound(testUri);

        expect(sendNotificationStub).not.to.have.been.called;
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

    test("initializes and propagates the React Flow execution plan preview setting", () => {
        const executionPlanUri = "file:///execution-plan.sql";
        controller.addQueryResultState(executionPlanUri, "execution-plan", true);

        expect(
            controller.getQueryResultState(executionPlanUri).executionPlanState
                .isBetaExecutionPlanEnabled,
        ).to.be.false;

        betaExecutionPlanEnabled = true;
        onDidChangeConfigurationHandler?.({
            affectsConfiguration: (section: string) =>
                section === getPreviewConfigKey(PreviewFeature.BetaExecutionPlan),
        } as vscode.ConfigurationChangeEvent);

        expect(
            controller.getQueryResultState(executionPlanUri).executionPlanState
                .isBetaExecutionPlanEnabled,
        ).to.be.true;
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
