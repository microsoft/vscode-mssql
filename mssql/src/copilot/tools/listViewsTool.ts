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
import SqlToolsServiceClient from "../../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { SimpleExecuteResult } from "vscode-mssql";
import { listViewsQuery } from "../queries";

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

    constructor(
        private _connectionManager: ConnectionManager,
        private _client: SqlToolsServiceClient,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListViewsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        try {
            const connInfo = this._connectionManager.getConnectionInfo(connectionId);
            const connCreds = connInfo?.credentials;
            if (!connCreds) {
                return JSON.stringify({
                    success: false,
                    message: loc.noConnectionError(connectionId),
                });
            }

            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri: connectionId,
                    queryString: listViewsQuery,
                },
            );
            const views = this.getViewNamesFromResult(result);

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

    private getViewNamesFromResult(result: SimpleExecuteResult): string[] {
        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const viewNames: string[] = [];

        // Extract view names from each row
        // Assuming the query returns view names in the first column
        for (const row of result.rows) {
            if (row && row.length > 0 && row[0] && !row[0].isNull) {
                const viewName = row[0].displayValue.trim();
                if (viewName) {
                    viewNames.push(viewName);
                }
            }
        }

        return viewNames;
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
