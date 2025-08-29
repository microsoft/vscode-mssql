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
import { MssqlChatAgent as loc } from "../constants/locConstants";
import { CHAT_COMMAND_PROMPTS } from "./prompts";

const DISCONNECTED_LABEL_PREFIX = "> ⚠️";
const CONNECTED_LABEL_PREFIX = "> 🟢";
const SERVER_DATABASE_LABEL_PREFIX = "> ➖";

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
                stream.markdown(`${CONNECTED_LABEL_PREFIX} ${loc.connectedSuccessfully}\n\n`);
            } else {
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} ${loc.failedToConnect}\n\n`);
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
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} ${loc.disconnectedSuccessfully}\n\n`);
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
                    stream.markdown(
                        `${CONNECTED_LABEL_PREFIX} ${loc.databaseChangedSuccessfully}\n\n`,
                    );
                } else {
                    stream.markdown(
                        `${DISCONNECTED_LABEL_PREFIX} ${loc.failedToChangeDatabase}\n\n`,
                    );
                }
            } else {
                stream.markdown(
                    `${DISCONNECTED_LABEL_PREFIX} ${loc.noActiveConnectionForDatabaseChange}\n\n`,
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
                        `${CONNECTED_LABEL_PREFIX} **${loc.connectionDetails}**\n\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **${loc.serverLabel}:** ${connection.credentials.server}\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **${loc.databaseLabel}:** ${connection.credentials.database}\n` +
                        `${SERVER_DATABASE_LABEL_PREFIX} **${loc.authentication}:** ${connection.credentials.authenticationType || loc.sqlLogin}\n\n`;
                    stream.markdown(details);
                } else {
                    stream.markdown(
                        `${DISCONNECTED_LABEL_PREFIX} ${loc.noConnectionInformationFound}\n\n`,
                    );
                }
            } else {
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} ${loc.noActiveConnection}\n\n`);
            }
            return true; // Command was handled
        },
    },

    // Prompt substitute commands - these modify the prompt and continue to language model
    runQuery: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.runQuery,
    },
    explain: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.explain,
    },
    fix: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.fix,
    },
    optimize: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.optimize,
    },
    showSchema: {
        type: CommandType.Simple,
        requiresConnection: true,
        handler: async (request, stream, controller, connectionUri) => {
            if (connectionUri && isConnectionActive(controller, connectionUri)) {
                stream.markdown(`${loc.openingSchemaDesigner}\n\n`);
                const connInfo = controller.connectionManager.getConnectionInfo(connectionUri);
                const connCreds = connInfo?.credentials;
                if (!connCreds) {
                    // TODO: Better error handling - should this ever happen if connection is active?
                    stream.markdown(
                        `${DISCONNECTED_LABEL_PREFIX} ${loc.noConnectionCredentialsFound}\n\n`,
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
                    `${DISCONNECTED_LABEL_PREFIX} ${loc.noActiveConnectionForSchemaView}\n\n`,
                );
            }
            return true; // Command was handled
        },
    },
    showDefinition: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.showDefinition,
    },
    listServers: {
        type: CommandType.Simple,
        requiresConnection: false,
        handler: async (request, stream, controller, _connectionUri) => {
            try {
                const profiles =
                    await controller.connectionManager.connectionStore.readAllConnections(false);

                if (!profiles || profiles.length === 0) {
                    stream.markdown(`${loc.availableServers}\n\n`);
                    stream.markdown(`${loc.noSavedConnectionProfilesFound}\n\n`);
                    stream.markdown(`${loc.useConnectToCreateNewConnection}\n\n`);
                } else {
                    stream.markdown(`${loc.availableServers}\n\n`);

                    for (const profile of profiles) {
                        const serverInfo =
                            `${SERVER_DATABASE_LABEL_PREFIX} **${profile.profileName || loc.unnamedProfile}**\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} ${loc.serverLabel}: ${profile.server}\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} ${loc.databaseLabel}: ${profile.database || loc.default}\n` +
                            `${SERVER_DATABASE_LABEL_PREFIX} ${loc.authentication}: ${profile.authenticationType || loc.sqlLogin}\n\n`;
                        stream.markdown(serverInfo);
                    }

                    stream.markdown(`${loc.foundSavedConnectionProfiles(profiles.length)}\n\n`);
                }
            } catch (error) {
                stream.markdown(
                    `${DISCONNECTED_LABEL_PREFIX} ${loc.errorRetrievingServerList(error instanceof Error ? error.message : loc.unknownError)}\n\n`,
                );
            }

            return true; // Command was handled
        },
    },
    listDatabases: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listDatabases,
    },
    listSchemas: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listSchemas,
    },
    listTables: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listTables,
    },
    listViews: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listViews,
    },
    listFunctions: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listFunctions,
    },
    listProcedures: {
        type: CommandType.PromptSubstitute,
        requiresConnection: true,
        promptTemplate: CHAT_COMMAND_PROMPTS.listProcedures,
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
                errorMessage: `${DISCONNECTED_LABEL_PREFIX} ${loc.noActiveDatabaseConnection}\n\n`,
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
