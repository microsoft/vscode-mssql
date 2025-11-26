/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import QueryRunner from "../../src/controllers/queryRunner";
import { QueryNotificationHandler } from "../../src/controllers/queryNotificationHandler";
import * as Utils from "../../src/models/utils";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import {
    QueryExecuteParams,
    QueryExecuteCompleteNotificationResult,
    QueryExecuteBatchNotificationParams,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteSubsetResult,
} from "../../src/models/contracts/queryExecute";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import StatusView from "../../src/views/statusView";
import * as Constants from "../../src/constants/constants";
import * as QueryExecuteContracts from "../../src/models/contracts/queryExecute";
import * as QueryDisposeContracts from "../../src/models/contracts/queryDispose";
import { ISelectionData } from "../../src/models/interfaces";
import * as stubs from "./stubs";
import * as vscode from "vscode";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);
const { expect } = chai;

// CONSTANTS //////////////////////////////////////////////////////////////////////////////////////
const standardUri = "uri";
const standardTitle = "title";
const standardSelection: ISelectionData = {
    startLine: 0,
    endLine: 0,
    startColumn: 3,
    endColumn: 3,
};

// TESTS //////////////////////////////////////////////////////////////////////////////////////////
suite("Query Runner tests", () => {
    let sandbox: sinon.SinonSandbox;
    let testSqlToolsServerClient: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let testQueryNotificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>;
    let testVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let testStatusView: sinon.SinonStubbedInstance<StatusView>;

    function createQueryRunner(
        uri: string = standardUri,
        title: string = standardTitle,
    ): QueryRunner {
        return new QueryRunner(
            uri,
            title,
            testStatusView,
            testSqlToolsServerClient,
            testQueryNotificationHandler,
            testVscodeWrapper,
        );
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        testSqlToolsServerClient = sandbox.createStubInstance(SqlToolsServerClient);
        testQueryNotificationHandler = sandbox.createStubInstance(QueryNotificationHandler);
        testVscodeWrapper = stubVscodeWrapper(sandbox);
        testStatusView = sandbox.createStubInstance(StatusView);

        (testVscodeWrapper.parseUri as sinon.SinonStub).callsFake((value: string) =>
            vscode.Uri.parse(value),
        );
        (testVscodeWrapper.showErrorMessage as sinon.SinonStub).returns(undefined);
        (testVscodeWrapper.showInformationMessage as sinon.SinonStub).returns(undefined);
        (testVscodeWrapper.logToOutputChannel as sinon.SinonStub).returns(undefined);
        (testVscodeWrapper.openTextDocument as sinon.SinonStub).resolves({} as vscode.TextDocument);
        (testVscodeWrapper.showTextDocument as sinon.SinonStub).resolves({} as vscode.TextEditor);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Constructs properly", () => {
        let queryRunner = createQueryRunner("", "");
        assert.equal(typeof queryRunner !== undefined, true);
    });

    test("Handles Query Request Result Properly", async () => {
        // Setup:
        // ... Standard service to handle a execute request, standard query notification
        setupStandardQueryRequestServiceMock(testSqlToolsServerClient, () => {
            return Promise.resolve(new QueryExecuteContracts.QueryExecuteResult());
        });
        setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler);

        // ... Mock up the view and VSCode wrapper to handle requests to update view
        let testDoc: vscode.TextDocument = {
            getText: () => {
                return undefined;
            },
        } as any;
        (testVscodeWrapper.openTextDocument as sinon.SinonStub).resolves(testDoc);
        (testVscodeWrapper.showTextDocument as sinon.SinonStub).resolves({} as vscode.TextEditor);

        // If:
        // ... I create a query runner
        let queryRunner = createQueryRunner();

        // ... And run a query
        await queryRunner.runQuery(standardSelection);

        // Then:
        // ... The query notification handler should have registered the query runner
        expect(testQueryNotificationHandler.registerRunner).to.have.been.calledOnce;
        expect(testQueryNotificationHandler.registerRunner.firstCall.args[1]).to.equal(standardUri);

        // ... The VS Code status should be updated
        expect(testStatusView.executingQuery).to.have.been.calledOnceWithExactly(standardUri);
        expect(testVscodeWrapper.logToOutputChannel as sinon.SinonStub).to.have.been.calledOnce;

        // ... The query runner should indicate that it is running a query and elapsed time should be set to 0
        assert.equal(queryRunner.isExecutingQuery, true);
        assert.equal(queryRunner.totalElapsedMilliseconds, 0);
    });

    test("Handles Query Request Error Properly", async () => {
        // Setup:
        // ... Setup the mock service client to return an error when the execute request is submitted
        // ... Setup standard notification mock
        setupStandardQueryRequestServiceMock(testSqlToolsServerClient, () => {
            return Promise.reject<QueryExecuteContracts.QueryExecuteResult>("failed");
        });
        setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler);

        // ... Setup the status view to handle start and stop updates
        testStatusView.executedQuery.resetHistory();
        testStatusView.executingQuery.resetHistory();

        let testDoc: vscode.TextDocument = {
            getText: () => {
                return undefined;
            },
        } as any;
        (testVscodeWrapper.openTextDocument as sinon.SinonStub).resolves(testDoc);
        (testVscodeWrapper.showTextDocument as sinon.SinonStub).resolves({} as vscode.TextEditor);

        // If:
        // ... I create a query runner
        let queryRunner = createQueryRunner();

        // ... And I run a query that is going to fail to start
        try {
            await queryRunner.runQuery(standardSelection);
            // If we reach here, the test should fail because we expected an error
            assert.fail("Expected runQuery to throw an error");
        } catch (error) {
            // Then:
            // ... The view status should have started and stopped
            expect(testVscodeWrapper.logToOutputChannel as sinon.SinonStub).to.have.been.calledOnce;
            expect(testStatusView.executingQuery).to.have.been.calledOnceWithExactly(standardUri);
            expect(testStatusView.executedQuery).to.have.been.called;

            // ... The query runner should not be running a query
            assert.strictEqual(queryRunner.isExecutingQuery, false);
        }
    });

    test("Notification - Batch Start", () => {
        // Setup: Create a batch start notification with appropriate values
        // NOTE: nulls are used because that's what comes back from the service.
        let batchStart: QueryExecuteBatchNotificationParams = {
            ownerUri: "uri",
            batchSummary: {
                executionElapsed: null,
                executionEnd: null,
                executionStart: new Date().toISOString(),
                hasError: false,
                id: 0,
                selection: {
                    startLine: 0,
                    endLine: 0,
                    startColumn: 3,
                    endColumn: 3,
                },
                resultSetSummaries: null,
            },
        };

        // If: I submit a batch start notification to the query runner
        let queryRunner = createQueryRunner("", "");
        queryRunner.handleBatchStart(batchStart);

        // Then: It should store the batch, messages and emit a batch start
        assert.equal(queryRunner.batchSets.indexOf(batchStart.batchSummary), 0);
        assert.ok(queryRunner.batchSetMessages[batchStart.batchSummary.id]);
    });

    function testBatchCompleteNotification(sendBatchTime: boolean): void {
        // Setup: Create a batch completion result
        let configResult: { [key: string]: any } = {};
        configResult[Constants.configShowBatchTime] = sendBatchTime;
        setupWorkspaceConfig(configResult);

        let dateNow = new Date();
        let fiveSecondsAgo = new Date(dateNow.getTime() - 5000);
        let elapsedTimeString = Utils.parseNumAsTimeString(5000);
        let batchComplete: QueryExecuteBatchNotificationParams = {
            ownerUri: "uri",
            batchSummary: {
                executionElapsed: elapsedTimeString,
                executionEnd: dateNow.toISOString(),
                executionStart: fiveSecondsAgo.toISOString(),
                hasError: false,
                id: 0,
                selection: {
                    startLine: 0,
                    endLine: 0,
                    startColumn: 3,
                    endColumn: 3,
                },
                resultSetSummaries: [],
            },
        };

        // If: I submit a batch completion notification to the query runner that has a batch already started
        let queryRunner = createQueryRunner("", "");
        queryRunner.batchSets[0] = {
            executionElapsed: null,
            executionEnd: null,
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {
                startLine: 0,
                endLine: 0,
                startColumn: 3,
                endColumn: 3,
            },
            resultSetSummaries: [],
        };
        queryRunner.batchSetMessages[queryRunner.batchSets[0].id] = [];

        queryRunner.handleBatchComplete(batchComplete);

        // Then: It should the remainder of the information and emit a batch complete notification
        assert.equal(queryRunner.batchSets.length, 1);
        let storedBatch = queryRunner.batchSets[0];
        assert.equal(storedBatch.executionElapsed, elapsedTimeString);
        assert.equal(
            typeof storedBatch.executionEnd,
            typeof batchComplete.batchSummary.executionEnd,
        );
        assert.equal(
            typeof storedBatch.executionStart,
            typeof batchComplete.batchSummary.executionStart,
        );
        assert.equal(storedBatch.hasError, batchComplete.batchSummary.hasError);

        // ... Messages should be empty since batch time messages are stored separately
        assert.equal(queryRunner.batchSetMessages[queryRunner.batchSets[0].id].length, 0);

        // ... Result sets should not be set by the batch complete notification
        assert.equal(typeof storedBatch.resultSetSummaries, typeof []);
        assert.equal(storedBatch.resultSetSummaries.length, 0);
    }

    test("Notification - Batch Complete no message", () => {
        testBatchCompleteNotification(false);
    });

    test("Notification - Batch Complete with message", () => {
        testBatchCompleteNotification(true);
    });

    test("Notification - ResultSet Complete w/no previous results", async () => {
        // Setup: Create a resultset completion result
        let resultSetComplete: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: "uri",
            resultSetSummary: {
                batchId: 0,
                columnInfo: [],
                id: 0,
                rowCount: 10,
            },
        };

        // If: I submit a resultSet completion notification to the query runner...
        let queryRunner = createQueryRunner("", "");
        queryRunner.batchSets[0] = {
            executionElapsed: null,
            executionEnd: null,
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {
                startLine: 0,
                endLine: 0,
                startColumn: 3,
                endColumn: 3,
            },
            resultSetSummaries: [],
        };
        await queryRunner.handleResultSetComplete(resultSetComplete);

        // Then:
        // ... The pre-existing batch should contain the result set we got back
        assert.equal(queryRunner.batchSets[0].resultSetSummaries.length, 1);
        assert.equal(
            queryRunner.batchSets[0].resultSetSummaries[0],
            resultSetComplete.resultSetSummary,
        );
    });

    test("Notification - ResultSet complete w/previous results", async () => {
        // Setup:
        // ... Create resultset completion results
        let resultSetComplete1: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: "uri",
            resultSetSummary: {
                batchId: 0,
                columnInfo: [],
                id: 0,
                rowCount: 10,
            },
        };
        let resultSetComplete2: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: "uri",
            resultSetSummary: {
                batchId: 0,
                columnInfo: [],
                id: 1,
                rowCount: 10,
            },
        };

        // If:
        // ... I submit a resultSet completion notification to the query runner
        let queryRunner = createQueryRunner("", "");
        queryRunner.batchSets[0] = {
            executionElapsed: null,
            executionEnd: null,
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {
                startLine: 0,
                endLine: 0,
                startColumn: 3,
                endColumn: 3,
            },
            resultSetSummaries: [],
        };
        await queryRunner.handleResultSetComplete(resultSetComplete1);

        // ... And submit a second result set completion notification
        await queryRunner.handleResultSetComplete(resultSetComplete2);

        // Then:
        // ... There should be two results in the batch summary
        assert.equal(queryRunner.batchSets[0].resultSetSummaries.length, 2);
        assert.equal(
            queryRunner.batchSets[0].resultSetSummaries[0],
            resultSetComplete1.resultSetSummary,
        );
        assert.equal(
            queryRunner.batchSets[0].resultSetSummaries[1],
            resultSetComplete2.resultSetSummary,
        );
    });

    test("Notification - Message", () => {
        // Setup:

        // ... Create a message notification with some message
        let message: QueryExecuteContracts.QueryExecuteMessageParams = {
            message: {
                batchId: 0,
                isError: false,
                message: "Message!",
                time: new Date().toISOString(),
            },
            ownerUri: standardUri,
        };

        // If:
        // ... I have a query runner
        let queryRunner = createQueryRunner();
        queryRunner.batchSetMessages[message.message.batchId] = [];

        // ... And I ask to handle a message
        queryRunner.handleMessage(message);

        // ... Result set message cache contains one entry
        assert.equal(queryRunner.batchSetMessages[message.message.batchId].length, 1);
    });

    test("Notification - Query complete", () => {
        // Setup:

        // ... Create a completion notification with bogus data
        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: "uri",
            batchSummaries: [
                {
                    hasError: false,
                    id: 0,
                    selection: standardSelection,
                    resultSetSummaries: [],
                    executionElapsed: undefined,
                    executionStart: new Date().toISOString(),
                    executionEnd: new Date().toISOString(),
                },
            ],
        };

        // If:
        // ... I have a query runner
        let queryRunner = createQueryRunner();

        // ... And I handle a query completion event
        queryRunner.handleQueryComplete(result);

        // Then:
        // ... The VS Code view should have stopped executing
        expect(testStatusView.executedQuery).to.have.been.calledOnceWithExactly(standardUri);
        expect(testStatusView.setExecutionTime).to.have.been.calledOnce;
        expect(testStatusView.setExecutionTime.firstCall.args[0]).to.equal(standardUri);

        // ... The state of the query runner has been updated
        assert.equal(queryRunner.batchSets.length, 1);
        assert.equal(queryRunner.isExecutingQuery, false);
    });

    test("Correctly handles subset", async () => {
        let testuri = "test";
        let testresult: QueryExecuteSubsetResult = {
            resultSubset: {
                rowCount: 5,
                rows: [
                    [
                        { isNull: false, displayValue: "1" },
                        { isNull: false, displayValue: "2" },
                    ],
                    [
                        { isNull: false, displayValue: "3" },
                        { isNull: false, displayValue: "4" },
                    ],
                    [
                        { isNull: false, displayValue: "5" },
                        { isNull: false, displayValue: "6" },
                    ],
                    [
                        { isNull: false, displayValue: "7" },
                        { isNull: false, displayValue: "8" },
                    ],
                    [
                        { isNull: false, displayValue: "9" },
                        { isNull: false, displayValue: "10" },
                    ],
                ],
            },
        };

        testSqlToolsServerClient.sendRequest
            .withArgs(QueryExecuteContracts.QueryExecuteSubsetRequest.type, sinon.match.object)
            .resolves(testresult);

        let queryRunner = createQueryRunner(testuri, testuri);
        queryRunner.uri = testuri;

        const result = await queryRunner.getRows(0, 5, 0, 0);
        assert.equal(result, testresult);
    });

    test("Correctly handles error from subset request", async () => {
        let testuri = "test";

        testSqlToolsServerClient.sendRequest
            .withArgs(QueryExecuteContracts.QueryExecuteSubsetRequest.type, sinon.match.object)
            .rejects(new Error("failed"));

        (testVscodeWrapper.showErrorMessage as sinon.SinonStub).resetHistory();

        let queryRunner = createQueryRunner(testuri, testuri);
        queryRunner.uri = testuri;
        await queryRunner.getRows(0, 5, 0, 0);
        expect(testVscodeWrapper.showErrorMessage as sinon.SinonStub).to.have.been.calledOnce;
    });

    test("Toggle SQLCMD Mode sends request", async () => {
        let queryUri = "test_uri";
        let queryRunner = createQueryRunner(queryUri, queryUri);
        expect(queryRunner.isSqlCmd, "Query Runner should have SQLCMD false be default").is.equal(
            false,
        );
        testSqlToolsServerClient.sendRequest
            .withArgs(QueryExecuteContracts.QueryExecuteOptionsRequest.type, sinon.match.object)
            .resolves(true);
        await queryRunner.toggleSqlCmd();
        expect(testSqlToolsServerClient.sendRequest).to.have.been.calledOnce;
        expect(queryRunner.isSqlCmd, "SQLCMD Mode should be switched").is.equal(true);
    });

    test("runStatement sends correct request with execution plan options", async () => {
        const queryRunner = createQueryRunner();
        const line = 1;
        const column = 1;
        const executionPlanOptions: QueryExecuteContracts.ExecutionPlanOptions = {
            includeActualExecutionPlanXml: true,
        };

        testSqlToolsServerClient.sendRequest.resolves();

        await queryRunner.runStatement(line, column, executionPlanOptions);

        const expectedParams: QueryExecuteContracts.QueryExecuteStatementParams = {
            ownerUri: standardUri,
            line: line,
            column: column,
            executionPlanOptions: executionPlanOptions,
        };

        expect(testSqlToolsServerClient.sendRequest).to.have.been.calledWith(
            QueryExecuteContracts.QueryExecuteStatementRequest.type,
            expectedParams,
        );
    });

    function setupWorkspaceConfig(configResult: { [key: string]: any }): void {
        let config = stubs.createWorkspaceConfiguration(configResult);
        (testVscodeWrapper.getConfiguration as sinon.SinonStub).callsFake(() => config);
    }
});

