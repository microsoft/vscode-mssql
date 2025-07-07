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
import { SimpleExecuteResult } from "../interfaces";
import { listFunctionsQuery } from "../queries";

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

    constructor(
        private _connectionManager: ConnectionManager,
        private _client: SqlToolsServiceClient,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ListFunctionsToolParams>,
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
                    queryString: listFunctionsQuery,
                },
            );
            const functions = this.getFunctionNamesFromResult(result);

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

    private getFunctionNamesFromResult(result: SimpleExecuteResult): string[] {
        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const functionNames: string[] = [];

        // Extract function names from each row
        // Assuming the query returns function names in the first column
        for (const row of result.rows) {
            if (row && row.length > 0 && row[0] && !row[0].isNull) {
                const functionName = row[0].displayValue.trim();
                if (functionName) {
                    functionNames.push(functionName);
                }
            }
        }

        return functionNames;
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
