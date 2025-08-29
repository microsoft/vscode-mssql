/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import MainController from "../controllers/mainController";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { SchemaDesignerWebviewManager } from "../schemaDesigner/schemaDesignerWebviewManager";
import VscodeWrapper from "../controllers/vscodeWrapper";

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
    skipConnectionLabels?: boolean; // Skip showing generic connection status labels in chat handler
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
        skipConnectionLabels: true, // Provides its own connection status
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
        skipConnectionLabels: true, // Provides its own connection status
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
        skipConnectionLabels: true, // Provides its own connection status
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri && isConnectionActive(controller, connectionUri)) {
                const res = await controller.onChooseDatabase();
                if (res) {
                    stream.markdown(`${CONNECTED_LABEL_PREFIX} Database changed successfully\n\n`);
                } else {
                    stream.markdown(`${DISCONNECTED_LABEL_PREFIX} Failed to change database\n\n`);
                }
            } else {
                stream.markdown(
                    `${DISCONNECTED_LABEL_PREFIX} No active connection for database change\n\n`,
                );
            }
            return true; // Command was handled
        },
    },
    connectionDetails: {
        type: CommandType.Simple,
        requiresConnection: true,
        skipConnectionLabels: true, // Provides its own connection information
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri && isConnectionActive(controller, connectionUri)) {
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
            } else {
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} No active connection\n\n`);
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
        type: CommandType.Simple,
        requiresConnection: true,
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri && isConnectionActive(controller, connectionUri)) {
                stream.markdown("🔍 Opening schema designer...\n\n");
                const connInfo = controller.connectionManager.getConnectionInfo(connectionUri);
                const connCreds = connInfo?.credentials;
                if (!connCreds) {
                    // TODO: Better error handling - should this ever happen if connection is active?
                    stream.markdown(
                        `${DISCONNECTED_LABEL_PREFIX} No connection credentials found\n\n`,
                    );
                    return true;
                }

                const designer = await SchemaDesignerWebviewManager.getInstance().getSchemaDesigner(
                    controller.context,
                    new VscodeWrapper(),
                    controller,
                    controller.schemaDesignerService,
                    connCreds.database,
                    undefined,
                    connectionUri,
                );
                designer.revealToForeground();
            } else {
                stream.markdown(
                    `${DISCONNECTED_LABEL_PREFIX} No active connection for schema view\n\n`,
                );
            }
            return true; // Command was handled
        },
    },
    showDefinition: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: `${USE_TOOLS_PREFIX}show the definition and structure of the specified database object: `,
    },
    listServers: {
        type: CommandType.Simple,
        requiresConnection: false,
        handler: async (request, stream, controller, _connectionUri) => {
            try {
                const profiles =
                    await controller.connectionManager.connectionStore.readAllConnections(false);

                if (!profiles || profiles.length === 0) {
                    stream.markdown("📋 **Available Servers**\n\n");
                    stream.markdown("No saved connection profiles found.\n\n");
                    stream.markdown("Use `/connect` to create a new connection.\n\n");
                } else {
                    stream.markdown("📋 **Available Servers**\n\n");

                    for (const profile of profiles) {
                        const serverInfo =
                            `${SERVER_DATABASE_LABEL_PREFIX} **${profile.profileName || "Unnamed Profile"}**\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} Server: ${profile.server}\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} Database: ${profile.database || "Default"}\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} Authentication: ${profile.authenticationType || "SQL Login"}\n\n`;
                        stream.markdown(serverInfo);
                    }

                    stream.markdown(`Found ${profiles.length} saved connection profile(s).\n\n`);
                }
            } catch (error) {
                stream.markdown(
                    `${DISCONNECTED_LABEL_PREFIX} Error retrieving server list: ${error instanceof Error ? error.message : "Unknown error"}\n\n`,
                );
            }

            return true; // Command was handled
        },
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
 * Checks if a connection is actually active and valid
 */
function isConnectionActive(
    controller: MainController,
    connectionUri: string | undefined,
): boolean {
    if (!connectionUri) {
        return false;
    }

    const connection = controller.connectionManager.getConnectionInfo(connectionUri);
    return connection !== undefined;
}

/**
 * Checks if a command should skip showing generic connection labels
 */
export function commandSkipsConnectionLabels(commandName: string | undefined): boolean {
    if (!commandName) {
        return false;
    }
    const command = CHAT_COMMANDS[commandName];
    return command?.skipConnectionLabels ?? false;
}

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

    // Send telemetry for all chat command usage
    const telemetryProperties: Record<string, string> = {
        commandName,
        commandType: commandDef.type,
        requiresConnection: commandDef.requiresConnection.toString(),
        hasConnection: isConnectionActive(controller, connectionUri).toString(),
    };

    try {
        // Check connection requirements - verify connection is actually active
        if (commandDef.requiresConnection && !isConnectionActive(controller, connectionUri)) {
            sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ChatCommand, {
                ...telemetryProperties,
                success: "false",
                errorType: "noConnection",
            });
            return {
                handled: true,
                errorMessage: `${DISCONNECTED_LABEL_PREFIX} No active database connection. Please connect first using \`/connect\`.\n\n`,
            };
        }

        // Handle simple commands
        if (commandDef.type === CommandType.Simple && commandDef.handler) {
            await commandDef.handler(request, stream, controller, connectionUri);
            sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ChatCommand, {
                ...telemetryProperties,
                success: "true",
            });
            return { handled: true };
        }

        // Handle prompt substitute commands
        if (commandDef.type === CommandType.PromptSubstitute && commandDef.promptTemplate) {
            sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ChatCommand, {
                ...telemetryProperties,
                success: "true",
            });
            return {
                handled: false, // Don't handle completely, let it continue to language model
                promptToAdd: commandDef.promptTemplate,
            };
        }

        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ChatCommand, {
            ...telemetryProperties,
            success: "false",
            errorType: "unknownCommandType",
        });
        return { handled: false };
    } catch (error) {
        sendErrorEvent(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.ChatCommand,
            error,
            false,
            undefined,
            undefined,
            {
                ...telemetryProperties,
                success: "false",
                errorType: "exception",
            },
        );
        throw error;
    }
}
