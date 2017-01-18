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
import { ISelectionData } from '../src/models/interfaces';


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

    test('RunQuery properly sets up a query to be run', done => {
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
        contentProvider.setDisplayResultPane( function(var1: string, var2: string): void { return; } );
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap().has('tsqloutput:' + uri), true);

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
        contentProvider.setDisplayResultPane( function(var1: string, var2: string): void { return; } );
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap().has('tsqloutput:Test_URI'), true);

        contentProvider.onUntitledFileSaved(uri, newUri);

        assert.equal(contentProvider.getResultsMap().has('tsqloutput:' + uri), false);
        assert.equal(contentProvider.getResultsMap().has('tsqloutput:' + newUri), true);

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
        contentProvider.setDisplayResultPane( function(var1: string, var2: string): void { return; } );
        contentProvider.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(contentProvider.getResultsMap().has('tsqloutput:' + uri), true);

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
        assert.equal(contentProvider.getResultsMap().get('tsqloutput:' + uri).flaggedForDeletion, true);

        done();
    });

});
