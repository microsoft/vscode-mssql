/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "../models/utils";
import { CopilotService } from "../services/copilotService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";
import * as Constants from "../constants/constants";
import {
    GetNextMessageResponse,
    LanguageModelChatTool,
    LanguageModelRequestMessage,
    MessageRole,
    MessageType,
} from "../models/contracts/copilot";
import {
    ActivityObject,
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { MssqlChatAgent as loc } from "../constants/locConstants";
import MainController from "../controllers/mainController";
import { Logger } from "../models/logger";
import {
    handleChatCommand,
    commandSkipsConnectionLabels,
    getConnectionButtonInfo,
} from "./chatCommands";
import {
    CHAT_COMMAND_NAMES,
    copilotFeedbackUrl,
    disconnectedLabelPrefix,
    connectedLabelPrefix,
    serverDatabaseLabelPrefix,
} from "./chatConstants";

export interface ISqlChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
        correlationId: string;
    };
}

export const createSqlAgentRequestHandler = (
    copilotService: CopilotService,
    vscodeWrapper: VscodeWrapper,
    context: vscode.ExtensionContext,
    controller: MainController,
): vscode.ChatRequestHandler => {
    const getNextConversationUri = (() => {
        let idCounter = 1;
        return () => `conversationUri${idCounter++}`;
    })();

    const getLogger = (() => {
        const logger = Logger.create(vscodeWrapper.outputChannel, "MssqlCopilot");

        return () => logger;
    })();

    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<ISqlChatResult> => {
        const correlationId = Utils.generateGuid();
        const logger = getLogger();
        let conversationUri = getNextConversationUri();
        let connectionUri = vscodeWrapper.activeTextEditorUri;
        logger.verbose("In handler");
        logger.logDebug(
            `Starting new chat conversation: conversion '${conversationUri}' with connection '${connectionUri}'`,
        );

        const activity = startActivity(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.StartConversation,
            correlationId,
            {
                correlationId: correlationId,
            },
        );

        let referenceTexts: string[] = [];
        const activeEditor = vscode.window.activeTextEditor;
        logger.logDebug(activeEditor ? "Active editor found." : "No active editor found.");

        async function findEditorFromReferences(
            references: readonly vscode.ChatPromptReference[],
        ): Promise<vscode.TextEditor | undefined> {
            logger.verbose("in findEditorFromReferences");
            const tabGroups = vscode.window.tabGroups.all;

            // Function to check if document is SQL
            function isSqlDocument(document: vscode.TextDocument): boolean {
                logger.verbose("in isSqlDocument");
                logger.logDebug(`Checking if document is SQL: ${document.languageId}`);
                // Check if the document is an SQL file
                // You can add more language IDs as needed
                // For example, you might want to include "sql" or "mssql" for SQL files
                const sqlLanguageIds = ["sql", "mssql"];
                const isSql = sqlLanguageIds.includes(document.languageId);
                logger.logDebug(`Is SQL document: ${isSql ? "Yes" : "No"}`);
                logger.verbose("Exiting isSqlDocument");
                return isSql;
            }

            logger.info("Checking references...");
            for (const reference of references) {
                const value = reference.value;
                let referenceUri: vscode.Uri | undefined;

                if (value instanceof vscode.Location) {
                    referenceUri = value.uri;
                } else if (value instanceof vscode.Uri) {
                    referenceUri = value;
                }

                logger.logDebug(
                    referenceUri ? "Found a reference URI." : "No reference URI found.",
                );

                if (referenceUri) {
                    logger.info("Looking for matching visible editor...");

                    // Try to find this URI in the visible editors, but only if it's an SQL file
                    const matchingEditor = vscode.window.visibleTextEditors.find(
                        (editor) =>
                            editor.document.uri.toString() === referenceUri?.toString() &&
                            isSqlDocument(editor.document),
                    );

                    if (matchingEditor) {
                        logger.info("Returning matching visible editor.");
                        return matchingEditor;
                    }

                    logger.info("No matching visible editor found. Checking tab groups...");
                    // Try to find this URI in tab groups
                    for (const group of tabGroups) {
                        const activeTab = group.activeTab;
                        if (activeTab) {
                            try {
                                /* eslint-disable @typescript-eslint/no-explicit-any */
                                const tabUri =
                                    (activeTab.input as any)?.uri ||
                                    (activeTab.input as any)?.textEditor?.document?.uri;
                                /* eslint-enable @typescript-eslint/no-explicit-any */

                                if (tabUri && tabUri.toString() === referenceUri.toString()) {
                                    logger.info("Found tab URI that matches reference URI.");
                                    const editor = vscode.window.visibleTextEditors.find(
                                        (ed) => ed.document.uri.toString() === tabUri.toString(),
                                    );
                                    // Only return the editor if it's an SQL document
                                    if (editor && isSqlDocument(editor.document)) {
                                        logger.info("Returning matching SQL editor.");
                                        return editor;
                                    }
                                }
                            } catch (error) {
                                logger.error("Error accessing tab properties:", error);
                            }
                        }
                    }
                }
            }

            logger.info("No matching editor found in references. Checking tab groups...");
            // If no match found, try to get any active SQL tab from tab groups
            for (const group of tabGroups) {
                const activeTab = group.activeTab;
                if (activeTab) {
                    try {
                        /* eslint-disable @typescript-eslint/no-explicit-any */
                        // Safely access tab.input properties
                        const tabUri =
                            (activeTab.input as any).uri ||
                            (activeTab.input as any)?.textEditor?.document?.uri;
                        /* eslint-enable @typescript-eslint/no-explicit-any */

                        if (tabUri) {
                            const editor = vscode.window.visibleTextEditors.find(
                                (ed) => ed.document.uri.toString() === tabUri.toString(),
                            );
                            // Only return the editor if it's an SQL document
                            if (editor && isSqlDocument(editor.document)) {
                                logger.info("Returning active SQL editor from tab group.");
                                return editor;
                            }
                        }
                    } catch (error) {
                        logger.error("Error accessing tab properties:", error);
                    }
                }
            }

            logger.verbose("Exiting findEditorFromReferences");
            logger.logDebug("No matching editor found in tab groups. Returning undefined.");
            return undefined;
        }

        // Process references using the appropriate editor
        logger.info("Process references using the appropriate editor...");
        if (request.references) {
            // Use activeEditor if available, otherwise try to find one from references
            const editorToUse =
                activeEditor || (await findEditorFromReferences(request.references));
            logger.info(editorToUse ? "Using editor found." : "No editor found.");

            // Use the preferred editor's URI if available
            connectionUri = editorToUse?.document.uri.toString() ?? connectionUri;
            logger.info(
                connectionUri
                    ? "Using the preferred editor's connection URI."
                    : "No connection URI found.",
            );

            for (const reference of request.references) {
                const value = reference.value;
                if (value instanceof vscode.Location) {
                    // Could be a document / selection in the current editor
                    logger.info("value is a Location");
                    if (
                        editorToUse &&
                        value.uri.toString() === editorToUse.document.uri.toString()
                    ) {
                        referenceTexts.push(
                            `${reference.modelDescription ?? "ChatResponseReference"}: ${editorToUse.document.getText(value.range)}`,
                        );
                    } else {
                        logger.info("Opening text document");
                        const doc = await vscode.workspace.openTextDocument(value.uri);
                        referenceTexts.push(
                            `${reference.modelDescription ?? "ChatResponseReference"}: ${doc.getText(value.range)}`,
                        );
                    }
                } else if (value instanceof vscode.Uri) {
                    logger.info("Value is a URI");
                    // Could be a file/document
                    logger.info("Opening text document");
                    const doc = await vscode.workspace.openTextDocument(value);
                    referenceTexts.push(
                        `${reference.modelDescription ?? "ChatResponseReference"}: ${doc.getText()}`,
                    );
                } else if (typeof reference.value === "string") {
                    logger.info("reference value is a string)");
                    // Could be a string
                    referenceTexts.push(
                        `${reference.modelDescription ?? "ChatResponseReference"}: ${reference.value}`,
                    );
                }
            }
        }

        let prompt = request.prompt.trim();
        const model = request.model;

        try {
            if (!model) {
                logger.info("No model found.");
                activity.endFailed(new Error("No chat model found."), true, undefined, undefined, {
                    correlationId: correlationId,
                });
                stream.markdown(loc.noModelFound);
                return {
                    metadata: {
                        command: "",
                        correlationId: correlationId,
                    },
                };
            }

            // Tool lookup
            const copilotDebugLogging = vscodeWrapper
                .getConfiguration()
                .get(Constants.copilotDebugLogging, false);
            logger.info(copilotDebugLogging ? "Debug logging enabled." : "Debug logging disabled.");
            if (copilotDebugLogging) {
                stream.progress(
                    loc.usingModel(
                        model.name,
                        context.languageModelAccessInformation.canSendRequest(model),
                    ),
                );
            }

            const connection = controller.connectionManager.getConnectionInfo(connectionUri);
            if (!connectionUri || !connection) {
                logger.info(
                    "No connection URI/connection was found. Sending prompt to default language model.",
                );

                activity.update({
                    correlationId: correlationId,
                    message: "No connection URI found. Sending prompt to default language model.",
                });

                // Handle chat commands first
                const commandResult = await handleChatCommand(
                    request,
                    stream,
                    controller,
                    connectionUri,
                );
                if (commandResult.handled) {
                    if (commandResult.errorMessage) {
                        stream.markdown(commandResult.errorMessage);
                    }
                    return {
                        metadata: {
                            command: request.command || "",
                            correlationId: correlationId,
                        },
                    };
                }

                // Show not connected message only if not handled by commands and command doesn't skip labels
                if (!commandSkipsConnectionLabels(request.command)) {
                    stream.markdown(`${disconnectedLabelPrefix} ${loc.notConnected}\n`);

                    // Add button to help user establish connection
                    const buttonInfo = getConnectionButtonInfo();
                    stream.markdown(`${loc.connectionRequiredMessage(buttonInfo.label)}\n\n`);
                    stream.button({
                        command: Constants.cmdCopilotNewQueryWithConnection,
                        title: buttonInfo.label,
                        arguments: [buttonInfo.args],
                    });
                }

                // Apply prompt template if this is a prompt substitute command
                if (commandResult.promptToAdd) {
                    prompt = commandResult.promptToAdd + prompt;
                }

                await sendToDefaultLanguageModel(
                    prompt,
                    model,
                    stream,
                    token,
                    activity,
                    correlationId,
                    logger,
                );
                return {
                    metadata: {
                        command: "",
                        correlationId: correlationId,
                    },
                };
            }

            var connectionMessage =
                `${connectedLabelPrefix} ${loc.connectedTo}  \n` +
                `${serverDatabaseLabelPrefix} ${loc.server(connection.credentials.server)}  \n` +
                `${serverDatabaseLabelPrefix} ${loc.database(connection.credentials.database)}\n\n`;

            // Handle chat commands
            const commandResult = await handleChatCommand(
                request,
                stream,
                controller,
                connectionUri,
            );
            if (commandResult.handled) {
                if (commandResult.errorMessage) {
                    stream.markdown(commandResult.errorMessage);
                }
                return {
                    metadata: {
                        command: request.command || "",
                        correlationId: correlationId,
                    },
                };
            }

            // Show connection info only if command wasn't handled and doesn't skip labels
            if (!commandSkipsConnectionLabels(request.command)) {
                stream.markdown(connectionMessage);
            }

            // Apply prompt template if this is a prompt substitute command
            if (commandResult.promptToAdd) {
                prompt = commandResult.promptToAdd + prompt;
            }

            const success = await copilotService.startConversation(
                conversationUri,
                connectionUri,
                prompt,
            );
            if (!success) {
                logger.info(
                    "Failed to start conversation. Sending prompt to default language model.",
                );
                activity.update({
                    correlationId: correlationId,
                    message:
                        "Failed to start conversation. Sending prompt to default language model.",
                });

                await sendToDefaultLanguageModel(
                    prompt,
                    model,
                    stream,
                    token,
                    activity,
                    correlationId,
                    logger,
                );
                return { metadata: { command: "", correlationId: correlationId } };
            }
            logger.info("Conversation started.");

            let sqlTools: { tool: LanguageModelChatTool; parameters: string }[];
            let replyText = "";
            let continuePollingMessages = true;
            let printTextout = false;

            while (continuePollingMessages) {
                logger.logDebug(`Continue polling messages for '${conversationUri}'`);

                // Default continuePollingMessages to true at the start of each loop
                continuePollingMessages = true;

                // Ensure tools array is initialized
                if (!sqlTools || sqlTools.length === 0) {
                    sqlTools = [{ tool: undefined, parameters: undefined }];
                }

                // Process tool calls and get the result
                logger.info("Processing tool calls and awaiting for the result...");
                const result = await processToolCalls(
                    stream,
                    sqlTools,
                    conversationUri,
                    replyText,
                    copilotService,
                    correlationId,
                    logger,
                );

                // Reset for the next iteration
                replyText = "";
                sqlTools = undefined;
                conversationUri = result.conversationUri ?? conversationUri;

                // Handle different message types
                switch (result.messageType) {
                    case MessageType.Complete:
                        logger.info("Processing complete message...");
                        activity.end(ActivityStatus.Succeeded, {
                            correlationId: correlationId,
                        });

                        continuePollingMessages = false; // Stop polling
                        break;

                    case MessageType.Fragment:
                        // Fragments are intermediate; polling continues
                        break;

                    case MessageType.RequestLLM:
                    case MessageType.RequestDirectLLM:
                        logger.info("Processing LLM message...");
                        const { text, tools, print } = await handleRequestLLMMessage(
                            conversationUri,
                            result,
                            model,
                            stream,
                            token,
                            chatContext,
                            referenceTexts,
                            correlationId,
                            logger,
                        );

                        replyText = text;
                        if (result.messageType === MessageType.RequestLLM) {
                            sqlTools = tools;
                            printTextout = print;
                        } else {
                            printTextout = false;
                        }
                        break;

                    default:
                        activity.endFailed(
                            new Error(`Unhandled message type: ${result.messageType}`),
                            true,
                            undefined,
                            undefined,
                            { correlationId: correlationId },
                        );
                        logger.error(
                            `Stopping polling because of Unhandled message type: ${result.messageType}`,
                        );
                        continuePollingMessages = false;
                        break;
                }

                logger.logDebug(`Done processing message for '${conversationUri}'`);
                // Output reply text if needed
                if (printTextout) {
                    stream.markdown(replyText);
                    printTextout = false;
                }
            }
        } catch (err) {
            handleError(err, stream, correlationId, logger);
        }

        return {
            metadata: {
                command: "",
                correlationId: correlationId,
            },
        };
    };

    async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Operation timed out")), ms),
        );
        return Promise.race([promise, timeout]);
    }

    async function processToolCalls(
        stream: vscode.ChatResponseStream,
        sqlTools: { tool: LanguageModelChatTool; parameters: string }[],
        conversationUri: string,
        replyText: string,
        copilotService: CopilotService,
        correlationId: string,
        logger: Logger,
    ): Promise<GetNextMessageResponse> {
        logger.verbose("in processToolCalls");

        if (sqlTools.length === 0) {
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.Error,
                new Error("No tools to process."),
                true,
                undefined,
                undefined,
                { correlationId: correlationId },
            );

            logger.error("No tools to process.");
            throw new Error(loc.noToolsToProcess);
        }

        let result: GetNextMessageResponse;
        for (const toolCall of sqlTools) {
            try {
                logger.logDebug(`Getting next message for conversationUri: ${conversationUri}`);

                result = await withTimeout(
                    copilotService.getNextMessage(
                        conversationUri,
                        replyText,
                        toolCall.tool,
                        toolCall.parameters,
                    ),
                    60000, // timeout in milliseconds
                );

                if (result.messageType === MessageType.Complete) {
                    logger.logDebug(
                        `Message type is complete for conversationUri: ${conversationUri}`,
                    );
                    break;
                }
            } catch (error) {
                logger.error(`Tool call failed or timed out:`, error);

                // Log telemetry for the unhandled error
                sendErrorEvent(
                    TelemetryViews.MssqlCopilot,
                    TelemetryActions.Error,
                    error instanceof Error ? error : new Error("Unknown tool call error"),
                    true,
                    undefined,
                    undefined,
                    {
                        correlationId: correlationId,
                        toolName: toolCall?.tool?.functionName || "Unknown",
                    },
                );

                // Gracefully warn the user in markdown
                stream.markdown(`⚠️ ${loc.messageCouldNotBeProcessed}\n${copilotFeedbackUrl}`);

                result = undefined;

                break; // Exit the loop if a tool call fails or times out
            }
        }

        if (!result) {
            logger.error("All tool calls failed or timed out.");
            throw new Error("All tool calls failed or timed out.");
        }

        logger.logDebug(`Finished processing tool calls for conversationUri: ${conversationUri}`);
        return result;
    }

    function prepareRequestMessages(
        result: GetNextMessageResponse,
        context: vscode.ChatContext,
        referenceTexts: string[],
        logger: Logger,
    ): vscode.LanguageModelChatMessage[] {
        logger.verbose("in prepareRequestMessages");

        // Get all messages from requestMessages
        const requestMessages = result.requestMessages;

        // Find the index of the first non-system message
        const firstNonSystemIndex = requestMessages.findIndex(
            (message: LanguageModelRequestMessage) => message.role !== MessageRole.System,
        );

        logger.info("Getting initial system messages");

        // Extract initial system messages (ones that appear before any user message)
        const initialSystemMessages = requestMessages
            .slice(0, firstNonSystemIndex === -1 ? requestMessages.length : firstNonSystemIndex)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.Assistant(message.text),
            );

        logger.info("Getting history messages");

        // Convert history messages with optional prefix marker
        const historyPrefix = "[HISTORY] "; // Can be empty string if no marker is desired

        const historyMessages = context.history
            .map((historyItem) => {
                if ("prompt" in historyItem) {
                    // Handle user messages - simple text
                    return vscode.LanguageModelChatMessage.User(historyPrefix + historyItem.prompt);
                } else if ("response" in historyItem && Array.isArray(historyItem.response)) {
                    // Extract content from assistant responses
                    const responseContent = historyItem.response
                        .filter((part) => part !== null && part !== undefined)
                        .map((part) => {
                            // Handle the specific nested object structure with part.value.value
                            if (
                                part &&
                                typeof part.value === "object" &&
                                part.value !== null &&
                                typeof part.value.value === "string"
                            ) {
                                return part.value.value;
                            }

                            // Try accessing through value() function
                            if (part && typeof part.value === "function") {
                                try {
                                    const fnResult = part.value();
                                    // Additional check - if function returns an object with value property
                                    if (
                                        typeof fnResult === "object" &&
                                        fnResult &&
                                        typeof fnResult.value === "string"
                                    ) {
                                        return fnResult.value;
                                    }
                                    return typeof fnResult === "string" ? fnResult : "";
                                } catch (e) {
                                    console.error("Error accessing response value:", e);
                                    return "";
                                }
                            }

                            // Fallback to content property if present
                            if (part && typeof part.content === "string") {
                                return part.content;
                            }

                            return "";
                        })
                        .join("");

                    return responseContent.trim()
                        ? vscode.LanguageModelChatMessage.Assistant(historyPrefix + responseContent)
                        : undefined;
                }
                return undefined;
            })
            .filter((msg): msg is vscode.LanguageModelChatMessage => msg !== undefined);

        logger.info("Getting reference messages");
        // Include reference messages with optional marker
        const referencePrefix = "[REFERENCE] "; // Can be empty string if no marker is desired
        const referenceMessages = referenceTexts
            ? referenceTexts.map((text) =>
                  vscode.LanguageModelChatMessage.Assistant(referencePrefix + text),
              )
            : [];

        // If there are no non-system messages
        if (firstNonSystemIndex === -1) {
            return [...initialSystemMessages, ...historyMessages, ...referenceMessages];
        }

        logger.info("Getting remaining messages...");
        // Process the remaining messages, preserving their original order
        const remainingMessages = requestMessages
            .slice(firstNonSystemIndex)
            .map((message: LanguageModelRequestMessage) => {
                if (message.role === MessageRole.System) {
                    return vscode.LanguageModelChatMessage.Assistant(message.text);
                } else {
                    return vscode.LanguageModelChatMessage.User(message.text);
                }
            });

        logger.info("Returning combined messages...");
        // Combine messages in the desired order
        return [
            ...initialSystemMessages,
            ...historyMessages,
            ...referenceMessages,
            ...remainingMessages,
        ];
    }

    function mapRequestTools(
        tools: LanguageModelChatTool[],
        logger: Logger,
    ): vscode.LanguageModelChatTool[] {
        logger.verbose("in mapRequestTools...");

        return tools.map((tool, index): vscode.LanguageModelChatTool => {
            try {
                // Validate tool name
                if (!tool.functionName || typeof tool.functionName !== "string") {
                    throw new Error(`Tool at index ${index} must have a valid functionName`);
                }

                // Parse parameters with fallback for invalid JSON
                let inputSchema = {};
                const parameters = tool.functionParameters?.trim();
                if (parameters && parameters !== "") {
                    try {
                        inputSchema = JSON.parse(parameters);
                    } catch (parseError) {
                        logger.error(
                            `Failed to parse JSON schema for tool ${tool.functionName}:`,
                            parseError,
                        );
                        // Fallback to empty schema
                    }
                }

                return {
                    name: tool.functionName,
                    description: tool.functionDescription ?? "No description provided",
                    inputSchema: inputSchema,
                };
            } catch (error) {
                logger.error(`Error mapping tool at index ${index}:`, error);
                throw error;
            }
        });
    }

    async function processResponseParts(
        stream: vscode.ChatResponseStream,
        chatResponse: vscode.LanguageModelChatResponse,
        tools: LanguageModelChatTool[],
        correlationId: string,
        logger: Logger,
    ): Promise<{
        replyText: string;
        toolsCalled: { tool: LanguageModelChatTool; parameters: string }[];
        printTextout: boolean;
    }> {
        logger.verbose("in processResponseParts...");
        const toolsCalled: {
            tool: LanguageModelChatTool;
            parameters: string;
        }[] = [];
        let replyText = "";
        let printTextout = false;

        for await (const part of chatResponse.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                logger.info("Part is a language model text part.");
                replyText += part.value;
                printTextout = true;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                logger.info("Part is a language model tool call part.");
                const { sqlTool: tool, sqlToolParameters: parameters } = await processToolCall(
                    tools,
                    part,
                    stream,
                    correlationId,
                    logger,
                );
                if (tool) {
                    logger.logDebug(`Pushing ${tool.functionName} to toolsCalled`);
                    toolsCalled.push({ tool, parameters });
                }
            }
        }

        logger.info("Finished processing response parts.");
        return { replyText, toolsCalled, printTextout };
    }

    async function handleRequestLLMMessage(
        _conversationUri: string,
        result: GetNextMessageResponse,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        context: vscode.ChatContext, // pass this context from above
        referenceTexts: string[],
        correlationId: string,
        logger: Logger,
    ): Promise<{
        text: string;
        tools: { tool: LanguageModelChatTool; parameters: string }[];
        print: boolean;
    }> {
        logger.verbose("in handleRequestLLMMessage");
        const requestTools = mapRequestTools(result.tools, logger);
        const options: vscode.LanguageModelChatRequestOptions = {
            justification: "Azure SQL Copilot agent requires access to language model.",
            tools: [],
        };

        if (result.messageType === MessageType.RequestLLM) {
            logger.info("result.messageType is RequestLLM");
            options.tools = requestTools;
        }

        const messages = prepareRequestMessages(result, context, referenceTexts, logger); // Correct call here

        const chatResponse = await model.sendRequest(messages, options, token);
        const { replyText, toolsCalled, printTextout } = await processResponseParts(
            stream,
            chatResponse,
            result.tools,
            correlationId,
            logger,
        );

        logger.info("Finished handling request LLM message.");
        return {
            text: replyText,
            tools: toolsCalled,
            print: printTextout,
        };
    }

    // Helper function for tool handling
    async function processToolCall(
        resultTools: Array<LanguageModelChatTool>,
        part: vscode.LanguageModelToolCallPart,
        stream: vscode.ChatResponseStream,
        correlationId: string,
        logger: Logger,
    ): Promise<{
        sqlTool: LanguageModelChatTool | undefined;
        sqlToolParameters: string | undefined;
    }> {
        logger.verbose("in processToolCall");
        // Initialize variables to return
        let sqlTool: LanguageModelChatTool | undefined;
        let sqlToolParameters: string | undefined;

        // Tool lookup
        const copilotDebugLogging = vscodeWrapper
            .getConfiguration()
            .get(Constants.copilotDebugLogging, false);

        logger.info("Looking up tool");
        const tool = resultTools.find((tool) => tool.functionName === part.name);
        if (!tool) {
            logger.logDebug(`No tool was found for: ${part.name} - ${JSON.stringify(part.input)}}`);
            if (copilotDebugLogging) {
                stream.markdown(loc.toolLookupFor(part.name, JSON.stringify(part.input)));
            }
            return { sqlTool, sqlToolParameters };
        }

        sqlTool = tool;

        // Parameter handling
        try {
            sqlToolParameters = JSON.stringify(part.input);
        } catch (err) {
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.Error,
                new Error(
                    `Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${getErrorMessage(err)})`,
                ),
                false,
                undefined,
                undefined,
                {
                    correlationId: correlationId,
                },
            );

            logger.error(
                `Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${getErrorMessage(err)})`,
            );
            throw new Error(
                loc.gotInvalidToolUseParameters(JSON.stringify(part.input), getErrorMessage(err)),
            );
        }

        // Log tool call
        logger.logDebug(`Calling tool: ${tool.functionName} with ${sqlToolParameters}`);
        if (copilotDebugLogging) {
            stream.progress(loc.callingTool(tool.functionName, sqlToolParameters));
        }

        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ToolCall, {
            toolName: tool.functionName,
            toolDescription: tool.functionDescription,
            correlationId: correlationId,
        });

        logger.info("Finished processing tool call.");

        return { sqlTool, sqlToolParameters };
    }

    function handleLanguageModelError(
        err: vscode.LanguageModelError,
        stream: vscode.ChatResponseStream,
        correlationId: string,
        logger: Logger,
    ): void {
        logger.verbose("in handleLanguageModelError");
        logger.error("Language Model Error:", getErrorMessage(err), "Code:", err.code);

        const errorMessages: Record<string, string> = {
            model_not_found: loc.modelNotFoundError,
            no_permission: loc.noPermissionError,
            quote_limit_exceeded: loc.quoteLimitExceededError,
            off_topic: loc.offTopicError,
        };

        const errorMessage = errorMessages[err.code] || loc.unexpectedError;

        sendErrorEvent(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.Error,
            new Error(getErrorMessage(err)),
            false,
            err.code || "Unknown",
            err.name || "Unknown",
            {
                correlationId: correlationId,
            },
        );

        stream.markdown(errorMessage);
    }

    async function sendToDefaultLanguageModel(
        prompt: string,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        activity: ActivityObject,
        correlationId: string,
        logger: Logger,
    ): Promise<void> {
        logger.verbose("in sendToDefaultLanguageModel");
        try {
            logger.info(`Using ${model.name} to process your request...`);
            stream.progress(loc.usingModelToProcessRequest(model.name));

            const messages = [vscode.LanguageModelChatMessage.User(prompt.trim())];
            const options: vscode.LanguageModelChatRequestOptions = {
                justification: "Fallback to default language model from MSSQL agent.",
                tools: [], // No tools involved for this fallback
            };

            logger.info("Sending request to default language model.");
            const chatResponse = await model.sendRequest(messages, options, token);

            let replyText = "";
            for await (const part of chatResponse.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    replyText += part.value;
                }
            }

            if (replyText) {
                logger.info("Received response from default language model.");
                activity.end(ActivityStatus.Succeeded, {
                    correlationId: correlationId,
                    message: "The default language model succeeded.",
                });
                stream.markdown(replyText);
            } else {
                logger.info("No output from the default language model.");
                activity.end(ActivityStatus.Succeeded, {
                    correlationId: correlationId,
                    message: "The default language model did not return any output.",
                });
                stream.markdown(loc.languageModelDidNotReturnAnyOutput);
            }
        } catch (err) {
            activity.endFailed(new Error(getErrorMessage(err)), false, undefined, undefined, {
                correlationId: correlationId,
                errorMessage: "Fallback to default language model call failed.",
            });
            logger.error("Error in fallback language model call:", getErrorMessage(err));
            stream.markdown(loc.errorOccurredWhileProcessingRequest);
        }
        logger.info("Finished sending request to default language model.");
    }

    function handleError(
        err: unknown,
        stream: vscode.ChatResponseStream,
        correlationId: string,
        logger: Logger,
    ): void {
        logger.verbose("in handleError");

        if (err instanceof vscode.LanguageModelError) {
            handleLanguageModelError(err, stream, correlationId, logger);
        } else if (err instanceof Error) {
            logger.error("Unhandled Error:", {
                message: err.message,
                stack: err.stack,
            });

            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.Error,
                new Error(`An error occurred with: ${getErrorMessage(err)}`),
                false,
                undefined,
                undefined,
                {
                    correlationId: correlationId,
                },
            );

            console.error("Unhandled Error:", {
                message: err.message,
                stack: err.stack,
            });

            stream.markdown(loc.errorOccurredWith(err.message));
        } else {
            logger.error("Unknown Error Type:", getErrorMessage(err));

            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.Error,
                new Error(`Unknown Error Type: ${getErrorMessage(err)}`),
                false,
                undefined,
                undefined,
                {
                    correlationId: correlationId,
                },
            );

            stream.markdown(loc.unknownErrorOccurred);
        }

        logger.info("Finished handling error.");
    }

    return handler;
};

