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
    ResultSetSummary,
    QueryExecuteSubsetResult,
} from "../../src/models/contracts/queryExecute";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import StatusView from "../../src/views/statusView";
import * as Constants from "../../src/constants/constants";
import * as QueryExecuteContracts from "../../src/models/contracts/queryExecute";
import * as QueryDisposeContracts from "../../src/models/contracts/queryDispose";
import { ISlickRange, ISelectionData } from "../../src/models/interfaces";
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

            // ... An error message should have been shown
            testVscodeWrapper.verify(
                (x) => x.showErrorMessage(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
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

    suite("Copy Tests", () => {
        // ------ Common inputs and setup for copy tests  -------
        const testuri = "test";
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
                        { isNull: false, displayValue: "10 ∞" },
                    ],
                ],
            },
        };
        process.env["LANG"] = "C";

        let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 1, toRow: 4 }];

        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: testuri,
            batchSummaries: [
                {
                    hasError: false,
                    id: 0,
                    selection: {
                        startLine: 0,
                        endLine: 0,
                        startColumn: 3,
                        endColumn: 3,
                    },
                    resultSetSummaries: <ResultSetSummary[]>[
                        {
                            id: 0,
                            rowCount: 5,
                            columnInfo: [{ columnName: "Col1" }, { columnName: "Col2" }],
                        },
                    ],
                    executionElapsed: undefined,
                    executionStart: new Date().toISOString(),
                    executionEnd: new Date().toISOString(),
                },
            ],
        };

        setup(() => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .callback(() => {
                    // testing
                })
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            testStatusView.setup((x) => x.executingQuery(TypeMoq.It.isAnyString()));
            testStatusView.setup((x) => x.executedQuery(TypeMoq.It.isAnyString()));
            testVscodeWrapper.setup((x) => x.logToOutputChannel(TypeMoq.It.isAnyString()));
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback(() => {
                    // testing
                })
                .returns(() => {
                    return Promise.resolve();
                });
        });

        // ------ Copy tests  -------
        test("Correctly copy pastes a selection", (done) => {
            let configResult: { [key: string]: any } = {};
            configResult[Constants.copyIncludeHeaders] = false;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            void queryRunner.copyResults(testRange, 0, 0).then(() => {
                testVscodeWrapper.verify<void>(
                    (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                    TypeMoq.Times.once(),
                );
                done();
            });
        });

        test("Copies selection with column headers set in user config", () => {
            // Set column headers in the user config settings
            let configResult: { [key: string]: any } = {};
            configResult[Constants.copyIncludeHeaders] = true;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);
            return queryRunner.copyResults(testRange, 0, 0).then(() => {
                testVscodeWrapper.verify<void>(
                    (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                    TypeMoq.Times.once(),
                );
            });
        });

        test("Copies selection with headers when true passed as parameter", () => {
            // Do not set column config in user settings
            let configResult: { [key: string]: any } = {};
            configResult[Constants.copyIncludeHeaders] = false;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to include headers
            return queryRunner.copyResults(testRange, 0, 0, true).then(() => {
                testVscodeWrapper.verify<void>(
                    (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                    TypeMoq.Times.once(),
                );
            });
        });

        test("Copies selection without headers when false passed as parameter", () => {
            // Set column config in user settings
            let configResult: { [key: string]: any } = {};
            configResult[Constants.copyIncludeHeaders] = true;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to not include headers
            return queryRunner.copyResults(testRange, 0, 0, false).then(() => {
                testVscodeWrapper.verify<void>(
                    (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                    TypeMoq.Times.once(),
                );
            });
        });

        test("SetEditorSelection uses an existing editor if it is visible", (done) => {
            let queryUri = "test_uri";
            let queryColumn = 2;
            let queryRunner = new QueryRunner(
                queryUri,
                queryUri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            let editor: vscode.TextEditor = {
                document: {
                    uri: queryUri,
                },
                viewColumn: queryColumn,
                selection: undefined,
            } as any;

            testVscodeWrapper.setup((x) => x.textDocuments).returns(() => [editor.document]);
            testVscodeWrapper.setup((x) => x.activeTextEditor).returns(() => editor);
            testVscodeWrapper
                .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(editor.document));
            testVscodeWrapper
                .setup((x) => x.showTextDocument(editor.document, TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(editor));

            // If I try to set a selection for the existing editor
            let selection: ISelectionData = {
                startColumn: 0,
                startLine: 0,
                endColumn: 1,
                endLine: 1,
            };
            queryRunner.setEditorSelection(selection).then(
                () => {
                    try {
                        // Then showTextDocument gets called with the existing editor's column
                        testVscodeWrapper.verify(
                            (x) => x.showTextDocument(editor.document, TypeMoq.It.isAny()),
                            TypeMoq.Times.once(),
                        );
                        done();
                    } catch (err) {
                        done(err);
                    }
                },
                (err) => done(err),
            );
        });

        test("SetEditorSelection uses column 1 by default", (done) => {
            let queryUri = "test_uri";
            let queryRunner = new QueryRunner(
                queryUri,
                queryUri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            let editor: vscode.TextEditor = {
                document: {
                    uri: queryUri,
                },
                viewColumn: undefined,
                selection: undefined,
            } as any;

            testVscodeWrapper.setup((x) => x.textDocuments).returns(() => [editor.document]);
            testVscodeWrapper.setup((x) => x.visibleEditors).returns(() => []);
            testVscodeWrapper
                .setup((x) => x.openTextDocument(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(editor.document));
            testVscodeWrapper
                .setup((x) => x.showTextDocument(editor.document, TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(editor));

            // If I try to set a selection for an editor that is not currently visible
            queryRunner
                .setEditorSelection({
                    startColumn: 0,
                    startLine: 0,
                    endColumn: 1,
                    endLine: 1,
                })
                .then(
                    () => {
                        try {
                            // Then showTextDocument gets called with the default first column
                            testVscodeWrapper.verify(
                                (x) => x.showTextDocument(editor.document, TypeMoq.It.isAny()),
                                TypeMoq.Times.once(),
                            );
                            done();
                        } catch (err) {
                            done(err);
                        }
                    },
                    (err) => done(err),
                );
        });
    });

    suite("Copy Tests with multiple selections", () => {
        // ------ Common inputs and setup for copy tests  -------
        let mockConfig: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
        const testuri = "test";
        let testresult: QueryExecuteSubsetResult = {
            resultSubset: {
                rowCount: 5,
                rows: [
                    [
                        { isNull: false, displayValue: "1" },
                        { isNull: false, displayValue: "2" },
                        { isNull: false, displayValue: "3" },
                    ],
                    [
                        { isNull: false, displayValue: "4" },
                        { isNull: false, displayValue: "5" },
                        { isNull: false, displayValue: "6" },
                    ],
                    [
                        { isNull: false, displayValue: "7" },
                        { isNull: false, displayValue: "8" },
                        { isNull: false, displayValue: "9" },
                    ],
                    [
                        { isNull: false, displayValue: "10" },
                        { isNull: false, displayValue: "11" },
                        { isNull: false, displayValue: "12" },
                    ],
                    [
                        { isNull: false, displayValue: "13" },
                        { isNull: false, displayValue: "14" },
                        { isNull: false, displayValue: "15" },
                    ],
                ],
            },
        };
        process.env["LANG"] = "C";

        let testRange: ISlickRange[] = [
            { fromCell: 0, fromRow: 0, toCell: 1, toRow: 2 },
            { fromCell: 1, fromRow: 1, toCell: 2, toRow: 4 },
        ];

        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: testuri,
            batchSummaries: [
                {
                    hasError: false,
                    id: 0,
                    selection: {
                        startLine: 0,
                        endLine: 0,
                        startColumn: 3,
                        endColumn: 3,
                    },
                    resultSetSummaries: <ResultSetSummary[]>[
                        {
                            id: 0,
                            rowCount: 5,
                            columnInfo: [
                                { columnName: "Col1" },
                                { columnName: "Col2" },
                                { columnName: "Col3" },
                            ],
                        },
                    ],
                    executionElapsed: undefined,
                    executionStart: new Date().toISOString(),
                    executionEnd: new Date().toISOString(),
                },
            ],
        };

        setup(() => {
            testStatusView.setup((x) => x.executingQuery(TypeMoq.It.isAnyString()));
            testStatusView.setup((x) => x.executedQuery(TypeMoq.It.isAnyString()));
            testVscodeWrapper.setup((x) => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        });

        function setupMockConfig(): void {
            mockConfig = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
            mockConfig.setup((c) => c.get(TypeMoq.It.isAnyString())).returns(() => false);
            testVscodeWrapper
                .setup((x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => mockConfig.object);
        }

        // ------ Copy tests with multiple selections  -------
        test("Correctly copy pastes a selection", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            await queryRunner.copyResults(testRange, 0, 0);
            // Two selections
            mockConfig.verify(
                (c) => c.get(Constants.configCopyRemoveNewLine),
                TypeMoq.Times.atLeast(2),
            );
            // Once for new lines and once for headers
            testVscodeWrapper.verify(
                (v) => v.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.atLeast(2),
            );
            mockConfig.verify((c) => c.get(Constants.copyIncludeHeaders), TypeMoq.Times.once());
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection with column headers set in user config", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            // Set column headers in the user config settings
            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);
            await queryRunner.copyResults(testRange, 0, 0);
            mockConfig.verify((c) => c.get(Constants.copyIncludeHeaders), TypeMoq.Times.once());
            // Two selections
            mockConfig.verify(
                (c) => c.get(Constants.configCopyRemoveNewLine),
                TypeMoq.Times.atLeast(2),
            );
            testVscodeWrapper.verify(
                (v) => v.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.atLeast(2),
            );
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection with headers when true passed as parameter", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            // Do not set column config in user settings
            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to include headers
            await queryRunner.copyResults(testRange, 0, 0, true);
            testVscodeWrapper.verify(
                (x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
            mockConfig.verify(
                (c) => c.get(Constants.configCopyRemoveNewLine),
                TypeMoq.Times.atLeast(2),
            );
            mockConfig.verify((c) => c.get(Constants.copyIncludeHeaders), TypeMoq.Times.never());
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection without headers when false passed as parameter", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            // Set column config in user settings
            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to not include headers
            await queryRunner.copyResults(testRange, 0, 0, false);
            testVscodeWrapper.verify(
                (x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.atLeastOnce(),
            );
            mockConfig.verify(
                (c) => c.get(Constants.configCopyRemoveNewLine),
                TypeMoq.Times.atLeast(2),
            );
            mockConfig.verify((c) => c.get(Constants.copyIncludeHeaders), TypeMoq.Times.never());
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection as CSV with headers", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            let configResult: { [key: string]: any } = {};
            configResult[Constants.configSaveAsCsv] = {
                delimiter: ",",
                textIdentifier: '"',
                lineSeperator: "\n",
            };

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsCsv(testRange, 0, 0, true);
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection as CSV with null values", async () => {
            let configResult: { [key: string]: any } = {};
            configResult[Constants.configSaveAsCsv] = {
                delimiter: ",",
                textIdentifier: '"',
                lineSeperator: "\n",
            };

            // Create test data with null values for CSV export
            let testResultWithNulls: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 3,
                    rows: [
                        [
                            { isNull: false, displayValue: "1" },
                            { isNull: true, displayValue: "null" },
                            { isNull: false, displayValue: "3" },
                        ],
                        [
                            { isNull: true, displayValue: "null" },
                            { isNull: false, displayValue: "5" },
                            { isNull: true, displayValue: "null" },
                        ],
                        [
                            { isNull: false, displayValue: "7" },
                            { isNull: false, displayValue: "8" },
                            { isNull: false, displayValue: "9" },
                        ],
                    ],
                },
            };

            let testRangeWithNulls: ISlickRange[] = [
                { fromCell: 0, fromRow: 0, toCell: 2, toRow: 2 },
            ];

            // Setup testSqlToolsServerClient to return null data
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResultWithNulls));

            // Setup configuration mock
            let mockConfig = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
            mockConfig
                .setup((c) => c.get(TypeMoq.It.isAnyString()))
                .returns((key: string) => {
                    return configResult[key] || false;
                });
            testVscodeWrapper
                .setup((x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => mockConfig.object);
            testVscodeWrapper
                .setup((x) => x.getConfiguration(TypeMoq.It.isAny()))
                .returns(() => mockConfig.object);

            // Capture the CSV content
            let capturedCsvContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedCsvContent = text;
                })
                .returns(() => Promise.resolve());

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsCsv(testRangeWithNulls, 0, 0, true);

            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );

            // Verify that null values are exported as empty strings, not "null"
            console.log("Captured CSV content:", JSON.stringify(capturedCsvContent));
            assert.ok(
                capturedCsvContent.includes("1,,3"),
                "First row should have empty value for null cell. Actual content: " +
                    capturedCsvContent,
            );
            assert.ok(
                capturedCsvContent.includes(",5,"),
                "Second row should have empty values for null cells",
            );
            assert.ok(
                !capturedCsvContent.includes(",null,"),
                "CSV should not contain literal 'null' strings",
            );
        });

        test("Copies selection as JSON with headers", async () => {
            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(testresult);
                });
            setupMockConfig();
            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsJson(testRange, 0, 0, true);
            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });

        test("Copies selection as JSON with null values", async () => {
            setupMockConfig();

            // Create test data with null values
            let testResultWithNulls: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 2,
                    rows: [
                        [
                            { isNull: false, displayValue: "1" },
                            { isNull: true, displayValue: "null" },
                            { isNull: false, displayValue: "test" },
                        ],
                        [
                            { isNull: true, displayValue: "null" },
                            { isNull: false, displayValue: "42" },
                            { isNull: true, displayValue: "null" },
                        ],
                    ],
                },
            };

            let resultWithNulls: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 2,
                                columnInfo: [
                                    { columnName: "Col1" },
                                    { columnName: "Col2" },
                                    { columnName: "Col3" },
                                ],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRangeWithNulls: ISlickRange[] = [
                { fromCell: 0, fromRow: 0, toCell: 2, toRow: 1 },
            ];

            // Setup mock to capture the actual JSON content
            let capturedJsonContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedJsonContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResultWithNulls));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(resultWithNulls);

            await queryRunner.copyResultsAsJson(testRangeWithNulls, 0, 0, true);

            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );

            // Verify that null values are exported as proper JSON null, not "null" strings
            let jsonData;
            try {
                jsonData = JSON.parse(capturedJsonContent);
            } catch (e) {
                assert.fail(
                    `Generated JSON is invalid: ${e.message}. Content: ${capturedJsonContent}`,
                );
            }

            assert.equal(jsonData.length, 2, "Should have 2 rows");

            // First row: {Col1: 1, Col2: null, Col3: "test"}
            assert.equal(jsonData[0].Col1, 1, "First row Col1 should be number 1");
            assert.strictEqual(jsonData[0].Col2, null, "First row Col2 should be null");
            assert.equal(jsonData[0].Col3, "test", "First row Col3 should be 'test'");

            // Second row: {Col1: null, Col2: 42, Col3: null}
            assert.strictEqual(jsonData[1].Col1, null, "Second row Col1 should be null");
            assert.equal(jsonData[1].Col2, 42, "Second row Col2 should be number 42");
            assert.strictEqual(jsonData[1].Col3, null, "Second row Col3 should be null");

            // Ensure JSON string doesn't contain literal "null" strings
            assert.ok(
                !capturedJsonContent.includes('"null"'),
                "JSON should not contain literal 'null' strings",
            );
        });
    });

    suite("copyResultsAsInClause", () => {
        const testuri = "uri";
        let testSqlToolsServerClient: TypeMoq.IMock<SqlToolsServerClient>;
        let testVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
        let testStatusView: TypeMoq.IMock<StatusView>;
        let testQueryNotificationHandler: TypeMoq.IMock<QueryNotificationHandler>;

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

        function setupMockConfig() {
            testVscodeWrapper
                .setup((x) =>
                    x.getConfiguration(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyString()),
                )
                .returns(() => {
                    return {
                        copyIncludeHeaders: true,
                        copyRemoveNewLine: false,
                    } as any;
                });
        }

        test("Copies selection as IN clause with string values", async () => {
            setupMockConfig();

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 2,
                    rows: [
                        [{ isNull: false, displayValue: "USA" }],
                        [{ isNull: false, displayValue: "Canada" }],
                    ],
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 2,
                                columnInfo: [{ columnName: "Country" }],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 0, toRow: 1 }];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInClause(testRange, 0, 0);

            testVscodeWrapper.verify<void>(
                (x) => x.clipboardWriteText(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );

            // Verify the IN clause format
            const expectedInClause = "IN\n(\n    'USA',\n    'Canada'\n)";
            assert.equal(capturedClipboardContent, expectedInClause);
        });

        test("Copies selection as IN clause with numeric values", async () => {
            setupMockConfig();

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 3,
                    rows: [
                        [{ isNull: false, displayValue: "247199264" }],
                        [{ isNull: false, displayValue: "247199265" }],
                        [{ isNull: false, displayValue: "247199266" }],
                    ],
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 3,
                                columnInfo: [{ columnName: "ID" }],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 0, toRow: 2 }];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInClause(testRange, 0, 0);

            // Verify the IN clause format with numeric values (no quotes)
            const expectedInClause = "IN\n(\n    247199264,\n    247199265,\n    247199266\n)";
            assert.equal(capturedClipboardContent, expectedInClause);
        });

        test("Copies selection as IN clause with NULL values", async () => {
            setupMockConfig();

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 2,
                    rows: [
                        [{ isNull: false, displayValue: "Valid" }],
                        [{ isNull: true, displayValue: "null" }],
                    ],
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 2,
                                columnInfo: [{ columnName: "Value" }],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 0, toRow: 1 }];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInClause(testRange, 0, 0);

            // Verify the IN clause format with NULL values
            const expectedInClause = "IN\n(\n    'Valid',\n    NULL\n)";
            assert.equal(capturedClipboardContent, expectedInClause);
        });
    });

    suite("copyResultsAsInsertInto", () => {
        const testuri = "uri";
        let testSqlToolsServerClient: TypeMoq.IMock<SqlToolsServerClient>;
        let testVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
        let testStatusView: TypeMoq.IMock<StatusView>;
        let testQueryNotificationHandler: TypeMoq.IMock<QueryNotificationHandler>;

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

        function setupMockConfig() {
            testVscodeWrapper
                .setup((x) =>
                    x.getConfiguration(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyString()),
                )
                .returns(() => {
                    return {
                        copyIncludeHeaders: true,
                        copyRemoveNewLine: false,
                    } as any;
                });
        }

        test("Copies selection as INSERT INTO statement with small dataset", async () => {
            setupMockConfig();

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 2,
                    rows: [
                        [
                            { isNull: false, displayValue: "1" },
                            { isNull: false, displayValue: "John" },
                            { isNull: false, displayValue: "Doe" },
                        ],
                        [
                            { isNull: false, displayValue: "2" },
                            { isNull: false, displayValue: "Jane" },
                            { isNull: false, displayValue: "Smith" },
                        ],
                    ],
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 2,
                                columnInfo: [
                                    { columnName: "ID" },
                                    { columnName: "FirstName" },
                                    { columnName: "LastName" },
                                ],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 2, toRow: 1 }];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInsertInto(testRange, 0, 0);

            // Verify the INSERT INTO format
            const expectedInsert =
                "INSERT INTO [TableName] ([ID], [FirstName], [LastName])\nVALUES\n    (1, 'John', 'Doe'),\n    (2, 'Jane', 'Smith');";
            assert.equal(capturedClipboardContent, expectedInsert);
        });

        test("Copies selection as INSERT INTO with NULL and mixed data types", async () => {
            setupMockConfig();

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: 2,
                    rows: [
                        [
                            { isNull: false, displayValue: "100" },
                            { isNull: true, displayValue: "null" },
                            { isNull: false, displayValue: "Active" },
                        ],
                        [
                            { isNull: false, displayValue: "200" },
                            { isNull: false, displayValue: "2023-01-01" },
                            { isNull: true, displayValue: "null" },
                        ],
                    ],
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: 2,
                                columnInfo: [
                                    { columnName: "Amount" },
                                    { columnName: "CreatedDate" },
                                    { columnName: "Status" },
                                ],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [{ fromCell: 0, fromRow: 0, toCell: 2, toRow: 1 }];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInsertInto(testRange, 0, 0);

            // Verify the INSERT INTO format with NULL values and mixed data types
            const expectedInsert =
                "INSERT INTO [TableName] ([Amount], [CreatedDate], [Status])\nVALUES\n    (100, NULL, 'Active'),\n    (200, '2023-01-01', NULL);";
            assert.equal(capturedClipboardContent, expectedInsert);
        });

        test("Handles large dataset exceeding 1000 rows (chunking)", async () => {
            setupMockConfig();

            // Create test data with more than 1000 rows to test chunking
            const rowCount = 1500;
            const rows: any[] = [];
            for (let i = 1; i <= rowCount; i++) {
                rows.push([
                    { isNull: false, displayValue: i.toString() },
                    { isNull: false, displayValue: `Name${i}` },
                ]);
            }

            let testResult: QueryExecuteSubsetResult = {
                resultSubset: {
                    rowCount: rowCount,
                    rows: rows,
                },
            };

            let result: QueryExecuteCompleteNotificationResult = {
                ownerUri: testuri,
                batchSummaries: [
                    {
                        hasError: false,
                        id: 0,
                        selection: {
                            startLine: 0,
                            endLine: 0,
                            startColumn: 3,
                            endColumn: 3,
                        },
                        resultSetSummaries: <ResultSetSummary[]>[
                            {
                                id: 0,
                                rowCount: rowCount,
                                columnInfo: [{ columnName: "ID" }, { columnName: "Name" }],
                            },
                        ],
                        executionElapsed: undefined,
                        executionStart: new Date().toISOString(),
                        executionEnd: new Date().toISOString(),
                    },
                ],
            };

            let testRange: ISlickRange[] = [
                { fromCell: 0, fromRow: 0, toCell: 1, toRow: rowCount - 1 },
            ];

            let capturedClipboardContent: string = "";
            testVscodeWrapper
                .setup((x) => x.clipboardWriteText(TypeMoq.It.isAnyString()))
                .callback((text: string) => {
                    capturedClipboardContent = text;
                })
                .returns(() => Promise.resolve());

            testSqlToolsServerClient
                .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(testResult));

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object,
            );
            queryRunner.uri = testuri;
            queryRunner.handleQueryComplete(result);

            await queryRunner.copyResultsAsInsertInto(testRange, 0, 0);

            // Verify that multiple INSERT statements were generated (chunking occurred)
            const statementCount = (capturedClipboardContent.match(/INSERT INTO/g) || []).length;
            assert.equal(statementCount, 2, "Should generate 2 INSERT statements for 1500 rows");

            // Verify that statements are separated by double newlines
            assert.ok(
                capturedClipboardContent.includes("\n\nINSERT INTO"),
                "Statements should be separated by double newlines",
            );

            // Verify first statement contains exactly 1000 rows (plus header)
            const firstStatement = capturedClipboardContent.split("\n\nINSERT INTO")[0];
            const firstStatementRowCount = (firstStatement.match(/\(/g) || []).length - 1; // Subtract 1 for column list parentheses
            assert.equal(firstStatementRowCount, 1000, "First statement should contain 1000 rows");
        });
    });
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
