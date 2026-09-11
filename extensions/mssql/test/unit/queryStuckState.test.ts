/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Regression tests for microsoft/vscode-mssql#22921 ("A query is already running for this
 * editor session" with no way to cancel).
 *
 * Each test drives the real SqlOutputContentProvider and QueryRunner with a stubbed service
 * client through one way the editor used to end up permanently marked as executing, and asserts
 * that the editor becomes usable again.
 */

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import {
    QueryRunnerState,
    SqlOutputContentProvider,
} from "../../src/models/sqlOutputContentProvider";
import StatusView from "../../src/views/statusView";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import QueryRunner from "../../src/controllers/queryRunner";
import { QueryNotificationHandler } from "../../src/controllers/queryNotificationHandler";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { QueryExecuteRequest } from "../../src/models/contracts/queryExecute";
import { QueryCancelRequest } from "../../src/models/contracts/queryCancel";
import * as Constants from "../../src/constants/constants";
import * as LocConstants from "../../src/constants/locConstants";
import * as stubs from "./stubs";
import { stubMessageBoxes, stubVscodeWorkspace } from "./utils";
import { Perf } from "../../src/perf/perfTelemetry";
import { ISelectionData } from "../../src/models/interfaces";

chai.use(sinonChai);
const { expect } = chai;

