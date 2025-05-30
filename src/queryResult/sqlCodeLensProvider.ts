/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import ConnectionManager from "../controllers/connectionManager";
import { QueryEditor } from "../constants/locConstants";
import { generateDatabaseDisplayName, generateServerDisplayName } from "../models/connectionInfo";

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

        const items: vscode.CodeLens[] = [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: connection
                    ? generateServerDisplayName(connection.credentials)
                    : QueryEditor.codeLensConnect,
                command: Constants.cmdConnect,
            }),
        ];
        if (connection) {
            items.push(
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: generateDatabaseDisplayName(connection.credentials),
                    command: Constants.cmdChooseDatabase,
                }),
            );
        }
        return items;
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
