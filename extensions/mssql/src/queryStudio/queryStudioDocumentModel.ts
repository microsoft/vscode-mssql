/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryStudioDocumentModel — the SHARED per-URI state for Query Studio
 * (doc 04 §4.2/§7): text sync against the backing TextDocument, and (from
 * B2/B3) the data-plane session binding, execution orchestrator, RowStore,
 * and message log. Panels attach/detach; the last detach disposes.
 *
 * This class adapts VS Code TextDocument events into the pure TextSyncEngine
 * and applies webview edit groups through WorkspaceEdit so VS Code keeps
 * ownership of persistence, dirty state, undo, and hot exit.
 */

import * as vscode from "vscode";
import { diag } from "../diagnostics/diagnosticsCore";
import {
    QsSyncEdits,
    QsSyncRemote,
    QsSyncResync,
    QsTextEdit,
} from "../sharedInterfaces/queryStudio";
import { TextSyncEngine } from "./textSync";
import { DocumentSessionBinding } from "./documentSessionBinding";
import { ExecutionHost } from "./executionHost";
import { persistQueryStudioHotExitBackup } from "./queryStudioHotExitBackup";

export interface ModelTextEvents {
    onRemote(remote: QsSyncRemote): void;
    onResync(resync: QsSyncResync): void;
}

export class QueryStudioDocumentModel implements vscode.Disposable {
    readonly uriKey: string;
    /** Managed by the registry. */
    panelCount = 0;
    /** Shared data-plane session for every panel of this document (M1). */
    readonly sessionBinding = new DocumentSessionBinding();
    /** Shared execution state/results for every panel (M2). */
    readonly executionHost: ExecutionHost;

    private sync: TextSyncEngine;
    private listeners = new Set<ModelTextEvents>();
    private docSubscription: vscode.Disposable;
    private disposed = false;
    private hotExitBackupWrite: Promise<void> = Promise.resolve();
    /** Guards re-entrant application of our own workspace edits. */
    private applyingWebviewEdit = false;

    /**
     * Open-from-context (OE v2 New Query / table preview, oe_view_design
     * §11.3): connect straight to a saved profile (+database override), then
     * optionally run the document once. Failures surface via the binding's
     * normal error UX; auto-run is skipped unless connect succeeded.
     */
    async applyOpenContext(context: {
        profileId?: string;
        database?: string;
        autoRun?: boolean;
    }): Promise<void> {
        if (!context.profileId) {
            return;
        }
        const connected = await this.sessionBinding.connectToProfile(
            context.profileId,
            context.database,
        );
        if (connected && context.autoRun) {
            await this.sessionBinding.waitForUserSessionReady();
            this.executionHost.execute(this.document.getText(), {
                selectionStartLine: 0,
                scope: "document",
            });
        }
    }

