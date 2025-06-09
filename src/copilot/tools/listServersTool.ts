/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";

export interface ServerProfile {
    serverId: string;
    serverName: string;
    hostName: string;
    defaultDatabase: string;
}

/** Result of the list servers request. */
export interface ListServersResult {
    servers: ServerProfile[];
}

/** Tool implementation for listing database servers from local profiles. */
export class ListServersTool extends ToolBase<undefined> {
    public readonly toolName = "mssql_list_servers";
    public readonly description = "List all database servers registered with the MSSQL extension.";

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<undefined>,
        _token: vscode.CancellationToken,
    ) {
        // Fetch all servers from the connection store
        const profiles = await this.connectionManager.connectionStore.readAllConnections(false);
        // Map to server profiles
        const servers: ServerProfile[] = profiles.map((p) => ({
            serverId: p.id,
            serverName: p.profileName,
            hostName: p.server,
            defaultDatabase: p.database || "",
        }));
        return JSON.stringify({ servers });
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<undefined>,
        _token: vscode.CancellationToken,
    ) {
        const confirmationMessages = {
            title: "mssql: List Database Servers",
            message: new vscode.MarkdownString(
                "List all database servers registered with the mssql extension?",
            ),
        };

        return {
            invocationMessage: "Listing server connections",
            confirmationMessages,
        };
    }
}
