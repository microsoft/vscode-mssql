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
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { IConnectionInfo } from "vscode-mssql";

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
        (connectionManager as any)["onSuccessfulConnection"] = (
            _listener: (e: any) => any,
        ): vscode.Disposable => ({ dispose: () => {} });

        // Create main controller
        mainController = new MainController(mockContext);
        mainController.connectionManager = connectionManager;
        mainController.createObjectExplorerSession = sandbox.stub().resolves();

        sqlDocumentService = new SqlDocumentService(mainController);
        mainController.sqlDocumentService = sqlDocumentService;

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
        mockCreateDocument.resolves(editor);

        const result = await sqlDocumentService.newQuery({
            connectionStrategy: ConnectionStrategy.CopyLastActive,
        });

        expect(result).to.equal(editor);
        expect(mockCreateDocument).to.have.been.calledOnce;

        mockCreateDocument.restore();
    });

    test("newQuery should copy connection from URI when copyConnectionFromUri is provided", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;

        const mockCreateDocument = sandbox.stub(sqlDocumentService as any, "createDocument");
        mockCreateDocument.resolves(editor);

        const mockConnectionInfo = { server: "localhost", database: "testdb" };
        const mockGetConnectionInfoFromUri = sandbox.stub();
        mockGetConnectionInfoFromUri.returns(mockConnectionInfo);
        const mockConnect = sandbox.stub().callsFake(async (uri, connectionInfo, promise) => {
            if (promise && promise.resolve) {
                promise.resolve(true);
            }
        });

        // Mock the connection manager
        (sqlDocumentService as any)._connectionMgr = {
            getConnectionInfoFromUri: mockGetConnectionInfoFromUri,
            connect: mockConnect,
        };

        const testUri = "file:///test.sql";
        const result = await sqlDocumentService.newQuery({
            sourceUri: testUri,
            connectionStrategy: ConnectionStrategy.CopyFromUri,
            content: "SELECT 1",
        });

        expect(result).to.equal(editor);
        expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 1");
        expect(mockGetConnectionInfoFromUri).to.have.been.calledOnceWith(testUri);

        mockCreateDocument.restore();
    });

    test("newQuery should fallback to copyLastActiveConnection when URI has no connection", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;

        const mockCreateDocument = sandbox.stub(sqlDocumentService as any, "createDocument");
        mockCreateDocument.resolves(editor);

        const mockGetConnectionInfoFromUri = sandbox.stub();
        mockGetConnectionInfoFromUri.returns(undefined); // No connection found
        const mockConnect = sandbox.stub().callsFake(async (uri, connectionInfo, promise) => {
            if (promise && promise.resolve) {
                promise.resolve(true);
            }
        });

        // Mock the connection manager
        (sqlDocumentService as any)._connectionMgr = {
            getConnectionInfoFromUri: mockGetConnectionInfoFromUri,
            connect: mockConnect,
        };

        const testUri = "file:///test.sql";
        const result = await sqlDocumentService.newQuery({
            sourceUri: testUri,
            connectionStrategy: ConnectionStrategy.CopyFromUri,
            content: "SELECT 1",
        });

        expect(result).to.equal(editor);
        expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 1");
        expect(mockGetConnectionInfoFromUri).to.have.been.calledOnceWith(testUri);

        mockCreateDocument.restore();
    });

    test("external SQL files auto-connect using last active connection", async () => {
        const script1 = mockTextDocument("script_1.sql");
        const script2 = mockTextDocument("script_2.sql");
        const textFile = mockTextDocument("text_file.txt", "plaintext");

        const editor1: vscode.TextEditor = { document: script1 } as unknown as vscode.TextEditor;

        // Stub getConnectionInfoFromUri: script1 is connected, others are not
        (connectionManager.getConnectionInfoFromUri as any).callsFake((uri: string) => {
            if (uri === script1.uri.toString(true)) {
                return { server: "localhost" } as any;
            }
            return undefined;
        });

        // Capture connect calls
        const connectStub = connectionManager.connect;

        // Activate script1 to set last active connection info
        await sqlDocumentService.onDidChangeActiveTextEditor(editor1);

        // Open a new external SQL file -> should auto-connect
        await sqlDocumentService.onDidOpenTextDocument(script2);
        expect(connectStub).to.have.been.calledOnceWithExactly(script2.uri.toString(true), {
            server: "localhost",
        });
        connectStub.resetHistory();

        // Open a non-sql file -> should not connect
        await sqlDocumentService.onDidOpenTextDocument(textFile);
        expect(connectStub).to.not.have.been.called;
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

    suite("Connection Strategy Tests", () => {
        let editor: vscode.TextEditor;
        let mockCreateDocument: sinon.SinonStub;
        let mockConnect: sinon.SinonStub;
        let mockGetConnectionInfoFromUri: sinon.SinonStub;
        let mockOnNewConnection: sinon.SinonStub;

        setup(() => {
            editor = {
                document: {
                    uri: vscode.Uri.parse("test_uri.sql"),
                },
                viewColumn: vscode.ViewColumn.One,
                selection: undefined,
            } as any;

            mockCreateDocument = sandbox.stub(sqlDocumentService as any, "createDocument");
            mockCreateDocument.resolves(editor);

            mockConnect = sandbox.stub().callsFake(async (uri, connectionInfo, promise) => {
                if (promise && promise.resolve) {
                    promise.resolve(true);
                }
            });

            mockGetConnectionInfoFromUri = sandbox.stub();
            mockOnNewConnection = sandbox.stub();

            (sqlDocumentService as any)._connectionMgr = {
                getConnectionInfoFromUri: mockGetConnectionInfoFromUri,
                connect: mockConnect,
                onNewConnection: mockOnNewConnection,
            };
        });

        test("ConnectionStrategy.None should not establish any connection", async () => {
            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.DoNotConnect,
                content: "SELECT 1",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 1");
            expect(mockConnect).to.not.have.been.called;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyLastActive should use last active connection when available", async () => {
            const lastActiveConnection = {
                server: "localhost",
                database: "testdb",
            } as IConnectionInfo;
            sqlDocumentService["_lastActiveConnectionInfo"] = lastActiveConnection;

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyLastActive,
                content: "SELECT 2",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 2");
            expect(mockConnect).to.have.been.calledOnce;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyLastActive should not connect when no last active connection", async () => {
            sqlDocumentService["_lastActiveConnectionInfo"] = undefined;

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyLastActive,
                content: "SELECT 3",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 3");
            expect(mockConnect).to.not.have.been.called;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyConnectionFromInfo should use provided connection info", async () => {
            const providedConnection = { server: "server1", database: "db1" } as IConnectionInfo;

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                connectionInfo: providedConnection,
                content: "SELECT 4",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 4");
            expect(mockConnect).to.have.been.calledOnce;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyConnectionFromInfo should throw error when connectionInfo is missing", async () => {
            try {
                await sqlDocumentService.newQuery({
                    connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                    content: "SELECT 5",
                });
                expect.fail("Expected error to be thrown");
            } catch (error) {
                expect(error.message).to.contain("connectionInfo is required");
            }

            expect(mockCreateDocument).to.have.been.calledOnce;
            expect(mockConnect).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyFromUri should copy connection from source URI when found", async () => {
            const sourceConnection = { server: "sourceserver", database: "sourcedb" };
            mockGetConnectionInfoFromUri.returns(sourceConnection);

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyFromUri,
                sourceUri: "file:///source.sql",
                content: "SELECT 6",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 6");
            expect(mockGetConnectionInfoFromUri).to.have.been.calledOnceWith("file:///source.sql");
            expect(mockConnect).to.have.been.calledOnce;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyFromUri should not connect when source URI has no connection", async () => {
            mockGetConnectionInfoFromUri.returns(undefined);

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyFromUri,
                sourceUri: "file:///source.sql",
                content: "SELECT 7",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 7");
            expect(mockGetConnectionInfoFromUri).to.have.been.calledOnceWith("file:///source.sql");
            expect(mockConnect).to.not.have.been.called;
            expect(mockOnNewConnection).to.not.have.been.called;
        });

        test("ConnectionStrategy.CopyFromUri should throw error when sourceUri is missing", async () => {
            try {
                await sqlDocumentService.newQuery({
                    connectionStrategy: ConnectionStrategy.CopyFromUri,
                    content: "SELECT 8",
                });
                expect.fail("Expected error to be thrown");
            } catch (error) {
                expect(error.message).to.contain("sourceUri is required");
            }

            expect(mockCreateDocument).to.have.been.calledOnce;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
        });

        test("ConnectionStrategy.PromptForConnection should prompt user for connection", async () => {
            const userSelectedConnection = { server: "userserver", database: "userdb" };
            mockOnNewConnection.resolves(userSelectedConnection);

            const result = await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.PromptForConnection,
                content: "SELECT 9",
            });

            expect(result).to.equal(editor);
            expect(mockCreateDocument).to.have.been.calledOnceWith("SELECT 9");
            expect(mockOnNewConnection).to.have.been.calledOnce;
            expect(mockConnect).to.have.been.calledOnce;
            expect(mockGetConnectionInfoFromUri).to.not.have.been.called;
        });

        test("should call createObjectExplorerSession when connection is established", async () => {
            const connectionInfo = { server: "localhost", database: "testdb" } as IConnectionInfo;

            await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                connectionInfo: connectionInfo,
                content: "SELECT 10",
            });

            expect(mainController.createObjectExplorerSession).to.have.been.calledWith(
                connectionInfo,
            );
        });

        test("should set status view properties correctly", async () => {
            const mockLanguageFlavorChanged = sandbox.stub();
            const mockSqlCmdModeChanged = sandbox.stub();

            sqlDocumentService["_statusview"] = {
                languageFlavorChanged: mockLanguageFlavorChanged,
                sqlCmdModeChanged: mockSqlCmdModeChanged,
            } as any;

            await sqlDocumentService.newQuery({
                connectionStrategy: ConnectionStrategy.DoNotConnect,
                content: "SELECT 11",
            });

            expect(mockLanguageFlavorChanged).to.have.been.calledOnce;
            expect(mockSqlCmdModeChanged).to.have.been.calledOnceWith(sinon.match.string, false);
        });
    });
});
