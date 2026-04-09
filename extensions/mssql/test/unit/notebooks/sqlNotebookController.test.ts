/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as vscode from "vscode";

chai.use(sinonChai);
import type { IConnectionInfo } from "vscode-mssql";
import { SqlNotebookController } from "../../../src/notebooks/sqlNotebookController";
import ConnectionManager from "../../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../../src/connectionSharing/connectionSharingService";
import type { NotebookQueryResult } from "../../../src/notebooks/notebookQueryExecutor";
import { NotebookConnectionManager } from "../../../src/notebooks/notebookConnectionManager";
import { IDbColumn } from "../../../src/models/interfaces";
import { BatchSummary } from "../../../src/models/contracts/queryExecute";

function makeQueryResult(overrides?: Partial<NotebookQueryResult>): NotebookQueryResult {
    return {
        batches: [],
        canceled: false,
        ...overrides,
    };
}

function makeColumn(columnName: string, dataTypeName: string): IDbColumn {
    return {
        columnName,
        dataTypeName,
        dataType: dataTypeName,
        baseCatalogName: "",
        baseColumnName: columnName,
        baseSchemaName: "",
        baseServerName: "",
        baseTableName: "",
        udtAssemblyQualifiedName: "",
    };
}

function makeBatchSummary(overrides?: Partial<BatchSummary>): BatchSummary {
    return {
        id: 0,
        hasError: false,
        selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
        resultSetSummaries: [],
        executionElapsed: "00:00:00.000",
        executionEnd: "",
        executionStart: "",
        ...overrides,
    };
}

