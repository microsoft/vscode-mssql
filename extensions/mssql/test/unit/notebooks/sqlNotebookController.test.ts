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
import * as Constants from "../../../src/constants/constants";
import * as LocalizedConstants from "../../../src/constants/locConstants";
import { SqlNotebookController } from "../../../src/notebooks/sqlNotebookController";
import ConnectionManager from "../../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../../src/connectionSharing/connectionSharingService";
import type { HeadlessQueryResult } from "../../../src/queryExecution/headlessQueryExecutor";
import { NotebookConnectionManager } from "../../../src/notebooks/notebookConnectionManager";
import { IDbColumn } from "../../../src/models/interfaces";
import { BatchSummary } from "../../../src/models/contracts/queryExecute";
import type { NotebookQueryResultOutputData } from "../../../src/sharedInterfaces/notebookQueryResult";

function makeQueryResult(overrides?: Partial<HeadlessQueryResult>): HeadlessQueryResult {
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
        executionElapsed: "",
        executionEnd: "",
        executionStart: "",
        ...overrides,
    };
}

function getOutputText(output: vscode.NotebookCellOutput, itemIndex = 0): string {
    return new TextDecoder().decode(output.items[itemIndex].data);
}

function getJsonOutput<T>(output: vscode.NotebookCellOutput, itemIndex = 0): T {
    return JSON.parse(getOutputText(output, itemIndex)) as T;
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
        executeHandler: (
            cells: vscode.NotebookCell[],
            notebook: vscode.NotebookDocument,
            controller: vscode.NotebookController,
        ) => void | Thenable<void>;
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
    let executeCommandStub: sinon.SinonStub;

    const notebookUri = vscode.Uri.parse("vscode-notebook://test-notebook");

    function makeNotebook(
        cells?: Array<{ text: string; languageId?: string; kind?: vscode.NotebookCellKind }>,
        metadata?: Record<string, unknown>,
        uri: vscode.Uri = notebookUri,
    ): vscode.NotebookDocument {
        const cellObjs = (cells ?? []).map((c, i) => ({
            index: i,
            kind: c.kind ?? vscode.NotebookCellKind.Code,
            document: {
                getText: () => c.text,
                languageId: c.languageId ?? "sql",
                // Mirror VS Code's cell URI shape: notebook URI with the
                // vscode-notebook-cell scheme and a per-cell fragment.
                uri: uri.with({ scheme: "vscode-notebook-cell", fragment: `cell${i}` }),
            },
        }));
        return {
            uri,
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

    // Handlers captured from the controller's event subscriptions so tests can
    // simulate workspace events, plus a mutable open-notebooks array.
    // Note: onDidOpen/CloseNotebookDocument cannot be sinon-stubbed on
    // vscode.workspace in the test host; tests invoke the controller's
    // handleNotebookOpened/handleNotebookClosed methods directly instead.
    let didSaveNotebookHandler: (notebook: vscode.NotebookDocument) => void;
    let didOpenTextDocumentHandler: (doc: vscode.TextDocument) => void;
    let openNotebookDocuments: vscode.NotebookDocument[];

    function setupVscodeMocks(sb: sinon.SinonSandbox): void {
        sb.stub(vscode.notebooks, "createNotebookController").returns(
            mockController as unknown as vscode.NotebookController,
        );
        sb.stub(vscode.notebooks, "createRendererMessaging").returns({
            onDidReceiveMessage: sb.stub().returns({ dispose: sb.stub() }),
            postMessage: sb.stub().resolves(true),
        } as unknown as vscode.NotebookRendererMessaging);
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
        sb.stub(vscode.workspace, "onDidSaveNotebookDocument").callsFake((listener) => {
            didSaveNotebookHandler = listener as (notebook: vscode.NotebookDocument) => void;
            return { dispose: sb.stub() };
        });
        sb.stub(vscode.workspace, "onDidOpenTextDocument").callsFake((listener) => {
            didOpenTextDocumentHandler = listener as (doc: vscode.TextDocument) => void;
            return { dispose: sb.stub() };
        });
        sb.stub(vscode.workspace, "onDidCloseNotebookDocument").returns({
            dispose: sb.stub(),
        });
        sb.stub(vscode.languages, "registerCodeLensProvider").returns({
            dispose: sb.stub(),
        });
        openNotebookDocuments = [];
        sb.stub(vscode.workspace, "notebookDocuments").value(openNotebookDocuments);
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
            executeHandler: sandbox.stub(),
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
        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);

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

        test("shows total execution time after a single result set", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ executionElapsed: "00:00:01.234" }),
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

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall
                .args[0] as vscode.NotebookCellOutput[];
            expect(outputs).to.have.lengthOf(1);
            expect(outputs[0].items[0].mime).to.equal("application/vnd.mssql.query-result");
            const output = getJsonOutput<NotebookQueryResultOutputData>(outputs[0]);
            expect(output.blocks.map((block) => block.type)).to.deep.equal(["resultSet", "text"]);
            expect(output.blocks[1]).to.deep.equal({
                type: "text",
                text: LocalizedConstants.elapsedTimeLabel("00:00:01.234"),
            });
            expect(getOutputText(outputs[0], 1)).to.include(
                LocalizedConstants.elapsedTimeLabel("00:00:01.234"),
            );
        });

        test("adds spacing between multiple result grids and appends execution time once", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ executionElapsed: "00:00:02.000" }),
                            messages: [],
                            resultSets: [
                                {
                                    columnInfo: [makeColumn("id", "int")],
                                    rows: [[{ displayValue: "1", isNull: false }]],
                                    rowCount: 1,
                                },
                                {
                                    columnInfo: [makeColumn("name", "nvarchar")],
                                    rows: [[{ displayValue: "Alice", isNull: false }]],
                                    rowCount: 1,
                                },
                            ],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT 1 AS id; SELECT 'Alice' AS name;" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall
                .args[0] as vscode.NotebookCellOutput[];
            expect(outputs).to.have.lengthOf(1);

            const output = getJsonOutput<NotebookQueryResultOutputData>(outputs[0]);
            expect(output.blocks.map((block) => block.type)).to.deep.equal([
                "resultSet",
                "resultSet",
                "text",
            ]);

            const executionTimeBlock = output.blocks[2];
            expect(executionTimeBlock).to.deep.equal({
                type: "text",
                text: LocalizedConstants.elapsedTimeLabel("00:00:02.000"),
            });
        });

        test("shows total execution time after message-only execution", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({ executionElapsed: "00:00:00.450" }),
                            messages: [
                                {
                                    batchId: 0,
                                    isError: false,
                                    time: new Date().toISOString(),
                                    message: "(1 row(s) affected)",
                                },
                            ],
                            resultSets: [],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "PRINT 'done'" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall
                .args[0] as vscode.NotebookCellOutput[];
            expect(outputs).to.have.lengthOf(2);
            expect(getOutputText(outputs[0])).to.equal("(1 row(s) affected)");
            expect(getOutputText(outputs[1])).to.equal(
                LocalizedConstants.elapsedTimeLabel("00:00:00.450"),
            );
        });

        test("shows total execution time once at the end across multiple batches", async () => {
            mockNotebookConnMgr.executeQueryString.resolves(
                makeQueryResult({
                    batches: [
                        {
                            batchSummary: makeBatchSummary({
                                id: 0,
                                executionElapsed: "00:00:01.000",
                            }),
                            messages: [],
                            resultSets: [],
                            hasError: false,
                        },
                        {
                            batchSummary: makeBatchSummary({
                                id: 1,
                                executionElapsed: "00:00:00.250",
                            }),
                            messages: [],
                            resultSets: [],
                            hasError: false,
                        },
                    ],
                }),
            );

            const notebook = makeNotebook([{ text: "SELECT 1\nGO\nSELECT 2" }]);
            const cells = notebook.getCells();

            await mockController.executeHandler(cells, notebook, mockController);

            const outputs = mockExecution.replaceOutput.firstCall
                .args[0] as vscode.NotebookCellOutput[];
            const executionTimeText = LocalizedConstants.elapsedTimeLabel("00:00:01.250");
            const executionTimeOutputs = outputs.filter(
                (output) => getOutputText(output) === executionTimeText,
            );

            expect(executionTimeOutputs).to.have.lengthOf(1);
            expect(getOutputText(outputs[outputs.length - 1])).to.equal(executionTimeText);
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
            expect(outputs).to.have.lengthOf(1);

            const output = getJsonOutput<NotebookQueryResultOutputData>(outputs[0]);
            expect(output.blocks.map((block) => block.type)).to.deep.equal(["text", "resultSet"]);
            const warningBlock = output.blocks[0];
            expect(warningBlock.type).to.equal("text");
            if (warningBlock.type === "text") {
                expect(warningBlock.text).to.include("Warning: Result set is incomplete");
                expect(warningBlock.text).to.include("2");
                expect(warningBlock.text).to.include("1000");
            }

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
            expect(outputs).to.have.lengthOf(1);
            expect(outputs[0].items[0].mime).to.equal("application/vnd.mssql.query-result");
            const output = getJsonOutput<NotebookQueryResultOutputData>(outputs[0]);
            expect(output.blocks.map((block) => block.type)).to.deep.equal([
                "resultSet",
                "error",
                "resultSet",
            ]);
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
                metadata: { kernelspec: { name: "sql", display_name: "SQL" } },
            });

            // Re-stub everything
            mockController = {
                id: "ms-mssql.sql-notebook-controller",
                notebookType: "jupyter-notebook",
                label: "MSSQL",
                supportedLanguages: undefined,
                supportsExecutionOrder: undefined,
                description: undefined,
                executeHandler: sandbox.stub(),
                updateNotebookAffinity: sandbox.stub(),
                createNotebookCellExecution: sandbox.stub().returns(mockExecution),
                onDidChangeSelectedNotebooks: sandbox.stub().returns({ dispose: sandbox.stub() }),
                dispose: sandbox.stub(),
            };
            sandbox
                .stub(vscode.notebooks, "createNotebookController")
                .returns(mockController as unknown as vscode.NotebookController);
            sandbox.stub(vscode.notebooks, "createRendererMessaging").returns({
                onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
                postMessage: sandbox.stub().resolves(true),
            } as unknown as vscode.NotebookRendererMessaging);
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
        test("creates notebook without connection and selects MSSQL kernel", async () => {
            const mockNotebook = makeNotebook();
            const mockNotebookEditor = {
                notebook: mockNotebook,
            } as unknown as vscode.NotebookEditor;
            sandbox.stub(vscode.workspace, "openNotebookDocument").resolves(mockNotebook);
            sandbox.stub(vscode.window, "showNotebookDocument").resolves(mockNotebookEditor);

            await controller.createNotebookWithConnection();

            expect(vscode.workspace.openNotebookDocument).to.have.been.calledWithMatch(
                "jupyter-notebook",
                sinon.match({
                    metadata: {
                        metadata: {
                            kernelspec: {
                                name: "sql-notebook",
                                display_name: "SQL",
                                language: "sql",
                            },
                            language_info: { name: "sql" },
                        },
                    },
                }),
            );
            expect(mockController.updateNotebookAffinity).to.have.been.calledWith(
                mockNotebook,
                vscode.NotebookControllerAffinity.Preferred,
            );
            expect(executeCommandStub).to.have.been.calledWithExactly("notebook.selectKernel", {
                notebookEditor: mockNotebookEditor,
                id: mockController.id,
                extension: Constants.extensionId,
            });
        });

        test("creates notebook, selects MSSQL kernel, and connects with provided connection", async () => {
            const mockNotebook = makeNotebook();
            const mockNotebookEditor = {
                notebook: mockNotebook,
            } as unknown as vscode.NotebookEditor;
            sandbox.stub(vscode.workspace, "openNotebookDocument").resolves(mockNotebook);
            sandbox.stub(vscode.window, "showNotebookDocument").resolves(mockNotebookEditor);
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const connInfo = {
                server: "test-server",
                database: "TestDB",
                authenticationType: "SqlLogin",
            } as IConnectionInfo;

            await controller.createNotebookWithConnection(connInfo);

            expect(executeCommandStub).to.have.been.calledWithExactly("notebook.selectKernel", {
                notebookEditor: mockNotebookEditor,
                id: mockController.id,
                extension: Constants.extensionId,
            });
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

    suite("save URI transfer", () => {
        test("re-keys manager and re-registers cells when notebook URI changes on save", async () => {
            const untitledUri = vscode.Uri.parse("untitled:Untitled-1.ipynb");
            const notebook = makeNotebook([{ text: "SELECT 1" }], undefined, untitledUri);

            // Execute once so the manager is tracked under the untitled URI.
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);
            expect(controller.connections.get(untitledUri.toString())).to.equal(
                mockNotebookConnMgr,
            );

            // Simulate the save assigning the final file URI.
            const fileUri = vscode.Uri.parse("file:///c:/temp/notebook1.ipynb");
            (notebook as { uri: vscode.Uri }).uri = fileUri;
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();

            didSaveNotebookHandler(notebook);

            // Manager re-keyed to the new URI.
            expect(controller.connections.has(untitledUri.toString())).to.be.false;
            expect(controller.connections.get(fileUri.toString())).to.equal(mockNotebookConnMgr);

            // Stale cell registrations released and current cells re-registered
            // so IntelliSense keeps working under the new cell URIs.
            expect(mockNotebookConnMgr.releaseCellRegistrations).to.have.been.calledOnce;
            expect(mockNotebookConnMgr.connectCellForIntellisense).to.have.been.calledWith(
                notebook.getCells()[0].document.uri.toString(),
            );
        });

        test("does not release registrations when URI is unchanged on save", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);

            didSaveNotebookHandler(notebook);

            expect(mockNotebookConnMgr.releaseCellRegistrations).to.not.have.been.called;
        });
    });

    suite("untitled save adoption (close + reopen transition)", () => {
        const untitledUri = vscode.Uri.parse("untitled:Untitled-1.ipynb");
        const savedUri = vscode.Uri.parse("file:///c:/src/note1.ipynb");

        /** Connect an untitled notebook so its manager is tracked by the controller. */
        async function connectUntitledNotebook(
            text = "SELECT 1",
        ): Promise<vscode.NotebookDocument> {
            const notebook = makeNotebook([{ text }], undefined, untitledUri);
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);
            expect(controller.connections.get(untitledUri.toString())).to.equal(
                mockNotebookConnMgr,
            );
            return notebook;
        }

        test("close then open: parked manager is adopted by matching file notebook", async () => {
            const untitled = await connectUntitledNotebook();

            // Save replaces the document: the untitled notebook closes...
            controller.handleNotebookClosed(untitled);
            expect(controller.connections.has(untitledUri.toString())).to.be.false;
            // ...but the connected manager must survive the transition.
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;

            // ...and the file-based notebook opens with the same content.
            const saved = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();
            controller.handleNotebookOpened(saved);

            expect(controller.connections.get(savedUri.toString())).to.equal(mockNotebookConnMgr);
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;
            // Old cell registrations released, new cell URIs registered.
            expect(mockNotebookConnMgr.releaseCellRegistrations).to.have.been.calledOnce;
            expect(mockNotebookConnMgr.connectCellForIntellisense).to.have.been.calledWith(
                saved.getCells()[0].document.uri.toString(),
            );
            // Connection metadata persisted under the new file URI.
            expect(mockWorkspaceState.update).to.have.been.calledWith(
                `notebook.connection.${savedUri.toString()}`,
                sinon.match({ server: "test-server", database: "TestDB" }),
            );
        });

        test("open then close: adoption still occurs when the file notebook opens first", async () => {
            const untitled = await connectUntitledNotebook();

            // The file-based notebook opens (and is seen opening) before the
            // untitled one closes.
            const saved = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            openNotebookDocuments.push(saved);
            controller.handleNotebookOpened(saved);

            controller.handleNotebookClosed(untitled);

            expect(controller.connections.get(savedUri.toString())).to.equal(mockNotebookConnMgr);
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;
            expect(mockNotebookConnMgr.releaseCellRegistrations).to.have.been.calledOnce;
        });

        test("park-time scan ignores notebooks that were not recently opened", async () => {
            const untitled = await connectUntitledNotebook();

            // A matching file notebook is open but was NEVER seen opening in
            // the adoption window (e.g. a long-open unrelated notebook).
            const oldNotebook = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            openNotebookDocuments.push(oldNotebook);

            controller.handleNotebookClosed(untitled);

            // Parked, not adopted into the stale notebook.
            expect(controller.connections.has(savedUri.toString())).to.be.false;
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;
        });

        test("does not steal a connected untitled notebook that still has an open tab", async () => {
            const untitled = await connectUntitledNotebook();
            openNotebookDocuments.push(untitled);
            // The untitled notebook still has an editor tab — the user is
            // actively using it; it is not a save-replacement leftover.
            sandbox.stub(controller, "isNotebookOpenInTab").returns(true);

            const saved = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            controller.handleNotebookOpened(saved);

            expect(controller.connections.has(savedUri.toString())).to.be.false;
            expect(controller.connections.get(untitledUri.toString())).to.equal(
                mockNotebookConnMgr,
            );
        });

        test("adopts a live manager when the untitled document lingers open (no close event)", async () => {
            const untitled = await connectUntitledNotebook();
            // The replaced untitled document stays open — no close event fires.
            openNotebookDocuments.push(untitled);

            const saved = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();
            controller.handleNotebookOpened(saved);

            expect(controller.connections.get(savedUri.toString())).to.equal(mockNotebookConnMgr);
            expect(controller.connections.has(untitledUri.toString())).to.be.false;
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;
            expect(mockNotebookConnMgr.releaseCellRegistrations).to.have.been.calledOnce;
            expect(mockNotebookConnMgr.connectCellForIntellisense).to.have.been.calledWith(
                saved.getCells()[0].document.uri.toString(),
            );
        });

        test("save event adopts a lingering manager when the open event found no match", async () => {
            const untitled = await connectUntitledNotebook();
            openNotebookDocuments.push(untitled);

            const saved = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            didSaveNotebookHandler(saved);

            expect(controller.connections.get(savedUri.toString())).to.equal(mockNotebookConnMgr);
            expect(mockNotebookConnMgr.releaseCellRegistrations).to.have.been.calledOnce;
        });

        test("does not steal a live manager whose untitled document content differs", async () => {
            const untitled = await connectUntitledNotebook("SELECT 1");
            openNotebookDocuments.push(untitled);

            const saved = makeNotebook([{ text: "SELECT 999" }], undefined, savedUri);
            controller.handleNotebookOpened(saved);

            // No transfer — the untitled notebook keeps its manager.
            expect(controller.connections.has(savedUri.toString())).to.be.false;
            expect(controller.connections.get(untitledUri.toString())).to.equal(
                mockNotebookConnMgr,
            );
        });

        test("does not adopt into a notebook with different content; disposes after TTL", async () => {
            const clock = sandbox.useFakeTimers();
            const untitled = await connectUntitledNotebook("SELECT 1");

            controller.handleNotebookClosed(untitled);

            const unrelated = makeNotebook([{ text: "SELECT 999" }], undefined, savedUri);
            controller.handleNotebookOpened(unrelated);
            expect(controller.connections.has(savedUri.toString())).to.be.false;

            // Nothing adopted the parked manager — it must be disposed after the TTL
            // so the orphaned connection is cleaned up.
            await clock.tickAsync(11000);
            expect(mockNotebookConnMgr.dispose).to.have.been.called;

            clock.restore();
        });

        test("disposes immediately when a file-based notebook closes", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }], undefined, savedUri);
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);

            controller.handleNotebookClosed(notebook);

            expect(mockNotebookConnMgr.dispose).to.have.been.called;
            expect(controller.connections.has(savedUri.toString())).to.be.false;
        });

        test("disposes immediately when a disconnected untitled notebook closes", async () => {
            const untitled = await connectUntitledNotebook();
            mockNotebookConnMgr.isConnected.returns(false);

            controller.handleNotebookClosed(untitled);

            expect(mockNotebookConnMgr.dispose).to.have.been.called;
        });

        test("re-parking a reused untitled URI disposes the superseded manager and keeps the new one adoptable", async () => {
            // VS Code recycles untitled names: two different notebooks can be
            // parked under the same untitled URI within the TTL window.
            const mgrA = sandbox.createStubInstance(NotebookConnectionManager);
            mgrA.isConnected.returns(true);
            const untitledA = makeNotebook([{ text: "SELECT 1" }], undefined, untitledUri);
            controller.connections.set(untitledUri.toString(), mgrA);
            controller.handleNotebookClosed(untitledA);

            const mgrB = sandbox.createStubInstance(NotebookConnectionManager);
            mgrB.isConnected.returns(true);
            const untitledB = makeNotebook([{ text: "SELECT 2" }], undefined, untitledUri);
            controller.connections.set(untitledUri.toString(), mgrB);
            controller.handleNotebookClosed(untitledB);

            // The superseded first manager is disposed; the second survives.
            expect(mgrA.dispose).to.have.been.called;
            expect(mgrB.dispose).to.not.have.been.called;

            // The second manager is still adoptable by its saved notebook.
            const saved = makeNotebook([{ text: "SELECT 2" }], undefined, savedUri);
            controller.handleNotebookOpened(saved);
            expect(controller.connections.get(savedUri.toString())).to.equal(mgrB);
        });

        test("controller dispose cleans up parked managers", async () => {
            const untitled = await connectUntitledNotebook();
            controller.handleNotebookClosed(untitled);
            expect(mockNotebookConnMgr.dispose).to.not.have.been.called;

            controller.dispose();

            expect(mockNotebookConnMgr.dispose).to.have.been.called;
        });
    });

    suite("late cell document registration", () => {
        test("registers a cell document that opens while the notebook is connected", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            openNotebookDocuments.push(notebook);

            // Execute once so a connected manager exists for the notebook.
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();

            const cellDoc = notebook.getCells()[0].document;
            didOpenTextDocumentHandler(cellDoc);

            expect(mockNotebookConnMgr.connectCellForIntellisense).to.have.been.calledWith(
                cellDoc.uri.toString(),
            );
        });

        test("ignores non-cell documents", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            openNotebookDocuments.push(notebook);
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();

            didOpenTextDocumentHandler({
                uri: vscode.Uri.parse("file:///c:/temp/query.sql"),
                languageId: "sql",
            } as vscode.TextDocument);

            expect(mockNotebookConnMgr.connectCellForIntellisense).to.not.have.been.called;
        });

        test("skips cell documents whose notebook has no manager", () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            openNotebookDocuments.push(notebook);

            const cellDoc = notebook.getCells()[0].document;
            didOpenTextDocumentHandler(cellDoc);

            expect(mockNotebookConnMgr.connectCellForIntellisense).to.not.have.been.called;
        });

        test("skips cell documents when the notebook is not connected", async () => {
            const notebook = makeNotebook([{ text: "SELECT 1" }]);
            openNotebookDocuments.push(notebook);
            await mockController.executeHandler(notebook.getCells(), notebook, mockController);

            mockNotebookConnMgr.isConnected.returns(false);
            mockNotebookConnMgr.connectCellForIntellisense.resetHistory();

            const cellDoc = notebook.getCells()[0].document;
            didOpenTextDocumentHandler(cellDoc);

            expect(mockNotebookConnMgr.connectCellForIntellisense).to.not.have.been.called;
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
