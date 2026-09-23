/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

const sqlProjectGlob = "**/*.sqlproj";
const excludeGlob = "**/node_modules/**";

/**
 * Caches the `.sqlproj` files in the workspace.
 *
 * Code action and rename providers run on nearly every cursor move, so scanning the workspace on
 * each call spawns overlapping searches that can pin the CPU in large workspaces. The list is
 * looked up once and refreshed only when a `.sqlproj` is created or deleted, or the workspace
 * folders change.
 */
export class SqlProjectFileCache implements vscode.Disposable {
    private _files: Promise<vscode.Uri[]> | undefined;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        const watcher = vscode.workspace.createFileSystemWatcher(
            sqlProjectGlob,
            false /* ignoreCreateEvents */,
            true /* ignoreChangeEvents */,
            false /* ignoreDeleteEvents */,
        );
        this._disposables.push(
            watcher,
            watcher.onDidCreate(() => this.invalidate()),
            watcher.onDidDelete(() => this.invalidate()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
        );
    }

    /** Returns the `.sqlproj` files in the workspace, scanning only when the cache is empty. */
    public getFiles(): Promise<vscode.Uri[]> {
        if (!this._files) {
            const files = Promise.resolve(vscode.workspace.findFiles(sqlProjectGlob, excludeGlob));
            this._files = files;
            // Don't cache a failed lookup; the next call retries.
            files.catch(() => {
                if (this._files === files) {
                    this._files = undefined;
                }
            });
        }
        return this._files;
    }

    public invalidate(): void {
        this._files = undefined;
    }

    public dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
        this._disposables.length = 0;
        this._files = undefined;
    }
}
