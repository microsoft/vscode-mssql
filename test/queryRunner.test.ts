// import * as TypeMoq from 'typemoq';
// import assert = require('assert');
// import QueryRunner from './../src/controllers/queryRunner';
// import { QueryNotificationHandler } from './../src/controllers/QueryNotificationHandler';
// import { SqlOutputContentProvider } from './../src/models/sqlOutputContentProvider';
// import SqlToolsServerClient from './../src/languageservice/serviceclient';
// import { QueryExecuteParams } from './../src/models/contracts/queryExecute';
// import VscodeWrapper from './../src/controllers/vscodeWrapper';
// import StatusView from './../src/views/statusView';
// import { ISlickRange } from './../src/models/interfaces';

// const ncp = require('copy-paste');

// suite('Query Runner tests', () => {

//     let testSqlOutputContentProvider: TypeMoq.Mock<SqlOutputContentProvider>;
//     let testSqlToolsServerClient: TypeMoq.Mock<SqlToolsServerClient>;
//     let testQueryNotificationHandler: TypeMoq.Mock<QueryNotificationHandler>;
//     let testVscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
//     let testStatusView: TypeMoq.Mock<StatusView>;

//     setup(() => {
//         testSqlOutputContentProvider = TypeMoq.Mock.ofType(SqlOutputContentProvider, TypeMoq.MockBehavior.Strict, {extensionPath: ''});
//         testSqlToolsServerClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Strict);
//         testQueryNotificationHandler = TypeMoq.Mock.ofType(QueryNotificationHandler, TypeMoq.MockBehavior.Strict);
//         testVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Strict);
//         testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Strict);

//     });

//     test('Constructs properly', () => {

//         let queryRunner = new QueryRunner(undefined,
//                                           testStatusView.object,
//                                           testSqlOutputContentProvider.object,
//                                             testSqlToolsServerClient.object,
//                                             testQueryNotificationHandler.object,
//                                             testVscodeWrapper.object);
//         assert.equal(typeof queryRunner !== undefined, true);
//     });

//     test('Runs Query Corrects', () => {
//         let testuri = 'uri';
//         let testquery = 'SELECT * FROM sys.objects';
//         let testtitle = 'title';
//         testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
//                                                           TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
//                                                               assert.equal(details.ownerUri, testuri);
//                                                               assert.equal(undefined, testquery);
//                                                           })
//                                 .returns(() => { return Promise.resolve({messages: undefined}); });
//         testQueryNotificationHandler.setup(x => x.registerRunner(TypeMoq.It.isAny(),
//                                                                  TypeMoq.It.isAnyString())).callback((queryRunner, uri: string) => {
//                                                                      assert.equal(uri, testuri);
//                                                                  });
//         testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
//         let queryRunner = new QueryRunner(
//             undefined,
//             testStatusView.object,
//             testSqlOutputContentProvider.object,
//             testSqlToolsServerClient.object,
//             testQueryNotificationHandler.object,
//             testVscodeWrapper.object
//         );
//         // return queryRunner.runQuery(testuri, undefined, testtitle).then(() => {
//         //     testQueryNotificationHandler.verify(x => x.registerRunner(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
//         // });

//     });

//     test('Handles Query Error Correctly', () => {
//         let testuri = 'uri';
//         let testquery = 'SELECT * FROM sys.objects';
//         let testtitle = 'title';
//         testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
//                                                           TypeMoq.It.isAny())).callback((type, details: QueryExecuteParams) => {
//                                                               assert.equal(details.ownerUri, testuri);
//                                                               assert.equal(undefined, testquery);
//                                                           })
//                                 .returns(() => { return Promise.resolve({messages: 'failed'}); });
//         testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
//         testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
//         let queryRunner = new QueryRunner(
//                     undefined,
//                     testStatusView.object,
//                     testSqlOutputContentProvider.object,
//                     testSqlToolsServerClient.object,
//                     testQueryNotificationHandler.object,
//                     testVscodeWrapper.object
//                 );
//         // return queryRunner.runQuery(testuri, undefined, testtitle).then(() => {
//         //     testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
//         // });
//     });

