/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { IConnectionInfo, IServerInfo } from "vscode-mssql";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ConnectionStore } from "../../src/models/connectionStore";
import { stubTelemetry } from "./utils";

chai.use(sinonChai);

suite("SqlDocumentService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let document: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let sqlDocumentService: SqlDocumentService;
    let docUri: string;
    let docUriCallback: string;

    setup(async () => {
        sandbox = sinon.createSandbox();
        // Setup a standard document and a new document
        docUri = "docURI.sql";

        document = mockTextDocument(docUri);

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

        // Mock objectExplorerProvider for SqlDocumentService
        const mockObjectExplorerService = {
            hasSession: sandbox.stub().returns(false),
            getConnectionNodeFromProfile: sandbox.stub().returns(null),
        };
        (mainController as any)._objectExplorerProvider = {
            objectExplorerService: mockObjectExplorerService,
        };

        sqlDocumentService = new SqlDocumentService(mainController);
        mainController.sqlDocumentService = sqlDocumentService;

        // Ensure the connection manager is properly set in the service
        sqlDocumentService["_connectionManager"] = connectionManager;

        // Stub SqlOutputContentProvider methods used during tests to avoid side effects
        const mockOutputContentProvider = {
            onDidCloseTextDocument: sandbox.stub().resolves(),
            updateQueryRunnerUri: sandbox.stub().resolves(),
            onUntitledFileSaved: sandbox.stub(),
        } as any;
        mainController["_outputContentProvider"] = mockOutputContentProvider;
        sqlDocumentService["_outputContentProvider"] = mockOutputContentProvider;

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

    test("handleNewQueryCommand should create a new query and update recents", async () => {
        stubTelemetry(sandbox);
        const editor: vscode.TextEditor = {
            document: { uri: "test_uri" },
        } as any;

        const newQueryStub = sandbox.stub(sqlDocumentService as any, "newQuery").resolves(editor);
        (connectionManager as any).connectionStore = {
            removeRecentlyUsed: sandbox.stub().resolves(),
        };
        connectionManager.getServerInfo.returns(undefined as any);
        connectionManager.handlePasswordBasedCredentials.resolves();

        const node: TreeNodeInfo = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(node, "connectionProfile").get(() => ({}) as IConnectionProfile);
        sandbox.stub(node, "nodeType").get(() => "Server");

        await sqlDocumentService.handleNewQueryCommand(node, undefined);

        expect(newQueryStub).to.have.been.calledOnce;
        expect((connectionManager as any).connectionStore.removeRecentlyUsed).to.have.been
            .calledOnce;
        expect(connectionManager.handlePasswordBasedCredentials).to.have.been.calledOnce;
    });

    test("handleNewQueryCommand should not create a new connection if new query fails", async () => {
        const newQueryStub = sandbox
            .stub(sqlDocumentService as any, "newQuery")
            .rejects(new Error("boom"));

        connectionManager.handlePasswordBasedCredentials.resolves();
        const node: any = { connectionProfile: {}, nodeType: "Server" };
        try {
            await sqlDocumentService.handleNewQueryCommand(node, undefined);
            expect.fail("Expected rejection");
        } catch (e) {
            expect((e as Error).message).to.match(/boom/);
        } finally {
            newQueryStub.restore();
        }

        expect(connectionManager.promptToConnect).to.not.have.been.called;
    });

    test("handleNewQueryCommand uses CopyLastActive when last active connection exists", async () => {
        const editor: vscode.TextEditor = { document: { uri: "test_uri" } } as any;
        const newQueryStub = sandbox.stub(sqlDocumentService, "newQuery").callsFake((opts: any) => {
            expect(opts.connectionStrategy).to.equal(ConnectionStrategy.CopyLastActive);
            expect(opts.connectionInfo).to.equal(undefined);
            return Promise.resolve(editor);
        });

        // simulate last active connection
        sqlDocumentService["_lastActiveConnectionInfo"] = { server: "localhost" } as any;
        // remove OE selection influence
        mainController.objectExplorerTree = { selection: [] } as any;
        connectionManager.connectionStore = {
            removeRecentlyUsed: sandbox.stub().resolves(),
        } as any;

        await sqlDocumentService.handleNewQueryCommand(undefined, "SELECT 1");

        expect(newQueryStub).to.have.been.calledOnce;
        expect(connectionManager.connectionStore.removeRecentlyUsed).to.not.have.been.called;
        newQueryStub.restore();
    });

    test("handleNewQueryCommand uses OE selection when exactly one node is selected", async () => {
        const nodeConnection = { server: "oeServer" } as IConnectionProfile;

        const selectedNode: TreeNodeInfo = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(selectedNode, "connectionProfile").get(() => nodeConnection);
        sandbox.stub(selectedNode, "nodeType").get(() => "Server");

        mainController.objectExplorerTree = {
            selection: [selectedNode],
        } as any;
        connectionManager.handlePasswordBasedCredentials.resolves();
        connectionManager.connectionStore = {
            removeRecentlyUsed: sandbox.stub().resolves(),
        } as any;

        const editor: vscode.TextEditor = { document: { uri: "t" } } as any;
        const newQueryStub = sandbox.stub(sqlDocumentService, "newQuery").callsFake((opts: any) => {
            expect(opts.connectionStrategy).to.equal(ConnectionStrategy.CopyConnectionFromInfo);
            expect(opts.connectionInfo).to.equal(nodeConnection);
            return Promise.resolve(editor);
        });

        await sqlDocumentService.handleNewQueryCommand(undefined, undefined);
        expect(connectionManager.handlePasswordBasedCredentials).to.have.been.calledOnceWith(
            nodeConnection,
        );
        expect(newQueryStub).to.have.been.calledOnce;
        newQueryStub.restore();
    });

    test("handleNewQueryCommand refreshes Entra token info on source node", async () => {
        stubTelemetry(sandbox);

        const oldToken = {
            azureAccountToken: "oldToken",
            expiresOn: Date.now() / 1000 - 60, // 60 seconds in the past; not that the test actually requires this to be expired
        };

        const newToken = {
            azureAccountToken: "refreshedToken",
            expiresOn: oldToken.expiresOn + 600 + 60, // 10 minutes in the future (plus making up for the past offset)
        };

        const nodeConnection = {
            server: "server",
            ...oldToken,
        } as IConnectionProfile;

        const node = {
            connectionProfile: nodeConnection,
            nodeType: "Server",
            updateEntraTokenInfo: sandbox.stub(),
        } as unknown as TreeNodeInfo;

        connectionManager.handlePasswordBasedCredentials.resolves();

        const connectionStoreStub = sandbox.createStubInstance(ConnectionStore);

        connectionManager.connectionStore = connectionStoreStub;
        connectionManager.getServerInfo.returns({} as IServerInfo);
        connectionManager.getConnectionInfo.returns({} as ConnectionInfo);

        const editor: vscode.TextEditor = {
            document: { uri: vscode.Uri.parse("untitled:tokenTest") },
        } as vscode.TextEditor;

        sandbox.stub(sqlDocumentService, "newQuery").callsFake(async (opts) => {
            expect(opts.connectionInfo).to.equal(nodeConnection);
            Object.assign(opts.connectionInfo, newToken);

            return editor;
        });

        expect(nodeConnection.azureAccountToken).to.equal(oldToken.azureAccountToken);
        expect(nodeConnection.expiresOn).to.equal(oldToken.expiresOn);

        await sqlDocumentService.handleNewQueryCommand(node, undefined);

        expect(node.updateEntraTokenInfo).to.have.been.calledOnceWith(nodeConnection);
        expect(nodeConnection.azureAccountToken).to.equal(newToken.azureAccountToken);
        expect(nodeConnection.expiresOn).to.equal(newToken.expiresOn);
    });

    test("handleNewQueryCommand prompts for connection when no context", async () => {
        // clear last active and OE selection
        sqlDocumentService["_lastActiveConnectionInfo"] = undefined;
        mainController.objectExplorerTree = { selection: [] } as any;
        connectionManager.connectionStore = {
            removeRecentlyUsed: sandbox.stub().resolves(),
        } as any;

        const editor: vscode.TextEditor = { document: { uri: "x" } } as any;
        const newQueryStub = sandbox.stub(sqlDocumentService, "newQuery").callsFake((opts: any) => {
            expect(opts.connectionStrategy).to.equal(ConnectionStrategy.PromptForConnection);
            expect(opts.connectionInfo).to.equal(undefined);
            return Promise.resolve(editor);
        });

        await sqlDocumentService.handleNewQueryCommand(undefined, undefined);
        expect(newQueryStub).to.have.been.calledOnce;
        expect(connectionManager.connectionStore.removeRecentlyUsed).to.not.have.been.called;
        newQueryStub.restore();
    });

    // Standard closed document event test
    test("onDidCloseTextDocument should propagate close to output provider and connectionManager", async () => {
        await sqlDocumentService.onDidCloseTextDocument(document);

        expect(connectionManager.onDidCloseTextDocument).to.have.been.calledOnceWithExactly(
            document,
        );
        expect(
            mainController["_outputContentProvider"].onDidCloseTextDocument,
        ).to.have.been.calledOnceWithExactly(document);
        expect(docUriCallback).to.equal(document.uri.toString());
        docUriCallback = "";
    });

    test("onDidCloseTextDocument should not transfer URI for untitled documents", async () => {
        // Scheme of older doc must be untitled
        let document2 = {
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId: "sql",
        } as vscode.TextDocument;

        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri");
        mockUpdateUri.resolves();

        await sqlDocumentService.onDidCloseTextDocument(document2);

        expect(mockUpdateUri).to.not.have.been.called;
        expect(connectionManager.onDidCloseTextDocument).to.have.been.calledOnceWithExactly(
            document2,
        );

        mockUpdateUri.restore();
    });

    test("onDidCloseTextDocument should skip processing when document is being renamed or saved", async () => {
        const doc = mockTextDocument("file:///old.sql");
        const docKey = doc.uri.toString();

        // Simulate a rename/save in progress by adding the URI to the set
        sqlDocumentService["_uriBeingRenamedOrSaved"].add(docKey);

        await sqlDocumentService.onDidCloseTextDocument(doc);

        // Should have skipped processing - no calls to connectionManager or outputContentProvider
        expect(connectionManager.onDidCloseTextDocument).to.not.have.been.called;
        expect(mainController["_outputContentProvider"].onDidCloseTextDocument).to.not.have.been
            .called;

        // The URI should be removed from the set after processing
        expect(sqlDocumentService["_uriBeingRenamedOrSaved"].has(docKey)).to.be.false;
    });

    test("onWillSaveTextDocument should transfer state when saving an untitled document", async () => {
        const untitledDoc = {
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:Untitled-1`),
            languageId: Constants.languageId,
            lineCount: 1,
            getText: () => "SELECT 1",
        } as vscode.TextDocument;

        const savedDoc = {
            uri: vscode.Uri.parse("file:///saved.sql"),
            languageId: Constants.languageId,
            lineCount: 1,
            getText: () => "SELECT 1",
        } as vscode.TextDocument;

        // Make the untitled doc appear in workspace.textDocuments
        sandbox.stub(vscode.workspace, "textDocuments").value([untitledDoc]);

        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri").resolves();

        const event = {
            document: savedDoc,
            reason: vscode.TextDocumentSaveReason.Manual,
            waitUntil: sandbox.stub(),
        } as unknown as vscode.TextDocumentWillSaveEvent;

        await sqlDocumentService.onWillSaveTextDocument(event);

        // updateUri should have been called to transfer state
        expect(mockUpdateUri).to.have.been.calledOnce;
        // The untitled URI should be in the set to skip close event
        expect(sqlDocumentService["_uriBeingRenamedOrSaved"].has(untitledDoc.uri.toString())).to.be
            .true;
        // The new URI should be tracked to skip auto-connect on open
        expect(sqlDocumentService["_newUriFromRenameOrSave"].has(savedDoc.uri.toString())).to.be
            .true;

        mockUpdateUri.restore();
    });

    test("onWillSaveTextDocument should not transfer state when no matching untitled document exists", async () => {
        const savedDoc = {
            uri: vscode.Uri.parse("file:///existing.sql"),
            languageId: Constants.languageId,
            lineCount: 5,
            getText: () => "SELECT * FROM table1",
        } as vscode.TextDocument;

        // No untitled documents in workspace
        sandbox.stub(vscode.workspace, "textDocuments").value([]);

        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri").resolves();

        const event = {
            document: savedDoc,
            reason: vscode.TextDocumentSaveReason.Manual,
            waitUntil: sandbox.stub(),
        } as unknown as vscode.TextDocumentWillSaveEvent;

        await sqlDocumentService.onWillSaveTextDocument(event);

        expect(mockUpdateUri).to.not.have.been.called;

        mockUpdateUri.restore();
    });

    test("onWillRenameFiles should transfer state for each renamed file", async () => {
        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri").resolves();

        const oldUri = vscode.Uri.parse("file:///old-name.sql");
        const newUri = vscode.Uri.parse("file:///new-name.sql");

        const event = {
            files: [{ oldUri, newUri }],
            waitUntil: sandbox.stub(),
        } as unknown as vscode.FileWillRenameEvent;

        await sqlDocumentService.onWillRenameFiles(event);

        expect(mockUpdateUri).to.have.been.calledOnceWith(oldUri.toString(), newUri.toString());
        expect(sqlDocumentService["_uriBeingRenamedOrSaved"].has(oldUri.toString())).to.be.true;
        expect(sqlDocumentService["_newUriFromRenameOrSave"].has(newUri.toString())).to.be.true;

        mockUpdateUri.restore();
    });

    test("onWillRenameFiles should handle multiple file renames", async () => {
        const mockUpdateUri = sandbox.stub(sqlDocumentService as any, "updateUri").resolves();

        const files = [
            {
                oldUri: vscode.Uri.parse("file:///a.sql"),
                newUri: vscode.Uri.parse("file:///a-renamed.sql"),
            },
            {
                oldUri: vscode.Uri.parse("file:///b.sql"),
                newUri: vscode.Uri.parse("file:///b-renamed.sql"),
            },
        ];

        const event = {
            files,
            waitUntil: sandbox.stub(),
        } as unknown as vscode.FileWillRenameEvent;

        await sqlDocumentService.onWillRenameFiles(event);

        expect(mockUpdateUri).to.have.been.calledTwice;

        mockUpdateUri.restore();
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

        // Stub getConnectionInfo: script1 is connected, others are not
        (connectionManager.getConnectionInfo as any).callsFake((uri: string) => {
            if (uri === script1.uri.toString()) {
                return {
                    connectionId: "conn1",
                    credentials: { server: "localhost" },
                } as any;
            }
            return undefined;
        });

        // Capture connect calls
        const connectStub = connectionManager.connect;

        // Activate script1 to set last active connection info
        await sqlDocumentService.onDidChangeActiveTextEditor(editor1);

        // Open a new external SQL file -> should auto-connect
        await sqlDocumentService.onDidOpenTextDocument(script2);
        expect(connectStub).to.have.been.calledOnceWithExactly(script2.uri.toString(), {
            server: "localhost",
        });
        connectStub.resetHistory();

        // Open a non-sql file -> should not connect
        await sqlDocumentService.onDidOpenTextDocument(textFile);
        expect(connectStub).to.not.have.been.called;
    });

    test("onDidOpenTextDocument should wait for ongoing creates for file SQL documents", async () => {
        const fileDoc = mockTextDocument("file:///test.sql");
        const waitStub = sandbox.stub(sqlDocumentService, "waitForOngoingCreates").resolves();

        await sqlDocumentService.onDidOpenTextDocument(fileDoc);

        expect(waitStub).to.have.been.calledOnce;
        waitStub.restore();
    });

    test("onDidOpenTextDocument should wait for ongoing creates for untitled SQL documents", async () => {
        const untitledDoc = {
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:Untitled-1`),
            languageId: Constants.languageId,
        } as vscode.TextDocument;
        const waitStub = sandbox.stub(sqlDocumentService, "waitForOngoingCreates").resolves();

        await sqlDocumentService.onDidOpenTextDocument(untitledDoc);

        expect(waitStub).to.have.been.calledOnce;
        waitStub.restore();
    });

    test("onDidOpenTextDocument should skip auto-connect for recently renamed or saved documents", async () => {
        const doc = mockTextDocument("file:///just-saved.sql");
        const docKey = doc.uri.toString();

        // Simulate that this document was just renamed/saved
        sqlDocumentService["_newUriFromRenameOrSave"].add(docKey);
        sqlDocumentService["_lastActiveConnectionInfo"] = {
            server: "localhost",
        } as any;

        await sqlDocumentService.onDidOpenTextDocument(doc);

        // Should not have tried to connect since this is a recently renamed/saved file
        expect(connectionManager.connect).to.not.have.been.called;
        // The URI should be removed from the set after processing
        expect(sqlDocumentService["_newUriFromRenameOrSave"].has(docKey)).to.be.false;
    }).timeout(5000);

    test("onDidChangeActiveTextEditor should handle error cases gracefully", async () => {
        const hideStatusBarStub = sandbox.stub();
        const updateStatusBarStub = sandbox.stub();
        sqlDocumentService["_statusview"] = {
            hideLastShownStatusBar: hideStatusBarStub,
            updateStatusBarForEditor: updateStatusBarStub,
        } as any;

        // Test case 1: editor is undefined
        await sqlDocumentService.onDidChangeActiveTextEditor(undefined);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.not.have.been.called;
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;
        hideStatusBarStub.resetHistory();

        // Test case 2: editor.document is undefined
        const editorWithoutDoc = {} as vscode.TextEditor;
        await sqlDocumentService.onDidChangeActiveTextEditor(editorWithoutDoc);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.not.have.been.called;
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;
        hideStatusBarStub.resetHistory();

        // Test case 3: connection manager returns undefined (no connection)
        const editorWithDoc = { document: mockTextDocument("test.sql") } as vscode.TextEditor;
        (connectionManager.getConnectionInfo as any).returns(undefined);
        await sqlDocumentService.onDidChangeActiveTextEditor(editorWithDoc);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.have.been.calledOnceWith(editorWithDoc, undefined);
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;
        hideStatusBarStub.resetHistory();
        updateStatusBarStub.resetHistory();

        // Test case 4: connection info exists but has no connectionId
        const connectionInfoWithoutId = { credentials: { server: "localhost" } };
        (connectionManager.getConnectionInfo as any).returns(connectionInfoWithoutId);
        await sqlDocumentService.onDidChangeActiveTextEditor(editorWithDoc);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.have.been.calledOnceWith(
            editorWithDoc,
            connectionInfoWithoutId,
        );
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;
        hideStatusBarStub.resetHistory();
        updateStatusBarStub.resetHistory();

        // Test case 4: connection info exists but has no connectionId
        const connectionInfoConnecting = {
            credentials: { server: "localhost" },
            id: "conn1",
            connecting: true,
        };
        (connectionManager.getConnectionInfo as any).returns(connectionInfoConnecting);
        await sqlDocumentService.onDidChangeActiveTextEditor(editorWithDoc);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.have.been.calledOnceWith(
            editorWithDoc,
            connectionInfoConnecting,
        );
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;
        hideStatusBarStub.resetHistory();
        updateStatusBarStub.resetHistory();

        // Test case 5: connection manager is undefined
        const originalConnectionMgr = sqlDocumentService["_connectionMgr"];
        sqlDocumentService["_connectionMgr"] = undefined;
        await sqlDocumentService.onDidChangeActiveTextEditor(editorWithDoc);
        expect(hideStatusBarStub).to.have.been.calledOnce;
        expect(updateStatusBarStub).to.have.been.calledOnceWith(editorWithDoc, undefined);
        expect(sqlDocumentService["_lastActiveConnectionInfo"]).to.be.undefined;

        // Restore the connection manager
        sqlDocumentService["_connectionMgr"] = originalConnectionMgr;
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

        connectionManager.transferConnectionToFile.callsFake(async (doc, _newDoc) => {
            docUriCallback = doc;
            return true;
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

            const mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
            mockConnect = mockConnectionManager.connect;
            mockOnNewConnection = mockConnectionManager.promptToConnect;
            mockGetConnectionInfoFromUri = mockConnectionManager.getConnectionInfoFromUri;

            mockConnect.resolves(true);
            mockOnNewConnection.resolves();
            mockGetConnectionInfoFromUri.resolves();

            sqlDocumentService["_connectionMgr"] = mockConnectionManager;
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