export function provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken,
    controller: MainController,
    vscodeWrapper: VscodeWrapper,
): vscode.ProviderResult<vscode.ChatFollowup[]> {
    // Only show follow-ups for help command
    if ((result as ISqlChatResult).metadata?.command !== CHAT_COMMAND_NAMES.help) {
        return [];
    }

    // Check current active editor connection directly
    const connectionUri = vscodeWrapper.activeTextEditorUri;
    const connection = controller.connectionManager.getConnectionInfo(connectionUri);
    const hasConnection = !!(connectionUri && connection);

    // If no active connection, suggest connecting
    if (!hasConnection) {
        return [
            {
                prompt: "",
                label: loc.followUpConnectToDatabase,
                command: CHAT_COMMAND_NAMES.connect,
            } satisfies vscode.ChatFollowup,
        ];
    }

    // If connected, suggest database operations
    return [
        {
            prompt: "",
            label: "/listSchemas",
            command: CHAT_COMMAND_NAMES.listSchemas,
        } satisfies vscode.ChatFollowup,
        {
            prompt: loc.followUpShowRandomTableDefinition,
            label: loc.followUpShowRandomTableDefinition,
            command: "",
        } satisfies vscode.ChatFollowup,
        {
            prompt: loc.followUpCountTables,
            label: loc.followUpCountTables,
            command: "",
        } satisfies vscode.ChatFollowup,
    ];
}
