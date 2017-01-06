/* tslint:disable */
// The module 'assert' provides assertion methods from node
'use strict';
import * as TypeMoq from 'typemoq';
import assert = require('assert');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import { SqlOutputContentProvider } from '../src/models/sqlOutputContentProvider';
import LocalWebService from '../src/controllers/localWebService';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import StatusView from '../src/views/statusView';
import * as stubs from './stubs';
import Interfaces = require('../src/models/interfaces');
import Constants = require('../src/models/constants');
import vscode = require('vscode');
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

suite('SqlOutputProvider Tests', () => {
    // let port: string;
    // let file = '/out/test/resources/sqlTest.sql';
    let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let statusView: TypeMoq.Mock<StatusView>;
    // let path: string;

    setup(() => {
        // port = LocalWebService._servicePort;
        // path = vscode.extensions.getExtension('microsoft.vscode-mssql').extensionPath;
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        context.object.extensionPath = '';
        statusView = TypeMoq.Mock.ofType(StatusView);
        contentProvider = new SqlOutputContentProvider(context.object, statusView.object);
        contentProvider.setVscodeWrapper(vscodeWrapper.object);

    });

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

    test("Correctly outputs the new result pane view column", done => {
        class Case {
            position: number;
            config: string;
            expectedColumn: number;
        }

        let cases: Case[] = [
            {position: 1, config: 'next', expectedColumn: 2},
            {position: 2, config: 'next', expectedColumn: 3},
            {position: 3, config: 'next', expectedColumn: 3},
            {position: 1, config: 'same', expectedColumn: 1},
            {position: 2, config: 'same', expectedColumn: 2},
            {position: 3, config: 'same', expectedColumn: 3},
            {position: 1, config: 'last', expectedColumn: 3},
            {position: 2, config: 'last', expectedColumn: 3},
            {position: 3, config: 'last', expectedColumn: 3},
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

//TODO: rewrite all the outputprodiver tests
/*
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
});
