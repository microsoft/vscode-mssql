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

export interface ListViewsToolParams {
    connectionId: string;
}

export interface ListViewsToolResult {
    success: boolean;
    message?: string;
    views: string[];
}

export class ListViewsTool extends ToolBase<ListViewsToolParams> {
    public readonly toolName = Constants.copilotListViewsToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListViewsToolParams>,
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
            // TODO : Implement logic to list views
            const views = [];

            return JSON.stringify({
                success: true,
                views,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ListViewsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.ListViewsToolConfirmationTitle}`,
            message: new vscode.MarkdownString(loc.ListViewsToolConfirmationMessage(connectionId)),
        };
        const invocationMessage = loc.ListViewsToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
