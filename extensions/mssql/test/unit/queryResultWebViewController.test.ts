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
import { QueryResultWebviewPanelController } from "../../src/queryResult/queryResultWebviewPanelController";
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
    let activeEditor: vscode.TextEditor | undefined;

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

        activeEditor = {
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

        expect(vscodeWrapper.clipboardWriteText).to.have.been.calledWithExactly(
            "first message\nsecond message",
        );
    });

    suite("query results list", () => {
        const testUriB = "file:///test-b.sql";

        // Enable the query results list preview for the controller under test. The getter reads
        // from the global preview service, so it is stubbed directly on the instance.
        function enableResultsList(): void {
            sandbox.stub(controller, "isQueryResultsListEnabled").get(() => true);
        }

        // Treat the given URIs as currently open editor tabs so they appear in the results list.
        function stubOpenTabs(...uris: string[]): void {
            sandbox.stub(controller, "getOpenEditorUris").returns(new Set(uris));
        }

        test("follows the active editor by default", () => {
            enableResultsList();
            stubOpenTabs(testUri);

            controller.refreshResultsList();

            expect(controller.state.isQueryResultsListEnabled).to.equal(true);
            expect(controller.state.isFollowingActiveEditor).to.equal(true);
            expect(controller.state.sessions).to.have.lengthOf(1);
            expect(controller.state.sessions?.[0]).to.include({
                uri: testUri,
                isActiveEditor: true,
                isOpenInTab: false,
            });
            expect(controller.state.uri).to.equal(testUri);
        });

        test("shows empty while following when the active editor has no results", () => {
            enableResultsList();
            // The active editor (testUri) has no results; only testUriB does.
            controller.deleteQueryResultState(testUri);
            controller.addQueryResultState(testUriB, "B");
            stubOpenTabs(testUriB);

            controller.refreshResultsList();

            expect(controller.state.isFollowingActiveEditor).to.equal(true);
            expect(controller.state.uri).to.equal(undefined);
            expect(controller.state.sessions).to.have.lengthOf(1);
        });

        test("reports an executing session in the roster", () => {
            enableResultsList();
            stubOpenTabs(testUri);
            controller.setQueryResultState(testUri, {
                ...controller.getQueryResultState(testUri),
                isExecuting: true,
            });

            controller.refreshResultsList();

            expect(controller.state.sessions?.[0].status).to.equal(
                qr.QueryResultSessionStatus.Executing,
            );
        });

        test("marks a session as failed when it has an error message", () => {
            enableResultsList();
            stubOpenTabs(testUri);
            controller.setQueryResultState(testUri, {
                ...controller.getQueryResultState(testUri),
                isExecuting: false,
                messages: [{ message: "boom", isError: true }],
            });

            controller.refreshResultsList();

            expect(controller.state.sessions?.[0].status).to.equal(
                qr.QueryResultSessionStatus.Error,
            );
        });

        test("pins a session when a different one is selected", () => {
            enableResultsList();
            controller.addQueryResultState(testUriB, "B");
            stubOpenTabs(testUri, testUriB);

            // testUriB is not the active editor (testUri), so selecting it pins.
            controller.setSelectedSession(testUriB);

            expect(controller.state.isFollowingActiveEditor).to.equal(false);
            expect(controller.state.uri).to.equal(testUriB);
            expect(controller.state.sessions).to.have.lengthOf(2);
        });

        test("keeps the pinned session when the active editor changes", () => {
            enableResultsList();
            controller.addQueryResultState(testUriB, "B");
            stubOpenTabs(testUri, testUriB);
            controller.setSelectedSession(testUriB);

            controller.updateResultsOnActiveEditorChange(undefined);

            expect(controller.state.isFollowingActiveEditor).to.equal(false);
            expect(controller.state.uri).to.equal(testUriB);
        });

        test("resumes following the active editor", () => {
            enableResultsList();
            controller.addQueryResultState(testUriB, "B");
            stubOpenTabs(testUri, testUriB);
            controller.setSelectedSession(testUriB);

            controller.followActiveEditor();

            expect(controller.state.isFollowingActiveEditor).to.equal(true);
            expect(controller.state.uri).to.equal(testUri);
        });

        test("removes a session from the list when its editor is closed", () => {
            enableResultsList();
            controller.addQueryResultState(testUriB, "B");
            // Only testUri remains open; testUriB's editor has been closed.
            stubOpenTabs(testUri);

            controller.refreshResultsList();

            const rosterUris = controller.state.sessions?.map((session) => session.uri);
            expect(rosterUris).to.deep.equal([testUri]);
        });

        test("keeps a popped-out session in the list and shows the in-tab placeholder", () => {
            enableResultsList();
            // The active editor's results are popped out to a tab.
            stubOpenTabs();
            sandbox.stub(controller, "hasPanel").callsFake((uri: string) => uri === testUri);

            controller.refreshResultsList();

            expect(controller.state.sessions).to.have.lengthOf(1);
            expect(controller.state.sessions?.[0].isOpenInTab).to.equal(true);
            expect(controller.state.isSelectedSessionInTab).to.equal(true);
            expect(controller.state.uri).to.equal(testUri);
        });

        test("treats a focused result tab as the active session", () => {
            enableResultsList();
            stubOpenTabs();
            // No active text editor: the popped-out result tab is focused instead.
            activeEditor = undefined;
            const panelController = sandbox.createStubInstance(QueryResultWebviewPanelController);
            sandbox
                .stub(panelController, "panel")
                .get(() => ({ active: true }) as unknown as vscode.WebviewPanel);
            (
                controller as unknown as {
                    _queryResultWebviewPanelControllerMap: Map<
                        string,
                        QueryResultWebviewPanelController
                    >;
                }
            )._queryResultWebviewPanelControllerMap.set(testUri, panelController);

            controller.refreshResultsList();

            expect(controller.state.isSelectedSessionInTab).to.equal(true);
            expect(controller.state.uri).to.equal(testUri);
        });

        test("auto-selects the active editor session on a streamed update", () => {
            enableResultsList();
            stubOpenTabs(testUri);

            controller.handleSessionUpdate();

            expect(controller.state.uri).to.equal(testUri);
            expect(controller.state.sessions).to.have.lengthOf(1);
        });

        test("does not populate the roster when the list is disabled", () => {
            controller.refreshResultsList();

            expect(controller.state.sessions).to.equal(undefined);
        });
    });
});
