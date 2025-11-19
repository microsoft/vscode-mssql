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
import { listTablesQuery } from "../queries";

export interface ListTablesToolParams {
    connectionId: string;
}

export interface ListTablesToolResult {
    success: boolean;
    message?: string;
    tables: string[];
}

export class ListTablesTool extends ToolBase<ListTablesToolParams> {
    public readonly toolName = Constants.copilotListTablesToolName;

    constructor(
        private _connectionManager: ConnectionManager,
        private _client: SqlToolsServiceClient,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListTablesToolParams>,
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
                    queryString: listTablesQuery,
                },
            );
            const tables = this.getTableNamesFromResult(result);

            return JSON.stringify({
                success: true,
                tables,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    private getTableNamesFromResult(result: SimpleExecuteResult): string[] {
        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const tableNames: string[] = [];

        // Extract table names from each row
        // Assuming the query returns table names in the first column
        for (const row of result.rows) {
            if (row && row.length > 0 && row[0] && !row[0].isNull) {
                const tableName = row[0].displayValue.trim();
                if (tableName) {
                    tableNames.push(tableName);
                }
            }
        }

        return tableNames;
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ListTablesToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.ListTablesToolConfirmationTitle}`,
            message: new vscode.MarkdownString(loc.ListTablesToolConfirmationMessage(connectionId)),
        };
        const invocationMessage = loc.ListTablesToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
