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
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import {
    stubExtensionContext,
    stubPreviewService,
    stubTelemetry,
    stubVscodeWorkspace,
} from "./utils";

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

    const testUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();

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

    test("keeps freeze-first-column disabled by default and reads an explicit opt-in", () => {
        expect(controller.getGridSettingsConfig().freezeFirstColumnByDefault).to.be.false;

        configuration.get
            .withArgs(Constants.configResultsGridFreezeFirstColumnByDefault)
            .returns(true);

        expect(controller.getGridSettingsConfig().freezeFirstColumnByDefault).to.be.true;
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

    test("reports results grid mode changes made through settings", () => {
        const { sendActionEvent } = stubTelemetry(sandbox);
        stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

        onDidChangeConfigurationHandler?.({
            affectsConfiguration: (section: string) =>
                section === getPreviewConfigKey(PreviewFeature.BetaResultsGrid),
        } as vscode.ConfigurationChangeEvent);

        expect(sendActionEvent).to.have.been.calledWithMatch(
            TelemetryViews.QueryResult,
            TelemetryActions.ToggleResultsGridMode,
            sinon.match({
                additionalProps: {
                    correlationId: sinon.match.string,
                    newMode: "preview",
                    source: "settings",
                },
            }),
        );
        expect(controller.getQueryResultState(testUri).isBetaResultsGridEnabled).to.be.true;
    });

    test("suppresses switch telemetry once without suppressing the next settings change", () => {
        const { sendActionEvent } = stubTelemetry(sandbox);
        stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: false });
        const betaGridConfigurationChange = {
            affectsConfiguration: (section: string) =>
                section === getPreviewConfigKey(PreviewFeature.BetaResultsGrid),
        } as vscode.ConfigurationChangeEvent;

        controller.setGridModeChangeReportedBySwitch(true);
        onDidChangeConfigurationHandler?.(betaGridConfigurationChange);

        expect(sendActionEvent).to.not.have.been.called;

        onDidChangeConfigurationHandler?.(betaGridConfigurationChange);

        expect(sendActionEvent).to.have.been.calledWithMatch(
            TelemetryViews.QueryResult,
            TelemetryActions.ToggleResultsGridMode,
            sinon.match({
                additionalProps: sinon.match({
                    newMode: "classic",
                    source: "settings",
                }),
            }),
        );
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
