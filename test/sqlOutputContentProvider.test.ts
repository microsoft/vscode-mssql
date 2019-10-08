/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

'use strict';

import { SqlOutputContentProvider, QueryRunnerState } from '../src/models/sqlOutputContentProvider';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import StatusView from '../src/views/statusView';
import * as stubs from './stubs';
import Constants = require('../src/constants/constants');
import vscode = require('vscode');
import * as TypeMoq from 'typemoq';
import assert = require('assert');
import { ISelectionData } from '../src/models/interfaces';
import { resolve } from 'url';


suite('SqlOutputProvider Tests', () => {
    const testUri = 'Test_URI';

    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let mockContentProvider: TypeMoq.IMock<SqlOutputContentProvider>;
    let context: TypeMoq.IMock<vscode.ExtensionContext>;
    let statusView: TypeMoq.IMock<StatusView>;
    let mockMap: Map<string, any> = new Map<string, any>();
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
        mockContentProvider = TypeMoq.Mock.ofType(SqlOutputContentProvider, TypeMoq.MockBehavior.Loose);
        mockContentProvider.setup(p => p.getResultsMap).returns(() => mockMap);
        mockContentProvider.setup(p => p.runQuery(TypeMoq.It.isAny(), testUri, TypeMoq.It.isAny(), TypeMoq.It.isAnyString())).returns(() => {
            mockMap.set(testUri, {
                queryRunner: {
                    isExecutingQuery: true
                }
            });
            mockContentProvider.setup(p => p.isRunningQuery(testUri)).returns(() => true);
            return Promise.resolve();
        });
        mockContentProvider.setup(p => p.runQuery(TypeMoq.It.isAny(), 'Test_URI2', TypeMoq.It.isAny(), TypeMoq.It.isAnyString())).returns(() => {
            mockMap.set('Test_URI2', {
                queryRunner: {
                    isExecutingQuery: true
                }
            });
            return Promise.resolve();
        });
        mockContentProvider.setup(p => p.onUntitledFileSaved(testUri, 'Test_URI_New')).returns(() => {
            mockMap.delete(testUri);
            mockMap.set('Test_URI_New', {
                queryRunner: {
                    isExecutingQuery: true
                }
            });
            return Promise.resolve();
        });
        mockContentProvider.setup(p => p.onDidCloseTextDocument(TypeMoq.It.isAny())).returns(() => {
            mockMap.set(testUri, {
                flaggedForDeletion: true
            });
            return Promise.resolve();
        });
        mockContentProvider.setup(p => p.isRunningQuery(testUri)).returns(() => {
            if (mockMap.has(testUri)) {
                return mockMap.get(testUri).queryRunner.isExecutingQuery;
            } else {
                return false;
            }
        });
        mockContentProvider.setup(p => p.isRunningQuery('Test_URI_New')).returns(() => false);
        mockContentProvider.setup(p => p.cancelQuery(testUri)).returns(() => {
            statusView.object.cancelingQuery(testUri);
        });
        mockContentProvider.setup(p => p.getQueryRunner(testUri)).returns(() => {
            return mockMap.get(testUri);
        });
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
        // Run function with properties declared below
        let title = 'Test_Title';
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Run function with properties declared below
        let title2 = 'Test_Title2';
        let uri2 = 'Test_URI2';
        mockContentProvider.object.runQuery(statusView.object, uri2, querySelection, title2);

        // Ensure both uris are executing
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.get(uri2).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.size, 2);
        mockMap.clear();
        done();
    });

    test('RunQuery only sets up one uri with the same name', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.size, 1);
        mockMap.clear();
        done();
    });

    test('onUntitledFileSaved should delete the untitled file and create a new titled file', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let newUri = 'Test_URI_New';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(testUri), true);

        mockContentProvider.object.onUntitledFileSaved(uri, newUri);

        // Check that the first one was replaced by the new one and that there is only one in the map
        assert.equal(mockMap.has(uri), false);
        assert.equal(mockMap.get(newUri).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.size, 1);
        mockMap.clear();
        done();
    });

    test('onDidCloseTextDocument properly mark the uri for deletion', (done) => {
        let title = 'Test_Title';
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(uri), true);

        let doc = <vscode.TextDocument> {
            uri : {
                toString(skipEncoding?: boolean): string {
                    return uri;
                }
            },
            languageId : 'sql'
        };
        mockContentProvider.object.onDidCloseTextDocument(doc);

        // This URI should now be flagged for deletion later on
        console.log(mockMap.get(uri));
        assert.equal(mockMap.get(uri).flaggedForDeletion, true);
        mockMap.clear();
        done();
    });

    test('isRunningQuery should return the correct state for the query', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let notRunUri = 'Test_URI_New';
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(testUri), true);

        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was replaced by the new one and that there is only one in the map
        assert.equal(mockContentProvider.object.isRunningQuery(uri), true);
        assert.equal(mockContentProvider.object.isRunningQuery(notRunUri), false);
        assert.equal(mockMap.size, 1);
        mockMap.clear();
        done();
    });

    test('cancelQuery should cancel the execution of a query by result pane URI', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let resultUri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        mockContentProvider.object.cancelQuery(resultUri);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(resultUri), true);

        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(mockContentProvider.object.isRunningQuery(resultUri), true);
        statusView.verify(x => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(mockMap.size, 1);

        done();
    });

    test('cancelQuery should cancel the execution of a query by SQL pane URI', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        mockContentProvider.object.cancelQuery(uri);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(testUri), true);

        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(mockContentProvider.object.isRunningQuery(uri), true);
        statusView.verify(x => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(mockMap.size, 1);

        done();
    });

    test('getQueryRunner should return the appropriate query runner', done => {
        let title = 'Test_Title';
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0
        };

        // Setup the function to call base and run it
        mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        let testedRunner = mockContentProvider.object.getQueryRunner(uri);

        // Ensure that the runner returned is the one inteneded
        assert.equal(mockMap.get(testUri), testedRunner);

        done();
    });
});
