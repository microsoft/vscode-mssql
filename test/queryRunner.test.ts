import * as TypeMoq from 'typemoq';
import assert = require('assert');
import QueryRunner from './../src/controllers/queryRunner';
import { QueryNotificationHandler } from './../src/controllers/QueryNotificationHandler';
import { SqlOutputContentProvider } from './../src/models/sqlOutputContentProvider';
import SqlToolsServerClient from './../src/languageservice/serviceclient';
import { QueryExecuteParams, QueryExecuteCompleteNotificationResult } from './../src/models/contracts/queryExecute';
import VscodeWrapper from './../src/controllers/vscodeWrapper';
import StatusView from './../src/views/statusView';
import { ISlickRange, ISelectionData } from './../src/models/interfaces';

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
        testVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Strict);

    });

    test('Constructs properly', () => {

        let queryRunner = new QueryRunner(undefined,
                                          testStatusView.object,
                                          testSqlOutputContentProvider.object,
                                            testSqlToolsServerClient.object,
                                            testQueryNotificationHandler.object,
                                            testVscodeWrapper.object);
        assert.equal(typeof queryRunner !== undefined, true);
    });

    test('Runs Query Corrects', () => {
        let testuri = 'uri';
        let testSelection = {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3};
        let testtitle = 'title';
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
                                                              assert.equal(details.ownerUri, testuri);
                                                              assert.equal(details.querySelection, testSelection);
                                                          })
                                .returns(() => { return Promise.resolve({messages: undefined}); });
        testQueryNotificationHandler.setup(x => x.registerRunner(TypeMoq.It.isAny(),
                                                                 TypeMoq.It.isAnyString())).callback((queryRunner, uri: string) => {
                                                                     assert.equal(uri, testuri);
                                                                 });
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        return queryRunner.runQuery(testuri, testSelection, testtitle).then(() => {
            testQueryNotificationHandler.verify(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

    });

    test('Handles Query Error Correctly', () => {
        let testuri = 'uri';
        let testSelection = {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3};
        let testtitle = 'title';
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
                                                              assert.equal(details.ownerUri, testuri);
                                                              assert.equal(details.querySelection, testSelection);
                                                          })
                                .returns(() => { return Promise.resolve({messages: 'failed'}); });
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
                    undefined,
                    testStatusView.object,
                    testSqlOutputContentProvider.object,
                    testSqlToolsServerClient.object,
                    testQueryNotificationHandler.object,
                    testVscodeWrapper.object
                );
        return queryRunner.runQuery(testuri, testSelection, testtitle).then(() => {
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Handles result correctly', () => {
        let result: QueryExecuteCompleteNotificationResult = {
            ownerUri: 'uri',
            batchSummaries: [{
                hasError: false,
                id: 0,
                selection: {startLine: 0, endLine: 0, startColumn: 3, endColumn: 3},
                messages: ['6 affects rows'],
                resultSetSummaries: []
            }]
        };

        testSqlOutputContentProvider.setup(x => x.updateContent(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));
        let queryRunner = new QueryRunner(
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = '';
        queryRunner.handleResult(result);
        testSqlOutputContentProvider.verify(x => x.updateContent(TypeMoq.It.isAny()), TypeMoq.Times.once());
        testStatusView.verify(x => x.executedQuery(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
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
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
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
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then(undefined, () => {
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Correctly copy pastes a selection', () => {
        const TAB = '\t';
        const CLRF = '\r\n';
        const finalString = '1' + TAB + '2' + TAB + CLRF +
                            '3' + TAB + '4' + TAB + CLRF +
                            '5' + TAB + '6' + TAB + CLRF +
                            '7' + TAB + '8' + TAB + CLRF +
                            '9' + TAB + '10' + TAB + CLRF;
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
        let testRange: ISlickRange[] = [{fromCell: 0, fromRow: 0, toCell: 1, toRow: 4}];
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback(() => {
                                                              // testing
                                                          }).returns(() => { return Promise.resolve(testresult); });
        testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = testuri;
        return queryRunner.copyResults(testRange, 0, 0).then(() => {
            let pasteContents = ncp.paste();
            assert.equal(pasteContents, finalString);
        });
    });

    test('Sets Selection Correctly', () => {
        let selection: ISelectionData = {
            startLine: 0,
            startColumn: 0,
            endLine: 2,
            endColumn: 2
        };

        testVscodeWrapper.setup(x => x.position(TypeMoq.It.isAnyNumber(), TypeMoq.It.isAnyNumber()))
            .returns((line, column) => {
                return {
                    line: line,
                    character: column,
                    isBefore: undefined,
                    isBeforeOrEqual: undefined,
                    isAfter: undefined,
                    isAfterOrEqual: undefined,
                    isEqual: undefined,
                    compareTo: undefined,
                    translate: undefined,
                    with: undefined
                };
            });

        testVscodeWrapper.setup(x => x.selection(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((start, end) => {
                return {
                    anchor: start,
                    active: end,
                    isReversed: undefined,
                    start: undefined,
                    end: undefined,
                    isEmpty: undefined,
                    isSingleLine: undefined,
                    contains: undefined,
                    isEqual: undefined,
                    intersection: undefined,
                    union: undefined,
                    with: undefined
                };
            });

        testVscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                let textDocument = {};
                return Promise.resolve(textDocument);
            });

        let editor = {
            selection: undefined
        };
        testVscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(editor);
            });

        testVscodeWrapper.setup(x => x.parseUri(TypeMoq.It.isAnyString()))
            .returns((uri) => {
                return {
                    file: undefined,
                    parse: undefined,
                    scheme: undefined,
                    authority: undefined,
                    path: undefined,
                    query: undefined,
                    fragment: undefined,
                    fsPath: undefined,
                    toString: undefined,
                    toJSON: undefined
                };
            });

        let queryRunner = new QueryRunner(
            undefined,
            testStatusView.object,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );

        return queryRunner.setEditorSelection(selection).then(() => {
            assert.equal(editor.selection.anchor.line, selection.startLine);
            assert.equal(editor.selection.anchor.character, selection.startColumn);
            assert.equal(editor.selection.active.line, selection.endLine);
            assert.equal(editor.selection.active.character, selection.endColumn);
        });
    });
});
