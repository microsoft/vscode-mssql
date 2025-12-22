/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import StatusView from "../../src/views/statusView";
import * as stubs from "./stubs";
import * as Constants from "../../src/constants/constants";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ISelectionData } from "../../src/models/interfaces";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import QueryRunner from "../../src/controllers/queryRunner";
import store from "../../src/queryResult/singletonStore";

const { expect } = chai;

chai.use(sinonChai);

suite("SqlOutputProvider Tests using mocks", () => {
    const testUri = "Test_URI";

    type MockRunnerEntry = {
        queryRunner: { isExecutingQuery: boolean };
        flaggedForDeletion?: boolean;
    };

    let sandbox: sinon.SinonSandbox;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let mockContentProvider: sinon.SinonStubbedInstance<SqlOutputContentProvider>;
    let context: vscode.ExtensionContext;
    let statusView: sinon.SinonStubbedInstance<StatusView>;
    let statusViewInstance: StatusView;
    let executionPlanService: sinon.SinonStubbedInstance<ExecutionPlanService>;
    let mockMap: Map<string, MockRunnerEntry>;
    let setSplitPaneSelectionConfig: (value: string) => void;
    let setCurrentEditorColumn: (column: number) => void;

    setup(() => {
        sandbox = sinon.createSandbox();
        vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        statusView = sandbox.createStubInstance(StatusView);
        statusViewInstance = statusView as unknown as StatusView;
        executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        context = {
            extensionPath: "test_uri",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
        mockMap = new Map();

        const disposable = { dispose: () => {} } as vscode.Disposable;
        sandbox.stub(vscode.window, "registerWebviewViewProvider").returns(disposable);
        sandbox.stub(vscode.commands, "registerCommand").returns(disposable);

        sandbox.stub(vscodeWrapper, "onDidOpenTextDocument").get(() => () => disposable);
        sandbox.stub(vscodeWrapper, "onDidChangeConfiguration").get(() => () => disposable);

        contentProvider = new SqlOutputContentProvider(
            context,
            statusViewInstance,
            vscodeWrapper as unknown as VscodeWrapper,
            executionPlanService as unknown as ExecutionPlanService,
        );
        contentProvider.setVscodeWrapper = vscodeWrapper as unknown as VscodeWrapper;
        vscodeWrapper.getConfiguration.callsFake(() => stubs.createWorkspaceConfiguration({}));

        setSplitPaneSelectionConfig = (value: string): void => {
            const configResult: { [key: string]: unknown } = {};
            configResult[Constants.configSplitPaneSelection] = value;
            const config = stubs.createWorkspaceConfiguration(configResult);
            vscodeWrapper.getConfiguration.callsFake(() => config);
        };

        let currentEditor: vscode.TextEditor | undefined;
        sandbox.stub(vscodeWrapper, "activeTextEditor").get(() => currentEditor);

        setCurrentEditorColumn = (column: number): void => {
            currentEditor = { viewColumn: column } as vscode.TextEditor;
        };

        mockContentProvider = sandbox.createStubInstance(SqlOutputContentProvider);
        sandbox.stub(mockContentProvider, "getResultsMap").get(() => mockMap);

        const ensureRunnerState = (uri: string): MockRunnerEntry => {
            let entry = mockMap.get(uri);
            if (!entry) {
                entry = { queryRunner: { isExecutingQuery: false } };
                mockMap.set(uri, entry);
            }
            return entry;
        };

        mockContentProvider.runQuery.callsFake(async (_status, uri) => {
            const entry = ensureRunnerState(uri);
            entry.queryRunner.isExecutingQuery = true;
        });

        mockContentProvider.onUntitledFileSaved.callsFake(async (oldUri, newUri) => {
            const entry = ensureRunnerState(oldUri);
            mockMap.delete(oldUri);
            mockMap.set(newUri, { ...entry, queryRunner: { isExecutingQuery: true } });
        });

        mockContentProvider.onDidCloseTextDocument.callsFake(async (doc: vscode.TextDocument) => {
            const uri = doc.uri.toString(true);
            const entry = ensureRunnerState(uri);
            entry.flaggedForDeletion = true;
        });

        mockContentProvider.isRunningQuery.callsFake((uri: string) => {
            const entry = mockMap.get(uri);
            return Boolean(entry?.queryRunner.isExecutingQuery);
        });

        mockContentProvider.cancelQuery.callsFake(async (uri: string) => {
            statusView.cancelingQuery(uri);
            const entry = ensureRunnerState(uri);
            entry.queryRunner.isExecutingQuery = false;
        });

        mockContentProvider.getQueryRunner.callsFake((uri: string) => {
            return mockMap.get(uri)?.queryRunner as unknown as QueryRunner;
        });
    });

    teardown(() => {
        mockMap.clear();
        sandbox.restore();
    });

    test("Correctly outputs the new result pane view column", () => {
        const cases = [
            { position: 1, config: "next", expectedColumn: 2 },
            { position: 2, config: "next", expectedColumn: 3 },
            { position: 3, config: "next", expectedColumn: 3 },
            { position: 1, config: "current", expectedColumn: 1 },
            { position: 2, config: "current", expectedColumn: 2 },
            { position: 3, config: "current", expectedColumn: 3 },
            { position: 1, config: "end", expectedColumn: 3 },
            { position: 2, config: "end", expectedColumn: 3 },
            { position: 3, config: "end", expectedColumn: 3 },
        ];

        cases.forEach((testCase) => {
            setSplitPaneSelectionConfig(testCase.config);
            setCurrentEditorColumn(testCase.position);

            const resultColumn = contentProvider.newResultPaneViewColumn("test_uri");

            expect(resultColumn).to.equal(testCase.expectedColumn);
        });
    });

    test("RunQuery properly sets up two queries to be run", async () => {
        // Run function with properties declared below
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Run function with properties declared below
        let title2 = "Test_Title2";
        let uri2 = "Test_URI2";
        await mockContentProvider.runQuery(statusViewInstance, uri2, querySelection, title2);

        // Ensure both uris are executing
        expect(mockMap.get(uri)?.queryRunner.isExecutingQuery).to.be.true;
        expect(mockMap.get(uri2)?.queryRunner.isExecutingQuery).to.be.true;
        expect(mockMap.size).to.equal(2);
        mockMap.clear();
    });

    test("RunQuery only sets up one uri with the same name", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Ensure all side effects occurred as intended
        expect(mockMap.get(uri)?.queryRunner.isExecutingQuery).to.be.true;
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);
        expect(mockMap.get(uri)?.queryRunner.isExecutingQuery).to.be.true;
        expect(mockMap.size).to.equal(1);
        mockMap.clear();
    });

    test("onUntitledFileSaved should delete the untitled file and create a new titled file", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let newUri = "Test_URI_New";
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Ensure all side effects occured as intended
        expect(mockMap.has(testUri)).to.be.true;

        await mockContentProvider.onUntitledFileSaved(uri, newUri);

        // Check that the first one was replaced by the new one and that there is only one in the map
        expect(mockMap.has(uri)).to.be.false;
        expect(mockMap.get(newUri)?.queryRunner.isExecutingQuery).to.be.true;
        expect(mockMap.size).to.equal(1);
        mockMap.clear();
    });

    test("onDidCloseTextDocument properly mark the uri for deletion", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Ensure all side effects occured as intended
        expect(mockMap.has(uri)).to.be.true;

        let doc = <vscode.TextDocument>{
            uri: {
                toString(skipEncoding?: boolean): string {
                    return uri;
                },
            },
            languageId: "sql",
        };
        await mockContentProvider.onDidCloseTextDocument(doc);

        // This URI should now be flagged for deletion later on
        expect(mockMap.get(uri)?.flaggedForDeletion).to.be.true;
        mockMap.clear();
    });

    test("isRunningQuery should return the correct state for the query", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let notRunUri = "Test_URI_New";
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Ensure all side effects occured as intended
        expect(mockMap.has(testUri)).to.be.true;

        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Check that the first one was replaced by the new one and that there is only one in the map
        expect(mockContentProvider.isRunningQuery(uri)).to.be.true;
        expect(mockContentProvider.isRunningQuery(notRunUri)).to.be.false;
        expect(mockMap.size).to.equal(1);
        mockMap.clear();
    });

    test("cancelQuery should cancel the execution of a query by result pane URI", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let resultUri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);
        await mockContentProvider.cancelQuery(resultUri);

        // Ensure all side effects occured as intended
        expect(mockMap.has(resultUri)).to.be.true;

        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        expect(mockContentProvider.isRunningQuery(resultUri)).to.be.true;
        expect(statusView.cancelingQuery).to.have.been.calledOnceWithExactly(resultUri);
        expect(mockMap.size).to.equal(1);
    });

    test("cancelQuery should cancel the execution of a query by SQL pane URI", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);
        await mockContentProvider.cancelQuery(uri);

        // Ensure all side effects occured as intended
        expect(mockMap.has(testUri)).to.be.true;

        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        expect(mockContentProvider.isRunningQuery(uri)).to.be.true;
        expect(statusView.cancelingQuery).to.have.been.calledOnceWithExactly(uri);
        expect(mockMap.size).to.equal(1);
    });

    test("getQueryRunner should return the appropriate query runner", async () => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        await mockContentProvider.runQuery(statusViewInstance, uri, querySelection, title);
        let testedRunner = mockContentProvider.getQueryRunner(uri);

        // Ensure that the runner returned is the one inteneded
        expect(mockMap.get(testUri)?.queryRunner).to.equal(testedRunner);
    });

    test("cancelQuery with no query running should show information message about it", async () => {
        vscodeWrapper.showInformationMessage.resolves("error");
        await contentProvider.cancelQuery("test_input");
        expect(vscodeWrapper.showInformationMessage).to.have.been.calledOnce;
    });

    test("getQueryRunner should return undefined for new URI", () => {
        let queryRunner = contentProvider.getQueryRunner("test_uri");
        expect(queryRunner).to.be.undefined;
    });

    test("toggleSqlCmd should do nothing if no queryRunner exists", async () => {
        let result = await contentProvider.toggleSqlCmd("test_uri");
        expect(result).to.be.false;
    });

    test("Test queryResultsMap getters and setters", () => {
        let queryResultsMap = contentProvider.getResultsMap;
        // Query Results Map should be empty
        expect(queryResultsMap.size).to.equal(0);
        let newQueryResultsMap = new Map();
        newQueryResultsMap.set("test_uri", { queryRunner: {} });
        contentProvider.setResultsMap = newQueryResultsMap;
        expect(contentProvider.getQueryRunner("test_uri")).to.not.be.undefined;
    });

    test("showErrorRequestHandler should call vscodeWrapper to show error message", () => {
        contentProvider.showErrorRequestHandler("test_error");
        expect(vscodeWrapper.showErrorMessage).to.have.been.calledOnceWithExactly("test_error");
    });

    test("showWarningRequestHandler should call vscodeWrapper to show warning message", () => {
        contentProvider.showWarningRequestHandler("test_warning");
        expect(vscodeWrapper.showWarningMessage).to.have.been.calledOnceWithExactly("test_warning");
    });

    test("A query runner should only exist if a query is run", async () => {
        vscodeWrapper.getConfiguration.callsFake(() => {
            const configResult: { [key: string]: unknown } = {};
            configResult[Constants.configPersistQueryResultTabs] = false;
            return stubs.createWorkspaceConfiguration(configResult);
        });

        contentProvider.queryResultWebviewController.createPanelController = sandbox
            .stub()
            .resolves();

        sandbox.stub(QueryRunner.prototype, "runQuery").resolves();

        let testQueryRunner = contentProvider.getQueryRunner("test_uri");
        expect(testQueryRunner).to.be.undefined;
        await contentProvider.runQuery(statusViewInstance, "test_uri", undefined, "test_title");
        testQueryRunner = contentProvider.getQueryRunner("test_uri");
        expect(testQueryRunner).to.not.be.undefined;
    });

    test("runCurrentStatement calls runStatement with correct options when actual plan is enabled", async () => {
        const uri = "test_uri";
        const title = "test_title";
        const selection: ISelectionData = {
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 1,
        };

        const mockQueryRunner = {
            runStatement: sandbox.stub().resolves(),
        };

        sandbox
            .stub(contentProvider as any, "initializeRunnerAndWebviewState")
            .resolves(mockQueryRunner);
        (contentProvider as any)._actualPlanStatuses = [uri];

        await contentProvider.runCurrentStatement(statusViewInstance, uri, selection, title);

        expect(mockQueryRunner.runStatement).to.have.been.calledWith(
            selection.startLine,
            selection.startColumn,
            { includeActualExecutionPlanXml: true },
        );
    });

    test("runCurrentStatement calls runStatement with correct options when actual plan is disabled", async () => {
        const uri = "test_uri";
        const title = "test_title";
        const selection: ISelectionData = {
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 1,
        };

        const mockQueryRunner = {
            runStatement: sandbox.stub().resolves(),
        };

        sandbox
            .stub(contentProvider as any, "initializeRunnerAndWebviewState")
            .resolves(mockQueryRunner);
        (contentProvider as any)._actualPlanStatuses = [];

        await contentProvider.runCurrentStatement(statusViewInstance, uri, selection, title);

        expect(mockQueryRunner.runStatement).to.have.been.calledWith(
            selection.startLine,
            selection.startColumn,
            { includeActualExecutionPlanXml: false },
        );
    });

    test("initializeRunnerAndWebviewState clears grid state", async () => {
        const uri = "test_uri";
        const title = "test_title";
        const deleteUriStateSpy = sandbox.spy(store, "deleteUriState");

        // Stub createQueryRunner to return a dummy runner
        const mockRunner = {
            uri: uri,
            runStatement: sandbox.stub().resolves(),
            runQuery: sandbox.stub().resolves(),
            isExecutingQuery: false,
            resetHasCompleted: sandbox.stub(),
            onStartFailed: sandbox.stub(),
            onStart: sandbox.stub(),
            onResultSetAvailable: sandbox.stub(),
            onResultSetUpdated: sandbox.stub(),
            onExecutionPlan: sandbox.stub(),
            onSummaryChanged: sandbox.stub(),
        } as unknown as QueryRunner;

        sandbox.stub(contentProvider, "createQueryRunner").resolves(mockRunner);

        // Stub _queryResultWebviewController methods to avoid errors
        const webviewController = (contentProvider as any)._queryResultWebviewController;
        sandbox.stub(webviewController, "addQueryResultState");
        sandbox.stub(webviewController, "createPanelController").resolves();

        // Call runCurrentStatement which calls initializeRunnerAndWebviewState
        await contentProvider.runCurrentStatement(
            statusViewInstance,
            uri,
            { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            title,
        );

        expect(deleteUriStateSpy).to.have.been.calledWith(uri);
    });
});
