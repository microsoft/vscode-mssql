/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { GitObjectStatus } from "../models/gitStatus";

/**
 * Provides file decorations for Git status in Object Explorer
 */
export class GitDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations: vscode.EventEmitter<
        vscode.Uri | vscode.Uri[] | undefined
    > = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
        this._onDidChangeFileDecorations.event;

    // Map to store Git status for URIs
    private _decorations: Map<string, GitObjectStatus> = new Map();

    /**
     * Set Git status for a URI
     */
    public setDecoration(uri: vscode.Uri, status: GitObjectStatus): void {
        this._decorations.set(uri.toString(), status);
        this._onDidChangeFileDecorations.fire(uri);
    }

    /**
     * Clear decoration for a URI
     */
    public clearDecoration(uri: vscode.Uri): void {
        this._decorations.delete(uri.toString());
        this._onDidChangeFileDecorations.fire(uri);
    }

    /**
     * Clear all decorations
     */
    public clearAllDecorations(): void {
        this._decorations.clear();
        this._onDidChangeFileDecorations.fire(undefined);
    }

    /**
     * Provide file decoration for a URI
     */
    public provideFileDecoration(
        uri: vscode.Uri,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.FileDecoration> {
        const status = this._decorations.get(uri.toString());
        if (!status) {
            return undefined;
        }

        switch (status) {
            case GitObjectStatus.Modified:
                return {
                    badge: "M",
                    tooltip: "Modified",
                    color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
                };
            case GitObjectStatus.Added:
                return {
                    badge: "A",
                    tooltip: "Added",
                    color: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
                };
            case GitObjectStatus.Deleted:
                return {
                    badge: "D",
                    tooltip: "Deleted",
                    color: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
                };
            case GitObjectStatus.InSync:
                // No decoration for in-sync objects
                return undefined;
            case GitObjectStatus.Untracked:
                return {
                    badge: "U",
                    tooltip: "Untracked",
                    color: new vscode.ThemeColor("gitDecoration.untrackedResourceForeground"),
                };
            default:
                return undefined;
        }
    }
}
