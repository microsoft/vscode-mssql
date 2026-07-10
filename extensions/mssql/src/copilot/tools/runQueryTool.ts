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
import { getDisplayNameForTool } from "./toolsUtils";
import { resolveQueryResultsParams } from "../../queryResults/queryResultsParams";

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
                    void
                >("query/simpleexecute"),
                {
                    ownerUri: connectionId,
                    queryString: query,
                },
            );

            UserSurvey.getInstance().promptUserForNPSFeedback("copilot_agentMode");

            // C2D-5 P0 (addendum §4.1): with the query-results feature area
            // active, cap the rows serialized into the tool result and point
            // the model at mssql_query_results for bounded continued access.
            // With the feature off, behavior is byte-identical to before
            // (zero-impact posture, journal C2D-D-11).
            const queryResultsActive = vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.queryStudio.enabled", false);
            if (queryResultsActive) {
                const cap = resolveQueryResultsParams().params.aiMaxRowsPerResponse;
                const totalRowCount = result.rows?.length ?? 0;
                if (resolveQueryResultsParams().params.aiEnabled && totalRowCount > cap) {
                    return JSON.stringify({
                        success: true,
                        rowCount: result.rowCount,
                        columnInfo: result.columnInfo,
                        rows: result.rows.slice(0, cap),
                        truncated: true,
                        totalRowCount,
                        returnedRowCount: cap,
                        guidance:
                            "The result was truncated to the first rows. For bounded analysis over " +
                            "full results (aggregates, group-by, sampling, filtering), run the query " +
                            "in Query Studio and use the mssql_query_results tool on a snapshot.",
                    });
                }
            }

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

        const connInfo = this._connectionManager.getConnectionInfo(connectionId);
        const displayName = getDisplayNameForTool(connInfo);

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.RunQueryToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.RunQueryToolConfirmationMessage(displayName, connectionId, query),
            ),
        };
        const invocationMessage = loc.RunQueryToolInvocationMessage(displayName, connectionId);
        return { invocationMessage, confirmationMessages };
    }
}
