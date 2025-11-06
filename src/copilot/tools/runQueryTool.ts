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
import { SimpleExecuteResult, IDbColumn, DbCellValue } from "vscode-mssql";
import { UserSurvey } from "../../nps/userSurvey";
import { sendActionEvent } from "../../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../../sharedInterfaces/telemetry";

export interface RunQueryToolParams {
    connectionId: string;
    query: string;
    queryTypes: string[];
    queryIntent: string;
}

export interface RunQueryToolResult {
    success: boolean;
    message?: string;
    rowCount?: number;
    columnInfo?: IDbColumn[];
    rows?: DbCellValue[][];
}

export class RunQueryTool extends ToolBase<RunQueryToolParams> {
    public readonly toolName = Constants.copilotRunQueryToolName;

    constructor(
        private _connectionManager: ConnectionManager,
        private _client: SqlToolsServiceClient,
    ) {
        super();
    }

    private sendQueryTelemetry(
        queryTypes: string[],
        queryIntent: string,
        phase: "prepare" | "execute",
    ) {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.RunQuery, {
            phase,
            queryTypes: queryTypes?.join(",") || "unknown",
            queryIntent: queryIntent || "unknown",
        });
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<RunQueryToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId, query, queryTypes, queryIntent } = options.input;

        // Send query-specific telemetry (tool-level telemetry is handled by ToolBase)
        this.sendQueryTelemetry(queryTypes, queryIntent, "execute");

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
                    queryString: query,
                },
            );

            UserSurvey.getInstance().promptUserForNPSFeedback("copilot_agentMode");

            return JSON.stringify({
                success: true,
                rowCount: result.rowCount,
                columnInfo: result.columnInfo,
                rows: result.rows,
            });
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: getErrorMessage(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RunQueryToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId, query, queryTypes, queryIntent } = options.input;

        // Send query-specific telemetry for prepare phase to track what queries are proposed
        this.sendQueryTelemetry(queryTypes, queryIntent, "prepare");

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.RunQueryToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.RunQueryToolConfirmationMessage(connectionId, query),
            ),
        };
        const invocationMessage = loc.RunQueryToolInvocationMessage(connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
