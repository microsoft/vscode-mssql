/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SqlCmdMode } from "../constants/constants";
import { containsSqlCmdSyntax } from "../sql/sqlcmdSyntaxDetector";
import { getUriKey } from "../utils/utils";
import SqlToolsServiceClient from "./serviceclient";
import { changeSqlCmdModeForFile } from "./utils";

/** Delay after the last edit before an Auto editor is re-checked for SQLCMD syntax. */
export const sqlCmdSyntaxCheckDelayMs = 400;

interface TrackedDocument {
    sqlCmdMode: SqlCmdMode;
    usesSqlCmdLanguage: boolean;
}

/**
 * Keeps each SQL document's language service flavor in sync with its SQLCMD mode. Documents in
 * SQLCMD mode On use the SQLCMD language flavor, documents in Off use the T-SQL flavor, and
 * documents in Auto use the SQLCMD flavor only while they contain SQLCMD syntax, re-checked
 * shortly after each edit. The language service is notified only when a document's flavor flips.
 */
export class SqlCmdLanguageFlavorTracker implements vscode.Disposable {
    private readonly _documents = new Map<string, TrackedDocument>();
    private readonly _pendingChecks = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly _disposables: vscode.Disposable[];

    constructor(private readonly _checkDelayMs: number = sqlCmdSyntaxCheckDelayMs) {
        this._disposables = [
            vscode.workspace.onDidChangeTextDocument((event) =>
                this.onDidChangeTextDocument(event.document),
            ),
            vscode.workspace.onDidCloseTextDocument((document) =>
                this.onDidCloseTextDocument(document),
            ),
        ];
    }

    /**
     * Sets the document's SQLCMD mode and immediately updates its language flavor to match.
     * Called when a SQL document is opened and when its SQLCMD mode changes.
     * @param document the SQL document
     * @param sqlCmdMode the document's SQLCMD mode
     */
    public update(document: vscode.TextDocument, sqlCmdMode: SqlCmdMode): void {
        const uri = getUriKey(document.uri);
        this.cancelPendingCheck(uri);
        const tracked = this._documents.get(uri);
        this._documents.set(uri, {
            sqlCmdMode,
            usesSqlCmdLanguage: tracked?.usesSqlCmdLanguage ?? false,
        });
        this.updateLanguage(uri, document);
    }

    /**
     * Schedules a debounced SQLCMD syntax check for an edited document in SQLCMD mode Auto.
     * @param document the edited document
     */
    public onDidChangeTextDocument(document: vscode.TextDocument): void {
        const uri = getUriKey(document.uri);
        if (this._documents.get(uri)?.sqlCmdMode !== SqlCmdMode.Auto) {
            return;
        }
        this.cancelPendingCheck(uri);
        this._pendingChecks.set(
            uri,
            setTimeout(() => {
                this._pendingChecks.delete(uri);
                if (!document.isClosed) {
                    this.updateLanguage(uri, document);
                }
            }, this._checkDelayMs),
        );
    }

    /**
     * Stops tracking a closed document.
     * @param document the closed document
     */
    public onDidCloseTextDocument(document: vscode.TextDocument): void {
        const uri = getUriKey(document.uri);
        this.cancelPendingCheck(uri);
        this._documents.delete(uri);
    }

    public dispose(): void {
        for (const timer of this._pendingChecks.values()) {
            clearTimeout(timer);
        }
        this._pendingChecks.clear();
        this._documents.clear();
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private updateLanguage(uri: string, document: vscode.TextDocument): void {
        const tracked = this._documents.get(uri);
        if (!tracked) {
            return;
        }
        const usesSqlCmdLanguage =
            tracked.sqlCmdMode === SqlCmdMode.On ||
            (tracked.sqlCmdMode === SqlCmdMode.Auto && containsSqlCmdSyntax(document.getText()));
        if (usesSqlCmdLanguage !== tracked.usesSqlCmdLanguage) {
            tracked.usesSqlCmdLanguage = usesSqlCmdLanguage;
            changeSqlCmdModeForFile(SqlToolsServiceClient.instance, uri, usesSqlCmdLanguage);
        }
    }

    private cancelPendingCheck(uri: string): void {
        const timer = this._pendingChecks.get(uri);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._pendingChecks.delete(uri);
        }
    }
}
