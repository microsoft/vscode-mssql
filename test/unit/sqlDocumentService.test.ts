/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import StatusView from "../../src/views/statusView";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";

chai.use(sinonChai);

suite("SqlDocumentService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let sqlDocumentService: SqlDocumentService;
    let docUri: string;
    let newDocUri: string;
    let docUriCallback: string;

    setup(async () => {
        sandbox = sinon.createSandbox();
        // Setup a standard document and a new document
        docUri = "docURI.sql";
        newDocUri = "newDocURI.sql";

        document = mockTextDocument(docUri);
        newDocument = mockTextDocument(newDocUri);

        // Resetting call back variables
        docUriCallback = "";

        // Create a mock context
        let mockContext = {
            globalState: {
                get: sandbox.stub().callsFake((_key: string, defaultValue?: any) => defaultValue),
                update: sandbox.stub().resolves(),
                setKeysForSync: sandbox.stub(),
            },
        } as any;

        // Create stubbed connection manager
        connectionManager = sinon.createStubInstance(ConnectionManager);

        // Create main controller
        mainController = new MainController(mockContext);
        mainController.connectionManager = connectionManager;

        sqlDocumentService = new SqlDocumentService(mainController);
        mainController.sqlDocumentService = sqlDocumentService;

        // Initialize internal state properly
        sqlDocumentService["_previousActiveDocument"] = undefined;
        // Ensure the connection manager is properly set in the service
        sqlDocumentService["_connectionManager"] = connectionManager;

        // Stub SqlOutputContentProvider methods used during tests to avoid side effects
        mainController["_outputContentProvider"] = {
            onDidCloseTextDocument: sandbox.stub().resolves(),
            updateQueryRunnerUri: sandbox.stub().resolves(),
            onUntitledFileSaved: sandbox.stub(),
        } as any;

        // Mock SqlToolsServerClient instance
        const mockDiagnosticCollection = {
            has: sandbox.stub().returns(false),
            delete: sandbox.stub(),
        };
        sandbox.stub(SqlToolsServerClient, "instance").value({
            diagnosticCollection: mockDiagnosticCollection,
        });

        setupConnectionManagerMocks(connectionManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    // Standard closed document event test
    test("onDidCloseTextDocument should propagate onDidCloseTextDocument to connectionManager", async () => {
        // Reset internal timers to ensure clean test state - this ensures we hit the normal close path
        sqlDocumentService["_lastSavedUri"] = undefined;
        sqlDocumentService["_lastSavedTimer"] = undefined;
        sqlDocumentService["_lastOpenedTimer"] = undefined;
        sqlDocumentService["_lastOpenedUri"] = undefined;

        await sqlDocumentService.onDidCloseTextDocument(document);

        expect(connectionManager.onDidCloseTextDocument).to.have.been.calledOnceWithExactly(
            document,
        );
        expect(docUriCallback).to.equal(document.uri.toString());
        docUriCallback = "";
    });

    // Saved Untitled file event test
    test("onDidCloseTextDocument should call untitledDoc function when an untitled file is saved", async () => {
        // Scheme of older doc must be untitled
        let document2 = {
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId: "sql",
        } as vscode.TextDocument;

        // Mock the updateUri method which is called for untitled saves
        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri");
        mockUpdateUri.resolves();

        // A save untitled doc constitutes a saveDoc event directly followed by a closeDoc event
        sqlDocumentService.onDidSaveTextDocument(newDocument);
        await sqlDocumentService.onDidCloseTextDocument(document2);

        // Check that updateUri was called (which is the path for untitled saves)
        expect(mockUpdateUri).to.have.been.calledOnce;

        mockUpdateUri.restore();
    });

    // Renamed file event test
    test("onDidCloseTextDocument should call renamedDoc function when rename occurs", async () => {
        // Mock the updateUri method which is called for renames
        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri");
        mockUpdateUri.resolves();

        // Set up a timer that looks like it was just started (simulating a rename scenario)
        const mockTimer = {
            getDuration: sandbox.stub().returns(Constants.renamedOpenTimeThreshold - 5), // Less than threshold
            end: sandbox.stub(),
        };

        // Simulate the rename sequence: open document, then close old document quickly
        sqlDocumentService.onDidSaveTextDocument(newDocument); // This sets _lastSavedTimer
        sqlDocumentService["_lastSavedTimer"] = mockTimer as any;
        sqlDocumentService["_lastOpenedUri"] = newDocument.uri.toString();

        await sqlDocumentService.onDidCloseTextDocument(document);

        // Check that updateUri was called (which is the path for renames)
        expect(mockUpdateUri).to.have.been.calledOnce;

        mockUpdateUri.restore();
    });

    // Closed document event called to test rename and untitled save file event timeouts
    test("onDidCloseTextDocument should propagate to the connectionManager even if a special event occurred before it", (done) => {
        // Set up expired timers that would have been reset
        const expiredTimer = {
            getDuration: sandbox.stub().returns(Constants.untitledSaveTimeThreshold + 10), // Expired
            end: sandbox.stub(),
        };

        // Set up conditions that would normally trigger special behavior but are now expired
        sqlDocumentService["_lastSavedUri"] = newDocument.uri.toString();
        sqlDocumentService["_lastSavedTimer"] = expiredTimer as any;
        sqlDocumentService["_lastOpenedUri"] = newDocument.uri.toString();
        sqlDocumentService["_lastOpenedTimer"] = expiredTimer as any;

        // This should now follow the normal close path since timers are expired
        sqlDocumentService
            .onDidCloseTextDocument(document)
            .then(() => {
                try {
                    // Should have called the normal close path
                    expect(
                        connectionManager.onDidCloseTextDocument,
                    ).to.have.been.calledOnceWithExactly(document);
                    expect(docUriCallback).to.equal(document.uri.toString());
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

        expect(connectionManager.onDidOpenTextDocument).to.have.been.calledOnceWithExactly(
            document,
        );
        expect(docUriCallback).to.equal(document.uri.toString());
    });

    // Save document event test
    test("onDidSaveTextDocument should propagate the function to the connectionManager", () => {
        // Call onDidSaveTextDocument to test its side effects
        sqlDocumentService.onDidSaveTextDocument(newDocument);

        // Ensure no extraneous function is called (save doesn't directly call connection manager)
        expect(connectionManager.onDidOpenTextDocument).to.not.have.been.called;
        expect(connectionManager.copyConnectionToFile).to.not.have.been.called;

        // Check that internal state was set correctly (uses getUriKey internally)
        expect(sqlDocumentService["_lastSavedUri"]).to.equal(newDocument.uri.toString());
        expect(sqlDocumentService["_lastSavedTimer"]).to.be.ok;
    });

    test("newQuery should call the new query method", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;

        const mockCreateDocument = sandbox.stub(sqlDocumentService as any, "createDocument");
        mockCreateDocument.withArgs(undefined, true).resolves(editor);

        const result = await sqlDocumentService.newQuery(undefined, true);

        expect(result).to.equal(editor);
        expect(mockCreateDocument).to.have.been.calledOnceWithExactly(undefined, true);

        mockCreateDocument.restore();
    });

    test("connection is transferred when opening a new file and the previous active file is connected", async () => {
        const script1 = mockTextDocument("script_1.sql");
        const script2 = mockTextDocument("script_2.sql");
        const textFile = mockTextDocument("text_file.txt", "plaintext");

        const editor: vscode.TextEditor = {
            document: script1,
        } as unknown as vscode.TextEditor;

        const mockWaitForOngoingCreates = sandbox.stub(sqlDocumentService, "waitForOngoingCreates");
        mockWaitForOngoingCreates.resolves([]);

        const mockShouldSkipCopyConnection = sandbox.stub(
            sqlDocumentService,
            "shouldSkipCopyConnection",
        );
        mockShouldSkipCopyConnection.returns(false);

        const mockStatusView = sandbox.createStubInstance(StatusView);
        sqlDocumentService["_statusview"] = mockStatusView;
        setupConnectionManagerMocks(connectionManager);

        // verify initial state
        expect(
            sqlDocumentService["_previousActiveDocument"],
            "previous active document should be initially unset",
        ).to.equal(undefined);

        // simulate opening a SQL file
        await sqlDocumentService.onDidChangeActiveTextEditor(editor);

        expect(
            sqlDocumentService["_previousActiveDocument"],
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(editor.document);
        expect(connectionManager.copyConnectionToFile).to.not.have.been.called;

        // verify that the connection manager transfers the connection from SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script2);

        expect(
            sqlDocumentService["_previousActiveDocument"],
            "previous active document should be changed to new script when opening a SQL file",
        ).to.deep.equal(script2);
        expect(connectionManager.copyConnectionToFile).to.have.been.calledOnceWithExactly(
            script1.uri.toString(true),
            script2.uri.toString(true),
            true,
        );

        connectionManager.copyConnectionToFile.resetHistory();

        // verify that the connection manager does not transfer the connection from SQL file to non-SQL file
        await sqlDocumentService.onDidOpenTextDocument(textFile);

        expect(
            sqlDocumentService["_previousActiveDocument"],
            "previous active document should be undefined after opening a non-SQL file",
        ).to.deep.equal(undefined);
        expect(connectionManager.copyConnectionToFile).to.not.have.been.called;

        // verify that the connection manager does not transfer the connection from non-SQL file to SQL file
        await sqlDocumentService.onDidOpenTextDocument(script1);

        expect(
            sqlDocumentService["_previousActiveDocument"],
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(script1);
        expect(connectionManager.copyConnectionToFile).to.not.have.been.called;

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

        connectionManager.copyConnectionToFile.callsFake(async (doc, _newDoc) => {
            docUriCallback = doc;
        });
    }
    function mockTextDocument(
        docUri: string,
        languageId: string = Constants.languageId,
    ): vscode.TextDocument {
        const document = {
            uri: vscode.Uri.parse(docUri),
            languageId: languageId,
        } as vscode.TextDocument;

        return document;
    }
});
