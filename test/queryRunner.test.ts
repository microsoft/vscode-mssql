import * as TypeMoq from 'typemoq';
import assert = require('assert');
import { EventEmitter } from 'events';
import QueryRunner from './../src/controllers/QueryRunner';
import { QueryNotificationHandler } from './../src/controllers/QueryNotificationHandler';
import { SqlOutputContentProvider } from './../src/models/SqlOutputContentProvider';
import SqlToolsServerClient from './../src/languageservice/serviceclient';
import {
    QueryExecuteParams,
    QueryExecuteCompleteNotificationResult,
    QueryExecuteBatchNotificationParams,
    QueryExecuteResultSetCompleteNotificationParams,
    ResultSetSummary
} from './../src/models/contracts/queryExecute';
import VscodeWrapper from './../src/controllers/vscodeWrapper';
import StatusView from './../src/views/statusView';
import * as Constants from '../src/constants/constants';
import * as QueryExecuteContracts from '../src/models/contracts/queryExecute';
import * as QueryDisposeContracts from '../src/models/contracts/QueryDispose';
import {
    ISlickRange,
    ISelectionData
 } from './../src/models/interfaces';
import * as stubs from './stubs';
import * as os from 'os';

// CONSTANTS //////////////////////////////////////////////////////////////////////////////////////
const ncp = require('copy-paste');
const standardUri: string = 'uri';
const standardTitle: string = 'title';
const standardSelection: ISelectionData = {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3};

