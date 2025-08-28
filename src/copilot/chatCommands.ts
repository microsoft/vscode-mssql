/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import MainController from "../controllers/mainController";

const DISCONNECTED_LABEL_PREFIX = "> ⚠️";
const CONNECTED_LABEL_PREFIX = "> 🟢";
const SERVER_DATABASE_LABEL_PREFIX = "> ➖";

// Common prefix for prompt substitute commands to encourage tool usage
const USE_TOOLS_PREFIX = "Use tools to ";

export enum CommandType {
    Simple = "simple",
    PromptSubstitute = "prompt",
}

export interface CommandDefinition {
    type: CommandType;
    requiresConnection: boolean;
    promptTemplate?: string;
    handler?: (
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        controller: MainController,
        connectionUri: string | undefined,
    ) => Promise<boolean>; // Returns true if command was handled, false to continue to language model
}

export const CHAT_COMMANDS: Record<string, CommandDefinition> = {
    // Simple command shortcuts - these are handled directly and don't go to language model
    connect: {
        type: CommandType.Simple,
        requiresConnection: false,
        handler: async (request, stream, controller, _connectionUri) => {
            const res = await controller.onNewConnection();
            if (res) {
                stream.markdown(`${CONNECTED_LABEL_PREFIX} Connected successfully\n\n`);
            } else {
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} Failed to connect\n\n`);
            }
            return true; // Command was handled
        },
    },
    disconnect: {
        type: CommandType.Simple,
        requiresConnection: true,
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri) {
                await controller.connectionManager.disconnect(connectionUri);
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} Disconnected successfully\n\n`);
            }
            return true; // Command was handled
        },
    },
    changeDatabase: {
        type: CommandType.Simple,
        requiresConnection: true,
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri) {
                // TODO: Implement database change logic
                // - Parse database name from user input or show quick pick
                // - Call connection manager to change database
                // - Show success/failure message
                stream.markdown(
                    "🔄 Change Database command will open the database selection dialog.\n\n",
                );
            }
            return true; // Command was handled
        },
    },
    connectionDetails: {
        type: CommandType.Simple,
        requiresConnection: true,
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri) {
                const connection = controller.connectionManager.getConnectionInfo(connectionUri);
                if (connection) {
                    const details =
                        `${CONNECTED_LABEL_PREFIX} **Connection Details**\n\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **Server:** ${connection.credentials.server}\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **Database:** ${connection.credentials.database}\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **Authentication:** ${connection.credentials.authenticationType || "SQL Login"}\n\n`;
                    stream.markdown(details);
                } else {
                    stream.markdown(
                        `${DISCONNECTED_LABEL_PREFIX} No connection information found\n\n`,
                    );
                }
            }
            return true; // Command was handled
        },
    },

    // Prompt substitute commands - these modify the prompt and continue to language model
    runQuery: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}run query: `,
    },
    explain: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}explain query: `,
        // TODO: Double check if this prompt template is optimal for explain functionality
    },
    fix: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}fix this SQL code: `,
        // TODO: Double check if this prompt template is optimal for fix functionality
    },
    optimize: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}optimize this SQL query for better performance: `,
        // TODO: Double check if this prompt template is optimal for optimize functionality
    },
    showSchema: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}show the database schema structure including tables, relationships, and keys. `,
    },
    showDefinition: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}show the definition and structure of the specified database object: `,
    },
    listServers: {
        type: CommandType.PromptSubstitute,
        requiresConnection: false,
        promptTemplate: `${USE_TOOLS_PREFIX}list all available database servers and connection profiles. `,
    },
    listDatabases: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all databases available on the current server. `,
    },
    listSchemas: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all schemas in the current database. `,
    },
    listTables: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all tables in the current database. `,
    },
    listViews: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all views in the current database. `,
    },
    listFunctions: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all functions in the current database. `,
    },
    listProcedures: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}list all stored procedures in the current database. `,
    },
};

/**
 * Checks if a command requires a database connection
 */
export function commandRequiresConnection(commandName: string): boolean {
    const command = CHAT_COMMANDS[commandName];
    return command?.requiresConnection ?? false;
}

/**
 * Gets the command definition for a given command name
 */
export function getCommandDefinition(commandName: string): CommandDefinition | undefined {
    return CHAT_COMMANDS[commandName];
}

/**
 * Checks if a command is a simple command that should be handled directly
 */
export function isSimpleCommand(commandName: string): boolean {
    const command = CHAT_COMMANDS[commandName];
    return command?.type === CommandType.Simple;
}

/**
 * Checks if a command is a prompt substitute command
 */
export function isPromptSubstituteCommand(commandName: string): boolean {
    const command = CHAT_COMMANDS[commandName];
    return command?.type === CommandType.PromptSubstitute;
}

/**
 * Handles a chat command and returns whether the command was handled
 * @param request The chat request
 * @param stream The chat response stream
 * @param controller The main controller
 * @param connectionUri The current connection URI
 * @returns Promise<{ handled: boolean, errorMessage?: string, promptToAdd?: string }>
 */
export async function handleChatCommand(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    controller: MainController,
    connectionUri: string | undefined,
): Promise<{ handled: boolean; errorMessage?: string; promptToAdd?: string }> {
    const commandName = request.command;
    if (!commandName) {
        return { handled: false };
    }

    const commandDef = getCommandDefinition(commandName);
    if (!commandDef) {
        return { handled: false };
    }

    // Check connection requirements
    if (commandDef.requiresConnection && !connectionUri) {
        return {
            handled: true,
            errorMessage: `${DISCONNECTED_LABEL_PREFIX} No database connection. Please connect first using \`/connect\`.\n\n`,
        };
    }

    // Special case: don't show "not connected" for connect command
    if (commandName === "connect" && !connectionUri) {
        // Allow connect command when not connected, don't show the disconnected message first
    }

    // TODO: For prompt substitute commands when not connected, we should return early
    // instead of letting LLM continue with "Use tools to..." prompt, since tools won't work without connection

    // Handle simple commands
    if (commandDef.type === CommandType.Simple && commandDef.handler) {
        await commandDef.handler(request, stream, controller, connectionUri);
        return { handled: true };
    }

    // Handle prompt substitute commands
    if (commandDef.type === CommandType.PromptSubstitute && commandDef.promptTemplate) {
        return {
            handled: false, // Don't handle completely, let it continue to language model
            promptToAdd: commandDef.promptTemplate,
        };
    }

    return { handled: false };
}
