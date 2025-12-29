/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../../controllers/connectionManager";
import { ToolBase } from "./toolBase";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getDisplayNameForTool } from "./toolsUtils";

/** Parameters for the disconnect tool. */
export interface DisconnectToolParams {
    connectionId: string;
}

/** Result of the disconnect tool. */
export interface DisconnectToolResult {
    success: boolean;
}

export class DisconnectTool extends ToolBase<DisconnectToolParams> {
    public readonly toolName = Constants.copilotDisconnectToolName;

    constructor(private _connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<DisconnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        await this._connectionManager.disconnect(connectionId);

        return JSON.stringify({ success: true } as DisconnectToolResult);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DisconnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const connInfo = this._connectionManager.getConnectionInfo(connectionId);
        const displayName = getDisplayNameForTool(connInfo);

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.disconnectToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.disconnectToolConfirmationMessage(displayName, connectionId),
            ),
        };
        const invocationMessage = loc.disconnectToolInvocationMessage(displayName, connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
