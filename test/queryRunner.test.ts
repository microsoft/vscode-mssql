import * as TypeMoq from 'typemoq';
import assert = require('assert');
import QueryRunner from './../src/controllers/queryRunner';
import { QueryNotificationHandler } from './../src/controllers/QueryNotificationHandler';
import { SqlOutputContentProvider } from './../src/models/sqlOutputContentProvider';
import SqlToolsServerClient from './../src/languageservice/serviceclient';
import { QueryExecuteParams } from './../src/models/contracts/queryExecute';
import VscodeWrapper from './../src/controllers/vscodeWrapper';

suite('Query Runner tests', () => {

    let testSqlOutputContentProvider: TypeMoq.Mock<SqlOutputContentProvider>;
    let testSqlToolsServerClient: TypeMoq.Mock<SqlToolsServerClient>;
    let testQueryNotificationHandler: TypeMoq.Mock<QueryNotificationHandler>;
    let testVscodeWrapper: TypeMoq.Mock<VscodeWrapper>;

    setup(() => {
        testSqlOutputContentProvider = TypeMoq.Mock.ofType(SqlOutputContentProvider, TypeMoq.MockBehavior.Loose, {extensionPath: ''});
        testSqlToolsServerClient = TypeMoq.Mock.ofType(SqlToolsServerClient);
        testQueryNotificationHandler = TypeMoq.Mock.ofType(QueryNotificationHandler);
        testVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);

    });

    test('Constructs properly', () => {

        let queryRunner = new QueryRunner(undefined,
                                          undefined,
                                          testSqlOutputContentProvider.object,
                                          testSqlToolsServerClient.object,
                                          testQueryNotificationHandler.object);
        assert.equal(typeof queryRunner !== undefined, true);
    });

    test('Runs Query Corrects', () => {
        let testuri = 'uri';
        let testquery = 'SELECT * FROM sys.objects';
        let testtitle = 'title';
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
                                                              assert.equal(details.ownerUri, testuri);
                                                              assert.equal(details.queryText, testquery);
                                                          })
                                .returns(() => { return Promise.resolve({messages: undefined}); });
        testQueryNotificationHandler.setup(x => x.registerRunner(TypeMoq.It.isAny(),
                                                                 TypeMoq.It.isAnyString())).callback((queryRunner, uri: string) => {
                                                                     assert.equal(uri, testuri);
                                                                 });
        let queryRunner = new QueryRunner(
            undefined,
            undefined,
            testSqlOutputContentProvider.object,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object
        );
        return queryRunner.runQuery(testuri, testquery, testtitle).then(() => {
            testQueryNotificationHandler.verify(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        });

    });

    test('Handles Query Error Correctly', () => {
        let testuri = 'uri';
        let testquery = 'SELECT * FROM sys.objects';
        let testtitle = 'title';
        testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
                                                          TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
                                                              assert.equal(details.ownerUri, testuri);
                                                              assert.equal(details.queryText, testquery);
                                                          })
                                .returns(() => { return Promise.resolve({messages: 'failed'}); });
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
                    undefined,
                    undefined,
                    undefined,
                    testSqlToolsServerClient.object,
                    testQueryNotificationHandler.object,
                    testVscodeWrapper.object
                );
        return queryRunner.runQuery(testuri, testquery, testtitle).then(() => {
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });

    test('Handles result correctly', () => {
        testSqlOutputContentProvider.setup(x => x.updateContent(TypeMoq.It.isAny()));
        let queryRunner = new QueryRunner(
            undefined,
            undefined,
            testSqlOutputContentProvider.object,
            undefined,
            undefined,
            testVscodeWrapper.object
        );
        queryRunner.handleResult({ownerUri: 'vscode', batchSummaries: [{
            hasError: false,
            id: 0,
            messages: ['6 affects rows'],
            resultSetSummaries: []
        }]});
        testSqlOutputContentProvider.verify(x => x.updateContent(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('Handles result error correctly', () => {
        testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
        let queryRunner = new QueryRunner(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            testVscodeWrapper.object
        );
        queryRunner.handleResult({ownerUri: 'vscode', batchSummaries: []});
        testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
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
        let queryRunner = new QueryRunner(
            undefined,
            undefined,
            undefined,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object
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
            undefined,
            undefined,
            testSqlToolsServerClient.object,
            testQueryNotificationHandler.object,
            testVscodeWrapper.object
        );
        queryRunner.uri = testuri;
        return queryRunner.getRows(0, 5, 0, 0).then(undefined, () => {
            testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
        });
    });
});
