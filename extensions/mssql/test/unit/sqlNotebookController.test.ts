/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import type { SimpleExecuteResult, IConnectionInfo } from "vscode-mssql";
import { SqlNotebookController } from "../../src/notebooks/sqlNotebookController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../src/connectionSharing/connectionSharingService";

function makeSimpleResult(overrides?: Partial<SimpleExecuteResult>): SimpleExecuteResult {
    return {
        rowCount: 0,
        columnInfo: [],
        rows: [],
        messages: [],
        ...overrides,
    } as SimpleExecuteResult;
}

suite("SqlNotebookController", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlNotebookController;
    let connectionMgr: any;
    let sharingService: any;

    // Mock vscode objects
    let mockController: any;
    let mockStatusBarItem: any;
    let mockExecution: any;
    let mockCancelToken: vscode.EventEmitter<void>;

    const notebookUri = vscode.Uri.parse("vscode-notebook://test-notebook");

    function makeNotebook(
        cells?: Array<{ text: string; languageId?: string; kind?: vscode.NotebookCellKind }>,
        metadata?: any,
    ): vscode.NotebookDocument {
        const cellObjs = (cells ?? []).map((c, i) => ({
            index: i,
            kind: c.kind ?? vscode.NotebookCellKind.Code,
            document: {
                getText: () => c.text,
                languageId: c.languageId ?? "sql",
                uri: vscode.Uri.parse(`vscode-notebook-cell://test-notebook#cell${i}`),
            },
        }));
        return {
            uri: notebookUri,
            notebookType: "jupyter-notebook",
            metadata: metadata ?? {},
            getCells: () => cellObjs,
        } as unknown as vscode.NotebookDocument;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock cancellation token
        mockCancelToken = new vscode.EventEmitter<void>();

        // Mock NotebookCellExecution
        mockExecution = {
            executionOrder: 0,
            start: sandbox.stub(),
            end: sandbox.stub(),
            replaceOutput: sandbox.stub(),
            token: {
                isCancellationRequested: false,
                onCancellationRequested: mockCancelToken.event,
            },
        };

        // Mock NotebookController
        mockController = {
            supportedLanguages: undefined,
            supportsExecutionOrder: undefined,
            description: undefined,
            executeHandler: undefined,
            updateNotebookAffinity: sandbox.stub(),
            createNotebookCellExecution: sandbox.stub().returns(mockExecution),
            onDidChangeSelectedNotebooks: sandbox.stub().returns({ dispose: sandbox.stub() }),
            dispose: sandbox.stub(),
        };

        sandbox.stub(vscode.notebooks, "createNotebookController").returns(mockController);

        // Mock status bar
        mockStatusBarItem = {
            text: "",
            tooltip: "",
            command: "",
            name: "",
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        };
        sandbox.stub(vscode.window, "createStatusBarItem").returns(mockStatusBarItem);

        // Mock output channel
        const mockLog = {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
            trace: sandbox.stub(),
            dispose: sandbox.stub(),
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
        };
        sandbox.stub(vscode.window, "createOutputChannel").returns(mockLog as any);

        // Mock event subscriptions
        sandbox.stub(vscode.window, "onDidChangeActiveNotebookEditor").returns({
            dispose: sandbox.stub(),
        });
        sandbox.stub(vscode.workspace, "onDidOpenNotebookDocument").returns({
            dispose: sandbox.stub(),
        });
        sandbox.stub(vscode.workspace, "onDidChangeNotebookDocument").returns({
            dispose: sandbox.stub(),
        });
        sandbox.stub(vscode.languages, "registerCodeLensProvider").returns({
            dispose: sandbox.stub(),
        });

        // Stub notebook documents (empty by default)
        sandbox.stub(vscode.workspace, "notebookDocuments").value([]);

        // Mock ConnectionManager
        connectionMgr = {
            connect: sandbox.stub().resolves(true),
            listDatabases: sandbox.stub().resolves(["master", "TestDB"]),
            createConnectionDetails: sandbox.stub().returns({}),
            sendRequest: sandbox.stub().resolves(true),
            connectionStore: {
                getPickListItems: sandbox.stub().resolves([]),
            },
            connectionUI: {
                promptForConnection: sandbox.stub().resolves({
                    server: "test-server",
                    database: "TestDB",
                    authenticationType: "SqlLogin",
                } as IConnectionInfo),
            },
        };

        // Mock ConnectionSharingService
        sharingService = {
            isConnected: sandbox.stub().returns(false),
            disconnect: sandbox.stub(),
            executeSimpleQuery: sandbox.stub().resolves(
                makeSimpleResult({
                    rows: [[{ displayValue: "TestDB", isNull: false }]],
                }),
            ),
            cancelQuery: sandbox.stub().resolves(),
        };

        controller = new SqlNotebookController(
            connectionMgr as unknown as ConnectionManager,
            sharingService as unknown as ConnectionSharingService,
        );
    });

    teardown(() => {
        controller.dispose();
        mockCancelToken.dispose();
        sandbox.restore();
    });

    suite("executeCell — SQL execution", () => {
        test("executes SELECT and produces output", async () => {
            sharingService.executeSimpleQuery.resolves(
                makeSimpleResult({
                    columnInfo: [{ columnName: "id" } as any],
                    rows: [[{ displayValue: "1", isNull: false }]],
                    rowCount: 1,
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT 1 AS id" }]);
            const cells = notebook.getCells();

            // Call the executeHandler that was set during construction
            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.called;
        });

        test("handles empty cell gracefully", async () => {
            const notebook = makeNotebook([{ text: "   " }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
            expect(mockExecution.replaceOutput).to.not.have.been.called;
        });

        test("shows error when connection fails", async () => {
            connectionMgr.connectionUI.promptForConnection.resolves(undefined);

            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });

        test("shows rows affected for DML statements", async () => {
            sharingService.executeSimpleQuery.resolves(
                makeSimpleResult({
                    rowCount: 5,
                    columnInfo: [],
                    rows: [],
                    messages: [],
                }),
            );

            const notebook = makeNotebook([{ text: "INSERT INTO t VALUES (1)" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("handles query execution error", async () => {
            // First call to ensureConnection (promptAndConnect → executeSimpleQuery) succeeds
            sharingService.executeSimpleQuery
                .onFirstCall()
                .resolves(
                    makeSimpleResult({
                        rows: [[{ displayValue: "TestDB", isNull: false }]],
                    }),
                )
                .onSecondCall()
                .rejects(new Error("Invalid object name 'foo'"));

            const notebook = makeNotebook([{ text: "SELECT * FROM foo" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });
    });

    suite("executeCell — magic commands", () => {
        test("%%disconnect disconnects and outputs message", async () => {
            const notebook = makeNotebook([{ text: "%%disconnect" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("%%connection outputs connection label", async () => {
            const notebook = makeNotebook([{ text: "%%connection" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("%%connect prompts for connection", async () => {
            const notebook = makeNotebook([{ text: "%%connect" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(connectionMgr.connectionUI.promptForConnection).to.have.been.called;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("%%use with argument switches database", async () => {
            const notebook = makeNotebook([{ text: "%%use NewDB" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(connectionMgr.connect).to.have.been.called;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("unknown magic command shows error", async () => {
            const notebook = makeNotebook([{ text: "%%unknown" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });
    });

    suite("setAffinityIfSql", () => {
        test("sets affinity for notebook with SQL kernelspec", () => {
            // Create controller with a notebook already open
            sandbox.restore(); // Need to re-setup with notebook documents
            sandbox = sinon.createSandbox();

            const mockNotebook = makeNotebook([], {
                kernelspec: { name: "sql", display_name: "SQL" },
            });

            // Re-stub everything
            mockController = {
                supportedLanguages: undefined,
                supportsExecutionOrder: undefined,
                description: undefined,
                executeHandler: undefined,
                updateNotebookAffinity: sandbox.stub(),
                createNotebookCellExecution: sandbox.stub().returns(mockExecution),
                onDidChangeSelectedNotebooks: sandbox.stub().returns({ dispose: sandbox.stub() }),
                dispose: sandbox.stub(),
            };
            sandbox.stub(vscode.notebooks, "createNotebookController").returns(mockController);
            sandbox.stub(vscode.window, "createStatusBarItem").returns(mockStatusBarItem);
            sandbox.stub(vscode.window, "createOutputChannel").returns({
                info: sandbox.stub(),
                warn: sandbox.stub(),
                error: sandbox.stub(),
                debug: sandbox.stub(),
                trace: sandbox.stub(),
                dispose: sandbox.stub(),
            } as any);
            sandbox.stub(vscode.window, "onDidChangeActiveNotebookEditor").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidOpenNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidChangeNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.languages, "registerCodeLensProvider").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "notebookDocuments").value([mockNotebook]);

            const ctrl = new SqlNotebookController(
                connectionMgr as unknown as ConnectionManager,
                sharingService as unknown as ConnectionSharingService,
            );

            expect(mockController.updateNotebookAffinity).to.have.been.calledWith(
                mockNotebook,
                vscode.NotebookControllerAffinity.Preferred,
            );

            ctrl.dispose();
        });
    });

    suite("createNotebookWithConnection", () => {
        test("creates notebook without connection", async () => {
            const mockNotebook = makeNotebook();
            sandbox.stub(vscode.workspace, "openNotebookDocument").resolves(mockNotebook);
            sandbox.stub(vscode.window, "showNotebookDocument").resolves({} as any);

            await controller.createNotebookWithConnection();

            expect(vscode.workspace.openNotebookDocument).to.have.been.calledOnce;
            expect(mockController.updateNotebookAffinity).to.have.been.calledWith(
                mockNotebook,
                vscode.NotebookControllerAffinity.Preferred,
            );
        });

        test("creates notebook and connects with provided connection", async () => {
            const mockNotebook = makeNotebook();
            sandbox.stub(vscode.workspace, "openNotebookDocument").resolves(mockNotebook);
            sandbox.stub(vscode.window, "showNotebookDocument").resolves({} as any);
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const connInfo = {
                server: "test-server",
                database: "TestDB",
                authenticationType: "SqlLogin",
            } as IConnectionInfo;

            await controller.createNotebookWithConnection(connInfo);

            expect(connectionMgr.connect).to.have.been.called;
        });
    });

    suite("changeDatabaseInteractive", () => {
        test("shows warning when no active notebook", async () => {
            Object.defineProperty(vscode.window, "activeNotebookEditor", {
                get: () => undefined,
                configurable: true,
            });
            const warnStub = sandbox.stub(vscode.window, "showWarningMessage");

            await controller.changeDatabaseInteractive();

            expect(warnStub).to.have.been.calledOnce;
        });
    });

    suite("changeConnectionInteractive", () => {
        test("shows warning when no active notebook", async () => {
            Object.defineProperty(vscode.window, "activeNotebookEditor", {
                get: () => undefined,
                configurable: true,
            });
            const warnStub = sandbox.stub(vscode.window, "showWarningMessage");

            await controller.changeConnectionInteractive();

            expect(warnStub).to.have.been.calledOnce;
        });
    });

    suite("dispose", () => {
        test("disposes all resources", () => {
            controller.dispose();
            expect(mockController.dispose).to.have.been.calledOnce;
            expect(mockStatusBarItem.dispose).to.have.been.calledOnce;
        });
    });
});
