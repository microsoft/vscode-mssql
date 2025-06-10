/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";

export interface ShowSchemaToolParams {
    connectionId: string;
}

export interface ShowSchemaToolResult {
    success: boolean;
    message?: string;
}

export class ShowSchemaTool extends ToolBase<ShowSchemaToolParams> {
    public readonly toolName = Constants.copilotShowSchemaToolName;

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
                    message: loc.showSchemaToolNoConnectionError(connectionId),
                });
            }
            // TODO: Implement schema visualization logic
            return JSON.stringify({
                success: true,
                message: loc.showSchemaToolSuccessMessage,
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
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.showSchemaToolConfirmationTitle}`,
            message: new vscode.MarkdownString(loc.showSchemaToolConfirmationMessage(connectionId)),
        };
        const invocationMessage = loc.showSchemaToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
