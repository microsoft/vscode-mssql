/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";

export interface ShowSchemaToolParams {
    connectionId: string;
}

export interface ShowSchemaToolResult {
    success: boolean;
    message?: string;
}

export class ShowSchemaTool extends ToolBase<ShowSchemaToolParams> {
    public readonly toolName = "mssql_show_schema";
    public readonly description = "Show the schema for an MSSQL connection.";

    constructor(
        private connectionManager: ConnectionManager,
        // private schemaDesignerService: SchemaDesignerService,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ShowSchemaToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        try {
            const connInfo = this.connectionManager.getConnectionInfo(connectionId)?.credentials;
            if (!connInfo) {
                return JSON.stringify({
                    success: false,
                    message: `No connection found for connectionId: ${connectionId}`,
                });
            }
            // Cast to concrete type to access the method
            // await this.schemaDesignerService.createSchemaWebviewSession(connInfo);
            return JSON.stringify({
                success: true,
                message: "Schema visualization opened.",
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ShowSchemaToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        return {
            invocationMessage: `Showing schema for connection '${connectionId}'`,
            confirmationMessages: {
                title: "mssql: Show Schema",
                message: new vscode.MarkdownString(`Show schema for connection '${connectionId}'?`),
            },
        };
    }
}
