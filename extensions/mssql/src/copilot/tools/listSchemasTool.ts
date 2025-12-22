/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getDisplayNameForTool } from "./toolsUtils";
import { getErrorMessage } from "../../utils/utils";
import SqlToolsServiceClient from "../../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { SimpleExecuteResult } from "vscode-mssql";
import { listSchemasQuery } from "../queries";

export interface ListSchemasToolParams {
    connectionId: string;
}

export interface ListSchemasToolResult {
    success: boolean;
    message?: string;
    schemas: string[];
}

export class ListSchemasTool extends ToolBase<ListSchemasToolParams> {
    public readonly toolName = Constants.copilotListSchemasToolName;

    constructor(
        private _connectionManager: ConnectionManager,
        private _client: SqlToolsServiceClient,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListSchemasToolParams>,
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
                    queryString: listSchemasQuery,
                },
            );
            const schemas = this.getSchemaNamesFromResult(result);

            return JSON.stringify({
                success: true,
                schemas,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    private getSchemaNamesFromResult(result: SimpleExecuteResult): string[] {
        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const schemaNames: string[] = [];

        // Extract schema names from each row
        // Assuming the query returns schema names in the first column
        for (const row of result.rows) {
            if (row && row.length > 0 && row[0] && !row[0].isNull) {
                const schemaName = row[0].displayValue.trim();
                if (schemaName) {
                    schemaNames.push(schemaName);
                }
            }
        }

        return schemaNames;
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ListSchemasToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const connInfo = this._connectionManager.getConnectionInfo(connectionId);
        const displayName = getDisplayNameForTool(connInfo);
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.ListSchemasToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.ListSchemasToolConfirmationMessage(displayName, connectionId),
            ),
        };
        const invocationMessage = loc.ListSchemasToolInvocationMessage(displayName, connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
