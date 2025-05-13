/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "../models/utils";
import { CopilotService } from "../services/copilotService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
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
import { Logger } from "../models/logger";

export interface ISqlChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
        correlationId: string;
    };
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
    vendor: "copilot",
    family: "gpt-4o",
};

export const createSqlAgentRequestHandler = (
    copilotService: CopilotService,
    vscodeWrapper: VscodeWrapper,
    context: vscode.ExtensionContext,
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
        logger.info("In handler");
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
            logger.info("in findEditorFromReferences");
            const tabGroups = vscode.window.tabGroups.all;

            // Function to check if document is SQL
            function isSqlDocument(document: vscode.TextDocument): boolean {
                logger.info("in isSqlDocument");
                logger.logDebug(`Checking if document is SQL: ${document.languageId}`);
                // Check if the document is an SQL file
                // You can add more language IDs as needed
                // For example, you might want to include "sql" or "mssql" for SQL files
                const sqlLanguageIds = ["sql", "mssql"];
                const isSql = sqlLanguageIds.includes(document.languageId);
                logger.logDebug(`Is SQL document: ${isSql ? "Yes" : "No"}`);
                logger.info("Exiting isSqlDocument");
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

            logger.info("Exiting findEditorFromReferences");
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

        const prompt = request.prompt.trim();
        const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

        try {
            if (!model) {
                logger.info("No model found.");
                activity.endFailed(new Error("No chat model found."), true, undefined, undefined, {
                    correlationId: correlationId,
                });
                stream.markdown("No model found.");
                return { metadata: { command: "", correlationId: correlationId } };
            }

            // Tool lookup
            const copilotDebugLogging = vscodeWrapper
                .getConfiguration()
                .get(Constants.copilotDebugLogging, false);
            logger.info(copilotDebugLogging ? "Debug logging enabled." : "Debug logging disabled.");
            if (copilotDebugLogging) {
                stream.progress(
                    `Using ${model.name} (${context.languageModelAccessInformation.canSendRequest(model)})...`,
                );
            }

            if (!connectionUri) {
                logger.info("No connection URI found. Sending prompt to default language model.");

                activity.update({
                    correlationId: correlationId,
                    message: "No connection URI found. Sending prompt to default language model.",
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
                    sqlTools,
                    conversationUri,
                    replyText,
                    copilotService,
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

        return { metadata: { command: "", correlationId: correlationId } };
    };

    async function processToolCalls(
        sqlTools: { tool: LanguageModelChatTool; parameters: string }[],
        conversationUri: string,
        replyText: string,
        copilotService: CopilotService,
        logger: Logger,
    ): Promise<GetNextMessageResponse> {
        logger.info("in processToolCalls");

        if (sqlTools.length === 0) {
            logger.error("No tools to process.");
            throw new Error("No tools to process.");
        }

        let result: GetNextMessageResponse;
        for (const toolCall of sqlTools) {
            logger.logDebug(`Getting next message for conversationUri: ${conversationUri}`);
            result = await copilotService.getNextMessage(
                conversationUri,
                replyText,
                toolCall.tool,
                toolCall.parameters,
            );

            if (result.messageType === MessageType.Complete) {
                logger.logDebug(`Message type is complete for conversationUri: ${conversationUri}`);
                break;
            }
        }

        logger.logDebug(`Finished processing tool calls for conversationUri: ${conversationUri}`);
        return result!;
    }

    function prepareRequestMessages(
        result: GetNextMessageResponse,
        context: vscode.ChatContext,
        referenceTexts: string[],
        logger: Logger,
    ): vscode.LanguageModelChatMessage[] {
        logger.info("in prepareRequestMessages");
        // Separate system messages from the requestMessages

        logger.info("Getting system messages");
        const systemMessages = result.requestMessages
            .filter((message: LanguageModelRequestMessage) => message.role === MessageRole.System)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.Assistant(message.text),
            );

        logger.info("Getting history messages");
        const historyMessages = context.history
            .map((historyItem) => {
                if ("prompt" in historyItem) {
                    return vscode.LanguageModelChatMessage.User(historyItem.prompt);
                } else {
                    const responseContent = historyItem.response
                        .map((part) => ("content" in part ? part.content : ""))
                        .join("");
                    return responseContent.trim()
                        ? vscode.LanguageModelChatMessage.Assistant(responseContent)
                        : undefined;
                }
            })
            .filter((msg): msg is vscode.LanguageModelChatMessage => msg !== undefined);

        // Include the reference messages
        // TODO: should we cut off the reference message or send a warning if it is too long? (especially without selection)
        logger.info("Getting reference messages");
        const referenceMessages = referenceTexts
            ? referenceTexts.map((text) => vscode.LanguageModelChatMessage.Assistant(text))
            : [];

        //Get the new user messages (non-system messages from requestMessages)
        logger.info("Getting user messages...");
        const userMessages = result.requestMessages
            .filter((message: LanguageModelRequestMessage) => message.role !== MessageRole.System)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.User(message.text),
            );

        // Combine messages in appropriate order
        logger.info("Returning combined messages...");
        return [...systemMessages, ...historyMessages, ...referenceMessages, ...userMessages];
    }

    function mapRequestTools(
        tools: LanguageModelChatTool[],
        logger: Logger,
    ): vscode.LanguageModelChatTool[] {
        logger.info("in mapRequestTools...");
        return tools.map(
            (tool): vscode.LanguageModelChatTool => ({
                name: tool.functionName,
                description: tool.functionDescription,
                inputSchema: JSON.parse(tool.functionParameters),
            }),
        );
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
        logger.logDebug("in processResponseParts...");
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
        logger.info("in handleRequestLLMMessage");
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
        logger.info("in processToolCall");
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
                stream.markdown(`Tool lookup for: ${part.name} - ${JSON.stringify(part.input)}.`);
            }
            return { sqlTool, sqlToolParameters };
        }

        sqlTool = tool;

        // Parameter handling
        try {
            sqlToolParameters = JSON.stringify(part.input);
        } catch (err) {
            logger.error(
                `Got invalid tool use parameters: ${JSON.stringify(part.input)} - (${getErrorMessage(err)})`,
            );
            throw new Error(
                `Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${getErrorMessage(err)})`,
            );
        }

        // Log tool call
        logger.logDebug(`Calling tool: ${tool.functionName} with ${sqlToolParameters}`);
        if (copilotDebugLogging) {
            stream.progress(`Calling tool: ${tool.functionName} with ${sqlToolParameters}`);
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
        logger.info("in handleLanguageModelError");
        logger.error("Language Model Error:", getErrorMessage(err), "Code:", err.code);

        const errorMessages: Record<string, string> = {
            model_not_found:
                "The requested model could not be found. Please check model availability or try a different model.",
            no_permission:
                "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
            quote_limit_exceeded:
                "Usage limits exceeded. Try again later, or consider optimizing your requests.",
            off_topic: "I'm sorry, I can only assist with SQL-related questions.",
        };

        const errorMessage =
            errorMessages[err.code] ||
            "An unexpected error occurred with the language model. Please try again.";

        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.Error, {
            errorCode: err.code || "Unknown",
            errorName: err.name || "Unknown",
            errorMessage: errorMessage,
            originalErrorMessage: err.message || "",
            correlationId: correlationId,
        });

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
        logger.info("in sendToDefaultLanguageModel");
        try {
            logger.info(`Using ${model.name} to process your request...`);
            stream.progress(`Using ${model.name} to process your request...`);

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
                stream.markdown("The language model did not return any output.");
            }
        } catch (err) {
            logger.error("Error in fallback to default language model call:", getErrorMessage(err));
            activity.endFailed(
                new Error("Fallback to default language model call failed."),
                true,
                undefined,
                undefined,
                {
                    correlationId: correlationId,
                    errorMessage: getErrorMessage(err),
                },
            );
            stream.markdown("An error occurred while processing your request.");
        }
        logger.info("Finished sending request to default language model.");
    }

    function handleError(
        err: unknown,
        stream: vscode.ChatResponseStream,
        correlationId: string,
        logger: Logger,
    ): void {
        logger.info("in handleError");

        if (err instanceof vscode.LanguageModelError) {
            handleLanguageModelError(err, stream, correlationId, logger);
        } else if (err instanceof Error) {
            logger.error("Unhandled Error:", {
                message: err.message,
                stack: err.stack,
            });
            stream.markdown("An error occurred: " + err.message);
        } else {
            logger.error("Unknown Error Type:", getErrorMessage(err));
            stream.markdown("An unknown error occurred. Please try again.");
        }

        logger.info("Finished handling error.");
    }

    return handler;
};
