/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getDisplayNameForTool } from "./toolsUtils";
import { getErrorMessage } from "../../utils/utils";

export interface ListDatabasesToolParams {
    connectionId: string;
}

export interface ListDatabasesToolResult {
    success: boolean;
    message?: string;
    databases: string[];
}

export class ListDatabasesTool extends ToolBase<ListDatabasesToolParams> {
    public readonly toolName = Constants.copilotListDatabasesToolName;

    constructor(private _connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListDatabasesToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        try {
            const connInfo = this._connectionManager.getConnectionInfo(connectionId);
            const connCreds = connInfo?.credentials;
            if (!connCreds) {
                return JSON.stringify({
                    success: false,
                    message: loc.noConnectionError(connectionId),
                });
            }
            const databases = await this._connectionManager.listDatabases(connectionId);

            return JSON.stringify({
                success: true,
                databases,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ListDatabasesToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const connInfo = this._connectionManager.getConnectionInfo(connectionId);
        const displayName = getDisplayNameForTool(connInfo);

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.listDatabasesToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.listDatabasesToolConfirmationMessage(displayName, connectionId),
            ),
        };
        const invocationMessage = loc.listDatabasesToolInvocationMessage(displayName, connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
