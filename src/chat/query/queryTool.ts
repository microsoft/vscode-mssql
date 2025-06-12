/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { Tool } from "../tool";
import { IToolResultHandler, MssqlToolRequestResponse } from "../toolResultHandler";

// /** Parameters for a validation query. */
// export interface ValidationQueryParams {
//     /** SQL to validate a literal value. */
//     validateValueQuery: string;
//     /** SQL to fetch distinct values when validation fails. */
//     fetchDistinctValuesQuery: string;
// }

// /** Parameters for the query tool. */
// export interface QueryToolParams {
//     connectionId: string;
//     query: string;
//     queryName: string;
//     queryDescription: string;
//     /** Validation queries to ensure correctness of literal values. */
//     validationQueries: ValidationQueryParams[];
// }

// /** Result of the query tool. */
// export interface RunQueryToolResult {
//     results: string;
//     errorMessage?: string;
// }

// export namespace RunQueryRequest {
//     export const type = new RequestType<QueryToolParams, MssqlToolRequestResponse, void, void>(
//         "copilot/tools/runquery",
//     );
// }

export class QueryTool extends Tool<QueryToolParams> {
    public readonly toolName = "mssql_query";
    public readonly description = "Query a Microsoft SQL Server database";

    constructor(
        // @ts-ignore
        private _client: SqlToolsServiceClient,
        // @ts-ignore
        private _results: IToolResultHandler,
    ) {
        super();
    }

    async call(
        _options: vscode.LanguageModelToolInvocationOptions<QueryToolParams>,
        _token: vscode.CancellationToken,
    ) {
        return "SQL query results placeholder"; // Placeholder for actual SQL query results

        // const response = await this.client.sendRequest(QueryRequest.type, options.input);
        // const result = await this.results.waitForResult<QueryToolResult>(response.responseId);
        //return JSON.stringify(result);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<QueryToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { connectionId } = options.input;
        const confirmationText = `Run query '${options.input.queryName}' against connection '${connectionId}'?`;
        return {
            invocationMessage: `Running query '${options.input.queryName}' against connection '${connectionId}'.`,
            confirmationMessages: {
                title: "mssql: Query Database",
                message: new vscode.MarkdownString(confirmationText),
            },
        };
    }
}
