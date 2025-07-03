/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { IConnectionInfo } from "vscode-mssql";
import { getErrorMessage } from "../../utils/utils";

export interface GetConnectionDetailsToolParams {
    connectionId: string;
}

export interface GetConnectionDetailsToolResult {
    success: boolean;
    message?: string;
    connectionInfo: IConnectionInfoSubset;
}

type IConnectionInfoSubset = Pick<
    IConnectionInfo,
    | "server"
    | "database"
    | "authenticationType"
    | "user"
    | "email"
    | "accountId"
    | "tenantId"
    | "trustServerCertificate"
    | "applicationIntent"
>;

export class GetConnectionDetailsTool extends ToolBase<GetConnectionDetailsToolParams> {
    public readonly toolName = Constants.copilotGetConnectionDetailsToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<GetConnectionDetailsToolParams>,
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
                } as GetConnectionDetailsToolResult);
            }
            const res: IConnectionInfoSubset = {
                server: connCreds.server,
                database: connCreds.database,
                authenticationType: connCreds.authenticationType,
                user: connCreds.user,
                email: connCreds.email,
                accountId: connCreds.accountId,
                tenantId: connCreds.tenantId,
                trustServerCertificate: connCreds.trustServerCertificate,
                applicationIntent: connCreds.applicationIntent,
            };

            return JSON.stringify({
                success: true,
                connectionInfo: res,
            } as GetConnectionDetailsToolResult);
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            } as GetConnectionDetailsToolResult);
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetConnectionDetailsToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.getConnectionDetailsToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.getConnectionDetailsToolConfirmationMessage(connectionId),
            ),
        };
        const invocationMessage = loc.getConnectionDetailsToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
