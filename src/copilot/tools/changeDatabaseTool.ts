/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getErrorMessage } from "../../utils/utils";

export interface ChangeDatabaseToolParams {
    connectionId: string;
    database: string;
}

export interface ChangeDatabaseToolResult {
    success: boolean;
    message?: string;
}

export class ChangeDatabaseTool extends ToolBase<ChangeDatabaseToolParams> {
    public readonly toolName = Constants.copilotChangeDatabaseToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ChangeDatabaseToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId, database } = options.input;
        try {
            const connInfo = this.connectionManager.getConnectionInfo(connectionId);
            const connCreds = connInfo?.credentials;
            if (!connCreds) {
                return JSON.stringify({
                    success: false,
                    message: loc.noConnectionError(connectionId),
                });
            }

            // TODO: Implement actual database change logic
            console.log(`TODO: Change to database: ${database}`);

            return JSON.stringify({
                success: true,
            } as ChangeDatabaseToolResult);
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            } as ChangeDatabaseToolResult);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ChangeDatabaseToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId, database } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.changeDatabaseToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.changeDatabaseToolConfirmationMessage(connectionId, database),
            ),
        };
        const invocationMessage = loc.changeDatabaseToolInvocationMessage(connectionId, database);
        return { invocationMessage, confirmationMessages };
    }
}
