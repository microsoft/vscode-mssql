/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { expect } from "chai";
import * as Extension from "../../src/extension";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import StatusView from "../../src/views/statusView";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";

interface IFixture {
    openDocResult: Promise<vscode.TextDocument>;
    showDocResult: Promise<vscode.TextEditor>;
    vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    service: SqlDocumentService;
    textDocuments: vscode.TextDocument[];
}

suite("SqlDocumentService Tests", () => {
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let sqlDocumentService: SqlDocumentService;
    let docUri: string;
    let newDocUri: string;
    let docUriCallback: string;
    let newDocUriCallback: string;

    setup(async () => {
        // Setup a standard document and a new document
        docUri = "docURI.sql";
        newDocUri = "newDocURI.sql";

        document = mockTextDocument(docUri);
        newDocument = mockTextDocument(newDocUri);

        // Resetting call back variables
        docUriCallback = "";
        newDocUriCallback = "";

        // Create a mock context
        let mockContext = {
            globalState: {
                get: sinon.stub().callsFake((_key: string, defaultValue?: any) => defaultValue),
                update: sinon.stub().resolves(),
                setKeysForSync: sinon.stub(),
            },
        } as any;

        // Create stubbed connection manager
        connectionManager = sinon.createStubInstance(ConnectionManager);

        // Create main controller
        mainController = new MainController(mockContext);
        mainController.connectionManager = connectionManager as any;

        sqlDocumentService = new SqlDocumentService(mainController);
        mainController.sqlDocumentService = sqlDocumentService;

        // Initialize internal state properly
        (sqlDocumentService as any)._previousActiveDocument = undefined;

        // Ensure the connection manager is properly set in the service
        (sqlDocumentService as any)._connectionMgr = connectionManager;

        // Stub SqlOutputContentProvider methods used during tests to avoid side effects
        (mainController as any)["_outputContentProvider"] = {
            onDidCloseTextDocument: sinon.stub().resolves(),
            updateQueryRunnerUri: sinon.stub().resolves(),
            onUntitledFileSaved: sinon.stub(),
        } as any;

        // Mock SqlToolsServerClient instance
        const mockDiagnosticCollection = {
            has: sinon.stub().returns(false),
            delete: sinon.stub(),
        };
        sinon.stub(SqlToolsServerClient, "instance").value({
            diagnosticCollection: mockDiagnosticCollection,
        });

        setupConnectionManagerMocks(connectionManager);
    });

    teardown(() => {
        sinon.restore();
    });

    // Standard closed document event test
    test("onDidCloseTextDocument should propagate onDidCloseTextDocument to connectionManager", async () => {
        // Reset internal timers to ensure clean test state - this ensures we hit the normal close path
        (sqlDocumentService as any)._lastSavedUri = undefined;
        (sqlDocumentService as any)._lastSavedTimer = undefined;
        (sqlDocumentService as any)._lastOpenedTimer = undefined;
        (sqlDocumentService as any)._lastOpenedUri = undefined;

        await sqlDocumentService.onDidCloseTextDocument(document);

        sinon.assert.calledOnceWithExactly(connectionManager.onDidCloseTextDocument, document);
        assert.equal(docUriCallback, document.uri.toString());
        docUriCallback = "";
    });

    // Saved Untitled file event test
    test("onDidCloseTextDocument should call untitledDoc function when an untitled file is saved", async () => {
        // Scheme of older doc must be untitled
        let document2 = <vscode.TextDocument>{
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId: "sql",
        };

        // Mock the updateUri method which is called for untitled saves
        const mockUpdateUri = sinon.stub(sqlDocumentService as any, "updateUri");
        mockUpdateUri.resolves();

        // A save untitled doc constitutes a saveDoc event directly followed by a closeDoc event
        sqlDocumentService.onDidSaveTextDocument(newDocument);
        await sqlDocumentService.onDidCloseTextDocument(document2);

        // Check that updateUri was called (which is the path for untitled saves)
        sinon.assert.calledOnce(mockUpdateUri);

        mockUpdateUri.restore();
    });

    // Renamed file event test
    test("onDidCloseTextDocument should call renamedDoc function when rename occurs", async () => {
        // Mock the updateUri method which is called for renames
        const mockUpdateUri = sinon.stub(sqlDocumentService as any, "updateUri");
        mockUpdateUri.resolves();

        // Set up a timer that looks like it was just started (simulating a rename scenario)
        const mockTimer = {
            getDuration: sinon.stub().returns(5), // Less than threshold
            end: sinon.stub(),
        };

        // Simulate the rename sequence: open document, then close old document quickly
        sqlDocumentService.onDidSaveTextDocument(newDocument); // This sets _lastSavedTimer
        (sqlDocumentService as any)._lastSavedTimer = mockTimer;
        (sqlDocumentService as any)._lastOpenedUri = newDocument.uri.toString();

        await sqlDocumentService.onDidCloseTextDocument(document);

        // Check that updateUri was called (which is the path for renames)
        sinon.assert.calledOnce(mockUpdateUri);

        mockUpdateUri.restore();
    });

    // Closed document event called to test rename and untitled save file event timeouts
    test("onDidCloseTextDocument should propagate to the connectionManager even if a special event occurred before it", (done) => {
        // Set up expired timers that would have been reset
        const expiredTimer = {
            getDuration: sinon.stub().returns(Constants.untitledSaveTimeThreshold + 10), // Expired
            end: sinon.stub(),
        };

        // Set up conditions that would normally trigger special behavior but are now expired
        (sqlDocumentService as any)._lastSavedUri = newDocument.uri.toString();
        (sqlDocumentService as any)._lastSavedTimer = expiredTimer;
        (sqlDocumentService as any)._lastOpenedUri = newDocument.uri.toString();
        (sqlDocumentService as any)._lastOpenedTimer = expiredTimer;

        // This should now follow the normal close path since timers are expired
        sqlDocumentService
            .onDidCloseTextDocument(document)
            .then(() => {
                try {
                    // Should have called the normal close path
                    sinon.assert.calledOnceWithExactly(
                        connectionManager.onDidCloseTextDocument,
                        document,
                    );
                    assert.equal(docUriCallback, document.uri.toString());
                    done();
                } catch (err) {
                    done(new Error(err));
                }
            })
            .catch(done);
    });

    // Open document event test
    test("onDidOpenTextDocument should propagate the function to the connectionManager", async () => {
        // Call onDidOpenTextDocument to test its side effects
        await sqlDocumentService.onDidOpenTextDocument(document);

        sinon.assert.calledOnceWithExactly(connectionManager.onDidOpenTextDocument, document);
        assert.equal(docUriCallback, document.uri.toString());
    });

    // Save document event test
    test("onDidSaveTextDocument should propagate the function to the connectionManager", () => {
        // Call onDidSaveTextDocument to test its side effects
        sqlDocumentService.onDidSaveTextDocument(newDocument);

        // Ensure no extraneous function is called (save doesn't directly call connection manager)
        sinon.assert.notCalled(connectionManager.onDidOpenTextDocument);
        sinon.assert.notCalled(connectionManager.copyConnectionToFile);

        // Check that internal state was set correctly (uses getUriKey internally)
        assert.equal((sqlDocumentService as any)._lastSavedUri, newDocument.uri.toString());
        assert.ok((sqlDocumentService as any)._lastSavedTimer);
    });

    test("newQuery should call the new query method", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;

        const mockCreateDocument = sinon.stub(sqlDocumentService as any, "createDocument");
        mockCreateDocument.withArgs(undefined, true).resolves(editor);

        const result = await sqlDocumentService.newQuery(undefined, true);

        assert.equal(result, editor);
        sinon.assert.calledOnceWithExactly(mockCreateDocument, undefined, true);

        mockCreateDocument.restore();
    });

    test.skip("newQuery should handle failures gracefully", async () => {
        const mockCreateDocument = sinon.stub(sqlDocumentService as any, "createDocument");
        mockCreateDocument.rejects(new Error("boom"));

        await assert.rejects(() => sqlDocumentService.newQuery(undefined, true), /boom/);

        sinon.assert.calledOnce(mockCreateDocument);

        mockCreateDocument.restore();
    });

    test("connection is transferred when opening a new file and the previous active file is connected", async () => {
        const script1 = mockTextDocument("script_1.sql");
        const script2 = mockTextDocument("script_2.sql");
        const textFile = mockTextDocument("text_file.txt", "plaintext");

        const editor: vscode.TextEditor = {
            document: script1,
        } as unknown as vscode.TextEditor;

        const mockWaitForOngoingCreates = sinon.stub(sqlDocumentService, "waitForOngoingCreates");
        mockWaitForOngoingCreates.resolves([]);

        const mockShouldSkipCopyConnection = sinon.stub(
            sqlDocumentService,
            "shouldSkipCopyConnection",
        );
        mockShouldSkipCopyConnection.returns(false);

        const mockStatusView = sinon.createStubInstance(StatusView);
        (sqlDocumentService as any)._statusview = mockStatusView;
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
        sinon.assert.notCalled(connectionManager.copyConnectionToFile);

        // verify that the connection manager transfers the connection from SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script2);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be changed to new script when opening a SQL file",
        ).to.deep.equal(script2);
        sinon.assert.calledOnceWithExactly(
            connectionManager.copyConnectionToFile,
            script1.uri.toString(true),
            script2.uri.toString(true),
            true,
        );

        connectionManager.copyConnectionToFile.resetHistory();

        // verify that the connection manager does not transfer the connection from SQL file to non-SQL file
        await sqlDocumentService.onDidOpenTextDocument(textFile);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be undefined after opening a non-SQL file",
        ).to.deep.equal(undefined);
        sinon.assert.notCalled(connectionManager.copyConnectionToFile);

        // verify that the connection manager does not transfer the connection from non-SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script1);

        expect(
            (sqlDocumentService as any)._previousActiveDocument,
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(script1);
        sinon.assert.notCalled(connectionManager.copyConnectionToFile);

        // Restore stubs
        mockWaitForOngoingCreates.restore();
        mockShouldSkipCopyConnection.restore();
    });

    function setupConnectionManagerMocks(
        connectionManager: sinon.SinonStubbedInstance<ConnectionManager>,
    ): void {
        connectionManager.onDidOpenTextDocument.callsFake(async (doc) => {
            docUriCallback = doc.uri.toString();
        });

        connectionManager.onDidCloseTextDocument.callsFake(async (doc) => {
            docUriCallback = doc.uri.toString();
        });

        connectionManager.copyConnectionToFile.callsFake(async (doc, newDoc) => {
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
        let vscodeWrapper = sinon.createStubInstance(VscodeWrapper);

        Object.defineProperty(vscodeWrapper, "textDocuments", {
            get: sinon.stub().returns(fixture.textDocuments),
        });

        vscodeWrapper.openMsSqlTextDocument.resolves(createTextDocumentObject());
        vscodeWrapper.showTextDocument.resolves({} as any);

        fixture.vscodeWrapper = vscodeWrapper;
        fixture.service = new SqlDocumentService(mainController);
        return fixture;
    }

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("newQuery should open a new untitled document and show in new tab (legacy)", () => {
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve({} as any),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: [],
        };
        fixture = createUntitledSqlDocumentService(fixture);

        void fixture.service.newQuery().then((_) => {
            sinon.assert.calledOnce(fixture.vscodeWrapper.openMsSqlTextDocument);
            sinon.assert.calledOnceWithExactly(
                fixture.vscodeWrapper.showTextDocument,
                sinon.match.any,
                sinon.match.any,
            );
        });
    });
});
