/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import ConnectionManager from "../controllers/connectionManager";
import { QueryEditor } from "../constants/locConstants";
import { getConnectionDisplayString } from "../models/connectionInfo";

export class SqlCodeLensProvider implements vscode.CodeLensProvider {
    constructor(private _connectionManager: ConnectionManager) {}

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const shouldShowActiveConnection = vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configShowActiveConnectionAsCodeLensSuggestion);
        if (!shouldShowActiveConnection) {
            return [];
        }
        const connection = this._connectionManager.getConnectionInfo(document.uri.toString());
        if (connection) {
            const connectionName = getConnectionDisplayString(connection.credentials);
            return [
                new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                    title: connectionName,
                    command: Constants.cmdChooseDatabase,
                    arguments: [
                        {
                            source: "CodeLens",
                        },
                    ],
                }),
            ];
        }
        return [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: QueryEditor.codeLensConnect,
                command: Constants.cmdConnect,
                arguments: [
                    {
                        source: "CodeLens",
                    },
                ],
            }),
        ];
    }

    public resolveCodeLens?(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken,
    ): vscode.CodeLens | Thenable<vscode.CodeLens> {
        return undefined;
    }
}
