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
import QueryRunner, { QueryExecutionCompleteEvent } from "../../src/controllers/queryRunner";
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import { QueryResultWebviewController } from "../../src/queryResult/queryResultWebViewController";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import { getPreviewConfigKey, PreviewFeature } from "../../src/previews/previewService";
import {
    CloseMultiResultNotification,
    MoveMultiResultNotification,
    MultiResultsFileStateNotification,
    MultiResultsPaneActionRequest,
    MultiResultsState,
} from "../../src/sharedInterfaces/multiResults";
import * as qr from "../../src/sharedInterfaces/queryResult";
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
        inspect: sinon.SinonStub;
        update: sinon.SinonStub;
    };
    let onDidChangeConfigurationHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    let openResultsInTabByDefault = false;
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
                return defaultValue;
            }),
            inspect: sandbox.stub().returns(undefined),
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

    test("keeps right-aligned numbers disabled by default and reads an explicit opt-in", () => {
        expect(controller.getGridSettingsConfig().rightAlignNumbers).to.be.false;

        configuration.get.withArgs(Constants.configResultsGridRightAlignNumbers).returns(true);

        expect(controller.getGridSettingsConfig().rightAlignNumbers).to.be.true;
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

    suite("multi-results layout", () => {
        const otherUri = "file:///other.sql";
        let multiController: QueryResultWebviewController;
        let previews: Record<string, boolean>;
        let requestHandlers: Map<string, (params: unknown) => Promise<unknown>>;
        let notificationHandlers: Map<string, (params: unknown) => void>;
        let onDidCloseTextDocumentHandler: ((document: vscode.TextDocument) => void) | undefined;
        let executeCommandStub: sinon.SinonStub;

        function editorFor(uri: string): vscode.TextEditor {
            return {
                document: { uri: vscode.Uri.parse(uri) },
                viewColumn: vscode.ViewColumn.One,
            } as unknown as vscode.TextEditor;
        }

        function getMultiResults(): MultiResultsState {
            return multiController.state.multiResults!;
        }

        function getActiveGroup() {
            const state = getMultiResults();
            return state.groups.find((group) => group.id === state.activeGroupId);
        }

        setup(() => {
            previews = {
                [PreviewFeature.BetaResultsGrid]: true,
                [PreviewFeature.MultiResults]: true,
            };
            stubPreviewService(sandbox, previews);
            configuration.get
                .withArgs(getPreviewConfigKey(PreviewFeature.MultiResults))
                .callsFake(() => previews[PreviewFeature.MultiResults]);
            executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            requestHandlers = new Map();
            notificationHandlers = new Map();
            sandbox
                .stub(QueryResultWebviewController.prototype, "onRequest")
                .callsFake((type, handler) => {
                    requestHandlers.set(type.method, (params) =>
                        Promise.resolve(handler(params as never, undefined as never)),
                    );
                });
            sandbox
                .stub(QueryResultWebviewController.prototype, "onNotification")
                .callsFake((type, handler) => {
                    notificationHandlers.set(type.method, handler as (params: unknown) => void);
                });
            vscodeWorkspace.onDidCloseTextDocument.callsFake(
                (handler: (document: vscode.TextDocument) => void) => {
                    onDidCloseTextDocumentHandler = handler;
                    return new vscode.Disposable(() => undefined);
                },
            );

            multiController = new QueryResultWebviewController(
                stubExtensionContext(sandbox),
                executionPlanService as unknown as ExecutionPlanService,
                sqlOutputContentProvider as unknown as SqlOutputContentProvider,
            );
            multiController.addQueryResultState(testUri, "test.sql");
            multiController.addQueryResultState(otherUri, "other.sql");
        });

        test("lists every result and shows the one most recently run", () => {
            expect(executeCommandStub).to.have.been.calledWith(
                "setContext",
                Constants.multiResultsActiveContextKey,
                true,
            );
            const state = getMultiResults();
            expect(state.groups.map((group) => group.uris)).to.deep.equal([[testUri], [otherUri]]);
            expect(getActiveGroup()?.uris).to.deep.equal([otherUri]);
            expect(state.entries[testUri]).to.include({
                title: "test.sql",
                isDocumentClosed: false,
            });
            expect(multiController.state.uri).to.be.undefined;
        });

        test("follows the active editor to the group holding its result", () => {
            const thirdUri = "file:///third.sql";
            multiController.addQueryResultState(thirdUri, "third.sql");
            const otherGroupId = getMultiResults().groups[1].id;
            notificationHandlers.get(MoveMultiResultNotification.type.method)!({
                uri: testUri,
                target: { kind: "joinGroup", groupId: otherGroupId, index: 1 },
            });
            multiController.focusMultiResult(thirdUri);

            multiController.updateResultsOnActiveEditorChange(editorFor(testUri));

            expect(getActiveGroup()?.uris).to.deep.equal([otherUri, testUri]);
            expect(getActiveGroup()?.focusedUri).to.equal(testUri);
        });

        test("keeps the current group for editors without results and when not following", () => {
            multiController.updateResultsOnActiveEditorChange(editorFor("file:///none.sql"));
            expect(getActiveGroup()?.uris).to.deep.equal([otherUri]);

            configuration.get
                .withArgs(Constants.configQueryResultsFollowActiveEditor)
                .returns(false);
            multiController.updateResultsOnActiveEditorChange(editorFor(testUri));
            expect(getActiveGroup()?.uris).to.deep.equal([otherUri]);
        });

        test("shows the active editor's results when following is turned back on", () => {
            onDidChangeConfigurationHandler?.({
                affectsConfiguration: (section: string) =>
                    section === Constants.configQueryResultsFollowActiveEditor,
            } as vscode.ConfigurationChangeEvent);

            expect(getActiveGroup()?.uris).to.deep.equal([testUri]);
            expect(getMultiResults().followActiveEditor).to.be.true;
        });

        test("changes following where the setting is set", async () => {
            await multiController["setFollowActiveEditor"](false);
            expect(configuration.update).to.have.been.calledWith(
                Constants.configQueryResultsFollowActiveEditor,
                false,
                vscode.ConfigurationTarget.Global,
            );

            configuration.inspect.returns({
                key: Constants.configQueryResultsFollowActiveEditor,
                workspaceValue: true,
            });
            await multiController["setFollowActiveEditor"](false);
            expect(configuration.update).to.have.been.calledWith(
                Constants.configQueryResultsFollowActiveEditor,
                false,
                vscode.ConfigurationTarget.Workspace,
            );
        });

        test("keeps results that are open in a tab out of the list when their query runs again", () => {
            multiController["_queryResultWebviewPanelControllerMap"].set(otherUri, {} as never);
            multiController["removeFromMultiResults"](otherUri);

            multiController.addQueryResultState(otherUri, "other.sql");

            expect(multiController.isInMultiResultsList(otherUri)).to.be.false;
            expect(getMultiResults().groups.map((group) => group.uris)).to.deep.equal([[testUri]]);
        });

        test("a result saved over a closed file's listed result replaces it", () => {
            onDidCloseTextDocumentHandler!({
                uri: vscode.Uri.parse(otherUri),
            } as vscode.TextDocument);

            multiController.updateUri(testUri, otherUri);

            expect(getMultiResults().groups.map((group) => group.uris)).to.deep.equal([[otherUri]]);
            expect(getMultiResults().entries[otherUri].isDocumentClosed).to.be.false;
            expect(multiController.getQueryResultState(otherUri).title).to.equal("test.sql");
        });

        test("keeps a result listed after its editor closes", () => {
            onDidCloseTextDocumentHandler!({
                uri: vscode.Uri.parse(testUri),
            } as vscode.TextDocument);

            expect(multiController.hasQueryResultState(testUri)).to.be.true;
            expect(multiController.isInMultiResultsList(testUri)).to.be.true;
            expect(getMultiResults().entries[testUri].isDocumentClosed).to.be.true;
            expect(sqlOutputContentProvider.cleanupRunner).to.not.have.been.called;
        });

        test("closing a result discards it and cleans up its query", () => {
            notificationHandlers.get(CloseMultiResultNotification.type.method)!({
                uri: otherUri,
            });

            expect(multiController.hasQueryResultState(otherUri)).to.be.false;
            expect(sqlOutputContentProvider.cleanupRunner).to.have.been.calledWith(otherUri);
            expect(getMultiResults().groups.map((group) => group.uris)).to.deep.equal([[testUri]]);
            expect(getActiveGroup()?.uris).to.deep.equal([testUri]);
        });

        test("keeps a cancelled query's state until the query completes", () => {
            const completeEmitter = new vscode.EventEmitter<QueryExecutionCompleteEvent>();
            sqlOutputContentProvider.getQueryRunner.withArgs(otherUri).returns({
                isExecutingQuery: true,
                onComplete: completeEmitter.event,
            } as unknown as QueryRunner);

            notificationHandlers.get(CloseMultiResultNotification.type.method)!({
                uri: otherUri,
            });

            expect(multiController.isInMultiResultsList(otherUri)).to.be.false;
            expect(multiController.hasQueryResultState(otherUri)).to.be.true;
            expect(sqlOutputContentProvider.cleanupRunner).to.have.been.calledWith(otherUri);

            completeEmitter.fire({} as QueryExecutionCompleteEvent);

            expect(multiController.hasQueryResultState(otherUri)).to.be.false;
        });

        test("runs a pane's actions against its own result", async () => {
            await requestHandlers.get(MultiResultsPaneActionRequest.type.method)!({
                uri: testUri,
                type: "setResultTab",
                payload: { tabId: qr.QueryResultPaneTabs.Results },
            });

            expect(multiController.getQueryResultState(testUri).tabStates?.resultPaneTab).to.equal(
                qr.QueryResultPaneTabs.Results,
            );
            expect(multiController.getQueryResultState(otherUri).tabStates?.resultPaneTab).to.equal(
                qr.QueryResultPaneTabs.Messages,
            );
            expect(multiController.state.multiResults).to.exist;
        });

        test("drops a pane action's state when the result is run again before it finishes", async () => {
            let finishReducer: () => void = () => undefined;
            multiController.registerReducer(
                "openFileThroughLink",
                (state) =>
                    new Promise((resolve) => {
                        finishReducer = () => resolve({ ...state, title: "stale" });
                    }),
            );

            const action = requestHandlers.get(MultiResultsPaneActionRequest.type.method)!({
                uri: testUri,
                type: "openFileThroughLink",
                payload: { content: "", type: "" },
            });
            multiController.addQueryResultState(testUri, "test.sql");
            finishReducer();
            await action;

            expect(multiController.getQueryResultState(testUri).title).to.equal("test.sql");
        });

        test("sends a result's state to the view only while its group is shown", () => {
            const sendNotification = sandbox.spy(multiController, "sendNotification");

            multiController.updateMultiResult(testUri);
            expect(sendNotification).to.not.have.been.calledWith(
                MultiResultsFileStateNotification.type,
            );

            multiController.updateMultiResult(otherUri);
            expect(sendNotification).to.have.been.calledWith(
                MultiResultsFileStateNotification.type,
                sinon.match({ uri: otherUri }),
            );
        });

        test("returns to the single-result view when the preview is turned off", () => {
            onDidCloseTextDocumentHandler!({
                uri: vscode.Uri.parse(otherUri),
            } as vscode.TextDocument);
            previews[PreviewFeature.MultiResults] = false;

            onDidChangeConfigurationHandler?.({
                affectsConfiguration: (section: string) =>
                    section === getPreviewConfigKey(PreviewFeature.MultiResults),
            } as vscode.ConfigurationChangeEvent);

            expect(executeCommandStub).to.have.been.calledWith(
                "setContext",
                Constants.multiResultsActiveContextKey,
                false,
            );
            expect(multiController.state.multiResults).to.be.undefined;
            expect(multiController.state.uri).to.equal(testUri);
            // Results the single-result view would already have dropped with their editor.
            expect(multiController.hasQueryResultState(otherUri)).to.be.false;
            expect(sqlOutputContentProvider.cleanupRunner).to.have.been.calledWith(otherUri);
        });
    });
});
