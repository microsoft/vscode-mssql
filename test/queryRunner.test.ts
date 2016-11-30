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
    QueryExecuteBatchCompleteNotificationResult,
    QueryExecuteResultSetCompleteNotificationParams,
    ResultSetSummary
} from './../src/models/contracts/queryExecute';
import VscodeWrapper from './../src/controllers/vscodeWrapper';
import StatusView from './../src/views/statusView';
import * as Constants from '../src/models/constants';
import { ISlickRange } from './../src/models/interfaces';
import * as stubs from './stubs';

const ncp = require('copy-paste');

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

    test('Runs Query Correctly', () => {
        let testuri = 'uri';
        let testSelection = {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3};
        let testtitle = 'title';

        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((type, details: QueryExecuteParams) => {
                assert.equal(details.ownerUri, testuri);
                assert.equal(details.querySelection, testSelection);
            })
            .returns(() => { return Promise.resolve({ messages: undefined }); });
        testQueryNotificationHandler.setup(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAnyString()))
            .callback((queryRunner, uri: string) => {
                assert.equal(uri, testuri);
            });
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup( x => x.logToOutputChannel(TypeMoq.It.isAnyString()));

        let queryRunner = new QueryRunner(
            testuri,
            testtitle,
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );

        return queryRunner.runQuery(testSelection).then(() => {
            testQueryNotificationHandler.verify(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

    });

    test('Handles Info Message Correctly', () => {
        let testuri = 'uri';
        let testSelection = {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3};
        let testtitle = 'title';
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
                                                              assert.equal(details.ownerUri, testuri);
                                                              assert.equal(details.querySelection, testSelection);
                                                          })
                                .returns(() => { return Promise.resolve({messages: 'Commands completed successfully.', hasInfoMessages: true}); });
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        testVscodeWrapper.setup( x => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
                    testuri,
                    testtitle,
                    testStatusView.object,
                    testSqlToolsServerClient.object,
                    testQueryNotificationHandler.object,
                    testVscodeWrapper.object
                );
        return queryRunner.runQuery(testSelection).then(() => {
            // I expect no error message to be displayed
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
            assert.strictEqual(queryRunner.batchSets[0].hasError, false);

            // I expect query execution to be done
            assert.strictEqual(queryRunner.isExecutingQuery, false);
        });
    });

    test('Notification - Batch Complete', () => {
        // Setup: Create a batch completion result
        let batchComplete: QueryExecuteBatchCompleteNotificationResult = {
            ownerUri: 'uri',
            batchSummary: {
                executionElapsed: undefined,
                executionEnd: new Date().toISOString(),
                executionStart: new Date().toISOString(),
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                messages: [{time: '', message: '6 affected rows'}],
                resultSetSummaries: []
            }
        };

        // If: I submit a batch completion notification to the query runner...
        let queryRunner = new QueryRunner(
            '',
            '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('batch', TypeMoq.It.isAny()));
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleBatchComplete(batchComplete);

        // Then: It should store the batch and emit a batch complete notification
        assert.equal(queryRunner.batchSets.indexOf(batchComplete.batchSummary), 0);
        mockEventEmitter.verify(x => x.emit('batch', TypeMoq.It.isAny()), TypeMoq.Times.once());
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
        let mockEventEmitter = TypeMoq.Mock.ofType(EventEmitter, TypeMoq.MockBehavior.Strict);
        mockEventEmitter.setup(x => x.emit('resultSet', TypeMoq.It.isAny()));
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleResultSetComplete(resultSetComplete);

        // Then:
        // ... It should create a batch summary to hold the result
        assert.equal(queryRunner.batchSets.length, 1);
        assert.equal(queryRunner.batchSets[0].id, 0);

        // ... The batch that was created should contain the result set we got back
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
        queryRunner.eventEmitter = mockEventEmitter.object;
        queryRunner.handleResultSetComplete(resultSetComplete1);

        // ... And submit a second result set completion notification
        queryRunner.handleResultSetComplete(resultSetComplete2);

        // Then:
        // ... There should only be one batch summary created to hold the results
        assert.equal(queryRunner.batchSets.length, 1);
        assert.equal(queryRunner.batchSets[0].id, 0);

        // ... There should be two results in the batch summary
        assert.equal(queryRunner.batchSets[0].resultSetSummaries.length, 2);
        assert.equal(queryRunner.batchSets[0].resultSetSummaries[0], resultSetComplete1.resultSetSummary);
        assert.equal(queryRunner.batchSets[0].resultSetSummaries[1], resultSetComplete2.resultSetSummary);

        // ... The resultset complete event should have been emitted twice
        mockEventEmitter.verify(x => x.emit('resultSet', TypeMoq.It.isAny()), TypeMoq.Times.exactly(2));
    });

    test('Handles result correctly', () => {
        let resolveRan = false;
        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: 'uri',
            message: undefined,
            batchSummaries: [{
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                messages: [{time: '', message: '6 affects rows'}],
                resultSetSummaries: [],
                executionElapsed: undefined,
                executionStart: new Date().toISOString(),
                executionEnd: new Date().toISOString()
            }]
        };

        testVscodeWrapper.setup( x => x.logToOutputChannel(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));
        let queryRunner = new QueryRunner(
            '',
            '',
            testStatusView.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = '';
        queryRunner.dataResolveReject = {resolve: () => {
            resolveRan = true;
        }};
        queryRunner.handleResult(result);
        testStatusView.verify(x => x.executedQuery(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        assert.equal(resolveRan, true);
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
        const CLRF = '\r\n';
        const finalStringNoHeader = '1' + TAB + '2' + TAB + CLRF +
                            '3' + TAB + '4' + TAB + CLRF +
                            '5' + TAB + '6' + TAB + CLRF +
                            '7' + TAB + '8' + TAB + CLRF +
                            '9' + TAB + '10' + TAB + CLRF;

        const finalStringWithHeader = 'Col1' + TAB + 'Col2' + TAB + CLRF + finalStringNoHeader;

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
            message: undefined,
            batchSummaries: [{
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                messages: [{time: '', message: '6 affects rows'}],
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
            queryRunner.dataResolveReject = {resolve: () => {
                // Needed to handle the result callback
            }};
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleResult(result);
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
            queryRunner.dataResolveReject = {resolve: () => {
                // Needed to handle the result callback
            }};
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleResult(result);

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
            queryRunner.dataResolveReject = {resolve: () => {
                // Needed to handle the result callback
            }};
            // Call handleResult to ensure column header info is seeded
            queryRunner.handleResult(result);

            // call copyResults with additional parameter indicating to not include headers
            return queryRunner.copyResults(testRange, 0, 0, false).then(() => {
                let pasteContents = ncp.paste();
                assert.equal(pasteContents, finalStringNoHeader);
            });
        });
    });
});
