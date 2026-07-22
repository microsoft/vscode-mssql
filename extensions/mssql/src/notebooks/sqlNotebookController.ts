/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import { ConnectionSharingService } from "../connectionSharing/connectionSharingService";
import * as Utils from "../models/utils";
import { ILogger } from "../sharedInterfaces/logger";
import { Logger } from "../models/logger";
import { NotebookConnectionManager } from "./notebookConnectionManager";
import { NotebookCodeLensProvider } from "./notebookCodeLensProvider";
import { HeadlessBatchResult } from "../queryExecution/headlessQueryExecutor";
import * as formatter from "./resultFormatter";
import type {
    NotebookQueryResultBlock,
    NotebookQueryResultGridBlock,
    NotebookQueryResultOutputData,
    NotebookSaveAsMessage,
} from "../sharedInterfaces/notebookQueryResult";
import { saveNotebookResults } from "./notebookResultsSerializer";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions, ActivityStatus } from "../sharedInterfaces/telemetry";

const NOTEBOOK_RESULT_RENDERER_ID = "ms-mssql.sql-result-renderer";

/**
 * How long a connection manager parked by the close of an untitled notebook
 * waits to be adopted by the file-based notebook that replaces it on save,
 * before being disposed (which closes its connection).
 */
const SAVE_ADOPTION_TTL_MS = 10000;

const MIME_TEXT_PLAIN = "text/plain";
const MIME_NOTEBOOK_QUERY_RESULT = "application/vnd.mssql.query-result";
type NotebookTextualResultBlock = Exclude<NotebookQueryResultBlock, NotebookQueryResultGridBlock>;

/**
 * Notebook-level metadata identifying a notebook as SQL. The VS Code ipynb
 * serializer writes kernelspec/language_info from notebook.metadata.metadata
 * to the .ipynb file, and reads them back from the same location on reopen
 * (see https://github.com/microsoft/vscode/blob/main/extensions/ipynb/src/serializers.ts#L490
 * and https://github.com/microsoft/vscode/blob/main/extensions/ipynb/src/deserializers.ts#L371).
 * This allows setAffinityIfSql to re-detect the notebook as SQL on reopen.
 */
interface SqlNotebookMetadata {
    metadata: {
        kernelspec: { name: string; display_name: string; language: string };
        language_info: { name: string };
    };
}

function sqlNotebookMetadata(): SqlNotebookMetadata {
    return {
        metadata: {
            kernelspec: {
                name: "sql-notebook",
                display_name: "SQL",
                language: "sql",
            },
            language_info: {
                name: "sql",
            },
        },
    };
}

