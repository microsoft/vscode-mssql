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
import { uriOwnershipCoordinator } from "../extension";
import { IConnectionProfile } from "../models/interfaces";
import { IConnectionInfo } from "vscode-mssql";

export const connectionCodeLensRange = new vscode.Range(0, 0, 0, 0);

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

        if (uriOwnershipCoordinator) {
            this._disposables.push(
                uriOwnershipCoordinator.onCoordinatingOwnershipChanged(() => {
                    this._codeLensChangedEmitter.fire();
                }),
            );
        }
    }

    public async provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CodeLens[]> {
        // Defer to notebook-specific code lens provider for notebook cells
        if (
            document.uri.scheme === "vscode-notebook-cell" ||
            uriOwnershipCoordinator?.isOwnedByCoordinatingExtension(document.uri)
        ) {
            return [];
        }

        const shouldShowActiveConnection = vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configShowActiveConnectionAsCodeLensSuggestion);
        if (!shouldShowActiveConnection) {
            return [];
        }

        const connection = this._connectionManager.getConnectionInfo(document.uri.toString());
        if (!connection) {
            // On no connection, show a single "Connect" CodeLens
            return [
                new vscode.CodeLens(connectionCodeLensRange, {
                    title: QueryEditor.codeLensConnect,
                    command: Constants.cmdConnect,
                }),
            ];
        } else if (connection.connecting) {
            // While connecting, show a single "Connecting" CodeLens.
            return [
                new vscode.CodeLens(connectionCodeLensRange, {
                    title: `$(loading~spin) ${LocalizedConstants.StatusBar.connectingLabel}`,
                    command: Constants.cmdDisconnect,
                }),
            ];
        } else if (connection.connectionId) {
            // If connected, show [profile name] | server | database
            const codeLenses: vscode.CodeLens[] = [];

            const profileName = await this.getMatchingProfileName(connection.credentials);
            if (profileName) {
                codeLenses.push(
                    new vscode.CodeLens(connectionCodeLensRange, {
                        title: `$(star-full) ${profileName}`,
                        command: Constants.cmdConnect,
                    }),
                );
            }

            codeLenses.push(
                new vscode.CodeLens(connectionCodeLensRange, {
                    title: generateServerDisplayName(connection.credentials),
                    command: Constants.cmdConnect,
                }),
                new vscode.CodeLens(connectionCodeLensRange, {
                    title: generateDatabaseDisplayName(connection.credentials),
                    command: Constants.cmdChooseDatabase,
                }),
            );

            return codeLenses;
        } else if (connection?.errorNumber || connection?.errorMessage) {
            // If there was an error, show a single "Connection Error" CodeLens with the error message in the tooltip
            const tooltipText = connection.errorNumber
                ? `${connection.errorNumber}: ${connection.errorMessage}`
                : connection.errorMessage;
            return [
                new vscode.CodeLens(connectionCodeLensRange, {
                    title: `$(error) ${LocalizedConstants.StatusBar.connectErrorLabel}`,
                    tooltip: tooltipText,
                    command: Constants.cmdConnect,
                }),
            ];
        }
        return [];
    }

    /**
     * Returns the profile name for the current connection if unchanged from the profile's
     * saved configuration (server + database) or if the profile does not specify a database.
     */
    private async getMatchingProfileName(
        credentials: IConnectionInfo,
    ): Promise<string | undefined> {
        const id = (credentials as IConnectionProfile).id;
        if (!id) {
            return undefined;
        }

        const profile =
            await this._connectionManager.connectionStore.connectionConfig.getConnectionById(id);

        if (
            profile &&
            profile.server === credentials.server &&
            (!profile.database || profile.database === credentials.database)
        ) {
            return profile.profileName;
        }

        return undefined;
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