suite("SqlNotebookController", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlNotebookController;
    let connectionMgr: {
        connect: sinon.SinonStub;
        listDatabases: sinon.SinonStub;
        createConnectionDetails: sinon.SinonStub;
        sendRequest: sinon.SinonStub;
        getConnectionInfoFromUri: sinon.SinonStub;
        connectionStore: { getPickListItems: sinon.SinonStub };
        connectionUI: { promptForConnection: sinon.SinonStub };
    };
    let mockNotebookConnMgr: sinon.SinonStubbedInstance<NotebookConnectionManager>;

    // Mock vscode objects
    let mockController: {
        id: string;
        notebookType: string;
        label: string;
        supportedLanguages: string[] | undefined;
        supportsExecutionOrder: boolean | undefined;
        description: string | undefined;
        executeHandler:
            | ((
                  cells: vscode.NotebookCell[],
                  notebook: vscode.NotebookDocument,
                  controller: vscode.NotebookController,
              ) => void | Thenable<void>)
            | undefined;
        updateNotebookAffinity: sinon.SinonStub;
        createNotebookCellExecution: sinon.SinonStub;
        onDidChangeSelectedNotebooks: sinon.SinonStub;
        dispose: sinon.SinonStub;
    };
    let mockStatusBarItem: {
        text: string;
        tooltip: string;
        command: string;
        name: string;
        show: sinon.SinonStub;
        hide: sinon.SinonStub;
        dispose: sinon.SinonStub;
    };
    let mockExecution: {
        executionOrder: number;
        start: sinon.SinonStub;
        end: sinon.SinonStub;
        replaceOutput: sinon.SinonStub;
        token: vscode.CancellationToken;
    };
    let mockCancelToken: vscode.EventEmitter<void>;

    const notebookUri = vscode.Uri.parse("vscode-notebook://test-notebook");

    function makeNotebook(
        cells?: Array<{ text: string; languageId?: string; kind?: vscode.NotebookCellKind }>,
        metadata?: Record<string, unknown>,
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

    let mockWorkspaceState: {
        get: sinon.SinonStub;
        update: sinon.SinonStub;
        keys: sinon.SinonStub;
    };

    function setupVscodeMocks(sb: sinon.SinonSandbox): void {
        sb.stub(vscode.notebooks, "createNotebookController").returns(
            mockController as unknown as vscode.NotebookController,
        );
        sb.stub(vscode.window, "createStatusBarItem").returns(
            mockStatusBarItem as unknown as vscode.StatusBarItem,
        );
        sb.stub(vscode.window, "createOutputChannel").returns({
            info: sb.stub(),
            warn: sb.stub(),
            error: sb.stub(),
            debug: sb.stub(),
            trace: sb.stub(),
            dispose: sb.stub(),
            append: sb.stub(),
            appendLine: sb.stub(),
        } as unknown as vscode.LogOutputChannel);
        sb.stub(vscode.window, "onDidChangeActiveNotebookEditor").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.workspace, "onDidOpenNotebookDocument").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.workspace, "onDidChangeNotebookDocument").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.workspace, "onDidSaveNotebookDocument").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.workspace, "onDidCloseNotebookDocument").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.languages, "registerCodeLensProvider").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.workspace, "notebookDocuments").value([]);
        sb.stub(vscode.workspace, "applyEdit").resolves(true);
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
            id: "ms-mssql.sql-notebook-controller",
            notebookType: "jupyter-notebook",
            label: "MSSQL",
            supportedLanguages: undefined,
            supportsExecutionOrder: undefined,
            description: undefined,
            executeHandler: undefined,
            updateNotebookAffinity: sandbox.stub(),
            createNotebookCellExecution: sandbox.stub().returns(mockExecution),
            onDidChangeSelectedNotebooks: sandbox.stub().returns({ dispose: sandbox.stub() }),
            dispose: sandbox.stub(),
        };

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

        setupVscodeMocks(sandbox);

        // Mock ConnectionManager (used for connection UI flows)
        connectionMgr = {
            connect: sandbox.stub().resolves(true),
            listDatabases: sandbox.stub().resolves(["master", "TestDB"]),
            createConnectionDetails: sandbox.stub().returns({}),
            sendRequest: sandbox.stub().resolves(true),
            getConnectionInfoFromUri: sandbox.stub().returns({
                server: "test-server",
                database: "TestDB",
                authenticationType: "SqlLogin",
            } as IConnectionInfo),
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

        // Mock NotebookConnectionManager — injected via the factory to bypass
        // the real STS/SqlToolsServiceClient query stack entirely.
        mockNotebookConnMgr = sandbox.createStubInstance(NotebookConnectionManager);
        mockNotebookConnMgr.ensureConnection.resolves("mssql://test-uri");
        mockNotebookConnMgr.executeQueryString.resolves(makeQueryResult());
        mockNotebookConnMgr.promptAndConnect.resolves("mssql://test-uri");
        mockNotebookConnMgr.connectWith.resolves("mssql://test-uri");
        mockNotebookConnMgr.getConnectionLabel.returns("test-server / TestDB");
        mockNotebookConnMgr.getConnectionInfo.returns({
            server: "test-server",
            database: "TestDB",
            authenticationType: "SqlLogin",
        } as IConnectionInfo);
        mockNotebookConnMgr.isConnected.returns(true);
        mockNotebookConnMgr.listDatabases.resolves(["master", "TestDB"]);
        mockNotebookConnMgr.changeDatabase.resolves();
        mockNotebookConnMgr.getCurrentDatabase.returns("TestDB");
        mockNotebookConnMgr.connectCellForIntellisense.resolves();

        mockWorkspaceState = {
            get: sandbox.stub().returns(undefined),
            update: sandbox.stub().resolves(),
            keys: sandbox.stub().returns([]),
        };

        controller = new SqlNotebookController(
            connectionMgr as unknown as ConnectionManager,
            {} as unknown as ConnectionSharingService,
            mockWorkspaceState as unknown as vscode.Memento,
            () => mockNotebookConnMgr as unknown as NotebookConnectionManager,
        );
    });

    teardown(() => {
        controller.dispose();
        mockCancelToken.dispose();
        sandbox.restore();
    });

    suite("executeCell — SQL execution", () => {
        test("executes SELECT and produces output", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary(),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("id", "int")],
                                    rows: [[{ displayValue: "1", isNull: false }]],
                                    rowCount: 1,
                                },
                            ],
                            hasError: false,
                        },
                    ],
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
            mockNotebookConnMgr.ensureConnection.rejects(new Error("No connection selected"));

            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });

        test("shows rows affected for DML statements", async () => {
            // Empty result sets → buildBatchOutputs emits "command completed successfully"
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary(),
                            messages: [],
                            resultSets: [],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "INSERT INTO t VALUES (1)" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("handles query execution error", async () => {
            mockNotebookConnMgr.executeQueryString.rejects(new Error("Invalid object name 'foo'"));

            const notebook = makeNotebook([{ text: "SELECT * FROM foo" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });

        test("shows truncation warning when result set is incomplete", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary(),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("id", "int")],
                                    rows: [
                                        [{ displayValue: "1", isNull: false }],
                                        [{ displayValue: "2", isNull: false }],
                                    ],
                                    rowCount: 1000, // More rows exist than were returned
                                },
                            ],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT * FROM LargeTable" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            expect(outputs).to.have.lengthOf(2);

            // First output should be the truncation warning
            const warningOutput = outputs[0];
            expect(warningOutput.items[0].mime).to.equal("text/plain");
            const warningText = new TextDecoder().decode(warningOutput.items[0].data);
            expect(warningText).to.include("Warning: Result set is incomplete");
            expect(warningText).to.include("2"); // Actual rows returned
            expect(warningText).to.include("1000"); // Total rows available

            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("shows error message for batch with isError=true messages (regardless of batch.hasError)", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ hasError: false }), // hasError=false even though there's an error message
                            messages: [
                                {
                                    batchId: 0,
                                    isError: true,
                                    time: "",
                                    message: "Incorrect syntax near 'SELEC'.",
                                },
                            ],
                            resultSets: [],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELEC 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            // Should have one error output, not "Commands completed successfully"
            expect(outputs).to.have.lengthOf(1);
            // Error output uses stderr mime type
            expect(outputs[0].items[0].mime).to.equal("application/vnd.code.notebook.stderr");
            const errorText = new TextDecoder().decode(outputs[0].items[0].data);
            expect(errorText).to.include("Incorrect syntax near 'SELEC'.");
            // Cell should be marked as failed
            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });

        test("does not show 'Commands completed successfully' when error messages exist", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ hasError: true }),
                            messages: [
                                {
                                    batchId: 0,
                                    isError: true,
                                    time: "",
                                    message: "Divide by zero error encountered.",
                                },
                            ],
                            resultSets: [],
                            hasError: true,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT 1/0" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            expect(outputs).to.have.lengthOf(1);
            const text = new TextDecoder().decode(outputs[0].items[0].data);
            expect(text).to.not.include("Command completed successfully");
            expect(text).to.include("Divide by zero error encountered.");
        });

        test("shows PRINT messages as plain text output", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary(),
                            messages: [
                                {
                                    batchId: 0,
                                    isError: false,
                                    time: "",
                                    message: "hello world",
                                },
                            ],
                            resultSets: [],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "PRINT 'hello world'" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            expect(outputs).to.have.lengthOf(1);
            expect(outputs[0].items[0].mime).to.equal("text/plain");
            const text = new TextDecoder().decode(outputs[0].items[0].data);
            expect(text).to.equal("hello world");
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("multi-batch: shows grid, error, grid in order", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ id: 0 }),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("n", "int")],
                                    rows: [[{ displayValue: "1", isNull: false }]],
                                    rowCount: 1,
                                },
                            ],
                            hasError: false,
                        },
                        {
                            batchSummary: makeBatchSummary({ id: 1, hasError: true }),
                            messages: [
                                {
                                    batchId: 1,
                                    isError: true,
                                    time: "",
                                    message: "Divide by zero error encountered.",
                                },
                            ],
                            resultSets: [],
                            hasError: true,
                        },
                        {
                            batchSummary: makeBatchSummary({ id: 2 }),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("n", "int")],
                                    rows: [[{ displayValue: "2", isNull: false }]],
                                    rowCount: 1,
                                },
                            ],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT 1\nGO\nSELECT 1/0\nGO\nSELECT 2" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            // Expected: result grid (batch 0), error message (batch 1), result grid (batch 2)
            expect(outputs).to.have.lengthOf(3);
            expect(outputs[0].items[0].mime).to.equal("application/vnd.mssql.query-result");
            expect(outputs[1].items[0].mime).to.equal("application/vnd.code.notebook.stderr");
            expect(outputs[2].items[0].mime).to.equal("application/vnd.mssql.query-result");
            // Cell should be marked failed because one batch had an error
            expect(mockExecution.end).to.have.been.calledWith(false, sinon.match.number);
        });

        test("does not show truncation warning when result set is complete", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary(),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("id", "int")],
                                    rows: [
                                        [{ displayValue: "1", isNull: false }],
                                        [{ displayValue: "2", isNull: false }],
                                    ],
                                    rowCount: 2, // Counts match - no truncation
                                },
                            ],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT * FROM SmallTable" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockExecution.replaceOutput).to.have.been.calledOnce;
            const outputs = mockExecution.replaceOutput.firstCall.args[0];
            expect(outputs).to.have.lengthOf(1); // Only the result set output, no warning

            // The output should be the result set, not a warning
            const resultOutput = outputs[0];
            expect(resultOutput.items[0].mime).to.equal("application/vnd.mssql.query-result");

            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
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

        test("%%connect prompts for connection via NotebookConnectionManager", async () => {
            const notebook = makeNotebook([{ text: "%%connect" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockNotebookConnMgr.promptAndConnect).to.have.been.called;
            expect(mockExecution.end).to.have.been.calledWith(true, sinon.match.number);
        });

        test("%%use with argument switches database", async () => {
            const notebook = makeNotebook([{ text: "%%use NewDB" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockNotebookConnMgr.changeDatabase).to.have.been.calledWith("NewDB");
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
                id: "ms-mssql.sql-notebook-controller",
                notebookType: "jupyter-notebook",
                label: "MSSQL",
                supportedLanguages: undefined,
                supportsExecutionOrder: undefined,
                description: undefined,
                executeHandler: undefined,
                updateNotebookAffinity: sandbox.stub(),
                createNotebookCellExecution: sandbox.stub().returns(mockExecution),
                onDidChangeSelectedNotebooks: sandbox.stub().returns({ dispose: sandbox.stub() }),
                dispose: sandbox.stub(),
            };
            sandbox
                .stub(vscode.notebooks, "createNotebookController")
                .returns(mockController as unknown as vscode.NotebookController);
            sandbox
                .stub(vscode.window, "createStatusBarItem")
                .returns(mockStatusBarItem as unknown as vscode.StatusBarItem);
            sandbox.stub(vscode.window, "createOutputChannel").returns({
                info: sandbox.stub(),
                warn: sandbox.stub(),
                error: sandbox.stub(),
                debug: sandbox.stub(),
                trace: sandbox.stub(),
                dispose: sandbox.stub(),
            } as unknown as vscode.LogOutputChannel);
            sandbox.stub(vscode.window, "onDidChangeActiveNotebookEditor").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidOpenNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidChangeNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidSaveNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "onDidCloseNotebookDocument").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.languages, "registerCodeLensProvider").returns({
                dispose: sandbox.stub(),
            });
            sandbox.stub(vscode.workspace, "notebookDocuments").value([mockNotebook]);

            const ctrl = new SqlNotebookController(
                connectionMgr as unknown as ConnectionManager,
                {} as unknown as ConnectionSharingService,
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
            sandbox
                .stub(vscode.window, "showNotebookDocument")
                .resolves({} as unknown as vscode.NotebookEditor);

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
            sandbox
                .stub(vscode.window, "showNotebookDocument")
                .resolves({} as unknown as vscode.NotebookEditor);
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const connInfo = {
                server: "test-server",
                database: "TestDB",
                authenticationType: "SqlLogin",
            } as IConnectionInfo;

            await controller.createNotebookWithConnection(connInfo);

            expect(mockNotebookConnMgr.connectWith).to.have.been.calledWith(connInfo);
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

    suite("connection metadata persistence", () => {
        test("saves metadata to workspaceState after connectWith", async () => {
            const mockNotebook = makeNotebook();
            sandbox.stub(vscode.workspace, "openNotebookDocument").resolves(mockNotebook);
            sandbox
                .stub(vscode.window, "showNotebookDocument")
                .resolves({} as unknown as vscode.NotebookEditor);
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const connInfo = {
                server: "test-server",
                database: "TestDB",
                authenticationType: "SqlLogin",
            } as IConnectionInfo;

            await controller.createNotebookWithConnection(connInfo);

            expect(mockWorkspaceState.update).to.have.been.calledWith(
                `notebook.connection.${notebookUri.toString()}`,
                { server: "test-server", database: "TestDB" },
            );
        });

        test("saves metadata after cell execution establishes connection", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockWorkspaceState.update).to.have.been.calledWith(
                `notebook.connection.${notebookUri.toString()}`,
                { server: "test-server", database: "TestDB" },
            );
        });

        test("restores reconnection context from workspaceState", async () => {
            mockWorkspaceState.get.returns({ server: "saved-server", database: "SavedDB" });

            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockNotebookConnMgr.setReconnectionContext).to.have.been.calledWith(
                "saved-server",
                "SavedDB",
            );
        });

        test("does not set reconnection context when no metadata present", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            expect(mockNotebookConnMgr.setReconnectionContext).to.not.have.been.called;
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
