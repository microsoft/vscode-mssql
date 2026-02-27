/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import { ConnectionSharingService } from "../connectionSharing/connectionSharingService";
import { NotebookConnectionManager } from "./notebookConnectionManager";
import { NotebookCodeLensProvider } from "./notebookCodeLensProvider";
import { parseBatches } from "./batchParser";
import * as formatter from "./resultFormatter";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";

export class SqlNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    readonly connections = new Map<string, NotebookConnectionManager>();
    private readonly codeLensProvider: NotebookCodeLensProvider;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly log: vscode.LogOutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private executionOrder = 0;

    constructor(
        private connectionMgr: ConnectionManager,
        private connectionSharingService: ConnectionSharingService,
    ) {
        this.log = vscode.window.createOutputChannel("SQL Notebooks", { log: true });

        this.controller = vscode.notebooks.createNotebookController(
            "ms-mssql.sql-notebook-controller",
            "jupyter-notebook",
            "SQL",
        );

        this.controller.supportedLanguages = ["sql"];
        this.controller.supportsExecutionOrder = true;
        this.controller.description = LocalizedConstants.Notebooks.controllerDescription;
        this.controller.executeHandler = this.executeCells.bind(this);

        // Status bar item shows the SQL Notebooks connection (authoritative source)
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.name = "SQL Notebook Connection";
        this.updateStatusBar(undefined);

        // Code lens provider for notebook cells — shows correct connection
        this.codeLensProvider = new NotebookCodeLensProvider(this.connections);
        this.disposables.push(
            vscode.languages.registerCodeLensProvider(
                { language: "sql", notebookType: "jupyter-notebook" },
                this.codeLensProvider,
            ),
        );

        // Update the status bar to reflect the active notebook.
        this.disposables.push(
            vscode.window.onDidChangeActiveNotebookEditor((editor) => {
                this.updateStatusBar(editor?.notebook);
            }),
        );

        // Auto-detect SQL notebooks and set affinity so VS Code
        // auto-selects our kernel instead of showing "Detecting Kernels".
        this.disposables.push(
            vscode.workspace.onDidOpenNotebookDocument((notebook) => {
                if (notebook.notebookType === "jupyter-notebook") {
                    this.setAffinityIfSql(notebook);
                }
            }),
        );

        // Set affinity for notebooks already open when the extension activates
        for (const notebook of vscode.workspace.notebookDocuments) {
            if (notebook.notebookType === "jupyter-notebook") {
                this.setAffinityIfSql(notebook);
            }
        }

        // When our controller is selected for a notebook, ensure all code
        // cells use SQL language. This fixes the case where cells were loaded
        // as Python (Jupyter default) before our kernel was selected.
        this.disposables.push(
            this.controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
                if (selected) {
                    this.log.info(
                        `[onDidChangeSelectedNotebooks] Selected for ${notebook.uri.toString()}`,
                    );
                    this.ensureSqlCellLanguage(notebook);
                    this.updateStatusBar(notebook);
                }
            }),
        );

        // When new cells are added to a notebook, connect them to STS
        // for IntelliSense if the notebook already has an active connection.
        this.disposables.push(
            vscode.workspace.onDidChangeNotebookDocument((e) => {
                if (e.contentChanges.length === 0) {
                    return;
                }
                const mgr = this.connections.get(e.notebook.uri.toString());
                if (!mgr?.isConnected()) {
                    return;
                }
                for (const change of e.contentChanges) {
                    for (const cell of change.addedCells) {
                        if (
                            cell.kind === vscode.NotebookCellKind.Code &&
                            cell.document.languageId === "sql"
                        ) {
                            void mgr.connectCellForIntellisense(cell.document.uri.toString());
                        }
                    }
                }
            }),
        );
    }

    /**
     * Check if a notebook appears to be a SQL notebook (based on metadata
     * and cell languages) and set controller affinity to Preferred.
     * This ensures VS Code auto-selects our kernel when reopening saved
     * SQL notebooks instead of showing "Detecting Kernels".
     */
    private setAffinityIfSql(notebook: vscode.NotebookDocument): void {
        const metadata = notebook.metadata;

        // Check kernelspec in notebook metadata.
        // The ipynb serializer can nest metadata in different ways.
        const kernelspec =
            metadata?.custom?.metadata?.kernelspec ??
            metadata?.metadata?.kernelspec ??
            metadata?.kernelspec;

        if (kernelspec) {
            const name = String(kernelspec.name ?? "").toLowerCase();
            const displayName = String(kernelspec.display_name ?? "").toLowerCase();
            if (name.includes("sql-notebook") || name === "sql" || displayName === "sql") {
                this.log.info(
                    `[setAffinityIfSql] Matched kernelspec for ${notebook.uri.toString()}`,
                );
                this.controller.updateNotebookAffinity(
                    notebook,
                    vscode.NotebookControllerAffinity.Preferred,
                );
                sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.KernelSelected, {
                    detectionMethod: "kernelspec",
                });
                return;
            }
        }

        // Check language_info
        const languageInfo =
            metadata?.custom?.metadata?.language_info ??
            metadata?.metadata?.language_info ??
            metadata?.language_info;

        if (languageInfo?.name?.toLowerCase() === "sql") {
            this.log.info(
                `[setAffinityIfSql] Matched language_info for ${notebook.uri.toString()}`,
            );
            this.controller.updateNotebookAffinity(
                notebook,
                vscode.NotebookControllerAffinity.Preferred,
            );
            sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.KernelSelected, {
                detectionMethod: "languageInfo",
            });
            return;
        }

        // Fallback: check if all code cells use SQL language
        const codeCells = notebook
            .getCells()
            .filter((c) => c.kind === vscode.NotebookCellKind.Code);
        if (codeCells.length > 0 && codeCells.every((c) => c.document.languageId === "sql")) {
            this.log.info(
                `[setAffinityIfSql] All code cells are SQL for ${notebook.uri.toString()}`,
            );
            this.controller.updateNotebookAffinity(
                notebook,
                vscode.NotebookControllerAffinity.Preferred,
            );
            sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.KernelSelected, {
                detectionMethod: "allCellsSql",
            });
        }
    }

    /**
     * Ensure all code cells in the notebook use SQL language.
     * When our controller is selected, cells may still have their default
     * language (e.g. "python") from before the kernel was chosen.
     */
    private ensureSqlCellLanguage(notebook: vscode.NotebookDocument): void {
        for (const cell of notebook.getCells()) {
            if (cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId !== "sql") {
                this.log.info(
                    `[ensureSqlCellLanguage] Cell ${cell.index}: "${cell.document.languageId}" → "sql"`,
                );
                vscode.languages.setTextDocumentLanguage(cell.document, "sql");
            }
        }
    }

    /**
     * Connect all SQL code cells in the notebook to STS for IntelliSense.
     * Called after any connection state change (connect, disconnect+reconnect,
     * database switch) so that cell URIs are registered with STS and
     * completions/hover/diagnostics work.
     */
    private connectCellsForIntellisense(notebook: vscode.NotebookDocument): void {
        const mgr = this.connections.get(notebook.uri.toString());
        if (!mgr?.isConnected() || !mgr.getConnectionInfo()) {
            return;
        }

        for (const cell of notebook.getCells()) {
            if (cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId === "sql") {
                void mgr.connectCellForIntellisense(cell.document.uri.toString());
            }
        }
    }

    private getConnectionManager(notebook: vscode.NotebookDocument): NotebookConnectionManager {
        const key = notebook.uri.toString();
        let mgr = this.connections.get(key);
        if (!mgr) {
            mgr = new NotebookConnectionManager(
                this.connectionMgr,
                this.connectionSharingService,
                this.log,
            );
            this.connections.set(key, mgr);
        }
        return mgr;
    }

    /**
     * Update the status bar to show the connection for the given notebook.
     * If notebook is undefined or not connected, hides the status bar.
     */
    private updateStatusBar(notebook: vscode.NotebookDocument | undefined): void {
        if (!notebook) {
            this.statusBarItem.hide();
            return;
        }
        const mgr = this.connections.get(notebook.uri.toString());
        if (mgr?.isConnected()) {
            this.statusBarItem.text = `$(database) ${mgr.getConnectionLabel()}`;
            this.statusBarItem.tooltip =
                LocalizedConstants.Notebooks.statusBarClickToChangeDatabase;
            this.statusBarItem.command = Constants.cmdNotebooksChangeDatabase;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.text = `$(database) ${LocalizedConstants.Notebooks.statusBarNotConnected}`;
            this.statusBarItem.tooltip = LocalizedConstants.Notebooks.statusBarClickToConnect;
            this.statusBarItem.command = Constants.cmdNotebooksChangeConnection;
            this.statusBarItem.show();
        }
    }

    private async executeCells(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController,
    ): Promise<void> {
        for (const cell of cells) {
            await this.executeCell(cell, notebook);
        }
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    private async executeCell(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
    ): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        const code = cell.document.getText().trim();

        if (!code) {
            execution.end(true, Date.now());
            return;
        }

        const connMgr = this.getConnectionManager(notebook);

        // Handle magic commands
        if (code.startsWith("%%")) {
            await this.handleMagic(code, execution, connMgr, notebook);
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        // Ensure we have a connection (one per notebook, reused across cells)
        try {
            await connMgr.ensureConnection();
            this.connectCellsForIntellisense(notebook);
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(
                        LocalizedConstants.Notebooks.errorPrefix(
                            err.message || LocalizedConstants.Notebooks.connectionFailed,
                        ),
                        "text/plain",
                    ),
                ]),
            ]);
            execution.end(false, Date.now());
            return;
        }

        // Parse batches and execute
        const batches = parseBatches(code);
        const outputs: vscode.NotebookCellOutput[] = [];

        // Cancellation support
        let cancelled = false;
        const cancelListener = execution.token.onCancellationRequested(() => {
            cancelled = true;
            sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.CancelCellExecution);
            void connMgr.cancelExecution();
        });

        const activity = startActivity(
            TelemetryViews.SqlNotebooks,
            TelemetryActions.ExecuteCell,
            undefined,
            { batchCount: String(batches.length), isMagicCommand: "false" },
        );

        try {
            for (const batch of batches) {
                if (cancelled) {
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.executionCancelled,
                                "text/plain",
                            ),
                        ]),
                    );
                    break;
                }

                const result = await connMgr.executeQuery(batch);
                const messages = (result.messages ?? [])
                    .filter((m) => !m.isError)
                    .map((m) => m.message);

                if (result.columnInfo && result.columnInfo.length > 0) {
                    // SELECT or similar — has result set
                    // If there are also messages (e.g. PRINT), show them first
                    if (messages.length > 0) {
                        outputs.push(
                            new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.text(
                                    messages.join("\n"),
                                    "text/plain",
                                ),
                            ]),
                        );
                    }
                    const plain = formatter.toPlain(result.columnInfo, result.rows);
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.json(
                                {
                                    columnInfo: result.columnInfo,
                                    rows: result.rows,
                                    rowCount: result.rowCount,
                                },
                                "application/vnd.mssql.query-result",
                            ),
                            vscode.NotebookCellOutputItem.text(plain, "text/plain"),
                        ]),
                    );
                } else if (messages.length > 0) {
                    // PRINT-only output (no result set)
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(messages.join("\n"), "text/plain"),
                        ]),
                    );
                } else {
                    // INSERT, UPDATE, DELETE, DDL — no messages, no result set
                    const msg =
                        result.rowCount >= 0
                            ? LocalizedConstants.Notebooks.rowsAffected(result.rowCount)
                            : LocalizedConstants.Notebooks.commandCompletedSuccessfully;
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(msg, "text/plain"),
                        ]),
                    );
                }
            }

            execution.replaceOutput(outputs);
            if (cancelled) {
                execution.end(false, Date.now());
                activity.end(ActivityStatus.Canceled);
            } else {
                execution.end(true, Date.now());
                activity.end(ActivityStatus.Succeeded);
            }
        } catch (err: any) {
            if (cancelled) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(
                            LocalizedConstants.Notebooks.executionCancelled,
                            "text/plain",
                        ),
                    ]),
                );
            } else {
                // Show SQL errors as plain text — no JS stack trace
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(
                            LocalizedConstants.Notebooks.errorPrefix(
                                err.message || LocalizedConstants.Notebooks.queryExecutionFailed,
                            ),
                            "text/plain",
                        ),
                    ]),
                );
            }
            execution.replaceOutput(outputs);
            execution.end(false, Date.now());
            activity.endFailed(new Error("Cell execution failed"));
        } finally {
            cancelListener.dispose();
        }
    }

    private async handleMagic(
        code: string,
        execution: vscode.NotebookCellExecution,
        connMgr: NotebookConnectionManager,
        notebook: vscode.NotebookDocument,
    ): Promise<void> {
        const lines = code.split("\n");
        const firstLine = lines[0].trim();
        const parts = firstLine.split(/\s+/);
        const command = parts[0].substring(2).toLowerCase(); // strip %%

        sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.MagicCommand, { command });

        try {
            switch (command) {
                case "disconnect": {
                    connMgr.disconnect();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.disconnected,
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "connection": {
                    const label = connMgr.getConnectionLabel();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(label, "text/plain"),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "connect": {
                    // Force a new connection prompt
                    connMgr.disconnect();
                    await connMgr.promptAndConnect();
                    this.connectCellsForIntellisense(notebook);
                    const info = connMgr.getConnectionLabel();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.connectedTo(info),
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                case "use": {
                    // %%use <database> — switch database
                    await connMgr.ensureConnection();
                    let targetDb = parts.slice(1).join(" ").trim();

                    if (!targetDb) {
                        // No arg — show quick pick
                        const databases = await connMgr.listDatabases();
                        const currentDb = connMgr.getCurrentDatabase();
                        const picked = await vscode.window.showQuickPick(
                            databases.map((db) => ({
                                label: db,
                                description:
                                    db.toLowerCase() === currentDb.toLowerCase()
                                        ? LocalizedConstants.Notebooks.currentDatabaseLabel
                                        : undefined,
                            })),
                            {
                                title: LocalizedConstants.Notebooks.selectDatabase,
                                placeHolder: LocalizedConstants.Notebooks.chooseDatabasePlaceholder,
                            },
                        );
                        if (!picked) {
                            execution.replaceOutput([
                                new vscode.NotebookCellOutput([
                                    vscode.NotebookCellOutputItem.text(
                                        LocalizedConstants.Notebooks.noDatabaseSelected,
                                        "text/plain",
                                    ),
                                ]),
                            ]);
                            execution.end(true, Date.now());
                            break;
                        }
                        targetDb = picked.label;
                    }

                    await connMgr.changeDatabase(targetDb);
                    this.connectCellsForIntellisense(notebook);
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.switchedTo(
                                    connMgr.getConnectionLabel(),
                                ),
                                "text/plain",
                            ),
                        ]),
                    ]);
                    execution.end(true, Date.now());
                    break;
                }

                default: {
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.error(
                                new Error(
                                    LocalizedConstants.Notebooks.unknownMagicCommand(command),
                                ),
                            ),
                        ]),
                    ]);
                    execution.end(false, Date.now());
                }
            }
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(new Error(err.message || String(err))),
                ]),
            ]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Show a quick pick of databases for the active notebook and switch.
     * Called from the command palette, code lens click, or status bar click.
     */
    async changeDatabaseInteractive(): Promise<void> {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        if (!notebook) {
            vscode.window.showWarningMessage(LocalizedConstants.Notebooks.noActiveNotebook);
            return;
        }

        const mgr = this.connections.get(notebook.uri.toString());
        if (!mgr?.isConnected()) {
            // Not connected yet — prompt for a connection first
            const connMgr = this.getConnectionManager(notebook);
            await connMgr.promptAndConnect();
            this.connectCellsForIntellisense(notebook);
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        const databases = await mgr.listDatabases();
        const currentDb = mgr.getCurrentDatabase();

        const picked = await vscode.window.showQuickPick(
            databases.map((db) => ({
                label: db,
                description:
                    db.toLowerCase() === currentDb.toLowerCase()
                        ? LocalizedConstants.Notebooks.currentDatabaseLabel
                        : undefined,
            })),
            {
                title: LocalizedConstants.Notebooks.selectDatabase,
                placeHolder: LocalizedConstants.Notebooks.chooseDatabasePlaceholder,
            },
        );

        if (!picked) {
            return;
        }

        await mgr.changeDatabase(picked.label);
        this.connectCellsForIntellisense(notebook);
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    /**
     * Prompt the user to pick a new connection for the active notebook.
     * Called from the "not connected" code lens or command palette.
     */
    async changeConnectionInteractive(): Promise<void> {
        const notebook = vscode.window.activeNotebookEditor?.notebook;
        if (!notebook) {
            vscode.window.showWarningMessage(LocalizedConstants.Notebooks.noActiveNotebook);
            return;
        }

        const mgr = this.getConnectionManager(notebook);
        mgr.disconnect();
        await mgr.promptAndConnect();
        this.connectCellsForIntellisense(notebook);
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
    }

    async createNotebookWithConnection(connectionInfo?: IConnectionInfo): Promise<void> {
        sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.CreateNotebook, {
            source: connectionInfo ? "objectExplorer" : "commandPalette",
        });

        const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "", "sql");
        const notebookData = new vscode.NotebookData([cellData]);
        const notebook = await vscode.workspace.openNotebookDocument(
            "jupyter-notebook",
            notebookData,
        );

        await vscode.window.showNotebookDocument(notebook);

        this.controller.updateNotebookAffinity(
            notebook,
            vscode.NotebookControllerAffinity.Preferred,
        );

        if (connectionInfo) {
            const connMgr = this.getConnectionManager(notebook);
            await connMgr.connectWith(connectionInfo);
            this.connectCellsForIntellisense(notebook);

            const label = connMgr.getConnectionLabel();
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            vscode.window.showInformationMessage(
                LocalizedConstants.Notebooks.notebookConnectedTo(label),
            );
        }
    }

    dispose(): void {
        for (const mgr of this.connections.values()) {
            mgr.dispose();
        }
        this.connections.clear();
        this.disposables.forEach((d) => d.dispose());
        this.statusBarItem.dispose();
        this.controller.dispose();
        this.log.dispose();
    }
}