suite("Query execution stuck-state recovery (#22921)", () => {
    const uri = "file:///repro/query.sql";
    const title = "query.sql";
    const selection: ISelectionData = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 8 };

    let sandbox: sinon.SinonSandbox;
    let messageBoxes: ReturnType<typeof stubMessageBoxes>;
    let vscodeWorkspace: ReturnType<typeof stubVscodeWorkspace>;
    let statusView: sinon.SinonStubbedInstance<StatusView>;
    let contentProvider: SqlOutputContentProvider;
    let client: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let notificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>;

    function createRunner(runnerUri: string = uri): QueryRunner {
        return new QueryRunner(
            runnerUri,
            title,
            statusView as unknown as StatusView,
            client,
            notificationHandler,
        );
    }

    function timesShown(message: string): number {
        return messageBoxes.showInformationMessage
            .getCalls()
            .filter((call) => call.args[0] === message).length;
    }

    function useFakeTimers(): sinon.SinonFakeTimers {
        return sandbox.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout"],
            shouldClearNativeTimers: true,
        });
    }

    function stubExecuteAccepted(): void {
        client.sendRequest.withArgs(QueryExecuteRequest.type, sinon.match.object).resolves({});
    }

    function stubCancelAnsweredWithNoQuery(): void {
        client.sendRequest
            .withArgs(QueryCancelRequest.type, sinon.match.object)
            .resolves({ messages: "Query is not active" });
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        messageBoxes = stubMessageBoxes(sandbox);
        vscodeWorkspace = stubVscodeWorkspace(sandbox);
        vscodeWorkspace.openTextDocument.resolves({
            getText: () => "select 1",
        } as unknown as vscode.TextDocument);
        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .returns(stubs.createWorkspaceConfiguration({}));
        const disposable = { dispose: () => {} } as vscode.Disposable;
        sandbox.stub(vscode.window, "registerWebviewViewProvider").returns(disposable);
        sandbox.stub(vscode.commands, "registerCommand").returns(disposable);
        sandbox.stub(Perf, "marker");
        QueryRunner["_runningQueries"] = [];

        client = sandbox.createStubInstance(SqlToolsServerClient);
        notificationHandler = sandbox.createStubInstance(QueryNotificationHandler);
        statusView = sandbox.createStubInstance(StatusView);

        const context = {
            extensionPath: "test_uri",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
        const executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        contentProvider = new SqlOutputContentProvider(
            context,
            statusView as unknown as StatusView,
            executionPlanService as unknown as ExecutionPlanService,
        );
    });

    teardown(() => {
        QueryRunner["_runningQueries"] = [];
        sandbox.restore();
    });

    test("cancel recovers the editor when the service reports it has no query to cancel", async () => {
        const clock = useFakeTimers();
        stubExecuteAccepted();
        stubCancelAnsweredWithNoQuery();
        const runner = createRunner();
        contentProvider.setResultsMap = new Map([[uri, new QueryRunnerState(runner)]]);

        await runner.runQuery(selection);
        expect(runner.isExecutingQuery).to.equal(true);
        // The completion notification never arrives.

        await contentProvider.cancelQuery(uri);
        // A completion that is still in flight gets a short grace period...
        expect(runner.isExecutingQuery).to.equal(true);
        await clock.tickAsync(Constants.queryCancelOrphanGraceMs + 1);
        // ...after which the editor is reset and the user is told why.
        expect(runner.isExecutingQuery).to.equal(false);
        expect(QueryRunner["_runningQueries"]).to.be.empty;
        expect(messageBoxes.showInformationMessage).to.have.been.calledWith(
            LocConstants.msgQueryNoLongerRunning,
        );

        // Running again works.
        await contentProvider.runQuery(statusView as unknown as StatusView, uri, selection, title);
        expect(timesShown(LocConstants.msgRunQueryInProgress)).to.equal(0);
        expect(client.sendRequest.withArgs(QueryExecuteRequest.type, sinon.match.object)).to.have
            .been.calledTwice;
    });

    test("an unanswered cancel request times out and resets the editor", async () => {
        const clock = useFakeTimers();
        stubExecuteAccepted();
        client.sendRequest
            .withArgs(QueryCancelRequest.type, sinon.match.object)
            .returns(new Promise<never>(() => {}));
        const runner = createRunner();
        contentProvider.setResultsMap = new Map([[uri, new QueryRunnerState(runner)]]);
        await runner.runQuery(selection);

        const cancel = contentProvider.cancelQuery(uri);
        await clock.tickAsync(Constants.queryCancelRequestTimeoutMs + 1);
        await cancel;

        expect(runner.isExecutingQuery).to.equal(false);
        expect(messageBoxes.showErrorMessage).to.have.been.called;

        // The service answers again; running works.
        stubCancelAnsweredWithNoQuery();
        await contentProvider.runQuery(statusView as unknown as StatusView, uri, selection, title);
        expect(timesShown(LocConstants.msgRunQueryInProgress)).to.equal(0);
    });

    test("the in-progress message offers to cancel, which recovers a query the service no longer has", async () => {
        const clock = useFakeTimers();
        stubExecuteAccepted();
        stubCancelAnsweredWithNoQuery();
        messageBoxes.showInformationMessage.resolves(
            LocConstants.msgRunQueryInProgressCancelAction,
        );
        const runner = createRunner();
        contentProvider.setResultsMap = new Map([[uri, new QueryRunnerState(runner)]]);
        await runner.runQuery(selection);

        // Run again while stuck: the message is shown with a Cancel action, which the user picks.
        await contentProvider.runQuery(statusView as unknown as StatusView, uri, selection, title);
        expect(messageBoxes.showInformationMessage).to.have.been.calledWith(
            LocConstants.msgRunQueryInProgress,
            LocConstants.msgRunQueryInProgressCancelAction,
        );
        await clock.tickAsync(Constants.queryCancelOrphanGraceMs + 1);

        expect(client.sendRequest).to.have.been.calledWith(
            QueryCancelRequest.type,
            sinon.match.object,
        );
        expect(runner.isExecutingQuery).to.equal(false);
    });

    test("a failure while reading the editor text does not leave the editor marked as executing", async () => {
        stubExecuteAccepted();
        vscodeWorkspace.openTextDocument.rejects(
            new Error("simulated: the editor document could not be opened"),
        );
        const runner = createRunner();
        let completed = false;
        runner.onComplete(() => {
            completed = true;
        });

        let thrown: unknown;
        try {
            await runner.runQuery(selection);
        } catch (error) {
            thrown = error;
        }
        expect(thrown, "runQuery should surface the failure").to.not.equal(undefined);

        expect(client.sendRequest).to.not.have.been.calledWith(
            QueryExecuteRequest.type,
            sinon.match.object,
        );
        expect(runner.isExecutingQuery).to.equal(false);
        expect(completed, "listeners are told the run ended").to.equal(true);
        expect(QueryRunner["_runningQueries"]).to.be.empty;
        expect(notificationHandler.unregisterRunner).to.have.been.calledWith(uri);
    });

    test("a failing status update on completion still releases the editor", async () => {
        stubExecuteAccepted();
        statusView.setExecutionTime.throws(new Error("simulated status bar failure"));
        const runner = createRunner();
        let completed = false;
        runner.onComplete(() => {
            completed = true;
        });
        await runner.runQuery(selection);

        runner.handleQueryComplete({ ownerUri: uri, batchSummaries: [] });

        expect(runner.isExecutingQuery).to.equal(false);
        expect(completed).to.equal(true);
        expect(QueryRunner["_runningQueries"]).to.be.empty;
    });

    test("saving an untitled editor mid-query releases the original execution slot on completion", async () => {
        const untitledUri = "untitled:Untitled-1";
        const fileUri = "file:///repro/saved.sql";
        const onComplete = new vscode.EventEmitter<void>();
        const mockRunner = {
            uri: untitledUri,
            runQuery: sandbox.stub().resolves(),
            onComplete: onComplete.event,
            updateQueryRunnerUri: sandbox.stub(),
        } as unknown as QueryRunner;
        sandbox
            .stub(
                contentProvider as unknown as { initializeRunnerAndWebviewState: unknown },
                "initializeRunnerAndWebviewState",
            )
            .resolves(mockRunner);

        // Run in Untitled-1; the slot for the untitled URI is taken.
        await contentProvider.runQuery(
            statusView as unknown as StatusView,
            untitledUri,
            undefined,
            title,
        );
        // Save As while the query runs: everything is re-keyed to the file URI.
        await contentProvider.updateQueryRunnerUri(untitledUri, fileUri);
        (mockRunner as unknown as { uri: string }).uri = fileUri;
        // The query finishes. Release happens under the runner's new URI.
        onComplete.fire(undefined as unknown as void);
        expect(contentProvider["_queryExecutionInFlightUris"].has(fileUri)).to.equal(false);

        // VS Code reuses the name: a brand-new Untitled-1 editor is opened and run.
        await contentProvider.runQuery(
            statusView as unknown as StatusView,
            untitledUri,
            undefined,
            title,
        );
        expect(timesShown(LocConstants.msgRunQueryInProgress)).to.equal(0);
        expect(mockRunner.runQuery).to.have.been.calledTwice;

        onComplete.dispose();
    });

    test("cancel during run setup releases the editor and the abandoned run does not start", async () => {
        let finishReset: () => void;
        const resetGate = new Promise<void>((resolve) => {
            finishReset = resolve;
        });
        const onComplete = new vscode.EventEmitter<void>();
        const mockRunner = {
            uri,
            isExecutingQuery: false,
            // Re-using an idle runner first sends a cancel to the service; here that request is
            // slow to return (unresponsive service).
            resetQueryRunner: () => resetGate,
            resetHasCompleted: sandbox.stub(),
            runQuery: sandbox.stub().resolves(),
            onComplete: onComplete.event,
        } as unknown as QueryRunner;
        contentProvider.setResultsMap = new Map([[uri, new QueryRunnerState(mockRunner)]]);

        // First run parks inside createQueryRunner while holding the execution slot.
        const firstRun = contentProvider.runQuery(
            statusView as unknown as StatusView,
            uri,
            selection,
            title,
        );
        // Second run is refused.
        await contentProvider.runQuery(statusView as unknown as StatusView, uri, selection, title);
        expect(timesShown(LocConstants.msgRunQueryInProgress)).to.equal(1);

        // Cancel abandons the pending run instead of claiming nothing is running.
        await contentProvider.cancelQuery(uri);
        expect(timesShown(LocConstants.msgCancelQueryNotRunning)).to.equal(0);
        expect(contentProvider["_queryExecutionInFlightUris"].has(uri)).to.equal(false);

        // When the slow setup finally finishes, the abandoned run must not start.
        finishReset!();
        await firstRun;
        expect(mockRunner.runQuery).to.not.have.been.called;

        onComplete.dispose();
    });
});