// TESTS //////////////////////////////////////////////////////////////////////////////////////////
suite('Query Runner tests', () => {

    let testSqlOutputContentProvider: TypeMoq.Mock<SqlOutputContentProvider>;
    let testSqlToolsServerClient: TypeMoq.Mock<SqlToolsServerClient>;
    let testQueryNotificationHandler: TypeMoq.Mock<QueryNotificationHandler>;
    let testVscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    let testStatusView: TypeMoq.Mock<StatusView>;

    setup(() => {
        testSqlOutputContentProvider = TypeMoq.Mock.ofType(SqlOutputContentProvider, TypeMoq.MockBehavior.Strict, {extensionPath: ''});
        testSqlToolsServerClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Strict);
        testQueryNotificationHandler = TypeMoq.Mock.ofType(QueryNotificationHandler, TypeMoq.MockBehavior.Strict);
        testVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Strict);

    });

    test('Constructs properly', () => {

        let queryRunner = new QueryRunner('',
                                          '',
                                          testStatusView.object,
                                            testSqlToolsServerClient.object,
                                            testQueryNotificationHandler.object,
                                            testVscodeWrapper.object);
        assert.equal(typeof queryRunner !== undefined, true);
    });

    test('Handles Query Request Result Properly', () => {
        // Setup:
        // ... Standard service to handle a execute request, standard query notification
        setupStandardQueryRequestServiceMock(testSqlToolsServerClient, () => { return Promise.resolve(new QueryExecuteContracts.QueryExecuteResult); });
        setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler);

        // ... Mock up the view and VSCode wrapper to handle requests to update view
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup( x => x.logToOutputChannel(TypeMoq.It.isAnyString()));

        // ... Mock up a event emitter to accept a start event (only)
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('start'));

        // If:
        // ... I create a query runner
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.eventEmitter = mockEventEmitter.object;

        // ... And run a query
        return queryRunner.runQuery(standardSelection).then(() => {
            // Then:
            // ... The query notification handler should have registered the query runner
            testQueryNotificationHandler.verify(x => x.registerRunner(TypeMoq.It.isValue(queryRunner), TypeMoq.It.isValue(standardUri)), TypeMoq.Times.once());

            // ... Start is the only event that should be emitted during successful query start
            mockEventEmitter.verify(x => x.emit('start'), TypeMoq.Times.once());

            // ... The VS Code status should be updated
            testStatusView.verify<void>(x => x.executingQuery(standardUri), TypeMoq.Times.once());
            testVscodeWrapper.verify<void>(x => x.logToOutputChannel(TypeMoq.It.isAnyString()), TypeMoq.Times.once());

            // ... The query runner should indicate that it is running a query and elapsed time should be set to 0
            assert.equal(queryRunner.isExecutingQuery, true);
            assert.equal(queryRunner.totalElapsedMilliseconds, 0);
        });
    });

    test('Handles Query Request Error Properly', () => {
        // Setup:
        // ... Setup the mock service client to return an error when the execute request is submitted
        // ... Setup standard notification mock
        setupStandardQueryRequestServiceMock(testSqlToolsServerClient, () => { return Promise.reject<QueryExecuteContracts.QueryExecuteResult>('failed'); });
        setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler);

        // ... Setup the status view to handle start and stop updates
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAnyString()));

        // ... Setup the vs code wrapper to handle output logging and error messages
        testVscodeWrapper.setup(x => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));

        // ... Setup the event emitter to handle nothing
        let testEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);

        // If:
        // ... I create a query runner
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.eventEmitter = testEventEmitter.object;

        // ... And I run a query that is going to fail to start
        return queryRunner.runQuery(standardSelection).then(undefined, () => {
            // Then:
            // ... The view status should have started and stopped
            testVscodeWrapper.verify(x => x.logToOutputChannel(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
            testStatusView.verify(x => x.executingQuery(standardUri), TypeMoq.Times.once());
            testStatusView.verify(x => x.executedQuery(standardUri), TypeMoq.Times.once());

            // ... The query runner should not be running a query
            assert.strictEqual(queryRunner.isExecutingQuery, false);

            // ... An error message should have been shown
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Notification - Batch Start', () => {
        // Setup: Create a batch start notification with appropriate values
        // NOTE: nulls are used because that's what comes back from the service.
        let batchStart: QueryExecuteBatchNotificationParams = {
            ownerUri: 'uri',
            batchSummary: {
                executionElapsed: null,     // tslint:disable-line:no-null-keyword
                executionEnd: null,         // tslint:disable-line:no-null-keyword
                executionStart: new Date().toISOString(),
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                resultSetSummaries: null    // tslint:disable-line:no-null-keyword
            }
        };

        // If: I submit a batch start notification to the query runner
        let queryRunner = new QueryRunner(
            '', '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('batchStart', TypeMoq.It.isAny()));
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleBatchStart(batchStart);

        // Then: It should store the batch and emit a batch start
        assert.equal(queryRunner.batchSets.indexOf(batchStart.batchSummary), 0);
        mockEventEmitter.verify(x => x.emit('batchStart', TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('Notification - Batch Complete', () => {
        // Setup: Create a batch completion result
        let batchComplete: QueryExecuteBatchNotificationParams = {
            ownerUri: 'uri',
            batchSummary: {
                executionElapsed: undefined,
                executionEnd: new Date().toISOString(),
                executionStart: new Date().toISOString(),
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                resultSetSummaries: []
            }
        };

        // If: I submit a batch completion notification to the query runner that has a batch already started
        let queryRunner = new QueryRunner(
            '',
            '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.batchSets[0] = {
            executionElapsed: null,         // tslint:disable-line:no-null-keyword
            executionEnd: null,             // tslint:disable-line:no-null-keyword
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
            resultSetSummaries: []
        };
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('batchComplete', TypeMoq.It.isAny()));
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleBatchComplete(batchComplete);

        // Then: It should the remainder of the information and emit a batch complete notification
        assert.equal(queryRunner.batchSets.length, 1);
        let storedBatch = queryRunner.batchSets[0];
        assert.equal(storedBatch.executionElapsed, undefined);
        assert.equal(typeof(storedBatch.executionEnd), typeof(batchComplete.batchSummary.executionEnd));
        assert.equal(typeof(storedBatch.executionStart), typeof(batchComplete.batchSummary.executionStart));
        assert.equal(storedBatch.hasError, batchComplete.batchSummary.hasError);

        // ... Result sets should not be set by the batch complete notification
        assert.equal(typeof(storedBatch.resultSetSummaries), typeof([]));
        assert.equal(storedBatch.resultSetSummaries.length, 0);

        mockEventEmitter.verify(x => x.emit('batchComplete', TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('Notification - ResultSet Complete w/no previous results', () => {
        // Setup: Create a resultset completion result
        let resultSetComplete: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: 'uri',
            resultSetSummary: {
                batchId: 0,
                columnInfo: [],
                id: 0,
                rowCount: 10
            }
        };

        // If: I submit a resultSet completion notification to the query runner...
        let queryRunner = new QueryRunner('', '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object);
        queryRunner.batchSets[0] = {
            executionElapsed: null,         // tslint:disable-line:no-null-keyword
            executionEnd: null,             // tslint:disable-line:no-null-keyword
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
            resultSetSummaries: []
        };
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('resultSet', TypeMoq.It.isAny()));
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleResultSetComplete(resultSetComplete);

        // Then:
        // ... The pre-existing batch should contain the result set we got back
        assert.equal(queryRunner.batchSets[0].resultSetSummaries.length, 1);
        assert.equal(queryRunner.batchSets[0].resultSetSummaries[0], resultSetComplete.resultSetSummary);

        // ... The resultset complete event should have been emitted
        mockEventEmitter.verify(x => x.emit('resultSet', TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('Notification - ResultSet complete w/previous results', () => {
        // Setup:
        // ... Create resultset completion results
        let resultSetComplete1: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: 'uri',
            resultSetSummary: {batchId: 0, columnInfo: [], id: 0, rowCount: 10 }
        };
        let resultSetComplete2: QueryExecuteResultSetCompleteNotificationParams = {
            ownerUri: 'uri',
            resultSetSummary: {batchId: 0, columnInfo: [], id: 1, rowCount: 10 }
        };

        // ... Create a mock event emitter to receive the events
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('resultSet', TypeMoq.It.isAny()));

        // If:
        // ... I submit a resultSet completion notification to the query runner
        let queryRunner = new QueryRunner('', '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object);
        queryRunner.batchSets[0] = {
            executionElapsed: null,         // tslint:disable-line:no-null-keyword
            executionEnd: null,             // tslint:disable-line:no-null-keyword
            executionStart: new Date().toISOString(),
            hasError: false,
            id: 0,
            selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
            resultSetSummaries: []
        };
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleResultSetComplete(resultSetComplete1);

        // ... And submit a second result set completion notification
        queryRunner.handleResultSetComplete(resultSetComplete2);

        // Then:
        // ... There should be two results in the batch summary
        assert.equal(queryRunner.batchSets[0].resultSetSummaries.length, 2);
        assert.equal(queryRunner.batchSets[0].resultSetSummaries[0], resultSetComplete1.resultSetSummary);
        assert.equal(queryRunner.batchSets[0].resultSetSummaries[1], resultSetComplete2.resultSetSummary);

        // ... The resultset complete event should have been emitted twice
        mockEventEmitter.verify(x => x.emit('resultSet', TypeMoq.It.isAny()), TypeMoq.Times.exactly(2));
    });

    test('Notification - Message', () => {
        // Setup:
        // ... Create a mock for an event emitter that handles message notifications
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('message', TypeMoq.It.isAny()));

        // ... Create a message notification with some message
        let message: QueryExecuteContracts.QueryExecuteMessageParams = {
            message: {
                batchId: 0,
                isError: false,
                message: 'Message!',
                time: new Date().toISOString()
            },
            ownerUri: standardUri
        };

        // If:
        // ... I have a query runner
        let queryRunner: QueryRunner = new QueryRunner(
            standardUri, standardTitle,
            testStatusView.object, testSqlToolsServerClient.object,
            testQueryNotificationHandler.object, testVscodeWrapper.object
        );
        queryRunner.eventEmitter = mockEventEmitter.object;

        // ... And I ask to handle a message
        queryRunner.handleMessage(message);

        // Then: A message event should have been emitted
        mockEventEmitter.verify(x => x.emit('message', TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('Notification - Query complete', () => {
        // Setup:
        // ... Create a mock for an event emitter that handles complete notifications
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('complete', TypeMoq.It.isAnyString()));

        // ... Setup the VS Code view handlers
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));
        testVscodeWrapper.setup(x => x.logToOutputChannel(TypeMoq.It.isAnyString()));

        // ... Create a completion notification with bogus data
        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: 'uri',
            batchSummaries: [{
                hasError: false,
                id: 0,
                selection: standardSelection,
                resultSetSummaries: [],
                executionElapsed: undefined,
                executionStart: new Date().toISOString(),
                executionEnd: new Date().toISOString()
            }]
        };

        // If:
        // ... I have a query runner
        let queryRunner = new QueryRunner(
            standardUri,
            standardTitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.eventEmitter = mockEventEmitter.object;

        // ... And I handle a query completion event
        queryRunner.handleQueryComplete(result);

        // Then:
        // ... The VS Code view should have stopped executing
        testStatusView.verify(x => x.executedQuery(standardUri), TypeMoq.Times.once());

        // ... The event emitter should have gotten a complete event
        mockEventEmitter.verify(x => x.emit('complete', TypeMoq.It.isAnyString()), TypeMoq.Times.once());

        // ... The state of the query runner has been updated
        assert.equal(queryRunner.batchSets.length, 1);
        assert.equal(queryRunner.isExecutingQuery, false);
    });

    test('Correctly handles subset', () => {
        let testuri = 'test';
        let testresult = {
            message: '',
            resultSubset: {
                rowCount: 5,
                rows: [
                    ['1', '2'],
                    ['3', '4'],
                    ['5', '6'],
                    ['7', '8'],
                    ['9', '10']
                ]
            }
        };
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback(() => {
                                                              // testing
                                                          }).returns(() => { return Promise.resolve(testresult); });
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            testuri,
            testuri,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then(result => {
            assert.equal(result, testresult);
        });
    });

    test('Correctly handles error from subset request', () => {
        let testuri = 'test';
        let testresult = {
            message: 'failed'
        };
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback(() => {
                                                              // testing
                                                          }).returns(() => { return Promise.resolve(testresult); });
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            testuri,
            testuri,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then(undefined, () => {
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    function setupWorkspaceConfig(configResult: {[key: string]: any}): void {
        let config = stubs.createWorkspaceConfiguration(configResult);
        testVscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
        .returns(x => {
            return config;
        });
    }

    suite('Copy Tests', () => {
        // ------ Common inputs and setup for copy tests  -------
        const TAB = '\t';
        const CLRF = os.EOL;
        const finalStringNoHeader = '1' + TAB + '2' + CLRF +
                            '3' + TAB + '4' + CLRF +
                            '5' + TAB + '6' + CLRF +
                            '7' + TAB + '8' + CLRF +
                            '9' + TAB + '10';

        const finalStringWithHeader = 'Col1' + TAB + 'Col2' + CLRF + finalStringNoHeader;

        const testuri = 'test';
        const testresult = {
            message: '',
            resultSubset: {
                rowCount: 5,
                rows: [
                    ['1', '2'],
                    ['3', '4'],
                    ['5', '6'],
                    ['7', '8'],
                    ['9', '10']
                ]
            }
        };

        let testRange: ISlickRange[] = [{fromCell: 0, fromRow: 0, toCell: 1, toRow: 4}];

        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: testuri,
            batchSummaries: [{
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                resultSetSummaries: <ResultSetSummary[]> [{
                    id: 0,
                    rowCount: 5,
                    columnInfo: [
                        { columnName: 'Col1' },
                        { columnName: 'Col2' }
                    ]
                }],
                executionElapsed: undefined,
                executionStart: new Date().toISOString(),
                executionEnd: new Date().toISOString()
            }]
        };

        setup(() => {
            testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                            TypeMoq.It.isAny())).callback(() => {
                                                                // testing
                                                            }).returns(() => { return Promise.resolve(testresult); });
            testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
            testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAnyString()));
            testVscodeWrapper.setup( x => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        });

        // ------ Copy tests  -------
        test('Correctly copy pastes a selection', () => {
            let configResult: {[key: string]: any} = {};
            configResult[Constants.copyIncludeHeaders] = false;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object
            );
            queryRunner.uri = testuri;
            return queryRunner.copyResults(testRange, 0, 0).then(() => {
                let pasteContents = ncp.paste();
                assert.equal(pasteContents, finalStringNoHeader);
            });
        });

        test('Copies selection with column headers set in user config', () => {
            // Set column headers in the user config settings
            let configResult: {[key: string]: any} = {};
            configResult[Constants.copyIncludeHeaders] = true;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);
            return queryRunner.copyResults(testRange, 0, 0).then(() => {
                let pasteContents = ncp.paste();
                assert.equal(pasteContents, finalStringWithHeader);
            });
        });

        test('Copies selection with headers when true passed as parameter', () => {
            // Do not set column config in user settings
            let configResult: {[key: string]: any} = {};
            configResult[Constants.copyIncludeHeaders] = false;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to include headers
            return queryRunner.copyResults(testRange, 0, 0, true).then(() => {
                let pasteContents = ncp.paste();
                assert.equal(pasteContents, finalStringWithHeader);
            });
        });

        test('Copies selection without headers when false passed as parameter', () => {
            // Set column config in user settings
            let configResult: {[key: string]: any} = {};
            configResult[Constants.copyIncludeHeaders] = true;
            setupWorkspaceConfig(configResult);

            let queryRunner = new QueryRunner(
                testuri,
                testuri,
                testStatusView.object,
                testSqlToolsServerClient.object,
                testQueryNotificationHandler.object,
                testVscodeWrapper.object
            );
            queryRunner.uri = testuri;
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleQueryComplete(result);

            // call copyResults with additional parameter indicating to not include headers
            return queryRunner.copyResults(testRange, 0, 0, false).then(() => {
                let pasteContents = ncp.paste();
                assert.equal(pasteContents, finalStringNoHeader);
            });
        });
    });
});

/**
 * Sets up a mock SQL Tools Service client with a handler for submitting a query execute request
 * @param testSqlToolsServerClient The mock service client to setup
 * @param returnCallback Function to execute when query execute request is called
 */
function setupStandardQueryRequestServiceMock(
    testSqlToolsServerClient: TypeMoq.Mock<SqlToolsServerClient>,
    returnCallback: (...x: any[]) => Thenable<QueryDisposeContracts.QueryDisposeResult>
): void {
    testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isValue(QueryExecuteContracts.QueryExecuteRequest.type), TypeMoq.It.isAny()))
        .callback((type, details: QueryExecuteParams) => {
            assert.equal(details.ownerUri, standardUri);
            assert.equal(details.querySelection, standardSelection);
        })
        .returns(returnCallback);
}

function setupStandardQueryNotificationHandlerMock(testQueryNotificationHandler: TypeMoq.Mock<QueryNotificationHandler>): void {
    testQueryNotificationHandler.setup(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAnyString()))
        .callback((qr, u: string) => {
            assert.equal(u, standardUri);
        });
}
