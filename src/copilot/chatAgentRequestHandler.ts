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
const DISCONNECTED_LABEL_PREFIX = "> ⚠️";
const CONNECTED_LABEL_PREFIX = "> 🟢";
const SERVER_DATABASE_LABEL_PREFIX = "> ➖";

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

    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<ISqlChatResult> => {
        const correlationId = Utils.generateGuid();
        let conversationUri = getNextConversationUri();
        let connectionUri = vscodeWrapper.activeTextEditorUri;

        Utils.logDebug(
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

        async function findEditorFromReferences(
            references: readonly vscode.ChatPromptReference[],
        ): Promise<vscode.TextEditor | undefined> {
            const tabGroups = vscode.window.tabGroups.all;

            // Function to check if document is SQL
            function isSqlDocument(document: vscode.TextDocument): boolean {
                const sqlLanguageIds = ["sql", "mssql"];
                return sqlLanguageIds.includes(document.languageId);
            }

            for (const reference of references) {
                const value = reference.value;
                let referenceUri: vscode.Uri | undefined;

                if (value instanceof vscode.Location) {
                    referenceUri = value.uri;
                } else if (value instanceof vscode.Uri) {
                    referenceUri = value;
                }

                if (referenceUri) {
                    // Try to find this URI in the visible editors, but only if it's an SQL file
                    const matchingEditor = vscode.window.visibleTextEditors.find(
                        (editor) =>
                            editor.document.uri.toString() === referenceUri?.toString() &&
                            isSqlDocument(editor.document),
                    );

                    if (matchingEditor) {
                        return matchingEditor;
                    }

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
                                    const editor = vscode.window.visibleTextEditors.find(
                                        (ed) => ed.document.uri.toString() === tabUri.toString(),
                                    );
                                    // Only return the editor if it's an SQL document
                                    if (editor && isSqlDocument(editor.document)) {
                                        return editor;
                                    }
                                }
                            } catch (error) {
                                console.log("Error accessing tab properties:", error);
                            }
                        }
                    }
                }
            }

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
                                return editor;
                            }
                        }
                    } catch (error) {
                        console.log("Error accessing tab properties:", error);
                    }
                }
            }

            return undefined;
        }

        // Process references using the appropriate editor
        if (request.references) {
            // Use activeEditor if available, otherwise try to find one from references
            const editorToUse =
                activeEditor || (await findEditorFromReferences(request.references));

            // Use the preferred editor's URI if available
            connectionUri = editorToUse?.document.uri.toString() ?? connectionUri;

            for (const reference of request.references) {
                const value = reference.value;
                if (value instanceof vscode.Location) {
                    // Could be a document / selection in the current editor
                    if (
                        editorToUse &&
                        value.uri.toString() === editorToUse.document.uri.toString()
                    ) {
                        referenceTexts.push(
                            `${reference.modelDescription ?? "ChatResponseReference"}: ${editorToUse.document.getText(value.range)}`,
                        );
                    } else {
                        const doc = await vscode.workspace.openTextDocument(value.uri);
                        referenceTexts.push(
                            `${reference.modelDescription ?? "ChatResponseReference"}: ${doc.getText(value.range)}`,
                        );
                    }
                } else if (value instanceof vscode.Uri) {
                    // Could be a file/document
                    const doc = await vscode.workspace.openTextDocument(value);
                    referenceTexts.push(
                        `${reference.modelDescription ?? "ChatResponseReference"}: ${doc.getText()}`,
                    );
                } else if (typeof reference.value === "string") {
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
                activity.endFailed(new Error("No chat model found."), true, undefined, undefined, {
                    correlationId: correlationId,
                });
                stream.markdown(loc.noModelFound);
                return { metadata: { command: "", correlationId: correlationId } };
            }

            // Tool lookup
            const copilotDebugLogging = vscodeWrapper
                .getConfiguration()
                .get(Constants.copilotDebugLogging, false);
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
                activity.update({
                    correlationId: correlationId,
                    message: "No connection URI found. Sending prompt to default language model.",
                });
                stream.markdown(`${DISCONNECTED_LABEL_PREFIX} ${loc.notConnected}\n\n`);
                await sendToDefaultLanguageModel(
                    prompt,
                    model,
                    stream,
                    token,
                    activity,
                    correlationId,
                );
                return { metadata: { command: "", correlationId: correlationId } };
            }

            var connectionMessage =
                `${CONNECTED_LABEL_PREFIX} ${loc.connectedTo}  \n` +
                `${SERVER_DATABASE_LABEL_PREFIX} ${loc.server(connection.credentials.server)}  \n` +
                `${SERVER_DATABASE_LABEL_PREFIX} ${loc.database(connection.credentials.database)}\n\n`;
            stream.markdown(connectionMessage);

            const success = await copilotService.startConversation(
                conversationUri,
                connectionUri,
                prompt,
            );
            if (!success) {
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
                );
                return { metadata: { command: "", correlationId: correlationId } };
            }

            let sqlTools: { tool: LanguageModelChatTool; parameters: string }[];
            let replyText = "";
            let continuePollingMessages = true;
            let printTextout = false;

            while (continuePollingMessages) {
                Utils.logDebug(`Continue polling messages for '${conversationUri}'`);

                // Default continuePollingMessages to true at the start of each loop
                continuePollingMessages = true;

                // Ensure tools array is initialized
                if (!sqlTools || sqlTools.length === 0) {
                    sqlTools = [{ tool: undefined, parameters: undefined }];
                }

                // Process tool calls and get the result
                const result = await processToolCalls(
                    stream,
                    sqlTools,
                    conversationUri,
                    replyText,
                    copilotService,
                    correlationId,
                );

                // Reset for the next iteration
                replyText = "";
                sqlTools = undefined;
                conversationUri = result.conversationUri ?? conversationUri;

                // Handle different message types
                switch (result.messageType) {
                    case MessageType.Complete:
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
                        const { text, tools, print } = await handleRequestLLMMessage(
                            conversationUri,
                            result,
                            model,
                            stream,
                            token,
                            chatContext,
                            referenceTexts,
                            correlationId,
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
                        console.warn(`Unhandled message type: ${result.messageType}`);
                        continuePollingMessages = false;
                        break;
                }

                Utils.logDebug(`Done processing message for '${conversationUri}'`);
                // Output reply text if needed
                if (printTextout) {
                    stream.markdown(replyText);
                    printTextout = false;
                }
            }
        } catch (err) {
            handleError(err, stream, correlationId);
        }

        return { metadata: { command: "", correlationId: correlationId } };
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
    ): Promise<GetNextMessageResponse> {
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

            console.error("No tools to process.");
            throw new Error(loc.noToolsToProcess);
        }

        let result: GetNextMessageResponse;
        for (const toolCall of sqlTools) {
            try {
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
                    break;
                }
            } catch (error) {
                console.error(`Tool call failed or timed out:`, error);

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
                stream.markdown(
                    "⚠️ This message couldn't be processed. If this issue persists, please check the logs and [open an issue](https://aka.ms/vscode-mssql-copilot-feedback) on GitHub for this Preview release.",
                );

                result = undefined;

                break; // Exit the loop if a tool call fails or times out
            }
        }

        if (!result) {
            throw new Error("All tool calls failed or timed out.");
        }

        return result;
    }

    function prepareRequestMessages(
        result: GetNextMessageResponse,
        context: vscode.ChatContext,
        referenceTexts: string[],
    ): vscode.LanguageModelChatMessage[] {
        // Get all messages from requestMessages
        const requestMessages = result.requestMessages;

        // Find the index of the first non-system message
        const firstNonSystemIndex = requestMessages.findIndex(
            (message: LanguageModelRequestMessage) => message.role !== MessageRole.System,
        );

        // Extract initial system messages (ones that appear before any user message)
        const initialSystemMessages = requestMessages
            .slice(0, firstNonSystemIndex === -1 ? requestMessages.length : firstNonSystemIndex)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.Assistant(message.text),
            );

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

        // Combine messages in the desired order
        return [
            ...initialSystemMessages,
            ...historyMessages,
            ...referenceMessages,
            ...remainingMessages,
        ];
    }

    function mapRequestTools(tools: LanguageModelChatTool[]): vscode.LanguageModelChatTool[] {
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
    ): Promise<{
        replyText: string;
        toolsCalled: { tool: LanguageModelChatTool; parameters: string }[];
        printTextout: boolean;
    }> {
        const toolsCalled: {
            tool: LanguageModelChatTool;
            parameters: string;
        }[] = [];
        let replyText = "";
        let printTextout = false;

        for await (const part of chatResponse.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                replyText += part.value;
                printTextout = true;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                const { sqlTool: tool, sqlToolParameters: parameters } = await processToolCall(
                    tools,
                    part,
                    stream,
                    correlationId,
                );
                if (tool) {
                    toolsCalled.push({ tool, parameters });
                }
            }
        }

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
    ): Promise<{
        text: string;
        tools: { tool: LanguageModelChatTool; parameters: string }[];
        print: boolean;
    }> {
        const requestTools = mapRequestTools(result.tools);
        const options: vscode.LanguageModelChatRequestOptions = {
            justification: "Azure SQL Copilot agent requires access to language model.",
            tools: [],
        };

        if (result.messageType === MessageType.RequestLLM) {
            options.tools = requestTools;
        }

        const messages = prepareRequestMessages(result, context, referenceTexts); // Correct call here

        const chatResponse = await model.sendRequest(messages, options, token);
        const { replyText, toolsCalled, printTextout } = await processResponseParts(
            stream,
            chatResponse,
            result.tools,
            correlationId,
        );

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
    ): Promise<{
        sqlTool: LanguageModelChatTool | undefined;
        sqlToolParameters: string | undefined;
    }> {
        // Initialize variables to return
        let sqlTool: LanguageModelChatTool | undefined;
        let sqlToolParameters: string | undefined;

        // Tool lookup
        const copilotDebugLogging = vscodeWrapper
            .getConfiguration()
            .get(Constants.copilotDebugLogging, false);

        const tool = resultTools.find((tool) => tool.functionName === part.name);
        if (!tool) {
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

            console.error(
                `Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${getErrorMessage(err)})`,
            );
            throw new Error(
                loc.gotInvalidToolUseParameters(JSON.stringify(part.input), getErrorMessage(err)),
            );
        }

        // Log tool call
        if (copilotDebugLogging) {
            stream.progress(loc.callingTool(tool.functionName, sqlToolParameters));
        }

        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ToolCall, {
            toolName: tool.functionName,
            toolDescription: tool.functionDescription,
            correlationId: correlationId,
        });

        return { sqlTool, sqlToolParameters };
    }

    function handleLanguageModelError(
        err: vscode.LanguageModelError,
        stream: vscode.ChatResponseStream,
        correlationId: string,
    ): void {
        console.error("Language Model Error:", err.message, "Code:", err.code);

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
    ): Promise<void> {
        try {
            stream.progress(loc.usingModelToProcessRequest(model.name));

            const messages = [vscode.LanguageModelChatMessage.User(prompt.trim())];
            const options: vscode.LanguageModelChatRequestOptions = {
                justification: "Fallback to default language model from MSSQL agent.",
                tools: [], // No tools involved for this fallback
            };

            const chatResponse = await model.sendRequest(messages, options, token);

            let replyText = "";
            for await (const part of chatResponse.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    replyText += part.value;
                }
            }

            if (replyText) {
                activity.end(ActivityStatus.Succeeded, {
                    correlationId: correlationId,
                    message: "The default language model succeeded.",
                });
                stream.markdown(replyText);
            } else {
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
            console.error("Error in fallback language model call:", err);
            stream.markdown(loc.errorOccurredWhileProcessingRequest);
        }
    }

    function handleError(
        err: unknown,
        stream: vscode.ChatResponseStream,
        correlationId: string,
    ): void {
        if (err instanceof vscode.LanguageModelError) {
            handleLanguageModelError(err, stream, correlationId);
        } else if (err instanceof Error) {
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
            console.error("Unknown Error Type:", getErrorMessage(err));

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
    }

    return handler;
};
