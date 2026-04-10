/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import { ConnectionSharingService } from "../connectionSharing/connectionSharingService";
import { NotebookConnectionManager } from "./notebookConnectionManager";
import { NotebookCodeLensProvider } from "./notebookCodeLensProvider";
import { NotebookBatchResult } from "./notebookQueryExecutor";
import * as formatter from "./resultFormatter";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";

const MIME_TEXT_PLAIN = "text/plain";

export class SqlNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    readonly connections = new Map<string, NotebookConnectionManager>();
    private readonly codeLensProvider: NotebookCodeLensProvider;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly log: vscode.LogOutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private executionOrder = 0;
    // Track notebooks by their document object to handle URI changes on save
    private readonly notebookToUri = new WeakMap<vscode.NotebookDocument, string>();

    constructor(
        private connectionMgr: ConnectionManager,
        private connectionSharingService: ConnectionSharingService,
        private readonly _workspaceState?: vscode.Memento,
        private readonly _connectionManagerFactory?: (
            connectionMgr: ConnectionManager,
            connectionSharingService: ConnectionSharingService,
            log: vscode.LogOutputChannel,
        ) => NotebookConnectionManager,
    ) {
        this.log = vscode.window.createOutputChannel("MSSQL - Notebooks", { log: true });

        this.controller = vscode.notebooks.createNotebookController(
            "ms-mssql.sql-notebook-controller",
            "jupyter-notebook",
            "MSSQL",
        );

        this.controller.supportedLanguages = ["sql"];
        this.controller.supportsExecutionOrder = true;
        this.controller.description = LocalizedConstants.Notebooks.controllerDescription;
        this.controller.executeHandler = this.executeCells.bind(this);

        // Dedicated status bar item for notebooks — we intentionally do not reuse
        // StatusView because it is keyed by text-editor URI and tightly coupled to
        // the global ConnectionManager, whereas notebooks have per-notebook connections
        // managed by NotebookConnectionManager with notebook-specific commands.
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.statusBarItem.name = "MSSQL Notebook Connection";
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

        // When a notebook is saved, persist connection metadata under the
        // final file URI. This handles the case where a notebook was created
        // as untitled (different URI) and then saved to disk.
        this.disposables.push(
            vscode.workspace.onDidSaveNotebookDocument((notebook) => {
                this.rekeyConnectionOnSave(notebook);
                this.saveConnectionMetadataIfConnected(notebook);
            }),
        );

        // Clean up connection managers when notebooks are closed
        this.disposables.push(
            vscode.workspace.onDidCloseNotebookDocument((notebook) => {
                const key = notebook.uri.toString();
                const mgr = this.connections.get(key);
                if (mgr) {
                    this.log.info(`[onDidCloseNotebookDocument] Disposing manager for ${key}`);
                    mgr.dispose();
                    this.connections.delete(key);
                }
                // Note: WeakMap entry will be garbage collected automatically
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
            mgr = this._connectionManagerFactory
                ? this._connectionManagerFactory(
                      this.connectionMgr,
                      this.connectionSharingService,
                      this.log,
                  )
                : new NotebookConnectionManager(
                      this.connectionMgr,
                      this.connectionSharingService,
                      this.log,
                  );

            // Restore saved database context from workspaceState so the
            // notebook reconnects to its original database instead of master.
            const savedContext = this.readConnectionMetadata(notebook);
            if (savedContext) {
                this.log.info(
                    `[getConnectionManager] Restored context: ${savedContext.server} / ${savedContext.database}`,
                );
                mgr.setReconnectionContext(savedContext.server, savedContext.database);
            }

            this.connections.set(key, mgr);
        }
        // Track this notebook for URI change detection on save
        this.notebookToUri.set(notebook, key);
        return mgr;
    }

    /**
     * When a notebook is saved (untitled → file), its URI changes but the
     * connections map still has the entry under the old key. Re-key it to
     * the new URI by tracking the notebook document object.
     */
    private rekeyConnectionOnSave(notebook: vscode.NotebookDocument): void {
        const newKey = notebook.uri.toString();
        const oldKey = this.notebookToUri.get(notebook);

        // Update tracking with current URI
        this.notebookToUri.set(notebook, newKey);

        // If URI changed and we have a manager under the old key, re-key it
        if (oldKey && oldKey !== newKey && this.connections.has(oldKey)) {
            const mgr = this.connections.get(oldKey)!;
            this.log.info(`[rekeyConnectionOnSave] Re-keying connection: ${oldKey} → ${newKey}`);
            this.connections.delete(oldKey);
            this.connections.set(newKey, mgr);
        }
    }

    /**
     * Read persisted connection metadata (server + database) from
     * workspaceState, keyed by the notebook's URI string.
     */
    private readConnectionMetadata(
        notebook: vscode.NotebookDocument,
    ): { server: string; database: string } | undefined {
        if (!this._workspaceState) {
            return undefined;
        }
        const key = `notebook.connection.${notebook.uri.toString()}`;
        return this._workspaceState.get<{ server: string; database: string }>(key);
    }

    /**
     * Persist the current connection's server + database in workspaceState
     * so it can be restored after a VS Code restart.
     */
    private saveConnectionMetadataIfConnected(notebook: vscode.NotebookDocument): void {
        if (!this._workspaceState) {
            return;
        }
        const mgr = this.connections.get(notebook.uri.toString());
        const info = mgr?.getConnectionInfo();
        if (!info?.server || !info?.database) {
            return;
        }

        const key = `notebook.connection.${notebook.uri.toString()}`;
        this._workspaceState
            .update(key, {
                server: info.server,
                database: info.database,
            })
            .then(undefined, (err) => {
                this.log.warn(
                    `[saveConnectionMetadataIfConnected] Failed to persist connection metadata for ${notebook.uri.toString()}: ${err?.message ?? err}`,
                );
            });
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
            this.statusBarItem.text = `$(check) ${mgr.getConnectionLabel()}`;
            this.statusBarItem.tooltip =
                LocalizedConstants.Notebooks.statusBarClickToChangeConnection;
            this.statusBarItem.command = Constants.cmdNotebooksChangeConnection;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.text = `$(plug) ${LocalizedConstants.StatusBar.disconnectedLabel}`;
            this.statusBarItem.tooltip = LocalizedConstants.StatusBar.notConnectedTooltip;
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
            this.saveConnectionMetadataIfConnected(notebook);
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(
                        LocalizedConstants.Notebooks.errorPrefix(
                            err.message || LocalizedConstants.Notebooks.connectionFailed,
                        ),
                        MIME_TEXT_PLAIN,
                    ),
                ]),
            ]);
            execution.end(false, Date.now());
            return;
        }

        const activity = startActivity(
            TelemetryViews.SqlNotebooks,
            TelemetryActions.ExecuteCell,
            undefined,
            { isMagicCommand: "false" },
        );

        try {
            const result = await connMgr.executeQueryString(code, execution.token);
            const outputs = this.buildBatchOutputs(result.batches);

            if (result.canceled) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(
                            LocalizedConstants.Notebooks.executionCanceled,
                            MIME_TEXT_PLAIN,
                        ),
                    ]),
                );
                execution.replaceOutput(outputs);
                execution.end(false, Date.now());
                activity.end(ActivityStatus.Canceled);
            } else {
                const hasErrors = result.batches.some(
                    (b) => b.hasError || b.messages.some((m) => m.isError),
                );
                execution.replaceOutput(outputs);
                execution.end(!hasErrors, Date.now());
                if (hasErrors) {
                    activity.endFailed(new Error("Query returned errors"));
                } else {
                    activity.end(ActivityStatus.Succeeded);
                }
            }
        } catch (err: any) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.text(
                        LocalizedConstants.Notebooks.errorPrefix(
                            err.message || LocalizedConstants.Notebooks.queryExecutionFailed,
                        ),
                        MIME_TEXT_PLAIN,
                    ),
                ]),
            ]);
            execution.end(false, Date.now());
            activity.endFailed(new Error("Cell execution failed"));
        }
    }

    private buildBatchOutputs(batches: NotebookBatchResult[]): vscode.NotebookCellOutput[] {
        const outputs: vscode.NotebookCellOutput[] = [];

        for (const batch of batches) {
            const messages = (batch.messages ?? []).filter((m) => !m.isError).map((m) => m.message);
            const errorMessages = (batch.messages ?? [])
                .filter((m) => m.isError)
                .map((m) => m.message);

            // Show error messages when present. We intentionally do NOT gate on
            // batch.hasError because STS can omit that flag for parse/syntax errors
            // while still sending error messages with isError=true.
            if (errorMessages.length > 0) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(errorMessages.join(os.EOL)),
                    ]),
                );
            }

            // Show non-error messages (PRINT, info, row counts) before result sets
            if (messages.length > 0) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(messages.join(os.EOL), MIME_TEXT_PLAIN),
                    ]),
                );
            }

            for (const rs of batch.resultSets) {
                if (rs.columnInfo.length === 0) {
                    continue;
                }

                if (rs.rows.length < rs.rowCount) {
                    outputs.push(
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.resultSetTruncated(
                                    rs.rows.length,
                                    rs.rowCount,
                                ),
                                MIME_TEXT_PLAIN,
                            ),
                        ]),
                    );
                }

                const plain = formatter.toPlain(rs.columnInfo, rs.rows);
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.json(
                            {
                                columnInfo: rs.columnInfo,
                                rows: rs.rows,
                                rowCount: rs.rowCount,
                            },
                            "application/vnd.mssql.query-result",
                        ),
                        vscode.NotebookCellOutputItem.text(plain, MIME_TEXT_PLAIN),
                    ]),
                );
            }

            // Show a generic success message only when the batch produced no
            // result sets, no informational messages, and no error messages.
            if (
                batch.resultSets.length === 0 &&
                messages.length === 0 &&
                errorMessages.length === 0
            ) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(
                            LocalizedConstants.Notebooks.commandCompletedSuccessfully,
                            MIME_TEXT_PLAIN,
                        ),
                    ]),
                );
            }
        }

        return outputs;
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
                                MIME_TEXT_PLAIN,
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
                            vscode.NotebookCellOutputItem.text(label, MIME_TEXT_PLAIN),
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
                    this.saveConnectionMetadataIfConnected(notebook);
                    const info = connMgr.getConnectionLabel();
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.connectedTo(info),
                                MIME_TEXT_PLAIN,
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
                                        MIME_TEXT_PLAIN,
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
                    this.saveConnectionMetadataIfConnected(notebook);
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                LocalizedConstants.Notebooks.switchedTo(
                                    connMgr.getConnectionLabel(),
                                ),
                                MIME_TEXT_PLAIN,
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
            this.saveConnectionMetadataIfConnected(notebook);
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
        this.saveConnectionMetadataIfConnected(notebook);
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
        const previousUri = mgr.getConnectionUri();

        try {
            // Prompt first so that cancelling the picker preserves the
            // existing connection instead of disconnecting eagerly.
            await mgr.promptAndConnect();
        } catch (err) {
            // Cancellation (no selection) — silently keep existing connection.
            // Real failures — notify the user so they know the change failed.
            const isCancellation =
                err instanceof Error &&
                err.message === LocalizedConstants.Notebooks.noConnectionSelected;
            if (!isCancellation) {
                const message =
                    err instanceof Error
                        ? err.message
                        : LocalizedConstants.Notebooks.connectionFailed;
                void vscode.window.showErrorMessage(message);
            }
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        // Clean up the previous connection now that the new one succeeded.
        if (previousUri) {
            mgr.disconnectUri(previousUri);
        }

        this.connectCellsForIntellisense(notebook);
        this.saveConnectionMetadataIfConnected(notebook);
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();

        // Follow up with a database picker so the user can choose a database
        // on the newly selected server. Cancelling keeps the default database.
        await this.changeDatabaseInteractive();
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
            this.saveConnectionMetadataIfConnected(notebook);

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
