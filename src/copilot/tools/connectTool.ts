/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";

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

export const CONNECT_TOOL_NAME = "mssql_connect";

export class ConnectTool extends ToolBase<ConnectToolParams> {
    public readonly toolName = CONNECT_TOOL_NAME;
    public readonly description =
        "Connect to a PostgreSQL server using server name and optional database name.";

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ConnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { serverName, database } = options.input;
        // Fetch all profiles and find the requested one
        const profiles =
            await this.connectionManager.connectionStore.getConnectionQuickpickItems(false);
        const profile = profiles.find((p) => p.connectionCreds.server === serverName);
        if (!profile) {
            return JSON.stringify({
                message: `Server with name '${serverName}' not found.`,
                success: false,
            } as ConnectToolResult);
        }

        // let creds = await this.connectionManager.connectionUI.handleSelectedConnection(profile);
        let creds = undefined;

        const cleanedServerName = serverName.replace(/\//g, "_");
        const effectiveDatabase = database || profile.connectionCreds.database || undefined;
        let connectionId = `mssql/${cleanedServerName}`;
        if (effectiveDatabase) {
            connectionId += `/${effectiveDatabase}`;
        }

        let success: boolean;
        let message: string;
        try {
            success = await this.connectionManager.connect(connectionId, {
                ...creds,
                database: effectiveDatabase,
            });
            message = success ? "Successfully connected." : "Failed to connect.";
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
            ? `Connect to server '${serverName}' and database '${database}'?`
            : `Connect to server '${serverName}'?`;
        const confirmationMessages = {
            title: "mssql: Connect to Database Server",
            message: new vscode.MarkdownString(confirmationText),
        };
        const invocationMessage = `Connecting to server '${serverName}'${database ? ` and database '${database}'` : ""}`;
        return { invocationMessage, confirmationMessages };
    }
}
