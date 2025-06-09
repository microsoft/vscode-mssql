/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../../controllers/connectionManager";
import { ToolBase } from "./toolBase";

/** Parameters for the connect tool. */
export interface DisconnectToolParams {
    connectionId: string;
}

/** Result of the connect tool. */
export interface DisconnectToolResult {
    success: boolean;
}

export const DISCONNECT_TOOL_NAME = "mssql_disconnect";

export class DisconnectTool extends ToolBase<DisconnectToolParams> {
    public readonly toolName = DISCONNECT_TOOL_NAME;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<DisconnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        await this.connectionManager.disconnect(connectionId);

        return JSON.stringify({ success: true } as DisconnectToolResult);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DisconnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationText = `Disconnect from connection '${connectionId}'?`;
        const confirmationMessages = {
            title: `mssql: Disconnect`,
            message: new vscode.MarkdownString(confirmationText),
        };
        const invocationMessage = `Disconnecting from connection '${connectionId}'`;
        return { invocationMessage, confirmationMessages };
    }
}
