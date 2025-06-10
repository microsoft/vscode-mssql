/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import { defaultDatabase } from "../../constants/constants";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";

/** Parameters for the connect tool. */
export interface ConnectToolParams {
    serverName: string;
    database?: string;
}

/** Result of the connect tool. */
export interface ConnectToolResult {
    success: boolean;
    connectionId: string;
    message?: string;
}

export class ConnectTool extends ToolBase<ConnectToolParams> {
    public readonly toolName = Constants.copilotConnectToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ConnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        // TODO: should we connect via the connection profile name or server/db name?
        const { serverName, database } = options.input;
        // Fetch all profiles and find the requested one
        const profiles = await this.connectionManager.connectionStore.readAllConnections();
        const profile = profiles.find((p) => p.server === serverName);
        if (!profile) {
            return JSON.stringify({
                message: loc.connectToolServerNotFoundError(serverName),
                success: false,
            } as ConnectToolResult);
        }

        let connectionId = `${Constants.extensionName}/${serverName}`;
        if (database) {
            connectionId += `/${database}`;
        }

        let success: boolean;
        let message: string;
        try {
            success = await this.connectionManager.connect(connectionId, {
                ...profile,
                database: database,
            });
            message = success ? loc.connectToolSuccessMessage : loc.connectToolFailMessage;
        } catch (err) {
            success = false;
            message = err instanceof Error ? err.message : String(err);
        }
        return JSON.stringify({ success, connectionId, message } as ConnectToolResult);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ConnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { serverName, database } = options.input;
        const confirmationText = database
            ? loc.connectToolConfirmationMessageWithServerAndDatabase(serverName, database)
            : loc.connectToolConfirmationMessageWithServerOnly(serverName);
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.connectToolConfirmationTitle}`,
            message: new vscode.MarkdownString(confirmationText),
        };
        const invocationMessage = database
            ? loc.connectToolInvocationMessageWithServerAndDatabase(serverName, database)
            : loc.connectToolInvocationMessageWithServerOnly(serverName);
        return { invocationMessage, confirmationMessages };
    }
}
