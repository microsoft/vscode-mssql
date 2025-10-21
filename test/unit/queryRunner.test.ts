/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as assert from "assert";
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
import { expect } from "chai";

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
    let testSqlToolsServerClient: TypeMoq.IMock<SqlToolsServerClient>;
    let testQueryNotificationHandler: TypeMoq.IMock<QueryNotificationHandler>;
    let testVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let testStatusView: TypeMoq.IMock<StatusView>;

    setup(() => {
        testSqlToolsServerClient = TypeMoq.Mock.ofType(
            SqlToolsServerClient,
            TypeMoq.MockBehavior.Loose,
        );
        testQueryNotificationHandler = TypeMoq.Mock.ofType(
            QueryNotificationHandler,
            TypeMoq.MockBehavior.Loose,
        );
        testVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Loose);
    });

    test("Constructs properly", () => {
        let queryRunner = new QueryRunner(
            "",
            "",
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
        assert.equal(typeof queryRunner !== undefined, true);
    });

    test("Handles Query Request Result Properly", () => {
        // Setup:
        // ... Standard service to handle a execute request, standard query notification
        setupStandardQueryRequestServiceMock(testSqlToolsServerClient, () => {
            return Promise.resolve(new QueryExecuteContracts.QueryExecuteResult());
        });
        setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler);

        // ... Mock up the view and VSCode wrapper to handle requests to update view
        testStatusView.setup((x) => x.executingQuery(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup((x) => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        let testDoc: vscode.TextDocument = {
            getText: () => {
                return undefined;
            },
        } as any;
        testVscodeWrapper
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(testDoc));

        // If:
        // ... I create a query runner
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );

        // ... And run a query
        return queryRunner.runQuery(standardSelection).then(() => {
            // Then:
            // ... The query notification handler should have registered the query runner
            testQueryNotificationHandler.verify(
                (x) => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );

            // ... The VS Code status should be updated
            testStatusView.verify<void>((x) => x.executingQuery(standardUri), TypeMoq.Times.once());
            testVscodeWrapper.verify<void>(
                (x) => x.logToOutputChannel(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );

            // ... The query runner should indicate that it is running a query and elapsed time should be set to 0
            assert.equal(queryRunner.isExecutingQuery, true);
            assert.equal(queryRunner.totalElapsedMilliseconds, 0);
        });
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
        testStatusView.setup((x) => x.executingQuery(TypeMoq.It.isAnyString()));
        testStatusView.setup((x) => x.executedQuery(TypeMoq.It.isAnyString()));

        // ... Setup the vs code wrapper to handle output logging and error messages
        testVscodeWrapper.setup((x) => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup((x) => x.showErrorMessage(TypeMoq.It.isAnyString()));
        let testDoc: vscode.TextDocument = {
            getText: () => {
                return undefined;
            },
        } as any;
        testVscodeWrapper
            .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(testDoc));

        // If:
        // ... I create a query runner
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );

        // ... And I run a query that is going to fail to start
        try {
            await queryRunner.runQuery(standardSelection);
            // If we reach here, the test should fail because we expected an error
            assert.fail("Expected runQuery to throw an error");
        } catch (error) {
            // Then:
            // ... The view status should have started and stopped
            testVscodeWrapper.verify(
                (x) => x.logToOutputChannel(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
            testStatusView.verify((x) => x.executingQuery(standardUri), TypeMoq.Times.once());
            testStatusView.verify((x) => x.executedQuery(standardUri), TypeMoq.Times.atLeastOnce());

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
        let queryRunner = new QueryRunner(
            "",
            "",
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
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
        let queryRunner = new QueryRunner(
            "",
            "",
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
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
        let queryRunner = new QueryRunner(
            "",
            "",
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
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
        let queryRunner = new QueryRunner(
            "",
            "",
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
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
        let queryRunner: QueryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
        queryRunner.batchSetMessages[message.message.batchId] = [];

        // ... And I ask to handle a message
        queryRunner.handleMessage(message);

        // ... Result set message cache contains one entry
        assert.equal(queryRunner.batchSetMessages[message.message.batchId].length, 1);
    });

    test("Notification - Query complete", () => {
        // Setup:

        // ... Setup the VS Code view handlers
        testStatusView.setup((x) => x.executedQuery(TypeMoq.It.isAny()));
        testVscodeWrapper.setup((x) => x.logToOutputChannel(TypeMoq.It.isAnyString()));

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
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );

        // ... And I handle a query completion event
        queryRunner.handleQueryComplete(result);

        // Then:
        // ... The VS Code view should have stopped executing
        testStatusView.verify((x) => x.executedQuery(standardUri), TypeMoq.Times.once());

        // ... The state of the query runner has been updated
        assert.equal(queryRunner.batchSets.length, 1);
        assert.equal(queryRunner.isExecutingQuery, false);
    });

    test("Correctly handles subset", () => {
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
        testSqlToolsServerClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback(() => {
                // testing
            })
            .returns(() => {
                return Promise.resolve(testresult);
            });
        testStatusView.setup((x) => x.executingQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            testuri,
            testuri,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then((result) => {
            assert.equal(result, testresult);
        });
    });

    test("Correctly handles error from subset request", () => {
        let testuri = "test";
        let testresult = {
            message: "failed",
        };
        testSqlToolsServerClient
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback(() => {
                // testing
            })
            .returns(() => {
                return Promise.resolve(testresult);
            });
        testVscodeWrapper.setup((x) => x.showErrorMessage(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            testuri,
            testuri,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then(undefined, () => {
            testVscodeWrapper.verify(
                (x) => x.showErrorMessage(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("Toggle SQLCMD Mode sends request", async () => {
        let queryUri = "test_uri";
        let queryRunner = new QueryRunner(
            queryUri,
            queryUri,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object,
        );
        expect(queryRunner.isSqlCmd, "Query Runner should have SQLCMD false be default").is.equal(
            false,
        );
        testSqlToolsServerClient
            .setup((s) =>
                s.sendRequest(
                    QueryExecuteContracts.QueryExecuteOptionsRequest.type,
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => {
                return Promise.resolve(true);
            });
        await queryRunner.toggleSqlCmd();
        testSqlToolsServerClient.verify(
            (s) => s.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
        expect(queryRunner.isSqlCmd, "SQLCMD Mode should be switched").is.equal(true);
    });

    function setupWorkspaceConfig(configResult: { [key: string]: any }): void {
        let config = stubs.createWorkspaceConfiguration(configResult);
        testVscodeWrapper
            .setup((x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((x) => {
                return config;
            });
    }
});

/**
 * Sets up a mock SQL Tools Service client with a handler for submitting a query execute request
 * @param testSqlToolsServerClient The mock service client to setup
 * @param returnCallback Function to execute when query execute request is called
 */
function setupStandardQueryRequestServiceMock(
    testSqlToolsServerClient: TypeMoq.IMock<SqlToolsServerClient>,
    returnCallback: (...x: any[]) => Thenable<QueryDisposeContracts.QueryDisposeResult>,
): void {
    testSqlToolsServerClient
        .setup((x) =>
            x.sendRequest(
                TypeMoq.It.isValue(QueryExecuteContracts.QueryExecuteRequest.type),
                TypeMoq.It.isAny(),
            ),
        )
        .callback((type, details: QueryExecuteParams) => {
            assert.equal(details.ownerUri, standardUri);
            assert.equal(details.querySelection.startLine, standardSelection.startLine);
            assert.equal(details.querySelection.startColumn, standardSelection.startColumn);
            assert.equal(details.querySelection.endLine, standardSelection.endLine);
            assert.equal(details.querySelection.endColumn, standardSelection.endColumn);
        })
        .returns(returnCallback);
}

function setupStandardQueryNotificationHandlerMock(
    testQueryNotificationHandler: TypeMoq.IMock<QueryNotificationHandler>,
): void {
    testQueryNotificationHandler
        .setup((x) => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .callback((qr, u: string) => {
            assert.equal(u, standardUri);
        });
}