/**
 * Sets up a mock SQL Tools Service client with a handler for submitting a query execute request
 * @param testSqlToolsServerClient The mock service client to setup
 * @param returnCallback Function to execute when query execute request is called
 */
function setupStandardQueryRequestServiceMock(
    testSqlToolsServerClient: sinon.SinonStubbedInstance<SqlToolsServerClient>,
    returnCallback: (...x: any[]) => Thenable<QueryDisposeContracts.QueryDisposeResult>,
): void {
    testSqlToolsServerClient.sendRequest
        .withArgs(QueryExecuteContracts.QueryExecuteRequest.type, sinon.match.object)
        .callsFake((_type, details: QueryExecuteParams) => {
            assert.equal(details.ownerUri, standardUri);
            assert.equal(details.querySelection.startLine, standardSelection.startLine);
            assert.equal(details.querySelection.startColumn, standardSelection.startColumn);
            assert.equal(details.querySelection.endLine, standardSelection.endLine);
            assert.equal(details.querySelection.endColumn, standardSelection.endColumn);
            return returnCallback(_type, details);
        });
}

function setupStandardQueryNotificationHandlerMock(
    testQueryNotificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>,
): void {
    testQueryNotificationHandler.registerRunner.callsFake((_qr, uri: string) => {
        assert.equal(uri, standardUri);
    });
}
