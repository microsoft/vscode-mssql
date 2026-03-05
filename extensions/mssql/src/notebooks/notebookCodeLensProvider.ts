/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { NotebookConnectionManager } from "./notebookConnectionManager";

/**
 * Provides code lenses for SQL cells in notebooks showing the SQL Notebooks
 * connection info.
 *
 * The MSSQL extension provides its own code lens via SqlCodeLensProvider
 * registered with { language: "sql" }. That provider auto-connects cells to
 * _lastActiveConnectionInfo (which may be stale/wrong for notebooks).
 *
 * Why "last connection" doesn't work for notebooks: SqlDocumentService updates
 * _lastActiveConnectionInfo in onDidChangeActiveTextEditor, which fires from
 * vscode.window.activeTextEditor. When a notebook is focused, activeTextEditor
 * is undefined (VS Code uses activeNotebookEditor instead), so the "last
 * connection" never reflects the notebook's connection. When a notebook cell
 * document opens, SqlDocumentService auto-connects it to whatever the last
 * *text editor* connection was — which is unrelated to the notebook.
 *
 * SqlCodeLensProvider defers to this provider for notebook cells by checking
 * the document URI scheme.
 *
 * This is intentionally separate from SqlCodeLensProvider rather than sharing
 * a base class. The two have different data sources (ConnectionManager vs
 * NotebookConnectionManager), different lookup logic (document URI vs
 * cell→notebook mapping), different states (connecting/error vs simple
 * connected/not-connected), and trigger different commands.
 */
export class NotebookCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    private readonly connections: Map<string, NotebookConnectionManager>;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(connections: Map<string, NotebookConnectionManager>) {
        this.connections = connections;
    }

    /** Signal that code lenses may have changed (call after connect/disconnect). */
    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.CodeLens[] {
        // Only handle notebook cells
        if (document.uri.scheme !== "vscode-notebook-cell") {
            return [];
        }

        // Find the notebook this cell belongs to
        const notebook = this.findNotebookForCell(document);
        if (!notebook) {
            return [];
        }

        const mgr = this.connections.get(notebook.uri.toString());
        const range = new vscode.Range(0, 0, 0, 0);

        if (mgr?.isConnected()) {
            const label = mgr.getConnectionLabel();
            return [
                new vscode.CodeLens(range, {
                    title: `$(database) ${label}`,
                    command: Constants.cmdNotebooksChangeDatabase,
                    tooltip: LocalizedConstants.Notebooks.codeLensClickToChangeDatabase,
                }),
            ];
        }

        // Not connected — show a connect prompt
        return [
            new vscode.CodeLens(range, {
                title: `$(plug) ${LocalizedConstants.Notebooks.codeLensConnectToSqlServer}`,
                command: Constants.cmdNotebooksChangeConnection,
            }),
        ];
    }

    private findNotebookForCell(cellDoc: vscode.TextDocument): vscode.NotebookDocument | undefined {
        for (const notebook of vscode.workspace.notebookDocuments) {
            for (const cell of notebook.getCells()) {
                if (cell.document.uri.toString() === cellDoc.uri.toString()) {
                    return notebook;
                }
            }
        }
        return undefined;
    }

    dispose(): void {
        this._onDidChangeCodeLenses.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
}
