'use strict';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { SqlOutputContentProvider } from '../src/models/SqlOutputContentProvider';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import StatusView from '../src/views/statusView';
import * as stubs from './stubs';
import Constants = require('../src/models/constants');
import vscode = require('vscode');
import * as TypeMoq from 'typemoq';
import assert = require('assert');

suite('SqlOutputProvider Tests', () => {
    let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let statusView: TypeMoq.Mock<StatusView>;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        context.object.extensionPath = '';
        statusView = TypeMoq.Mock.ofType(StatusView);
        contentProvider = new SqlOutputContentProvider(context.object, statusView.object);
        contentProvider.setVscodeWrapper(vscodeWrapper.object);

    });

    test('Correctly outputs the new result pane view column', done => {
        function setSplitPaneSelectionConfig(value: string): void {
            let configResult: {[key: string]: any} = {};
            configResult[Constants.configSplitPaneSelection] = value;
            let config = stubs.createWorkspaceConfiguration(configResult);
            vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
            .returns(x => {
                return config;
            });
        }

        function setCurrentEditorColumn(column: number): void {
            vscodeWrapper.setup(x => x.activeTextEditor)
            .returns(x => {
                let editor: vscode.TextEditor = new stubs.TestTextEditor();
                editor.viewColumn = column;
                return editor;
            });
        }

        class Case {
            position: number;
            config: string;
            expectedColumn: number;
        }

        let cases: Case[] = [
            {position: 1, config: 'next', expectedColumn: 2},
            {position: 2, config: 'next', expectedColumn: 3},
            {position: 3, config: 'next', expectedColumn: 3},
            {position: 1, config: 'current', expectedColumn: 1},
            {position: 2, config: 'current', expectedColumn: 2},
            {position: 3, config: 'current', expectedColumn: 3},
            {position: 1, config: 'end', expectedColumn: 3},
            {position: 2, config: 'end', expectedColumn: 3},
            {position: 3, config: 'end', expectedColumn: 3}
        ];

        try {
            cases.forEach((c: Case) => {
                setSplitPaneSelectionConfig(c.config);
                setCurrentEditorColumn(c.position);

                let resultColumn = contentProvider.newResultPaneViewColumn();
                assert.equal(resultColumn, c.expectedColumn);
            });

            done();
        } catch (err) {
            done(new Error(err));
        }
    });

});


// TODO: rewrite all the outputprovider handle tests (old ones kept for reference)
// Tracked by issue #584
/*
// Imports used by previous tests

import LocalWebService from '../src/controllers/localWebService';
import Interfaces = require('../src/models/interfaces');
let results = require('./resources/results.json');
let messages = require('./resources/messages.json');
const pd = require('pretty-data').pd;
const fs = require('fs');
let request = require('request');
let metadata = [
    {
        'columnsUri': '/' + Constants.outputContentTypeColumns + '?id=0',
        'rowsUri': '/' + Constants.outputContentTypeRows + '?id=0'
    }
]

    // Old Decleration area
    // let port: string;
    // let file = '/out/test/resources/sqlTest.sql';
    // let path: string;

    // Old Setup Area
    // port = LocalWebService._servicePort;
    // path = vscode.extensions.getExtension('microsoft.vscode-mssql').extensionPath;

    test("Initial Server Responses", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Root] + '?uri=' + uri;
        let htmlbuf = fs.readFileSync(path +'/src/views/htmlcontent/sqlOutput.ejs')
        htmlbuf = htmlbuf.toString();
        htmlbuf = htmlbuf.replace('<%=uri%>', uri);
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(htmlbuf.toString(), body);
        });
    });

    test("Correctly Delievers MetaData", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.ResultsetsMeta] + '?uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(metadata));
        });
    });

    test("Correctly Delievers Messages", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Messages] + '?uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(messages));
        });
    });

    test("Correctly Delivers Columns", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Columns] + '?id=0&uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].columns));
        });
    });

    test("Correctly Delievers Rows", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Rows] + '?id=0&uri=' + uri;
        return request.get(url,(err, res, body) => {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].rows));
        });
    });
*/
