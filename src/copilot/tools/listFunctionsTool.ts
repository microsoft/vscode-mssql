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

export interface ListFunctionsToolParams {
    connectionId: string;
}

export interface ListFunctionsToolResult {
    success: boolean;
    message?: string;
    functions: string[];
}

export class ListFunctionsTool extends ToolBase<ListFunctionsToolParams> {
    public readonly toolName = Constants.copilotListFunctionsToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListFunctionsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        try {
            const connInfo = this.connectionManager.getConnectionInfo(connectionId);
            const connCreds = connInfo?.credentials;
            if (!connCreds) {
                return JSON.stringify({
                    success: false,
                    message: loc.noConnectionError(connectionId),
                });
            }
            // TODO : Implement logic to list functions
            const functions = [];

            return JSON.stringify({
                success: true,
                functions,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ListFunctionsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.ListFunctionsToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.ListFunctionsToolConfirmationMessage(connectionId),
            ),
        };
        const invocationMessage = loc.ListFunctionsToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
