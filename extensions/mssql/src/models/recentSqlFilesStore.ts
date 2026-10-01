/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "./logger";

const GLOBAL_STATE_RECENT_SQL_FILES_KEY = "overview/recentSqlFiles";

const MAX_TRACKED_FILES = 50;

const MAX_WORKSPACE_SCAN = 50;

interface RecentSqlFileEntry {
    fsPath: string;
    openedAtMs: number;
}

export interface ResolvedRecentSqlFile {
    fsPath: string;
    /** Epoch milliseconds this file was last opened, or last modified when only scanned. */
    timestampMs: number;
}

/**
 * VS Code exposes no public API for its own "recently opened" list, so the extension keeps its own.
 */
export class RecentSqlFilesStore implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _logger: ILogger = logger.withPrefix("RecentSqlFilesStore");
    private _writeQueue: Promise<void> = Promise.resolve();
    private _onDidChange = new vscode.EventEmitter<void>();
    private _workspaceScan: Promise<ResolvedRecentSqlFile[]> | undefined;

    public readonly onDidChange = this._onDidChange.event;

    constructor(private _context: vscode.ExtensionContext) {}

    /**
     * Keyed off the active editor rather than `onDidOpenTextDocument`, which also fires whenever
     * any extension reads a file with `openTextDocument` -- a project build or a language
     * feature resolving references -- and would push the user's own files out of the list.
     */
    public register(): void {
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.recordOpenInBackground(editor.document);
                }
            }),
        );

        // The event does not replay, and opening a SQL file is the usual way the extension
        // activates, so the document that caused it would otherwise be the one file missing
        // from the list -- and with a full history nothing goes looking for it.
        const active = vscode.window.activeTextEditor?.document;
        if (active) {
            this.recordOpenInBackground(active);
        }
    }

    private recordOpenInBackground(document: vscode.TextDocument): void {
        void this.recordOpen(document).catch((error) => {
            this._logger.error("Failed to persist a recent SQL file", error);
        });
    }

    /**
     * Untitled and virtual documents are skipped: they have no path to reopen later.
     */
    public async recordOpen(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== Constants.languageId || document.uri.scheme !== "file") {
            return;
        }

        // Opening several SQL files at once (a restored editor layout, say) fires this
        // concurrently. Each call reads the whole list, prepends one entry and writes it back, so
        // overlapping calls would read the same list and the last write would drop the others'
        // entries. Chain them instead, so each read sees the previous write.
        const write = this._writeQueue.then(() => this.prependEntry(document.uri.fsPath));
        // Keep the chain alive on failure, so one bad write does not stop all later ones.
        this._writeQueue = write.catch(() => undefined);
        return write;
    }

    private async prependEntry(fsPath: string): Promise<void> {
        const entries = this.readEntries().filter((entry) => entry.fsPath !== fsPath);
        entries.unshift({ fsPath, openedAtMs: Date.now() });

        await this._context.globalState.update(
            GLOBAL_STATE_RECENT_SQL_FILES_KEY,
            entries.slice(0, MAX_TRACKED_FILES),
        );
        this._onDidChange.fire();
    }

    public async getRecentFiles(limit: number): Promise<ResolvedRecentSqlFile[]> {
        const tracked = await this.resolveTrackedFiles(limit);
        if (tracked.length >= limit) {
            return tracked;
        }

        const seen = new Set(tracked.map((file) => file.fsPath));
        const scanned = await this.scanWorkspaceFiles();
        for (const file of scanned) {
            if (tracked.length >= limit) {
                break;
            }
            if (!seen.has(file.fsPath)) {
                seen.add(file.fsPath);
                tracked.push(file);
            }
        }
        return tracked;
    }

    private readEntries(): RecentSqlFileEntry[] {
        return (
            this._context.globalState.get<RecentSqlFileEntry[]>(
                GLOBAL_STATE_RECENT_SQL_FILES_KEY,
            ) ?? []
        );
    }

    private async resolveTrackedFiles(limit: number): Promise<ResolvedRecentSqlFile[]> {
        const resolved: ResolvedRecentSqlFile[] = [];
        for (const entry of this.readEntries()) {
            if (resolved.length >= limit) {
                break;
            }
            if (await this.exists(vscode.Uri.file(entry.fsPath))) {
                resolved.push({ fsPath: entry.fsPath, timestampMs: entry.openedAtMs });
            }
        }
        return resolved;
    }

    /**
     * A burst of opens -- a restored editor layout -- asks for this once per file, so reads
     * that overlap one scan share it rather than each globbing the workspace.
     */
    private scanWorkspaceFiles(): Promise<ResolvedRecentSqlFile[]> {
        if (!this._workspaceScan) {
            this._workspaceScan = this.readWorkspaceFiles().finally(() => {
                this._workspaceScan = undefined;
            });
        }
        return this._workspaceScan;
    }

    private async readWorkspaceFiles(): Promise<ResolvedRecentSqlFile[]> {
        if (!vscode.workspace.workspaceFolders?.length) {
            return [];
        }

        try {
            const uris = await vscode.workspace.findFiles(
                "**/*.sql",
                "**/node_modules/**",
                MAX_WORKSPACE_SCAN,
            );
            const files = await Promise.all(
                uris.map(async (uri) => {
                    try {
                        const stat = await vscode.workspace.fs.stat(uri);
                        return { fsPath: uri.fsPath, timestampMs: stat.mtime };
                    } catch {
                        return undefined;
                    }
                }),
            );
            return files
                .filter((file): file is ResolvedRecentSqlFile => file !== undefined)
                .sort((a, b) => b.timestampMs - a.timestampMs);
        } catch (error) {
            this._logger.error("Failed to scan the workspace for SQL files", error);
            return [];
        }
    }

    private async exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    public dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
        this._disposables = [];
        this._onDidChange.dispose();
    }
}
