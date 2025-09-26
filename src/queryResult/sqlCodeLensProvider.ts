/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import ConnectionManager from "../controllers/connectionManager";
import { QueryEditor } from "../constants/locConstants";
import { generateDatabaseDisplayName, generateServerDisplayName } from "../models/connectionInfo";
import * as LocalizedConstants from "../constants/locConstants";

export class SqlCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _codeLensChangedEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses?: vscode.Event<void> = this._codeLensChangedEmitter.event;

    constructor(private _connectionManager: ConnectionManager) {
        this._disposables.push(
            this._connectionManager.onConnectionsChanged(() => {
                this._codeLensChangedEmitter.fire();
            }),
        );
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const shouldShowActiveConnection = vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configShowActiveConnectionAsCodeLensSuggestion);
        if (!shouldShowActiveConnection) {
            return [];
        }

        const connection = this._connectionManager.getConnectionInfo(document.uri.toString(true));
        if (!connection) {
            // On no connection, show a single "Connect" CodeLens
            return [
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: QueryEditor.codeLensConnect,
                    command: Constants.cmdConnect,
                }),
            ];
        } else if (connection.connectionId) {
            // If connected, show the connection change and database change CodeLenses
            return [
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: generateServerDisplayName(connection.credentials),
                    command: Constants.cmdConnect,
                }),
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: generateDatabaseDisplayName(connection.credentials),
                    command: Constants.cmdChooseDatabase,
                }),
            ];
        } else if (connection?.errorNumber || connection?.errorMessage) {
            // If there was an error, show a single "Connection Error" CodeLens with the error message in the tooltip
            const tooltipText = connection.errorNumber
                ? `${connection.errorNumber}: ${connection.errorMessage}`
                : connection.errorMessage;
            return [
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: `$(error) ${LocalizedConstants.StatusBar.connectErrorLabel}`,
                    tooltip: tooltipText,
                    command: Constants.cmdConnect,
                }),
            ];
        }
        return [];
    }

    public resolveCodeLens?(
        _codeLens: vscode.CodeLens,
        _token: vscode.CancellationToken,
    ): vscode.CodeLens | Thenable<vscode.CodeLens> {
        return undefined;
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
    }
}
