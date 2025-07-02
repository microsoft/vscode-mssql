/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlOutputContentProvider } from "../../src/extension/models/sqlOutputContentProvider";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import StatusView from "../../src/oldViews/statusView";
import * as stubs from "./stubs";
import * as Constants from "../../src/extension/constants/constants";
import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as assert from "assert";
import { ISelectionData } from "../../src/extension/models/interfaces";

suite("SqlOutputProvider Tests using mocks", () => {
    const testUri = "Test_URI";

    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let contentProvider: SqlOutputContentProvider;
    let mockContentProvider: TypeMoq.IMock<SqlOutputContentProvider>;
    let context: TypeMoq.IMock<vscode.ExtensionContext> = stubs.TestExtensionContext;
    let statusView: TypeMoq.IMock<StatusView>;
    let mockMap: Map<string, any> = new Map<string, any>();
    let setSplitPaneSelectionConfig: (value: string) => void;
    let setCurrentEditorColumn: (column: number) => void;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        statusView = TypeMoq.Mock.ofType(StatusView);
        statusView.setup((x) => x.cancelingQuery(TypeMoq.It.isAny()));
        statusView.setup((x) => x.executedQuery(TypeMoq.It.isAny()));
        context.setup((c) => c.extensionPath).returns(() => "test_uri");
        contentProvider = new SqlOutputContentProvider(
            context.object,
            statusView.object,
            vscodeWrapper.object,
        );
        contentProvider.setVscodeWrapper = vscodeWrapper.object;
        setSplitPaneSelectionConfig = function (value: string): void {
            let configResult: { [key: string]: any } = {};
            configResult[Constants.configSplitPaneSelection] = value;
            let config = stubs.createWorkspaceConfiguration(configResult);
            vscodeWrapper
                .setup((x) => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((x) => {
                    return config;
                });
        };
        setCurrentEditorColumn = function (column: number): void {
            let editor = stubs.TestTextEditor;
            editor.setup((e) => e.viewColumn).returns(() => column);
            vscodeWrapper.setup((x) => x.activeTextEditor).returns(() => editor.object);
        };
        mockContentProvider = TypeMoq.Mock.ofType(
            SqlOutputContentProvider,
            TypeMoq.MockBehavior.Loose,
        );
        mockContentProvider.setup((p) => p.getResultsMap).returns(() => mockMap);
        mockContentProvider
            .setup((p) =>
                p.runQuery(
                    TypeMoq.It.isAny(),
                    testUri,
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => {
                mockMap.set(testUri, {
                    queryRunner: {
                        isExecutingQuery: true,
                    },
                });
                mockContentProvider.setup((p) => p.isRunningQuery(testUri)).returns(() => true);
                return Promise.resolve();
            });
        mockContentProvider
            .setup((p) =>
                p.runQuery(
                    TypeMoq.It.isAny(),
                    "Test_URI2",
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAnyString(),
                ),
            )
            .returns(() => {
                mockMap.set("Test_URI2", {
                    queryRunner: {
                        isExecutingQuery: true,
                    },
                });
                return Promise.resolve();
            });
        mockContentProvider
            .setup((p) => p.onUntitledFileSaved(testUri, "Test_URI_New"))
            .returns(() => {
                mockMap.delete(testUri);
                mockMap.set("Test_URI_New", {
                    queryRunner: {
                        isExecutingQuery: true,
                    },
                });
                return Promise.resolve();
            });
        mockContentProvider
            .setup((p) => p.onDidCloseTextDocument(TypeMoq.It.isAny()))
            .returns(() => {
                mockMap.set(testUri, {
                    flaggedForDeletion: true,
                });
                return Promise.resolve();
            });
        mockContentProvider
            .setup((p) => p.isRunningQuery(testUri))
            .returns(() => {
                if (mockMap.has(testUri)) {
                    return mockMap.get(testUri).queryRunner.isExecutingQuery;
                } else {
                    return false;
                }
            });
        mockContentProvider.setup((p) => p.isRunningQuery("Test_URI_New")).returns(() => false);
        mockContentProvider
            .setup((p) => p.cancelQuery(testUri))
            .returns(() => {
                statusView.object.cancelingQuery(testUri);
                return Promise.resolve();
            });
        mockContentProvider
            .setup((p) => p.getQueryRunner(testUri))
            .returns(() => {
                return mockMap.get(testUri);
            });
    });

    test("Correctly outputs the new result pane view column", (done) => {
        class Case {
            position: number;
            config: string;
            expectedColumn: number;
        }

        // All the possible cases for a new results pane
        let cases: Case[] = [
            { position: 1, config: "next", expectedColumn: 2 },
            { position: 2, config: "next", expectedColumn: 3 },
            { position: 3, config: "next", expectedColumn: 3 },
            { position: 1, config: "current", expectedColumn: 1 },
            { position: 2, config: "current", expectedColumn: 2 },
            { position: 3, config: "current", expectedColumn: 3 },
            { position: 1, config: "end", expectedColumn: 3 },
            { position: 2, config: "end", expectedColumn: 3 },
            { position: 3, config: "end", expectedColumn: 3 },
        ];

        // Iterate through each case
        try {
            cases.forEach((c: Case) => {
                setSplitPaneSelectionConfig(c.config);
                setCurrentEditorColumn(c.position);

                let resultColumn = contentProvider.newResultPaneViewColumn("test_uri");

                // Ensure each case properly outputs the result pane
                assert.equal(resultColumn, c.expectedColumn);
            });

            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test("RunQuery properly sets up two queries to be run", (done) => {
        // Run function with properties declared below
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Run function with properties declared below
        let title2 = "Test_Title2";
        let uri2 = "Test_URI2";
        void mockContentProvider.object.runQuery(statusView.object, uri2, querySelection, title2);

        // Ensure both uris are executing
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.get(uri2).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.size, 2);
        mockMap.clear();
        done();
    });

    test("RunQuery only sets up one uri with the same name", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occurred as intended
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        assert.equal(mockMap.get(uri).queryRunner.isExecutingQuery, true);
        assert.equal(mockMap.size, 1);
        mockMap.clear();
        done();
    });

    test("onUntitledFileSaved should delete the untitled file and create a new titled file", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let newUri = "Test_URI_New";
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

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

    test("onDidCloseTextDocument properly mark the uri for deletion", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(uri), true);

        let doc = <vscode.TextDocument>{
            uri: {
                toString(skipEncoding?: boolean): string {
                    return uri;
                },
            },
            languageId: "sql",
        };
        mockContentProvider.object.onDidCloseTextDocument(doc);

        // This URI should now be flagged for deletion later on
        console.log(mockMap.get(uri));
        assert.equal(mockMap.get(uri).flaggedForDeletion, true);
        mockMap.clear();
        done();
    });

    test("isRunningQuery should return the correct state for the query", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let notRunUri = "Test_URI_New";
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(testUri), true);

        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was replaced by the new one and that there is only one in the map
        assert.equal(mockContentProvider.object.isRunningQuery(uri), true);
        assert.equal(mockContentProvider.object.isRunningQuery(notRunUri), false);
        assert.equal(mockMap.size, 1);
        mockMap.clear();
        done();
    });

    test("cancelQuery should cancel the execution of a query by result pane URI", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let resultUri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        mockContentProvider.object.cancelQuery(resultUri);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(resultUri), true);

        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(mockContentProvider.object.isRunningQuery(resultUri), true);
        statusView.verify((x) => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(mockMap.size, 1);

        done();
    });

    test("cancelQuery should cancel the execution of a query by SQL pane URI", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        mockContentProvider.object.cancelQuery(uri);

        // Ensure all side effects occured as intended
        assert.equal(mockMap.has(testUri), true);

        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);

        // Check that the first one was ran and that a canceling dialogue was opened
        assert.equal(mockContentProvider.object.isRunningQuery(uri), true);
        statusView.verify((x) => x.cancelingQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
        assert.equal(mockMap.size, 1);

        done();
    });

    test("getQueryRunner should return the appropriate query runner", (done) => {
        let title = "Test_Title";
        let uri = testUri;
        let querySelection: ISelectionData = {
            endColumn: 0,
            endLine: 0,
            startColumn: 0,
            startLine: 0,
        };

        // Setup the function to call base and run it
        void mockContentProvider.object.runQuery(statusView.object, uri, querySelection, title);
        let testedRunner = mockContentProvider.object.getQueryRunner(uri);

        // Ensure that the runner returned is the one inteneded
        assert.equal(mockMap.get(testUri), testedRunner);

        done();
    });

    test("cancelQuery with no query running should show information message about it", () => {
        vscodeWrapper
            .setup((v) => v.showInformationMessage(TypeMoq.It.isAnyString()))
            .returns(() => Promise.resolve("error"));
        contentProvider.cancelQuery("test_input");
        vscodeWrapper.verify(
            (v) => v.showInformationMessage(TypeMoq.It.isAnyString()),
            TypeMoq.Times.once(),
        );
    });

    test("getQueryRunner should return undefined for new URI", () => {
        let queryRunner = contentProvider.getQueryRunner("test_uri");
        assert.equal(queryRunner, undefined);
    });

    test("toggleSqlCmd should do nothing if no queryRunner exists", async () => {
        let result = await contentProvider.toggleSqlCmd("test_uri");
        assert.equal(result, false);
    });

    test("Test queryResultsMap getters and setters", () => {
        let queryResultsMap = contentProvider.getResultsMap;
        // Query Results Map should be empty
        assert.equal(queryResultsMap.size, 0);
        let newQueryResultsMap = new Map();
        newQueryResultsMap.set("test_uri", { queryRunner: {} });
        contentProvider.setResultsMap = newQueryResultsMap;
        assert.notEqual(contentProvider.getQueryRunner("test_uri"), undefined);
    });

    test("showErrorRequestHandler should call vscodeWrapper to show error message", () => {
        contentProvider.showErrorRequestHandler("test_error");
        vscodeWrapper.verify((v) => v.showErrorMessage("test_error"), TypeMoq.Times.once());
    });

    test("showWarningRequestHandler should call vscodeWrapper to show warning message", () => {
        contentProvider.showWarningRequestHandler("test_warning");
        vscodeWrapper.verify((v) => v.showWarningMessage("test_warning"), TypeMoq.Times.once());
    });

    test("A query runner should only exist if a query is run", async () => {
        vscodeWrapper
            .setup((v) => v.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                let configResult: { [key: string]: any } = {};
                configResult[Constants.configPersistQueryResultTabs] = false;
                configResult[Constants.configUseLegacyQueryResultExperience] = true;
                let config = stubs.createWorkspaceConfiguration(configResult);
                return config;
            });
        let testQueryRunner = contentProvider.getQueryRunner("test_uri");
        assert.equal(testQueryRunner, undefined);
        await contentProvider.runQuery(statusView.object, "test_uri", undefined, "test_title");
        testQueryRunner = contentProvider.getQueryRunner("test_uri");
        assert.notEqual(testQueryRunner, undefined);
    });
});