    constructor(
        private document: vscode.TextDocument,
        spillRoot: string,
        private readonly hotExitBackupRoot?: vscode.Uri,
        private readonly onLastDispose?: (model: QueryStudioDocumentModel) => void,
    ) {
        this.uriKey = document.uri.toString();
        this.executionHost = new ExecutionHost(spillRoot, this.sessionBinding, this.uriKey);
        this.sync = new TextSyncEngine(document.getText());
        this.persistHotExitBackup();
        this.docSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() !== this.document.uri.toString()) {
                return;
            }
            this.handleHostChange(e);
        });
    }

    get backingDocument(): vscode.TextDocument {
        return this.document;
    }

    get hostVersion(): number {
        return this.sync.hostVersion;
    }

    get currentTextHash(): string {
        return this.sync.currentHash;
    }

    /**
     * Bounded wait for the mirror to reach a webview text hash. Change
     * signal: every applied edit fires handleHostChange -> listeners; a
     * short poll backstops applies that complete without a listener tick.
     */
    awaitTextHash(hash: string, timeoutMs: number): Promise<boolean> {
        if (this.sync.currentHash === hash) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const done = (ok: boolean) => {
                clearInterval(poll);
                clearTimeout(deadline);
                listener.dispose();
                resolve(ok);
            };
            const check = () => {
                if (this.sync.currentHash === hash) {
                    done(true);
                }
            };
            const listener = this.attachListener({
                onRemote: () => check(),
                onResync: () => check(),
            });
            const poll = setInterval(check, 15);
            const deadline = setTimeout(() => done(false), timeoutMs);
        });
    }

    get syncResyncCount(): number {
        return this.sync.resyncCount;
    }

    /** Save As / re-resolve: rebind to the (possibly re-keyed) document. */
    rebind(document: vscode.TextDocument): void {
        this.document = document;
        // Text may differ after external save transforms — resync everyone.
        this.sync = new TextSyncEngine(document.getText());
        this.persistHotExitBackup();
        this.broadcastResync("document rebind (Save As / re-resolve)");
    }

    attachListener(listener: ModelTextEvents): vscode.Disposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Initial payload for a newly attached panel. */
    syncInit(): { text: string; hostVersion: number; textHash: string; eol: "\n" | "\r\n" } {
        return {
            text: this.sync.currentText,
            hostVersion: this.sync.hostVersion,
            textHash: this.sync.currentHash,
            eol: this.documentEol(),
        };
    }

    /**
     * Webview edit group → engine → WorkspaceEdit. The TextDocument change
     * event that follows is recognized as our echo and not bounced back.
     */
    async applyWebviewEdits(
        edits: QsSyncEdits,
    ): Promise<{ applied: boolean; hostVersion: number; resyncPending?: boolean }> {
        const span = diag.startSpan({
            feature: "queryStudio",
            kind: "span",
            type: "queryStudio.sync.applyEdit",
            fields: {
                editCount: { raw: edits.edits.length, cls: "diagnostic.metadata" },
                chars: {
                    raw: edits.edits.reduce((sum, edit) => sum + edit.text.length, 0),
                    cls: "diagnostic.metadata",
                },
            },
        });
        try {
            const result = await this.applyWebviewEditsCore(edits);
            span.end(result.applied ? "ok" : result.resyncPending ? "warning" : "info", {
                applied: { raw: result.applied, cls: "diagnostic.metadata" },
                resyncPending: { raw: result.resyncPending ?? false, cls: "diagnostic.metadata" },
            });
            return result;
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    private async applyWebviewEditsCore(
        edits: QsSyncEdits,
    ): Promise<{ applied: boolean; hostVersion: number; resyncPending?: boolean }> {
        const outcome = this.sync.applyWebviewEdits(edits);
        if (!outcome.applied) {
            if (outcome.resyncNeeded) {
                diag.emit({
                    feature: "queryStudio",
                    type: "queryStudio.sync.resync",
                    status: "warning",
                    fields: {
                        reason: {
                            raw: outcome.reason ?? "unknown",
                            cls: "diagnostic.metadata",
                        },
                    },
                });
                this.broadcastResync(outcome.reason ?? "sync divergence");
                return { applied: false, hostVersion: outcome.hostVersion, resyncPending: true };
            }
            return { applied: false, hostVersion: outcome.hostVersion };
        }
        const wsEdit = new vscode.WorkspaceEdit();
        for (const edit of edits.edits) {
            wsEdit.replace(
                this.document.uri,
                new vscode.Range(
                    this.document.positionAt(edit.start),
                    this.document.positionAt(edit.end),
                ),
                edit.text,
            );
        }
        this.applyingWebviewEdit = true;
        try {
            const ok = await vscode.workspace.applyEdit(wsEdit);
            if (!ok) {
                // VS Code refused (e.g. readonly): resync back to truth.
                this.sync = new TextSyncEngine(this.document.getText());
                this.broadcastResync("workspace edit rejected");
                return {
                    applied: false,
                    hostVersion: this.sync.hostVersion,
                    resyncPending: true,
                };
            }
        } finally {
            this.applyingWebviewEdit = false;
        }
        return { applied: true, hostVersion: outcome.hostVersion };
    }

    /**
     * Full-text adoption from the webview (qs/syncAdopt): the stale-base
     * rejection path never reconciles when the init/remote was missed, so
     * the webview converges the host to its visible editor content — the
     * user-facing truth. One engine adopt + one full-range document replace.
     */
    async adoptWebviewText(
        text: string,
        editGroupId: string,
    ): Promise<{ applied: boolean; hostVersion: number }> {
        const before = this.document.getText();
        diag.emit({
            feature: "queryStudio",
            type: "queryStudio.sync.adopt",
            fields: {
                chars: { raw: text.length, cls: "diagnostic.metadata" },
                hostChars: { raw: before.length, cls: "diagnostic.metadata" },
            },
        });
        if (before === text) {
            // Already converged textually — just re-align the version.
            return { applied: true, hostVersion: this.sync.hostVersion };
        }
        const outcome = this.sync.adopt(text, editGroupId);
        const wsEdit = new vscode.WorkspaceEdit();
        wsEdit.replace(
            this.document.uri,
            new vscode.Range(this.document.positionAt(0), this.document.positionAt(before.length)),
            text,
        );
        this.applyingWebviewEdit = true;
        try {
            const ok = await vscode.workspace.applyEdit(wsEdit);
            if (!ok) {
                this.sync = new TextSyncEngine(this.document.getText());
                this.broadcastResync("workspace edit rejected (adopt)");
                return { applied: false, hostVersion: this.sync.hostVersion };
            }
        } finally {
            this.applyingWebviewEdit = false;
        }
        return { applied: true, hostVersion: outcome.hostVersion };
    }

    async undo(redo: boolean): Promise<void> {
        // Host-owned undo (doc 04 §8.4): route through VS Code commands so
        // the TextDocument stack stays authoritative. The resulting change
        // flows back through onDidChangeTextDocument as reason undo/redo.
        this.pendingUndoReason = redo ? "redo" : "undo";
        await vscode.commands.executeCommand(redo ? "redo" : "undo");
    }

    async save(): Promise<void> {
        await this.document.save();
    }

    resyncFor(webviewVersion: number, textHash: string): QsSyncResync {
        void webviewVersion;
        if (!this.sync.verifyWebviewHash(textHash)) {
            diag.emit({
                feature: "queryStudio",
                type: "queryStudio.sync.resync",
                status: "warning",
                fields: {
                    reason: { raw: "webview-requested resync", cls: "diagnostic.metadata" },
                },
            });
        }
        return { ...this.sync.resync("webview requested"), eol: this.documentEol() };
    }

    private pendingUndoReason: "undo" | "redo" | undefined;

    private handleHostChange(e: vscode.TextDocumentChangeEvent): void {
        if (e.contentChanges.length === 0) {
            return;
        }
        const edits: QsTextEdit[] = e.contentChanges.map((change) => ({
            start: change.rangeOffset,
            end: change.rangeOffset + change.rangeLength,
            text: change.text,
        }));
        const reason: QsSyncRemote["reason"] = this.applyingWebviewEdit
            ? "hostEdit" // echo detection inside the engine refines this
            : (this.pendingUndoReason ?? "external");
        this.pendingUndoReason = undefined;
        const outcome = this.sync.onHostTextChanged(e.document.getText(), edits, reason);
        this.persistHotExitBackup();
        if (outcome.remote) {
            for (const listener of this.listeners) {
                listener.onRemote(outcome.remote);
            }
        }
    }

    private broadcastResync(reason: string): void {
        const resync: QsSyncResync = { ...this.sync.resync(reason), eol: this.documentEol() };
        for (const listener of this.listeners) {
            listener.onResync(resync);
        }
    }

    private documentEol(): "\n" | "\r\n" {
        return this.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    }

    private persistHotExitBackup(): void {
        this.hotExitBackupWrite = this.hotExitBackupWrite.then(
            () => persistQueryStudioHotExitBackup(this.hotExitBackupRoot, this.document),
            () => persistQueryStudioHotExitBackup(this.hotExitBackupRoot, this.document),
        );
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        // Doc 04 §7.3 grows here in B2/B3: cancel active query, close session,
        // release metadata handles, tear down shadow LSP, dispose RowStore.
        this.executionHost.dispose();
        this.sessionBinding.dispose();
        this.docSubscription.dispose();
        this.listeners.clear();
        this.onLastDispose?.(this);
    }
}
