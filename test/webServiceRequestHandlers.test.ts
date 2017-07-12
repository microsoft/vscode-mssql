'use strict';

import { SqlOutputContentProvider } from '../src/models/SqlOutputContentProvider';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import QueryRunner from '../src/controllers/QueryRunner';
import { ISelectionData } from '../src/models/interfaces';
import { QueryExecuteSubsetResult, ResultSetSubset } from '../src/models/contracts/queryExecute';
import StatusView from '../src/views/statusView';
import * as stubs from './stubs';
import vscode = require('vscode');
import * as TypeMoq from 'typemoq';
import assert = require('assert');

suite('Web Service Request Handler Tests', () => {
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let context: TypeMoq.IMock<vscode.ExtensionContext>;
    let statusView: TypeMoq.IMock<StatusView>;
    let result: TypeMoq.IMock<stubs.ExpressResult>;
    let queryRunner: TypeMoq.IMock<QueryRunner>;

    setup(() => {

        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapper.callBase = true;

        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        context.object.extensionPath = '';

        statusView = TypeMoq.Mock.ofType(StatusView);
        statusView.setup(x => x.cancelingQuery(TypeMoq.It.isAny()));
        statusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));

        contentProvider = new SqlOutputContentProvider(context.object, statusView.object);
        contentProvider.setVscodeWrapper = vscodeWrapper.object;
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };

        result = TypeMoq.Mock.ofType(stubs.ExpressResult);
        result.setup(x => x.render(TypeMoq.It.isAny(), TypeMoq.It.isAny()));
        result.setup(x => x.send(TypeMoq.It.isAny()));
        result.setup(x => x.send());

        queryRunner = TypeMoq.Mock.ofType(QueryRunner);
        // add a testable URI to the query map and inject our mocked query runner
        queryRunner = TypeMoq.Mock.ofType(QueryRunner);
        let title = 'test_title';
        let uri = 'test_uri';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);
        contentProvider.getResultsMap.get('tsqloutput:' + uri).queryRunner = queryRunner.object;
    });

    test('RootHandler properly handles request and renders content', done => {
        let testQuery = {
            backgroundColor: 'test_background_color',
            uri: 'tsqloutput:test_uri',
            color: 'test_color',
            theme: 'test_theme'
        };
        let request = new stubs.ExpressRequest(testQuery);

        result.setup(x => x.render(TypeMoq.It.isAny(), TypeMoq.It.isAny())).callback(function(path: string, params: any): void {
            assert.equal(params.uri, testQuery.uri);
            assert.equal(params.backgroundColor, testQuery.backgroundColor);
            assert.equal(params.color, testQuery.color);
            assert.equal(params.theme, testQuery.theme);
        });

        contentProvider.rootRequestHandler(request, result.object);

        result.verify(x => x.render(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        done();
    });

    test('RowRequestHandler properly handles request and renders content', done => {
        let testQuery = {
            numberOfRows: 0,
            batchId: 0,
            rowStart: 0,
            resultId: 0,
            uri: 'tsqloutput:test_uri'
        };
        let request = new stubs.ExpressRequest(testQuery);

        // Setup a query runner callback and return type
        queryRunner.setup(x => x.getRows(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .callback((rowStart: number, numberOfRows: number, batchId: number, resultId: number) => {
            // assert that input data has properly propogated
            assert.equal(rowStart, testQuery.rowStart);
            assert.equal(numberOfRows, testQuery.numberOfRows);
            assert.equal(batchId, testQuery.batchId);
            assert.equal(resultId, testQuery.resultId);
        })
        .returns( () => {
            return new Promise<QueryExecuteSubsetResult>((reject, resolve) => {
                // returning a blank resultSubset Message
                let subsetResult = new QueryExecuteSubsetResult();
                subsetResult.resultSubset = new ResultSetSubset();
                subsetResult.resultSubset.rowCount = 0;
                subsetResult.resultSubset.rows = [[]];
                resolve(subsetResult);
            });
        });

        // Run tested function
        contentProvider.rowRequestHandler(request, result.object);

        // Ensure proper functions were called
        queryRunner.verify(x => x.getRows(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

        done();
    });

    test('ConfigRequestHandler properly handles request and renders content', done => {
        let request = new stubs.ExpressRequest();
        // Run tested function
        contentProvider.configRequestHandler(request, result.object);

        // Ensure proper functions were called
        result.verify(x => x.send(TypeMoq.It.isAny()), TypeMoq.Times.once());

        done();
    });

    test('SaveResultsRequestHandler properly handles request and renders content', done => {
        let testQuery = {
            resultSetNo: 0,
            uri: 'tsqloutput:test_uri',
            batchIndex: 0,
            format: 'test_format'
        };
        let request = new stubs.ExpressRequest(testQuery);
        request.body = [{
            fromCell: 0,
            toCell: 0,
            fromRow: 0,
            toRow: 0
        }];

        contentProvider.saveResultsRequestHandler(request, result.object);

        // Ensure proper functions were called
        result.verify(x => x.send(), TypeMoq.Times.once());
        assert.equal(result.object.status, 200);

        done();
    });


    test('OpenLinkRequestHandler properly handles request and renders content', done => {
        let request = new stubs.ExpressRequest();
        request.body = {
            content: 'test_content',
            coumnName: 'test_column',
            type: 'test_type'
        };

        contentProvider.openLinkRequestHandler(request, result.object);

        // Ensure proper functions were called
        result.verify(x => x.send(), TypeMoq.Times.once());
        assert.equal(result.object.status, 200);

        done();
    });


    test('CopyRequestHandler properly handles request and renders content', done => {
        let testQuery = {
            includeHeaders: true,
            batchId: 0,
            resultId: 0,
            uri: 'tsqloutput:test_uri'
        };
        let request = new stubs.ExpressRequest(testQuery);
        request.body = [{
            fromCell: 0,
            toCell: 0,
            fromRow: 0,
            toRow: 0
        }];

        // Setup a query runner callback and return type
        queryRunner.setup(x => x.copyResults(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .callback((selection: any, batchId: any, resultId: any, includeHeaders: any) => {
            // assert that input data has properly propogated
            assert.equal(selection.fromCell, request.body.fromCell);
            assert.equal(selection.toCell, request.body.toCell);
            assert.equal(selection.fromRow, request.body.fromRow);
            assert.equal(selection.toRow, request.body.toRow);
            assert.equal(includeHeaders, testQuery.includeHeaders);
            assert.equal(batchId, testQuery.batchId);
            assert.equal(resultId, testQuery.resultId);
        })
        .returns( () => {
            return new Promise<void>((reject, resolve) => {
                // returning a void promise
                resolve();
            });
        });

        // Run tested function
        contentProvider.copyRequestHandler(request, result.object);

        // Ensure proper functions were called
        queryRunner.verify(x => x.copyResults(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

        done();
    });

    test('EditorSelectionRequestHandler properly handles request and renders content', done => {
        let testQuery = {
            startLine: '0',
            startColumn: '0',
            endLine: '0',
            endColumn: '0',
            uri: 'tsqloutput:test_uri'
        };
        let request = new stubs.ExpressRequest(testQuery);

        // Setup a query runner callback and return type
        queryRunner.setup(x => x.setEditorSelection(TypeMoq.It.isAny()))
        .callback((selection: any, batchId: any, resultId: any, includeHeaders: any) => {
            // assert that input data has properly propogated
            let testSelection: ISelectionData = {
                startLine: parseInt(testQuery.startLine, 10),
                startColumn: parseInt(testQuery.startColumn, 10),
                endLine: parseInt(testQuery.endLine, 10),
                endColumn: parseInt(testQuery.endColumn, 10)
            };
            assert.equal(JSON.stringify(selection), JSON.stringify(testSelection));
        })
        .returns( () => {
            return new Promise<void>((reject, resolve) => {
                // returning a void promise
                resolve();
            });
        });

        // Run tested function
        contentProvider.editorSelectionRequestHandler(request, result.object);

        // Ensure proper functions were called
        queryRunner.verify(x => x.setEditorSelection(TypeMoq.It.isAny()), TypeMoq.Times.once());

        done();
    });

    test('ShowErrorRequestHandler properly handles request and renders content', done => {
        let request = new stubs.ExpressRequest();
        request.body = {
            message: 'test_message'
        };

        contentProvider.showErrorRequestHandler(request, result.object);

        // Ensure proper functions were called
        result.verify(x => x.send(), TypeMoq.Times.once());
        assert.equal(result.object.status, 200);

        done();
    });

    test('ShowWarningRequestHandler properly handles request and renders content', done => {
        let request = new stubs.ExpressRequest();
        request.body = {
            message: 'test_message'
        };

        contentProvider.showWarningRequestHandler(request, result.object);

        // Ensure proper functions were called
        result.verify(x => x.send(), TypeMoq.Times.once());
        assert.equal(result.object.status, 200);

        done();
    });

});
