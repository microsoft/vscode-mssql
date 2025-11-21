/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chat UI formatting constants for consistent presentation across chat components
 */

/** Prefix for messages indicating disconnected state */
export const disconnectedLabelPrefix = "> ⚠️";

/** Prefix for messages indicating connected state */
export const connectedLabelPrefix = "> 🟢";

/** Prefix for messages indicating general error state */
export const errorLabelPrefix = "> ❌";

/** Prefix for server/database information display */
export const serverDatabaseLabelPrefix = "> ➖";

/** URL for GitHub Copilot feedback */
export const copilotFeedbackUrl =
  "https://aka.ms/vscode-mssql-copilot-feedback";

/**
 * Chat command names
 */
export const CHAT_COMMAND_NAMES = {
  help: "help",
  connect: "connect",
  disconnect: "disconnect",
  changeDatabase: "changeDatabase",
  getConnectionDetails: "getConnectionDetails",
  listServers: "listServers",
  listDatabases: "listDatabases",
  listSchemas: "listSchemas",
  listTables: "listTables",
  listViews: "listViews",
  listFunctions: "listFunctions",
  listProcedures: "listProcedures",
  showSchema: "showSchema",
  showDefinition: "showDefinition",
  runQuery: "runQuery",
  explain: "explain",
  fix: "fix",
  optimize: "optimize",
} as const;
