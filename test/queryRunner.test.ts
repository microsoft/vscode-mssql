// import * as TypeMoq from 'typemoq';
// import * as vscode from 'vscode';
// import assert = require('assert');
// import QueryRunner from './../src/controllers/queryRunner';
// import { QueryNotificationHandler } from './../src/controllers/QueryNotificationHandler';
// import { SqlOutputContentProvider } from './../src/models/sqlOutputContentProvider';
// import SqlToolsServerClient from './../src/languageservice/serviceclient';

// suite('Query Runner tests', () => {

//     let outputProvider: TypeMoq.Mock<SqlOutputContentProvider>;
//     let notificationHandler: TypeMoq.GlobalMock<typeof QueryNotificationHandler>;
//     let serviceClient: TypeMoq.GlobalMock<typeof SqlToolsServerClient>;
//     let editorMoq: TypeMoq.GlobalMock<typeof vscode.window.activeTextEditor>;
//     let fileName = 'testSql';

//     setup(() => {
//         outputProvider = TypeMoq.Mock.ofType(SqlOutputContentProvider);
//         notificationHandler = TypeMoq.GlobalMock.ofInstance(QueryNotificationHandler);
//         editorMoq = TypeMoq.GlobalMock.ofInstance(vscode.window.activeTextEditor);
//         editorMoq.setup(x => x.document.fileName).returns(() => { return fileName; });
//         serviceClient = TypeMoq.GlobalMock.ofInstance(SqlToolsServerClient);
//         serviceClient.setup(x => x.getInstance());
//     });

//     test('Constructs properly', () => {
//         TypeMoq.GlobalScope.using(editorMoq).with(() => {
//             TypeMoq.GlobalScope.using(serviceClient).with(() => {
//                 TypeMoq.GlobalScope.using(notificationHandler).with(() => {
//                     new QueryRunner(
//                                         undefined,
//                                         undefined,
//                                         outputProvider.object
//                                     );
//                 });
//             });
//         });
//     });

//     test('Run Query Test', () => {
//         return new Promise<void>((resolve, reject) => {
//             TypeMoq.GlobalScope.using(serviceClient).with(() => {
//                 TypeMoq.GlobalScope.using(notificationHandler).with(() => {
//                     let queryRunner = new QueryRunner(
//                                                         undefined,
//                                                         undefined,
//                                                         outputProvider.object
//                                                     );
//                     queryRunner.runQuery().then(() => {
//                         assert.equal(queryRunner.title, fileName);
//                         assert.equal(queryRunner.uri, 'vscode-mssql');
//                     });
//                 });
//             });
//         });
//     });
// });
