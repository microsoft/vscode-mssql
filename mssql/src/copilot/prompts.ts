/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";

export const genericChatStart = `@${Constants.mssqlChatParticipantName} Hello!`;

export const analyzeQueryPerformancePrompt = `@${Constants.mssqlChatParticipantName} Analyze the performance of this query.
Provide a detailed analysis, including a summary of the execution plan,
potential bottlenecks, and suggestions for optimization.
Make sure to highlight any relevant statistics or metrics that can help in understanding the performance characteristics of the query.
If the query is complex, break down the analysis into smaller parts for better clarity.
Provide a summary of the key findings and recommendations at the end of the analysis.`;

// Shared prompt instructions to avoid duplication
const EXPLAIN_QUERY_INSTRUCTIONS = `Provide a detailed explanation of the query's purpose, business logic, structure, and functionality.
Make sure to clarify the role of each part of the query and how they contribute to the overall result.
Provide examples or analogies if necessary to help understand the query better.`;

export const explainQueryPrompt = `@${Constants.mssqlChatParticipantName} Explain this query.
${EXPLAIN_QUERY_INSTRUCTIONS}`;

export const explainQuerySelectionPrompt = `@${Constants.mssqlChatParticipantName} Explain the selected text of this query.
Provide a detailed explanation of the query's purpose, business logic, structure, and functionality in the context of the query
it is a part of.`;

export const rewriteQueryPrompt = `@${Constants.mssqlChatParticipantName} Rewrite this query.
Provide a revised version of the query that provides optimal performance, readability, or maintainability.
Use the database context to ensure correctness. Think hard to find the absolute best version of the query.
Make sure to explain the changes made and the reasons behind them.
If applicable, include any relevant statistics or metrics that can help in understanding the performance characteristics of the revised query.
If the text contains multiple queries, rewrite each query separately.
If the query is already optimal, please let me know that as well.`;

export const rewriteQuerySelectionPrompt = `@${Constants.mssqlChatParticipantName} Rewrite the selected text of this query.
Provide a revised version of the selected text that improves its performance, readability, or maintainability.
Use the database context to ensure correctness. Think hard to find the absolute best version of the query.
Make sure to explain the changes made and the reasons behind them.
If applicable, include any relevant statistics or metrics that can help in understanding the performance characteristics of the revised query.`;

// Common prefix for prompt substitute commands to encourage tool usage
export const USE_TOOLS_PREFIX = "Use tools to ";

// Prompt templates for chat commands
export const CHAT_COMMAND_PROMPTS = {
    runQuery: `${USE_TOOLS_PREFIX}run query: `,
    explain: `${USE_TOOLS_PREFIX}explain this query. ${EXPLAIN_QUERY_INSTRUCTIONS}`,
    fix: `${USE_TOOLS_PREFIX}fix this SQL query: `,
    optimize: `${USE_TOOLS_PREFIX}optimize this SQL query for better performance: `,
    showDefinition: `${USE_TOOLS_PREFIX}show the definition and structure of the specified database object: `,
    listDatabases: `${USE_TOOLS_PREFIX}list all databases available on the current server. `,
    listSchemas: `${USE_TOOLS_PREFIX}list all schemas in the current database. `,
    listTables: `${USE_TOOLS_PREFIX}list all tables in the current database. `,
    listViews: `${USE_TOOLS_PREFIX}list all views in the current database. `,
    listFunctions: `${USE_TOOLS_PREFIX}list all functions in the current database. `,
    listProcedures: `${USE_TOOLS_PREFIX}list all stored procedures in the current database. `,
} as const;