export class SqlNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    readonly connections = new Map<string, NotebookConnectionManager>();
    private readonly codeLensProvider: NotebookCodeLensProvider;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly log: ILogger;
    private readonly disposables: vscode.Disposable[] = [];
    private executionOrder = 0;
    // Track notebooks by their document object to handle URI changes on save
    private readonly notebookToUri = new WeakMap<vscode.NotebookDocument, string>();
    // Track notebooks using our SQL kernel. When these notebooks are saved, we stamp
    // SQL kernelspec/language_info metadata so the .ipynb file identifies as SQL
    // (not Python) when reopened.
    private readonly selectedNotebooks = new WeakSet<vscode.NotebookDocument>();
    /**
     * Connection managers parked when a connected untitled notebook closes.
     * Saving an untitled notebook REPLACES its NotebookDocument with a new
     * file-based document (close + open) rather than updating the URI in
     * place, so disposing on close would drop the connection mid-save. The
     * file-based notebook that opens with matching cell content adopts the
     * parked manager; unclaimed managers are disposed after a short TTL.
     * Keyed by the closed notebook's URI string.
     */
    private readonly pendingSaveAdoptions = new Map<
        string,
        {
            mgr: NotebookConnectionManager;
            signature: string;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    /**
     * Notebook URIs recently seen opening, with their open timestamps.
     * Used by the park-time adoption scan so a parked connection is only
     * offered to notebooks that appeared around the save transition — not to
     * long-open unrelated notebooks that happen to have matching content.
     */
    private readonly recentNotebookOpens = new Map<string, number>();

    constructor(
        private connectionMgr: ConnectionManager,
        private connectionSharingService: ConnectionSharingService,
        private readonly _workspaceState?: vscode.Memento,
        private readonly _connectionManagerFactory?: (
            connectionMgr: ConnectionManager,
            connectionSharingService: ConnectionSharingService,
            log: ILogger,
        ) => NotebookConnectionManager,
    ) {
        this.log = Logger.forChannelName("MSSQL - Notebooks", "SqlNotebookController");

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
        // Also adopt any connection manager parked by the close of the
        // untitled notebook this document replaced on save.
        this.disposables.push(
            vscode.workspace.onDidOpenNotebookDocument((notebook) =>
                this.handleNotebookOpened(notebook),
            ),
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
                    this.selectedNotebooks.add(notebook);
                    this.log.info(
                        `[onDidChangeSelectedNotebooks] Selected for ${notebook.uri.toString()}`,
                    );
                    this.ensureSqlCellLanguage(notebook);
                    this.updateStatusBar(notebook);
                } else {
                    this.selectedNotebooks.delete(notebook);
                }
            }),
        );

        this.disposables.push(
            vscode.workspace.onWillSaveNotebookDocument((event) => {
                const { notebook } = event;
                // Stamp SQL kernelspec/language_info before serialization so it is included in the same save
                if (this.selectedNotebooks.has(notebook)) {
                    event.waitUntil(this.ensureSqlNotebookMetadata(notebook));
                }
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidSaveNotebookDocument((notebook) => {
                // Persist connection metadata under the final file URI (handles untitled → saved file URI change)
                const uriChanged = this.rekeyConnectionOnSave(notebook);
                if (uriChanged) {
                    // The notebook URI changed (untitled → file), which re-created every
                    // cell document under a new URI. Transfer the IntelliSense
                    // registrations: disconnect the stale cell URIs from STS and
                    // register the new ones — the notebook equivalent of the query
                    // editor's connection transfer on save.
                    const mgr = this.connections.get(notebook.uri.toString());
                    mgr?.releaseCellRegistrations();
                    this.connectCellsForIntellisense(notebook, "didSaveNotebook");
                    this.updateStatusBar(notebook);
                    this.codeLensProvider.refresh();
                } else if (!this.connections.has(notebook.uri.toString())) {
                    // The save produced a NEW document (untitled → file replacement)
                    // that this controller has no manager for — claim the connection
                    // from the untitled notebook it replaced.
                    this.tryAdoptConnection(notebook);
                }
                this.saveConnectionMetadataIfConnected(notebook);
            }),
        );

        // Clean up connection managers when notebooks are closed.
        this.disposables.push(
            vscode.workspace.onDidCloseNotebookDocument((notebook) =>
                this.handleNotebookClosed(notebook),
            ),
        );

        const messaging = vscode.notebooks.createRendererMessaging(NOTEBOOK_RESULT_RENDERER_ID);
        this.disposables.push(
            messaging.onDidReceiveMessage((e) => {
                const message = e.message as NotebookSaveAsMessage | undefined;
                if (message?.type !== "saveAs") {
                    return;
                }
                void this.handleSaveAs(e.editor.notebook, message);
            }),
        );

        // When a cell document opens after the notebook is already connected —
        // e.g. cells re-created on save, or re-opened when their language flips
        // to SQL after kernel selection — register it with STS for IntelliSense.
        // Connect-time registration (connectCellsForIntellisense) can't cover
        // these because the cell document didn't exist under that URI yet.
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.uri.scheme !== "vscode-notebook-cell" || doc.languageId !== "sql") {
                    return;
                }
                const notebook = this.findNotebookForCellDocument(doc);
                if (!notebook) {
                    return;
                }
                const mgr = this.connections.get(notebook.uri.toString());
                if (!mgr?.isConnected()) {
                    return;
                }
                const cellUri = doc.uri.toString();
                this.log.debug(`[onDidOpenTextDocument] Registering opened cell ${cellUri}`);
                void mgr.connectCellForIntellisense(cellUri);
            }),
        );

        // When new cells are added to a notebook, connect them to STS
        // for IntelliSense if the notebook already has an active connection.
        this.disposables.push(
            vscode.workspace.onDidChangeNotebookDocument((e) => {
                if (e.contentChanges.length === 0) {
                    return;
                }
                const totalAdded = e.contentChanges.reduce(
                    (sum, c) => sum + c.addedCells.length,
                    0,
                );
                if (totalAdded === 0) {
                    return;
                }
                const notebookKey = e.notebook.uri.toString();
                const mgr = this.connections.get(notebookKey);
                if (!mgr) {
                    if (this.selectedNotebooks.has(e.notebook)) {
                        this.log.debug(
                            `[onDidChangeNotebookDocument] Skipped ${totalAdded} added cell(s) (no manager) notebook=${notebookKey}`,
                        );
                    }
                    return;
                }
                if (!mgr.isConnected()) {
                    this.log.debug(
                        `[onDidChangeNotebookDocument] Skipped ${totalAdded} added cell(s) (not connected) notebook=${notebookKey}`,
                    );
                    return;
                }
                let registered = 0;
                let skippedNonSql = 0;
                let skippedNonCode = 0;
                for (const change of e.contentChanges) {
                    for (const cell of change.addedCells) {
                        if (
                            cell.kind === vscode.NotebookCellKind.Code &&
                            cell.document.languageId === "sql"
                        ) {
                            registered++;
                            void mgr.connectCellForIntellisense(cell.document.uri.toString());
                        } else if (cell.kind === vscode.NotebookCellKind.Code) {
                            skippedNonSql++;
                        } else {
                            skippedNonCode++;
                        }
                    }
                }
                this.log.debug(
                    `[onDidChangeNotebookDocument] Registered ${registered} added cell(s), skipped ${skippedNonSql} non-SQL code cell(s), skipped ${skippedNonCode} non-code cell(s) notebook=${notebookKey}`,
                );
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

        // Check metadata.metadata first (where VS Code ipynb serializer stores it),
        // then fallback to other locations for compatibility.
        // See: https://github.com/microsoft/vscode/blob/main/extensions/ipynb/src/serializers.ts#L490
        // and https://github.com/microsoft/vscode/blob/main/extensions/ipynb/src/deserializers.ts#L371
        const kernelspec =
            metadata?.metadata?.kernelspec ??
            metadata?.kernelspec ??
            metadata?.custom?.metadata?.kernelspec;

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

        const languageInfo =
            metadata?.metadata?.language_info ??
            metadata?.language_info ??
            metadata?.custom?.metadata?.language_info;

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
     * Stamp SQL kernelspec/language_info metadata on the notebook so it
     * identifies as SQL (not Python) when saved and reopened.
     */
    private async ensureSqlNotebookMetadata(notebook: vscode.NotebookDocument): Promise<void> {
        const existing = notebook.metadata?.metadata?.kernelspec;
        const name = String(existing?.name ?? "").toLowerCase();
        if (name === "sql-notebook") {
            return;
        }
        const sqlMeta = sqlNotebookMetadata();
        const mergedMetadata = {
            ...notebook.metadata,
            metadata: {
                ...(notebook.metadata?.metadata as Record<string, unknown>),
                kernelspec: sqlMeta.metadata.kernelspec,
                language_info: sqlMeta.metadata.language_info,
            },
        };
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(mergedMetadata)]);
        try {
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                this.log.warn(
                    `[ensureSqlNotebookMetadata] applyEdit was rejected for ${notebook.uri.toString()}`,
                );
            }
        } catch (err) {
            this.log.warn(
                `[ensureSqlNotebookMetadata] Failed to update metadata for ${notebook.uri.toString()}: ${(err as Error)?.message ?? err}`,
            );
        }
    }

    /**
     * Connect all SQL code cells in the notebook to STS for IntelliSense.
     * Called after any connection state change (connect, disconnect+reconnect,
     * database switch) so that cell URIs are registered with STS and
     * completions/hover/diagnostics work.
     */
    private connectCellsForIntellisense(notebook: vscode.NotebookDocument, trigger: string): void {
        const notebookKey = notebook.uri.toString();
        const mgr = this.connections.get(notebookKey);
        if (!mgr) {
            this.log.debug(
                `[connectCellsForIntellisense] Skipped (no manager) trigger=${trigger} notebook=${notebookKey}`,
            );
            return;
        }
        if (!mgr.isConnected()) {
            this.log.debug(
                `[connectCellsForIntellisense] Skipped (not connected) trigger=${trigger} notebook=${notebookKey}`,
            );
            return;
        }
        if (!mgr.getConnectionInfo()) {
            this.log.debug(
                `[connectCellsForIntellisense] Skipped (no connectionInfo) trigger=${trigger} notebook=${notebookKey}`,
            );
            return;
        }

        const cells = notebook.getCells();
        let sqlCellCount = 0;
        let nonSqlCellCount = 0;
        let nonCodeCellCount = 0;
        for (const cell of cells) {
            if (cell.kind !== vscode.NotebookCellKind.Code) {
                nonCodeCellCount++;
                continue;
            }
            if (cell.document.languageId !== "sql") {
                nonSqlCellCount++;
                continue;
            }
            sqlCellCount++;
            void mgr.connectCellForIntellisense(cell.document.uri.toString());
        }
        this.log.debug(
            `[connectCellsForIntellisense] trigger=${trigger} notebook=${notebookKey} sqlCells=${sqlCellCount} nonSqlCells=${nonSqlCellCount} nonCodeCells=${nonCodeCellCount}`,
        );
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
     * @returns true when the notebook URI changed and a tracked connection
     * manager was re-keyed to it.
     */
    private rekeyConnectionOnSave(notebook: vscode.NotebookDocument): boolean {
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
            return true;
        }
        return false;
    }

    /**
     * Handles a notebook document opening: sets kernel affinity for SQL
     * notebooks and adopts any connection manager parked by the close of the
     * untitled notebook this document replaced on save.
     * Public for testing purposes.
     */
    public handleNotebookOpened(notebook: vscode.NotebookDocument): void {
        if (notebook.notebookType !== "jupyter-notebook") {
            return;
        }
        this.recordNotebookOpen(notebook);
        this.setAffinityIfSql(notebook);
        this.tryAdoptConnection(notebook);
    }

    /**
     * Finds the open notebook that owns a cell text document. VS Code derives
     * cell URIs from the notebook URI (scheme swapped, fragment added), so
     * path-matching notebooks are checked first and membership is always
     * verified against the notebook's actual cells; a full scan remains as
     * fallback in case the derivation ever changes.
     */
    private findNotebookForCellDocument(
        doc: vscode.TextDocument,
    ): vscode.NotebookDocument | undefined {
        const cellUri = doc.uri.toString();
        const ownsCell = (nb: vscode.NotebookDocument) =>
            nb.getCells().some((cell) => cell.document.uri.toString() === cellUri);

        for (const nb of vscode.workspace.notebookDocuments) {
            if (nb.uri.path === doc.uri.path && ownsCell(nb)) {
                return nb;
            }
        }
        return vscode.workspace.notebookDocuments.find(
            (nb) => nb.uri.path !== doc.uri.path && ownsCell(nb),
        );
    }

    /**
     * Record when a notebook opened (pruning stale entries) so the park-time
     * adoption scan can restrict itself to notebooks opened around the save
     * transition.
     */
    private recordNotebookOpen(notebook: vscode.NotebookDocument): void {
        const now = Date.now();
        for (const [key, openedAt] of this.recentNotebookOpens) {
            if (now - openedAt > SAVE_ADOPTION_TTL_MS) {
                this.recentNotebookOpens.delete(key);
            }
        }
        this.recentNotebookOpens.set(notebook.uri.toString(), now);
    }

    /**
     * Whether the notebook opened recently enough to plausibly be the
     * file-based replacement created by an untitled notebook's save.
     */
    private wasRecentlyOpened(uriString: string): boolean {
        const openedAt = this.recentNotebookOpens.get(uriString);
        return openedAt !== undefined && Date.now() - openedAt <= SAVE_ADOPTION_TTL_MS;
    }

    /**
     * Whether any editor tab currently shows the given notebook URI. A
     * notebook document replaced by a save keeps no tab, while a notebook the
     * user still has open (even as a background tab) does.
     * Public for testing purposes.
     */
    public isNotebookOpenInTab(uriString: string): boolean {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (
                    tab.input instanceof vscode.TabInputNotebook &&
                    tab.input.uri.toString() === uriString
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Handles a notebook document closing. A connected UNTITLED notebook
     * closing is usually the save-to-disk transition (VS Code replaces the
     * document rather than renaming it), so its manager is parked for
     * adoption instead of disposed.
     * Public for testing purposes.
     */
    public handleNotebookClosed(notebook: vscode.NotebookDocument): void {
        const key = notebook.uri.toString();
        const mgr = this.connections.get(key);
        if (!mgr) {
            return;
        }
        this.connections.delete(key);
        // Note: WeakMap entry will be garbage collected automatically

        if (notebook.uri.scheme === "untitled" && mgr.isConnected()) {
            this.parkManagerForAdoption(key, notebook, mgr);
            return;
        }

        this.log.info(`[handleNotebookClosed] Disposing manager for ${key}`);
        mgr.dispose();
    }

    /**
     * Content signature used to match a closing untitled notebook with the
     * file-based notebook that replaces it on save. Cell content is identical
     * across the transition; cap the length to bound comparison cost.
     */
    private notebookContentSignature(notebook: vscode.NotebookDocument): string {
        // Accumulate the capped prefix and total length incrementally so a
        // large notebook never materializes its full concatenated content
        // just to produce a 10k-char signature.
        const maxChars = 10000;
        const cells = notebook.getCells();
        const separator = "\u0000";
        let totalLength = 0;
        let prefix = "";
        for (let i = 0; i < cells.length; i++) {
            const text =
                i === 0 ? cells[i].document.getText() : separator + cells[i].document.getText();
            totalLength += text.length;
            if (prefix.length < maxChars) {
                prefix += text.slice(0, maxChars - prefix.length);
            }
        }
        // Include the full content length so notebooks that differ only past
        // the comparison cap still get distinct signatures.
        return `${cells.length}:${totalLength}:${prefix}`;
    }

    /**
     * Park the connection manager of a closing untitled notebook so the
     * file-based notebook created by the save can adopt it. If no notebook
     * adopts it within the TTL (e.g. the untitled notebook was genuinely
     * discarded), the manager is disposed, closing its connection.
     */
    private parkManagerForAdoption(
        oldKey: string,
        notebook: vscode.NotebookDocument,
        mgr: NotebookConnectionManager,
    ): void {
        // VS Code reuses untitled names, so a second park can arrive under the
        // same key while the first is still pending. The superseded manager
        // can never be adopted once replaced — dispose it and cancel its
        // timer so it cannot fire against the new entry.
        const superseded = this.pendingSaveAdoptions.get(oldKey);
        if (superseded) {
            clearTimeout(superseded.timer);
            this.pendingSaveAdoptions.delete(oldKey);
            this.log.info(
                `[parkManagerForAdoption] Superseding parked manager for reused key ${oldKey}`,
            );
            superseded.mgr.dispose();
        }

        const signature = this.notebookContentSignature(notebook);
        const timer = setTimeout(() => {
            // Only dispose the entry this timer was created for — a newer park
            // under the same (reused) untitled URI must not be torn down by a
            // stale timer.
            const parked = this.pendingSaveAdoptions.get(oldKey);
            if (parked?.mgr === mgr) {
                this.pendingSaveAdoptions.delete(oldKey);
                this.log.info(
                    `[parkManagerForAdoption] No adoption within ${SAVE_ADOPTION_TTL_MS}ms for ${oldKey}; disposing manager`,
                );
                mgr.dispose();
            }
        }, SAVE_ADOPTION_TTL_MS);
        this.pendingSaveAdoptions.set(oldKey, { mgr, signature, timer });
        this.log.info(`[parkManagerForAdoption] Parked connected manager for ${oldKey}`);

        // If the file-based notebook opened BEFORE the untitled one closed,
        // it is already in the workspace — adopt immediately. Only notebooks
        // that opened around the save transition are considered, so a
        // long-open unrelated notebook with matching content is never picked.
        for (const candidate of vscode.workspace.notebookDocuments) {
            if (
                candidate.notebookType === "jupyter-notebook" &&
                this.wasRecentlyOpened(candidate.uri.toString()) &&
                this.tryAdoptConnection(candidate)
            ) {
                break;
            }
        }
    }

    /**
     * Transfer a connection stranded on the untitled notebook this file-based
     * notebook replaced on save. Two sources, matched by content signature:
     * 1. Managers parked by the untitled notebook's close event.
     * 2. Live managers still keyed by an untitled URI whose document lingers
     *    open — VS Code may keep the replaced untitled NotebookDocument open
     *    (or close it late), in which case no close event has fired yet.
     * @returns true when an adoption occurred.
     */
    private tryAdoptConnection(notebook: vscode.NotebookDocument): boolean {
        if (notebook.uri.scheme === "untitled") {
            return false;
        }
        const newKey = notebook.uri.toString();
        if (this.connections.has(newKey)) {
            return false;
        }
        // Skip the (cell-content) signature computation when there is nothing
        // that could possibly be adopted.
        const hasLiveUntitledCandidate = [...this.connections.keys()].some((key) =>
            key.startsWith("untitled:"),
        );
        if (this.pendingSaveAdoptions.size === 0 && !hasLiveUntitledCandidate) {
            return false;
        }
        const signature = this.notebookContentSignature(notebook);

        // Source 1: manager parked by the untitled notebook's close event.
        for (const [oldKey, parked] of this.pendingSaveAdoptions) {
            if (parked.signature !== signature) {
                continue;
            }
            clearTimeout(parked.timer);
            this.pendingSaveAdoptions.delete(oldKey);
            this.adoptManager(notebook, newKey, oldKey, parked.mgr);
            return true;
        }

        // Source 2: live manager whose untitled notebook document lingers open.
        for (const [oldKey, mgr] of this.connections) {
            if (!oldKey.startsWith("untitled:") || !mgr.isConnected()) {
                continue;
            }
            // An untitled notebook that still has an editor tab is one the
            // user is actively using — NOT a document orphaned by a save
            // replacement. Never steal its connection just because content
            // matches.
            if (this.isNotebookOpenInTab(oldKey)) {
                continue;
            }
            const oldNotebook = vscode.workspace.notebookDocuments.find(
                (nb) => nb.uri.toString() === oldKey,
            );
            if (!oldNotebook || this.notebookContentSignature(oldNotebook) !== signature) {
                continue;
            }
            this.connections.delete(oldKey);
            this.adoptManager(notebook, newKey, oldKey, mgr);
            return true;
        }
        return false;
    }

    /**
     * Complete an adoption: re-key the manager to the new notebook, re-register
     * the (new) cell document URIs with STS for IntelliSense, persist metadata,
     * and refresh UI state.
     */
    private adoptManager(
        notebook: vscode.NotebookDocument,
        newKey: string,
        oldKey: string,
        mgr: NotebookConnectionManager,
    ): void {
        this.connections.set(newKey, mgr);
        this.notebookToUri.set(notebook, newKey);
        this.log.info(`[adoptManager] Transferred connection ${oldKey} → ${newKey}`);

        // The old cell URIs belong to the replaced untitled notebook; release
        // their STS registrations and register the new cell URIs.
        mgr.releaseCellRegistrations();
        this.connectCellsForIntellisense(notebook, "adoptAfterSave");
        this.saveConnectionMetadataIfConnected(notebook);
        this.updateStatusBar(notebook);
        this.codeLensProvider.refresh();
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

    private async handleSaveAs(
        notebook: vscode.NotebookDocument,
        message: NotebookSaveAsMessage,
    ): Promise<void> {
        sendActionEvent(TelemetryViews.SqlNotebooks, TelemetryActions.SaveResults, {
            format: message.format,
        });
        try {
            const notebookName = path.basename(notebook.uri.fsPath);
            const saved = await saveNotebookResults({
                format: message.format,
                columnInfo: message.columnInfo,
                rows: message.rows,
                notebookBaseName: notebookName,
                notebookUri: notebook.uri,
                resultSetIndex: message.resultSetIndex,
            });
            if (saved) {
                void vscode.window.showInformationMessage(
                    LocalizedConstants.Notebooks.savedResultsTo(saved.fsPath),
                );
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.log.error(`[handleSaveAs] Failed to save results: ${errorMsg}`);
            void vscode.window.showErrorMessage(
                LocalizedConstants.Notebooks.saveResultsFailed(errorMsg),
            );
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

        this.log.debug(
            `[executeCell] start order=${execution.executionOrder} cellIndex=${cell.index} ` +
                `notebook=${notebook.uri.scheme}:${notebook.isUntitled ? "untitled" : notebook.uri.path.split("/").pop()} ` +
                `codeLen=${code.length}`,
        );

        if (!code) {
            this.log.debug(`[executeCell] empty cell, skipping`);
            execution.end(true, Date.now());
            return;
        }

        const connMgr = this.getConnectionManager(notebook);
        this.log.debug(
            `[executeCell] preConn existingUri=${connMgr.getConnectionUri() ?? "none"} ` +
                `isConnected=${connMgr.isConnected()}`,
        );

        // Handle magic commands
        if (code.startsWith("%%")) {
            this.log.debug(`[executeCell] magic command path`);
            await this.handleMagic(code, execution, connMgr, notebook);
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            return;
        }

        // Ensure we have a connection (one per notebook, reused across cells)
        try {
            this.log.debug(`[executeCell] ensureConnection: begin`);
            const ensuredUri = await connMgr.ensureConnection();
            this.log.debug(
                `[executeCell] ensureConnection: ok uri=${ensuredUri} ` +
                    `isConnected=${connMgr.isConnected()}`,
            );
            this.connectCellsForIntellisense(notebook, "executeCell");
            this.saveConnectionMetadataIfConnected(notebook);
        } catch (err: any) {
            this.log.error(
                `[executeCell] ensureConnection: failed msg=${err?.message ?? "(no message)"}`,
            );
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
            this.log.debug(
                `[executeCell] executeQueryString: begin uri=${connMgr.getConnectionUri() ?? "none"} ` +
                    `sqlLen=${code.length}`,
            );
            const result = await connMgr.executeQueryString(code, execution.token);
            this.log.debug(
                `[executeCell] executeQueryString: done canceled=${result.canceled} ` +
                    `batches=${result.batches.length}`,
            );
            const outputs = this.buildBatchOutputs(result.batches, !result.canceled);

            if (result.canceled) {
                outputs.push(
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(
                            LocalizedConstants.Notebooks.executionCanceled,
                            MIME_TEXT_PLAIN,
                        ),
                    ]),
                );
                this.appendExecutionTimeOutput(outputs, result.batches);
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
            this.log.error(
                `[executeCell] executeQueryString: failed msg=${err?.message ?? "(no message)"}`,
            );
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

    private buildBatchOutputs(
        batches: HeadlessBatchResult[],
        includeExecutionTime = true,
    ): vscode.NotebookCellOutput[] {
        const blocks = this.buildBatchOutputBlocks(batches, includeExecutionTime);
        if (this.hasResultSetBlock(blocks)) {
            return [this.buildRichBatchOutput(blocks)];
        }

        return this.buildPlainBatchOutputs(
            blocks.filter(
                (block): block is NotebookTextualResultBlock => block.type !== "resultSet",
            ),
        );
    }

    private buildBatchOutputBlocks(
        batches: HeadlessBatchResult[],
        includeExecutionTime: boolean,
    ): NotebookQueryResultBlock[] {
        const blocks: NotebookQueryResultBlock[] = [];

        for (const batch of batches) {
            const messages = (batch.messages ?? []).filter((m) => !m.isError).map((m) => m.message);
            const errorMessages = (batch.messages ?? [])
                .filter((m) => m.isError)
                .map((m) => m.message);

            if (errorMessages.length > 0) {
                blocks.push({
                    type: "error",
                    text: errorMessages.join(os.EOL),
                });
            }

            if (messages.length > 0) {
                blocks.push({
                    type: "text",
                    text: messages.join(os.EOL),
                });
            }

            for (const rs of batch.resultSets) {
                if (rs.columnInfo.length === 0) {
                    continue;
                }

                if (rs.rows.length < rs.rowCount) {
                    blocks.push({
                        type: "text",
                        text: LocalizedConstants.Notebooks.resultSetTruncated(
                            rs.rows.length,
                            rs.rowCount,
                        ),
                    });
                }

                blocks.push({
                    type: "resultSet",
                    columnInfo: rs.columnInfo,
                    rows: rs.rows,
                    rowCount: rs.rowCount,
                });
            }

            if (
                batch.resultSets.length === 0 &&
                messages.length === 0 &&
                errorMessages.length === 0
            ) {
                blocks.push({
                    type: "text",
                    text: LocalizedConstants.Notebooks.commandCompletedSuccessfully,
                });
            }
        }

        const executionTimeLine = this.getExecutionTimeLine(batches);
        if (
            includeExecutionTime &&
            executionTimeLine &&
            !this.hasExecutionTimeMessage(batches, executionTimeLine)
        ) {
            blocks.push({
                type: "text",
                text: executionTimeLine,
            });
        }

        return blocks;
    }

    private buildRichBatchOutput(blocks: NotebookQueryResultBlock[]): vscode.NotebookCellOutput {
        const plain = blocks
            .map((block) =>
                block.type === "resultSet"
                    ? formatter.toPlain(block.columnInfo, block.rows)
                    : block.text,
            )
            .join(`${os.EOL}${os.EOL}`);
        const data: NotebookQueryResultOutputData = {
            version: 1,
            blocks,
        };

        return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.json(data, MIME_NOTEBOOK_QUERY_RESULT),
            vscode.NotebookCellOutputItem.text(plain, MIME_TEXT_PLAIN),
        ]);
    }

    private buildPlainBatchOutputs(
        blocks: NotebookTextualResultBlock[],
    ): vscode.NotebookCellOutput[] {
        return blocks.map((block) => {
            switch (block.type) {
                case "error":
                    return new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(block.text),
                    ]);
                case "text":
                    return new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(block.text, MIME_TEXT_PLAIN),
                    ]);
            }
        });
    }

    private hasResultSetBlock(blocks: NotebookQueryResultBlock[]): boolean {
        return blocks.some(
            (block): block is NotebookQueryResultGridBlock => block.type === "resultSet",
        );
    }

    private appendExecutionTimeOutput(
        outputs: vscode.NotebookCellOutput[],
        batches: HeadlessBatchResult[],
    ): void {
        const executionTimeLine = this.getExecutionTimeLine(batches);
        if (!executionTimeLine) {
            return;
        }

        if (this.hasExecutionTimeMessage(batches, executionTimeLine)) {
            return;
        }

        outputs.push(
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(executionTimeLine, MIME_TEXT_PLAIN),
            ]),
        );
    }

    private getExecutionTimeLine(batches: HeadlessBatchResult[]): string | undefined {
        const executionElapsed = this.getExecutionElapsed(batches);
        return executionElapsed ? LocalizedConstants.elapsedTimeLabel(executionElapsed) : undefined;
    }

    private hasExecutionTimeMessage(
        batches: HeadlessBatchResult[],
        executionTimeLine: string,
    ): boolean {
        return batches.some((batch) =>
            (batch.messages ?? []).some((message) => message.message === executionTimeLine),
        );
    }

    private getExecutionElapsed(batches: HeadlessBatchResult[]): string | undefined {
        const batchExecutionElapsed = batches
            .map((batch) => batch.batchSummary.executionElapsed)
            .filter((elapsedTime): elapsedTime is string => !!elapsedTime);
        if (batchExecutionElapsed.length === 0) {
            return undefined;
        }

        const totalMilliseconds = batchExecutionElapsed.reduce((total, elapsedTime) => {
            const parsedElapsed = Utils.parseTimeString(elapsedTime);
            return total + (typeof parsedElapsed === "number" ? parsedElapsed : 0);
        }, 0);
        return Utils.durationToDisplay(totalMilliseconds, { format: "clock" });
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
                    this.connectCellsForIntellisense(notebook, "magic:%%connect");
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
                    this.connectCellsForIntellisense(notebook, "magic:%%use");
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
            this.connectCellsForIntellisense(notebook, "changeDatabaseInteractive:initialConnect");
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
        this.connectCellsForIntellisense(notebook, "changeDatabaseInteractive");
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

        this.connectCellsForIntellisense(notebook, "changeConnectionInteractive");
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
        // Stamp SQL kernelspec/language_info so the .ipynb round-trips as SQL.
        // Without this, the Jupyter serializer defaults to Python on save, and
        // on reopen cells deserialize as Python before our kernel can re-select.
        notebookData.metadata = sqlNotebookMetadata();
        const notebook = await vscode.workspace.openNotebookDocument(
            "jupyter-notebook",
            notebookData,
        );

        const notebookEditor = await vscode.window.showNotebookDocument(notebook);

        this.controller.updateNotebookAffinity(
            notebook,
            vscode.NotebookControllerAffinity.Preferred,
        );
        await this.selectController(notebookEditor);

        if (connectionInfo) {
            const connMgr = this.getConnectionManager(notebook);
            await connMgr.connectWith(connectionInfo);
            this.connectCellsForIntellisense(notebook, "createNotebookWithConnection");
            this.saveConnectionMetadataIfConnected(notebook);

            const label = connMgr.getConnectionLabel();
            this.updateStatusBar(notebook);
            this.codeLensProvider.refresh();
            vscode.window.showInformationMessage(
                LocalizedConstants.Notebooks.notebookConnectedTo(label),
            );
        }
    }

    private async selectController(notebookEditor: vscode.NotebookEditor): Promise<void> {
        await vscode.commands.executeCommand("notebook.selectKernel", {
            notebookEditor,
            id: this.controller.id,
            extension: Constants.extensionId,
        });
    }

    dispose(): void {
        for (const mgr of this.connections.values()) {
            mgr.dispose();
        }
        this.connections.clear();
        for (const parked of this.pendingSaveAdoptions.values()) {
            clearTimeout(parked.timer);
            parked.mgr.dispose();
        }
        this.pendingSaveAdoptions.clear();
        this.disposables.forEach((d) => d.dispose());
        this.statusBarItem.dispose();
        this.controller.dispose();
        this.log.dispose();
    }
}
