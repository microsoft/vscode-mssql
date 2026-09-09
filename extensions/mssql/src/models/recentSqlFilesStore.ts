/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "./logger";

/** Key under which the most-recently-opened SQL file list is persisted. */
const GLOBAL_STATE_RECENT_SQL_FILES_KEY = "overview/recentSqlFiles";

/** Upper bound on the persisted list, independent of how many a caller asks for. */
const MAX_TRACKED_FILES = 50;

/** Cap on the workspace scan used to seed the list before any file has been opened. */
const MAX_WORKSPACE_SCAN = 50;

/** One entry in the recently-opened SQL file list. */
interface RecentSqlFileEntry {
    /** Filesystem path of the file. */
    fsPath: string;
    /** Epoch milliseconds the file was last opened. */
    openedAtMs: number;
}

/** A recent SQL file resolved for display. */
export interface ResolvedRecentSqlFile {
    fsPath: string;
    /** Epoch milliseconds this file was last opened, or last modified when only scanned. */
    timestampMs: number;
}

/**
 * Tracks the SQL files the user has opened, most recent first.
 *
 * VS Code exposes no public API for its own "recently opened" list, so the extension keeps its
 * own. Until the user has opened a SQL file the list is empty, so reads top it up with SQL files
 * already in the workspace, newest by modified time — which keeps the Overview page useful on a
 * first run instead of showing an empty section.
 */
export class RecentSqlFilesStore implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _logger: ILogger = logger.withPrefix("RecentSqlFilesStore");

    constructor(private _context: vscode.ExtensionContext) {}

    /** Starts recording SQL file opens. */
    public register(): void {
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument((document) => {
                void this.recordOpen(document);
            }),
        );
    }

    /**
     * Records a document open if it is a SQL file on disk. Untitled and virtual documents are
     * skipped: they have no path to reopen later.
     */
    public async recordOpen(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== Constants.languageId || document.uri.scheme !== "file") {
            return;
        }

        const fsPath = document.uri.fsPath;
        const entries = this.readEntries().filter((entry) => entry.fsPath !== fsPath);
        entries.unshift({ fsPath, openedAtMs: Date.now() });

        await this._context.globalState.update(
            GLOBAL_STATE_RECENT_SQL_FILES_KEY,
            entries.slice(0, MAX_TRACKED_FILES),
        );
    }

    /**
     * Returns up to `limit` recent SQL files that still exist on disk, most recent first.
     */
    public async getRecentFiles(limit: number): Promise<ResolvedRecentSqlFile[]> {
        const tracked = await this.resolveTrackedFiles(limit);
        if (tracked.length >= limit) {
            return tracked;
        }

        // Not enough history yet — fill the remainder from the workspace.
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

    /** Drops tracked files that have since been deleted or moved. */
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

    /** SQL files in the open workspace, most recently modified first. */
    private async scanWorkspaceFiles(): Promise<ResolvedRecentSqlFile[]> {
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
    }
}