//     test('Handles result correctly', () => {
//         testSqlOutputContentProvider.setup(x => x.updateContent(TypeMoq.It.isAny()));
//         testStatusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));
//         let queryRunner = new QueryRunner(
//             undefined,
//             testStatusView.object,
//             testSqlOutputContentProvider.object,
//             testSqlToolsServerClient.object,
//             testQueryNotificationHandler.object,
//             testVscodeWrapper.object
//         );
//         queryRunner.uri = '';
//         // queryRunner.handleResult({ownerUri: 'vscode', batchSummaries: [{
//         //     hasError: false,
//         //     id: 0,
//         //     messages: ['6 affects rows'],
//         //     resultSetSummaries: []
//         // }]});
//         testSqlOutputContentProvider.verify(x => x.updateContent(TypeMoq.It.isAny()), TypeMoq.Times.once());
//         testStatusView.verify(x => x.executedQuery(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
//     });

//     test('Correctly handles subset', () => {
//         let testuri = 'test';
//         let testresult = {
//             message: '',
//             resultSubset: {
//                 rowCount: 5,
//                 rows: [
//                     ['1', '2'],
//                     ['3', '4'],
//                     ['5', '6'],
//                     ['7', '8'],
//                     ['9', '10']
//                 ]
//             }
//         };
//         testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
//                                                           TypeMoq.It.isAny())).callback(() => {
//                                                               // testing
//                                                           }).returns(() => { return Promise.resolve(testresult); });
//         testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
//         let queryRunner = new QueryRunner(
//             undefined,
//             testStatusView.object,
//             testSqlOutputContentProvider.object,
//             testSqlToolsServerClient.object,
//             testQueryNotificationHandler.object,
//             testVscodeWrapper.object
//         );
//         queryRunner.uri = testuri;
//         return queryRunner.getRows(0, 5, 0, 0).then(result => {
//             assert.equal(result, testresult);
//         });
//     });

//     test('Correctly handles error from subset request', () => {
//         let testuri = 'test';
//         let testresult = {
//             message: 'failed'
//         };
//         testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
//                                                           TypeMoq.It.isAny())).callback(() => {
//                                                               // testing
//                                                           }).returns(() => { return Promise.resolve(testresult); });
//         testVscodeWrapper.setup(x => x.showErrorMessage(TypeMoq.It.isAnyString()));
//         let queryRunner = new QueryRunner(
//             undefined,
//             testStatusView.object,
//             testSqlOutputContentProvider.object,
//             testSqlToolsServerClient.object,
//             testQueryNotificationHandler.object,
//             testVscodeWrapper.object
//         );
//         queryRunner.uri = testuri;
//         return queryRunner.getRows(0, 5, 0, 0).then(undefined, () => {
//             testVscodeWrapper.verify(x => x.showErrorMessage(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
//         });
//     });

//     test('Correctly copy pastes a selection', () => {
//         const TAB = '\t';
//         const CLRF = '\r\n';
//         const finalString = '1' + TAB + '2' + TAB + CLRF +
//                             '3' + TAB + '4' + TAB + CLRF +
//                             '5' + TAB + '6' + TAB + CLRF +
//                             '7' + TAB + '8' + TAB + CLRF +
//                             '9' + TAB + '10' + TAB + CLRF;
//         let testuri = 'test';
//         let testresult = {
//             message: '',
//             resultSubset: {
//                 rowCount: 5,
//                 rows: [
//                     ['1', '2'],
//                     ['3', '4'],
//                     ['5', '6'],
//                     ['7', '8'],
//                     ['9', '10']
//                 ]
//             }
//         };
//         let testRange: ISlickRange[] = [{fromCell: 0, fromRow: 0, toCell: 1, toRow: 4}];
//         testSqlToolsServerClient.setup(x => x.sendRequest(TypeMoq.It.isAny(),
//                                                           TypeMoq.It.isAny())).callback(() => {
//                                                               // testing
//                                                           }).returns(() => { return Promise.resolve(testresult); });
//         testStatusView.setup(x => x.executingQuery(TypeMoq.It.isAnyString()));
//         let queryRunner = new QueryRunner(
//             undefined,
//             testStatusView.object,
//             testSqlOutputContentProvider.object,
//             testSqlToolsServerClient.object,
//             testQueryNotificationHandler.object,
//             testVscodeWrapper.object
//         );
//         queryRunner.uri = testuri;
//         return queryRunner.copyResults(testRange, 0, 0).then(() => {
//             let pasteContents = ncp.paste();
//             assert.equal(pasteContents, finalString);
//         });
//     });
// });
