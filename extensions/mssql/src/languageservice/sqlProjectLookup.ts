/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { createServiceIdentifier } from "extension-toolkit/base";
import SqlToolsServerClient from "./serviceclient";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { getLogger } from "../models/logger";

const logger = getLogger("SqlProjectLookup");

export const ISqlProjectLookup = createServiceIdentifier<ISqlProjectLookup>("sqlProjectLookup");

export interface ISqlProjectLookup {
    /**
     * Returns the `.sqlproj` that owns `fileUri`, or undefined when it is not a saved `.sql` file
     * inside a project.
     */
    findProjectForFile(fileUri: vscode.Uri): Promise<vscode.Uri | undefined>;
}

/**
 * Finds the project that owns a `.sql` file by asking SQL Tools Service, which checks only the
 * file's folder and its parents instead of scanning the workspace. Code actions and rename ask
 * this on every cursor move, so answers are cached per file until a `.sqlproj` is created or
 * deleted, files are renamed, or the document closes.
 */
export class SqlProjectLookup implements ISqlProjectLookup, vscode.Disposable {
    private readonly _cache = new Map<string, Promise<vscode.Uri | undefined>>();
    private readonly _disposables: vscode.Disposable[] = [];
    private _sqlProjectsService: Pick<SqlProjectsService, "findProjectForFile"> | undefined;

    constructor(sqlProjectsService?: Pick<SqlProjectsService, "findProjectForFile">) {
        this._sqlProjectsService = sqlProjectsService;

        const watcher = vscode.workspace.createFileSystemWatcher(
            "**/*.sqlproj",
            false /* ignoreCreateEvents */,
            true /* ignoreChangeEvents */,
            false /* ignoreDeleteEvents */,
        );
        this._disposables.push(
            watcher,
            watcher.onDidCreate(() => this._cache.clear()),
            watcher.onDidDelete(() => this._cache.clear()),
            // Renaming a folder moves every file under it without a .sqlproj event
            vscode.workspace.onDidRenameFiles(() => this._cache.clear()),
            vscode.workspace.onDidCloseTextDocument((doc) =>
                this._cache.delete(doc.uri.toString()),
            ),
        );
    }

    public findProjectForFile(fileUri: vscode.Uri): Promise<vscode.Uri | undefined> {
        // Untitled and virtual documents can't belong to a project; skip the request entirely
        if (fileUri.scheme !== "file" || path.extname(fileUri.fsPath).toLowerCase() !== ".sql") {
            return Promise.resolve(undefined);
        }

        const key = fileUri.toString();
        const cached = this._cache.get(key);
        if (cached) {
            return cached;
        }

        const request: Promise<vscode.Uri | undefined> = this.requestProjectForFile(
            fileUri.fsPath,
        ).catch((err) => {
            // Don't cache failures, e.g. when the service isn't ready yet. Only remove this request's
            // entry: the cache may have been cleared and repopulated since it started.
            if (this._cache.get(key) === request) {
                this._cache.delete(key);
            }
            logger.error(`Failed to find the project for ${fileUri.fsPath}: ${err}`);
            return undefined;
        });
        this._cache.set(key, request);
        return request;
    }

    public dispose(): void {
        this._cache.clear();
        vscode.Disposable.from(...this._disposables).dispose();
    }

    private async requestProjectForFile(filePath: string): Promise<vscode.Uri | undefined> {
        this._sqlProjectsService ??= new SqlProjectsService(SqlToolsServerClient.instance);
        const result = await this._sqlProjectsService.findProjectForFile(filePath);
        if (!result?.success) {
            throw new Error(result?.errorMessage ?? "no response");
        }
        return result.projectUri ? vscode.Uri.file(result.projectUri) : undefined;
    }
}
