/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { expect } from "chai";
import * as Extension from "../../src/extension";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { activateExtension } from "./utils";
import StatusView from "../../src/views/statusView";

interface IFixture {
    openDocResult: Promise<vscode.TextDocument>;
    showDocResult: Promise<vscode.TextEditor>;
    vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    service: SqlDocumentService;
    textDocuments: vscode.TextDocument[];
}

suite("SqlDocumentService Tests", () => {
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let sqlDocumentService: SqlDocumentService;
    let docUri: string;
    let newDocUri: string;
    let docUriCallback: string;
    let newDocUriCallback: string;

    setup(async () => {
        // Need to activate the extension to get the mainController
        await activateExtension();

        // Setup a standard document and a new document
        docUri = "docURI.sql";
        newDocUri = "newDocURI.sql";

        document = mockTextDocument(docUri);
        newDocument = mockTextDocument(newDocUri);

        // Resetting call back variables
        docUriCallback = "";
        newDocUriCallback = "";
        // Using the mainController that was instantiated with the extension
        mainController = await Extension.getController();

        // Setting up a mocked connectionManager
        let mockContext: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        let mockGlobalState = {
            get: (_key: string, defaultValue?: any) => defaultValue,
            update: (_key: string, _value: any) => Promise.resolve(),
            setKeysForSync: (_keys: readonly string[]) => {},
        };
        mockContext.setup((x) => x.globalState).returns(() => mockGlobalState as any);
        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );
        mainController.connectionManager = connectionManager.object;

        sqlDocumentService = mainController.sqlDocumentService;

        // Initialize internal state properly
        (sqlDocumentService as any)._previousActiveDocument = undefined;

        // Stub SqlOutputContentProvider methods used during tests to avoid side effects
        (mainController as any)["_outputContentProvider"] = {
            onDidCloseTextDocument: async () => Promise.resolve(),
            updateQueryRunnerUri: async () => Promise.resolve(),
            onUntitledFileSaved: () => undefined,
        } as any;

        setupConnectionManagerMocks(connectionManager);
    });

    // Standard closed document event test
    test("onDidCloseTextDocument should propagate onDidCloseTextDocument to connectionManager", async () => {
        // Reset internal timers to ensure clean test state
        (sqlDocumentService as any)._lastSavedUri = undefined;
        (sqlDocumentService as any)._lastSavedTimer = undefined;
        (sqlDocumentService as any)._lastOpenedTimer = undefined;
        (sqlDocumentService as any)._lastOpenedUri = undefined;

        await sqlDocumentService.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(
                (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            assert.equal(docUriCallback, document.uri.toString());
            docUriCallback = "";
        } catch (err) {
            throw err;
        }
    });

    // Saved Untitled file event test
    test("onDidCloseTextDocument should call untitledDoc function when an untitled file is saved", async () => {
        // Scheme of older doc must be untitled
        let document2 = <vscode.TextDocument>{
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId: "sql",
        };

        // A save untitled doc constitutes a saveDoc event directly followed by a closeDoc event
        sqlDocumentService.onDidSaveTextDocument(newDocument);
        await sqlDocumentService.onDidCloseTextDocument(document2);
        connectionManager.verify(
            (x) => x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
        assert.equal(docUriCallback, document2.uri.toString());
        assert.equal(newDocUriCallback, newDocument.uri.toString());
    });

    // Renamed file event test
    test("onDidCloseTextDocument should call renamedDoc function when rename occurs", async () => {
        // Seed state so the copy branch can run
        (document as any).languageId = Constants.languageId;
        (newDocument as any).languageId = Constants.languageId;
        (sqlDocumentService as any)._previousActiveDocument = document;

        const mockWaitForOngoingCreates = TypeMoq.Mock.ofInstance(
            sqlDocumentService.waitForOngoingCreates.bind(sqlDocumentService),
        );
        mockWaitForOngoingCreates.setup((x) => x()).returns(() => Promise.resolve([]));
        (sqlDocumentService as any).waitForOngoingCreates = mockWaitForOngoingCreates.object;

        const mockShouldSkipCopyConnection = TypeMoq.Mock.ofInstance(
            sqlDocumentService.shouldSkipCopyConnection.bind(sqlDocumentService),
        );
        mockShouldSkipCopyConnection.setup((x) => x(TypeMoq.It.isAnyString())).returns(() => false);
        (sqlDocumentService as any).shouldSkipCopyConnection = mockShouldSkipCopyConnection.object;

        // A renamed doc constitutes an openDoc event directly followed by a closeDoc event
        await sqlDocumentService.onDidOpenTextDocument(newDocument);
        await sqlDocumentService.onDidCloseTextDocument(document);

        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.atLeastOnce(),
        );
        assert.equal(docUriCallback, document.uri.toString());
        assert.equal(newDocUriCallback, newDocument.uri.toString());
    });

    // Closed document event called to test rename and untitled save file event timeouts
    test("onDidCloseTextDocument should propagate to the connectionManager even if a special event occurred before it", (done) => {
        // Call both special cases
        sqlDocumentService.onDidSaveTextDocument(newDocument);
        void sqlDocumentService.onDidOpenTextDocument(newDocument);

        // Cause event time out (above 10 ms should work)
        setTimeout(async () => {
            await sqlDocumentService.onDidCloseTextDocument(document);

            try {
                connectionManager.verify(
                    (x) =>
                        x.copyConnectionToFile(
                            // ignore changes to settings.json because MainController setup adds missing mssql connection settings
                            TypeMoq.It.is((x) => !x.endsWith("settings.json")),
                            TypeMoq.It.is((x) => !x.endsWith("settings.json")),
                        ),
                    TypeMoq.Times.never(),
                );
                connectionManager.verify(
                    (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
                    TypeMoq.Times.once(),
                );
                assert.equal(docUriCallback, document.uri.toString());
                done();
            } catch (err) {
                done(new Error(err));
            }
            // Timeout set to the max threshold + 1
        }, Constants.untitledSaveTimeThreshold + 1);
    });

    // Open document event test
    test("onDidOpenTextDocument should propagate the function to the connectionManager", (done) => {
        // Call onDidOpenTextDocument to test its side effects
        void sqlDocumentService.onDidOpenTextDocument(document);
        try {
            connectionManager.verify(
                (x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            assert.equal(docUriCallback, document.uri.toString());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    // Save document event test
    test("onDidSaveTextDocument should propagate the function to the connectionManager", (done) => {
        // Call onDidSaveTextDocument to test its side effects
        sqlDocumentService.onDidSaveTextDocument(newDocument);
        try {
            // Ensure no extraneous function is called
            connectionManager.verify(
                (x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()),
                TypeMoq.Times.never(),
            );
            connectionManager.verify(
                (x) => x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.never(),
            );
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    test("newQuery should call the new query method", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;

        const mockCreateDocument = TypeMoq.Mock.ofInstance(
            (sqlDocumentService as any).createDocument.bind(sqlDocumentService),
        );
        mockCreateDocument.setup((x) => x(undefined, true)).returns(() => Promise.resolve(editor));
        (sqlDocumentService as any).createDocument = mockCreateDocument.object;

        const result = await sqlDocumentService.newQuery(undefined, true);

        assert.equal(result, editor);
        mockCreateDocument.verify((x) => x(undefined, true), TypeMoq.Times.once());
    });

    test("newQuery should handle failures gracefully", async () => {
        const mockCreateDocument = TypeMoq.Mock.ofInstance(
            (sqlDocumentService as any).createDocument.bind(sqlDocumentService),
        );
        mockCreateDocument
            .setup((x) => x(TypeMoq.It.isAny(), TypeMoq.It.isValue(true)))
            .returns(() => Promise.reject(new Error("boom")));
        (sqlDocumentService as any).createDocument = mockCreateDocument.object;

        await assert.rejects(() => sqlDocumentService.newQuery(undefined, true), /boom/);

        mockCreateDocument.verify(
            (x) => x(TypeMoq.It.isAny(), TypeMoq.It.isValue(true)),
            TypeMoq.Times.once(),
        );
    });

    test("connection is transferred when opening a new file and the previous active file is connected", async () => {
        const script1 = mockTextDocument("script_1.sql");
        const script2 = mockTextDocument("script_2.sql");
        const textFile = mockTextDocument("text_file.txt", "plaintext");

        const editor: vscode.TextEditor = {
            document: script1,
        } as unknown as vscode.TextEditor;

        const mockWaitForOngoingCreates = TypeMoq.Mock.ofInstance(
            sqlDocumentService.waitForOngoingCreates.bind(sqlDocumentService),
        );
        mockWaitForOngoingCreates.setup((x) => x()).returns(() => Promise.resolve([]));
        (sqlDocumentService as any).waitForOngoingCreates = mockWaitForOngoingCreates.object;

        const mockShouldSkipCopyConnection = TypeMoq.Mock.ofInstance(
            sqlDocumentService.shouldSkipCopyConnection.bind(sqlDocumentService),
        );
        mockShouldSkipCopyConnection.setup((x) => x(TypeMoq.It.isAnyString())).returns(() => false);
        (sqlDocumentService as any).shouldSkipCopyConnection = mockShouldSkipCopyConnection.object;

        const mockStatusView = TypeMoq.Mock.ofType(StatusView);
        mockStatusView.setup((x) =>
            x.languageFlavorChanged(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
        );
        (sqlDocumentService as any)._statusview = mockStatusView.object;
        setupConnectionManagerMocks(connectionManager);

        // verify initial state
        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be initially unset",
        ).to.equal(undefined);

        // simulate opening a SQL file
        await sqlDocumentService.onDidChangeActiveTextEditor(editor);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(editor.document);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );

        // verify that the connection manager transfers the connection from SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script2);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be changed to new script when opening a SQL file",
        ).to.deep.equal(script2);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(
                    script1.uri.toString(true),
                    script2.uri.toString(true),
                    true,
                ),
            TypeMoq.Times.once(),
        );

        connectionManager.reset();
        setupConnectionManagerMocks(connectionManager);

        // verify that the connection manager does not transfer the connection from SQL file to non-SQL file
        await sqlDocumentService.onDidOpenTextDocument(textFile);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be undefined after opening a non-SQL file",
        ).to.deep.equal(undefined);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );

        // verify that the connection manager does not transfer the connection from non-SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script1);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(script1);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
    });

    function setupConnectionManagerMocks(
        connectionManager: TypeMoq.IMock<ConnectionManager>,
    ): void {
        connectionManager
            .setup((x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()))
            .callback((doc) => {
                docUriCallback = doc.uri.toString();
            });

        connectionManager
            .setup((x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()))
            .callback((doc) => {
                docUriCallback = doc.uri.toString();
            });

        connectionManager
            .setup((x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            )
            .callback((doc, newDoc) => {
                docUriCallback = doc;
                newDocUriCallback = newDoc;
            });
    }
    function mockTextDocument(
        docUri: string,
        languageId: string = Constants.languageId,
    ): vscode.TextDocument {
        const document = <vscode.TextDocument>{
            uri: vscode.Uri.parse(docUri),
            languageId: languageId,
        };

        return document;
    }

    function createTextDocumentObject(fileName: string = ""): vscode.TextDocument {
        return {
            uri: undefined,
            eol: undefined,
            fileName: fileName,
            getText: undefined,
            getWordRangeAtPosition: undefined,
            isClosed: undefined,
            isDirty: true,
            isUntitled: true,
            languageId: "sql",
            lineAt: undefined,
            lineCount: undefined,
            offsetAt: undefined,
            positionAt: undefined,
            save: undefined,
            validatePosition: undefined,
            validateRange: undefined,
            version: undefined,
        };
    }

    function createUntitledSqlDocumentService(fixture: IFixture): IFixture {
        let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);

        vscodeWrapper
            .setup((x) => x.textDocuments)
            .returns(() => {
                return fixture.textDocuments;
            });
        vscodeWrapper
            .setup((x) => x.openMsSqlTextDocument())
            .returns(() => {
                return Promise.resolve(createTextDocumentObject());
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(TypeMoq.It.isAny());
            });
        fixture.vscodeWrapper = vscodeWrapper;
        fixture.service = new SqlDocumentService(mainController);
        return fixture;
    }

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("newQuery should open a new untitled document and show in new tab (legacy)", () => {
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve(TypeMoq.It.isAny()),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: [],
        };
        fixture = createUntitledSqlDocumentService(fixture);

        void fixture.service.newQuery().then((_) => {
            fixture.vscodeWrapper.verify((x) => x.openMsSqlTextDocument(), TypeMoq.Times.once());
            fixture.vscodeWrapper.verify(
                (x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });
});
