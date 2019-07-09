/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

'use strict';

import { SqlOutputContentProvider } from '../src/models/sqlOutputContentProvider';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import StatusView from '../src/views/statusView';
import * as stubs from './stubs';
import Constants = require('../src/constants/constants');
import vscode = require('vscode');
import * as TypeMoq from 'typemoq';
import assert = require('assert');
import { ISelectionData } from '../src/models/interfaces';


suite('SqlOutputProvider Tests', () => {
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let context: TypeMoq.IMock<vscode.ExtensionContext>;
    let statusView: TypeMoq.IMock<StatusView>;
    let setSplitPaneSelectionConfig: (value: string) => void;
    let setCurrentEditorColumn: (column: number) => void;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        context.object.extensionPath = '';
        statusView = TypeMoq.Mock.ofType(StatusView);
        statusView.setup(x => x.cancelingQuery(TypeMoq.It.isAny()));
        statusView.setup(x => x.executedQuery(TypeMoq.It.isAny()));
        contentProvider = new SqlOutputContentProvider(context.object, statusView.object);
        contentProvider.setVscodeWrapper = vscodeWrapper.object;
        setSplitPaneSelectionConfig = function(value: string): void {
            let configResult: {[key: string]: any} = {};
            configResult[Constants.configSplitPaneSelection] = value;
            let config = stubs.createWorkspaceConfiguration(configResult);
            vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(x => {
                return config;
            });
        };
        setCurrentEditorColumn = function(column: number): void {
            vscodeWrapper.setup(x => x.activeTextEditor)
            .returns(x => {
                let editor: vscode.TextEditor = new stubs.TestTextEditor();
                editor.viewColumn = column;
                return editor;
            });
        };

    });

    test('Correctly outputs the new result pane view column', done => {
        class Case {
            position: number;
            config: string;
            expectedColumn: number;
        }

        // All the possible cases for a new results pane
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

        // Iterate through each case
        try {
            cases.forEach((c: Case) => {
                setSplitPaneSelectionConfig(c.config);
                setCurrentEditorColumn(c.position);

                let resultColumn = contentProvider.newResultPaneViewColumn('test_uri');

                // Ensure each case properly outputs the result pane
                assert.equal(resultColumn, c.expectedColumn);
            });

            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test('RunQuery properly sets up two queries to be run', done => {
        // Setup internal functions
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };

        // Run function with properties declared below
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Run function with properties declared below
        let title2 = 'Test_Title2';
        let uri2 = 'Test_URI2';
        contentProvider.runQuery(statusView.object, uri2, querySelection, title2);

        // Ensure both uris are executing
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + uri).queryRunner.isExecutingQuery, true);
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + uri2).queryRunner.isExecutingQuery, true);
        assert.equal(contentProvider.getResultsMap.size, 2);

        done();
    });

    test('RunQuery only sets up one uri with the same name', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + uri).queryRunner.isExecutingQuery, true);
        contentProvider.runQuery(statusView.object, uri, querySelection, title);
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + uri).queryRunner.isExecutingQuery, true);
        assert.equal(contentProvider.getResultsMap.size, 1);

        done();
    });

    test('onUntitledFileSaved should deleted the untitled file and create a new titled file', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let newUri = 'Test_URI_New';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.has('tsqloutput:Test_URI'), true);

        contentProvider.onUntitledFileSaved(uri, newUri);

        // Check that the first one was replaced by the new one and that there is only one in the map
        assert.equal(contentProvider.getResultsMap.has('tsqloutput:' + uri), false);
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + newUri).queryRunner.isExecutingQuery, true);
        assert.equal(contentProvider.getResultsMap.size, 1);

        done();
    });

    test('onDidCloseTextDocument properly mark the uri for deletion', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.has('tsqloutput:' + uri), true);

        let doc = <vscode.TextDocument> {
            uri : {
                toString(skipEncoding?: boolean): string {
                    return uri;
                }
            },
            languageId : 'sql'
        };
        contentProvider.onDidCloseTextDocument(doc);

        // This URI should now be flagged for deletion later on
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:' + uri).flaggedForDeletion, true);

        done();
    });

    test('isRunningQuery should return the correct state for the query', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let notRunUri = 'Test_URI_New';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.has('tsqloutput:Test_URI'), true);

        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was replaced by the new one and that there is only one in the map
        assert.equal(contentProvider.isRunningQuery('tsqloutput:' + uri), true);
        assert.equal(contentProvider.isRunningQuery('tsqloutput:' + notRunUri), false);
        assert.equal(contentProvider.getResultsMap.size, 1);

        done();
    });

    test('cancelQuery should cancel the execution of a query by result pane URI', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let resultUri = 'tsqloutput:Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);
        contentProvider.cancelQuery(resultUri);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.has(resultUri), true);

        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(contentProvider.isRunningQuery(resultUri), true);
        statusView.verify(x => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(contentProvider.getResultsMap.size, 1);

        done();
    });

    test('cancelQuery should cancel the execution of a query by SQL pane URI', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);
        contentProvider.cancelQuery(uri);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap.has('tsqloutput:Test_URI'), true);

        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(contentProvider.isRunningQuery('tsqloutput:' + uri), true);
        statusView.verify(x => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(contentProvider.getResultsMap.size, 1);

        done();
    });

    test('getQueryRunner should return the appropriate query runner', done => {
        let title = 'Test_Title';
        let uri = 'Test_URI';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Get properties of contentProvider before we run a query
        vscodeWrapper.setup(x => x.textDocuments).returns( () => []);

        // Setup the function to call base and run it
        contentProvider.displayResultPane = function(var1: string, var2: string): void { return; };
        contentProvider.runQuery(statusView.object, uri, querySelection, title);
        let testedRunner = contentProvider.getQueryRunner(uri);

        // Ensure that the runner returned is the one inteneded
        assert.equal(contentProvider.getResultsMap.get('tsqloutput:Test_URI').queryRunner, testedRunner);

        done();
    });
});
