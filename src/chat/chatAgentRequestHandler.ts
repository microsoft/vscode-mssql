/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "../models/utils";
import { CopilotService } from "../services/copilotService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    GetNextMessageResponse,
    LanguageModelChatTool,
    LanguageModelRequestMessage,
    MessageRole,
    MessageType,
} from "../models/contracts/copilot";
import { ISelectionData } from "../models/interfaces";

interface ISqlChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
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

    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        chatContext: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<ISqlChatResult> => {

        let conversationUri = getNextConversationUri();
        let connectionUri = vscodeWrapper.activeTextEditorUri;
        Utils.logDebug(`Starting new chat conversation: conversion '${conversationUri}' with connection '${connectionUri}'`);

        let activeEditorUri: string | undefined;
        let activeEditorSelection: ISelectionData | undefined;

        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            if (activeEditor.selections?.length === 1) {
                // Calculate the selection if we have a selection, otherwise we'll treat null as
                // the entire document's selection
                if (!activeEditor.selection.isEmpty) {
                    let selection = activeEditor.selection;
                    activeEditorSelection = {
                        startLine: selection.start.line,
                        startColumn: selection.start.character,
                        endLine: selection.end.line,
                        endColumn: selection.end.character,
                    };
                }

                // Trim down the selection. If it is empty after selecting, then we don't execute
                let selectionToTrim = activeEditor.selection;
                if (
                    activeEditor.document.getText(selectionToTrim).trim()
                        .length === 0
                ) {
                    activeEditorSelection = undefined;
                }
            }
        }

        let referenceMessage: string | undefined;
        if (activeEditorSelection) {
            referenceMessage = `Selected document: ${activeEditor.document.getText(activeEditor.selection)}`;
        } else {
            referenceMessage = `Full document: ${activeEditor.document.getText()}`;
        }

        const prompt = request.prompt.trim();
        const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

        try {
            if (!model) {
                stream.markdown("No model found.");
                return { metadata: { command: "" } };
            }

            stream.progress(
                `Using ${model.name} (${context.languageModelAccessInformation.canSendRequest(model)})...`,
            );

            if (!connectionUri) {
                await sendToDefaultLanguageModel(prompt, model, stream, token);
                return { metadata: { command: "" } };
            }

            const success = await copilotService.startConversation(
                conversationUri,
                connectionUri,
                prompt,
            );
            if (!success) {
                await sendToDefaultLanguageModel(prompt, model, stream, token);
                return { metadata: { command: "" } };
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
                    sqlTools,
                    conversationUri,
                    replyText,
                    copilotService,
                );

                // Reset for the next iteration
                replyText = "";
                sqlTools = undefined;
                conversationUri = result.conversationUri ?? conversationUri;

                // Handle different message types
                switch (result.messageType) {
                    case MessageType.Complete:
                        continuePollingMessages = false; // Stop polling
                        break;

                    case MessageType.Fragment:
                        // Fragments are intermediate; polling continues
                        break;

                    case MessageType.RequestLLM:
                    case MessageType.RequestDirectLLM:
                        const { text, tools, print } =
                            await handleRequestLLMMessage(
                                conversationUri,
                                result,
                                model,
                                stream,
                                token,
                                chatContext,
                                referenceMessage,
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
                        console.warn(
                            `Unhandled message type: ${result.messageType}`,
                        );
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
            handleError(err, stream);
        }

        return { metadata: { command: "" } };
    };

    async function processToolCalls(
        sqlTools: { tool: LanguageModelChatTool; parameters: string }[],
        conversationUri: string,
        replyText: string,
        copilotService: CopilotService,
    ): Promise<GetNextMessageResponse> {
        if (sqlTools.length === 0) {
            throw new Error("No tools to process.");
        }

        let result: GetNextMessageResponse;
        for (const toolCall of sqlTools) {
            result = await copilotService.getNextMessage(
                conversationUri,
                replyText,
                toolCall.tool,
                toolCall.parameters,
            );

            if (result.messageType === MessageType.Complete) {
                break;
            }
        }

        return result!;
    }

    // function prepareRequestMessages(
    //     result: GetNextMessageResponse,
    //     context: vscode.ChatContext
    // ): vscode.LanguageModelChatMessage[] {
    //     return result.requestMessages.map(
    //         (message: LanguageModelRequestMessage) =>
    //             message.role === MessageRole.System
    //                 ? vscode.LanguageModelChatMessage.Assistant(message.text)
    //                 : vscode.LanguageModelChatMessage.User(message.text),
    //     );
    // }

    // function prepareRequestMessages(
    //     result: GetNextMessageResponse,
    //     context: vscode.ChatContext
    // ): vscode.LanguageModelChatMessage[] {
    //     // Step 1: Separate system messages from the requestMessages
    //     const systemMessages = result.requestMessages
    //         .filter((message: LanguageModelRequestMessage) => message.role === MessageRole.System)
    //         .map((message: LanguageModelRequestMessage) =>
    //             vscode.LanguageModelChatMessage.Assistant(message.text)
    //         );

    //     // Step 2: Convert chat history messages to LanguageModelChatMessage format
    //     const historyMessages = context.history.map((historyItem) => {
    //         // historyItem.role is either 'user' or 'assistant'
    //         return historyItem.role === 'user'
    //             ? vscode.LanguageModelChatMessage.User(historyItem.content)
    //             : vscode.LanguageModelChatMessage.Assistant(historyItem.content);
    //     });

    //     // Step 3: Get the new user messages (non-system messages from requestMessages)
    //     const userMessages = result.requestMessages
    //         .filter((message: LanguageModelRequestMessage) => message.role !== MessageRole.System)
    //         .map((message: LanguageModelRequestMessage) =>
    //             vscode.LanguageModelChatMessage.User(message.text)
    //         );

    //     // Step 4: Combine them in order: system messages, history, then new user messages
    //     return [...systemMessages, ...historyMessages, ...userMessages];
    // }



    function prepareRequestMessages(
        result: GetNextMessageResponse,
        context: vscode.ChatContext,
        referenceMessage: string | undefined,
    ): vscode.LanguageModelChatMessage[] {
        // Step 1: Separate system messages from the requestMessages
        const systemMessages = result.requestMessages
            .filter((message: LanguageModelRequestMessage) => message.role === MessageRole.System)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.Assistant(message.text)
            );

        // Step 2: Convert chat history messages to LanguageModelChatMessage format
        const historyMessages = context.history.map((historyItem) => {
            if ('prompt' in historyItem) {
                // This is a ChatRequestTurn (user message)
                return vscode.LanguageModelChatMessage.User(historyItem.prompt);
            } else {
                // This is a ChatResponseTurn (assistant message)
                const responseContent = historyItem.response
                    .map((part) => ('content' in part ? part.content : '')) // Handle ChatResponsePart
                    .join(''); // Combine multiple parts if present
                return vscode.LanguageModelChatMessage.Assistant(responseContent);
            }
        });

        // Step 3: Include the reference messages
        // TODO: respect file context visibility setting
        // TODO: properly constuct and pass the reference message
        // TODO: should we cut off the reference message if it is too long? (especially without selection)
        const referenceMessages = referenceMessage
            ? [vscode.LanguageModelChatMessage.Assistant(referenceMessage)]
            : [];


        // Step 3: Get the new user messages (non-system messages from requestMessages)
        const userMessages = result.requestMessages
            .filter((message: LanguageModelRequestMessage) => message.role !== MessageRole.System)
            .map((message: LanguageModelRequestMessage) =>
                vscode.LanguageModelChatMessage.User(message.text)
            );

        // Step 4: Combine them in order: system messages, history, then new user messages
        return [...systemMessages, ...historyMessages, ...referenceMessages, ...userMessages];
    }

    // function prepareRequestMessages(
    //     result: GetNextMessageResponse,
    //     context: vscode.ChatContext
    // ): vscode.LanguageModelChatMessage[] {
    //     const historicalMessages = context.history.map(msg =>
    //         msg.role === vscode.ChatMessageRole.User
    //             ? vscode.LanguageModelChatMessage.User(msg.content)
    //             : vscode.LanguageModelChatMessage.Assistant(msg.content)
    //     );

    //     const currentMessages = result.requestMessages.map(
    //         (message: LanguageModelRequestMessage) =>
    //             message.role === MessageRole.System
    //                 ? vscode.LanguageModelChatMessage.Assistant(message.text)
    //                 : vscode.LanguageModelChatMessage.User(message.text),
    //     );

    //     return [
    //         currentMessages[0],      // System message
    //         ...historicalMessages,   // Injected context
    //         ...currentMessages.slice(1), // Remaining messages
    //     ];
    // }


    // function prepareRequestMessages(
    //     result: GetNextMessageResponse,
    //     context: vscode.ChatContext
    // ): vscode.LanguageModelChatMessage[] {
    //     // const historicalMessages = context.history.flatMap(turn => {
    //     //     if ('prompt' in turn) {
    //     //         return [vscode.LanguageModelChatMessage.User(turn.prompt)];
    //     //     } else if ('response' in turn) {
    //     //         return [vscode.LanguageModelChatMessage.Assistant(turn.response)];
    //     //     }
    //     //     return [];
    //     // });

    //     const historicalMessages = context.history.map(msg =>
    //         msg.role === vscode.ChatMessageRole.User
    //             ? vscode.LanguageModelChatMessage.User(msg.content)
    //             : vscode.LanguageModelChatMessage.Assistant(msg.content)
    //     );


    //     const currentMessages = result.requestMessages.map(
    //         (message: LanguageModelRequestMessage) =>
    //             message.role === MessageRole.System
    //                 ? vscode.LanguageModelChatMessage.Assistant(message.text)
    //                 : vscode.LanguageModelChatMessage.User(message.text),
    //     );

    //     return [
    //         currentMessages[0],        // System message
    //         ...historicalMessages,     // Injected history
    //         ...currentMessages.slice(1), // Remaining current session messages
    //     ];
    // }

    // function prepareRequestMessages(
    //     result: GetNextMessageResponse,
    //     context: vscode.ChatContext,
    // ): vscode.LanguageModelChatMessage[] {
    //     const historicalMessages = context.history.map((msg) =>
    //         msg.role === MessageRole.User
    //             ? vscode.LanguageModelChatMessage.User(msg.content)
    //             : vscode.LanguageModelChatMessage.Assistant(msg.content),
    //     );

    //     const currentMessages = result.requestMessages.map(
    //         (message: LanguageModelRequestMessage) =>
    //             message.role === MessageRole.System
    //                 ? vscode.LanguageModelChatMessage.Assistant(message.text)
    //                 : vscode.LanguageModelChatMessage.User(message.text),
    //     );

    //     return [
    //         currentMessages[0], // System message
    //         ...historicalMessages, // Injected history
    //         ...currentMessages.slice(1), // Remaining current session messages
    //     ];
    // }


    function mapRequestTools(
        tools: LanguageModelChatTool[],
    ): vscode.LanguageModelChatTool[] {
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
                const { sqlTool: tool, sqlToolParameters: parameters } =
                    await processToolCall(tools, part, stream);
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
        referenceMessage: string | undefined,
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

        const messages = prepareRequestMessages(result, context, referenceMessage); // Correct call here

        const chatResponse = await model.sendRequest(messages, options, token);
        const { replyText, toolsCalled, printTextout } =
            await processResponseParts(stream, chatResponse, result.tools);

        return {
            text: replyText,
            tools: toolsCalled,
            print: printTextout,
        };
    }

    // Helper function for tool handling
    async function processToolCall(
        resultTools: Array<LanguageModelChatTool>, // Replace `any` with the actual tool type if available
        part: vscode.LanguageModelToolCallPart,
        stream: vscode.ChatResponseStream,
    ): Promise<{
        sqlTool: LanguageModelChatTool | undefined;
        sqlToolParameters: string | undefined;
    }> {
        // Initialize variables to return
        let sqlTool: LanguageModelChatTool | undefined;
        let sqlToolParameters: string | undefined;

        // Tool lookup
        const tool = resultTools.find((tool) => tool.functionName === part.name);
        if (!tool) {
            stream.markdown(`Tool lookup for: ${part.name} - ${JSON.stringify(part.input)}.`);
            return { sqlTool, sqlToolParameters };
        }

        sqlTool = tool;

        // Parameter handling
        try {
            sqlToolParameters = JSON.stringify(part.input);
        } catch (err) {
            throw new Error(
                `Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${(err as Error).message})`,
            );
        }

        // Log tool call
        stream.progress(
            `Calling tool: ${tool.functionName} with ${sqlToolParameters}`,
        );

        return { sqlTool, sqlToolParameters };
    }

    function handleLanguageModelError(
        err: vscode.LanguageModelError,
        stream: vscode.ChatResponseStream,
    ): void {
        console.error("Language Model Error:", err.message, "Code:", err.code);

        const errorMessages: Record<string, string> = {
            model_not_found:
                "The requested model could not be found. Please check model availability or try a different model.",
            no_permission:
                "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
            quote_limit_exceeded:
                "Usage limits exceeded. Try again later, or consider optimizing your requests.",
            off_topic:
                "I'm sorry, I can only assist with SQL-related questions.",
        };

        const errorMessage =
            errorMessages[err.code] ||
            "An unexpected error occurred with the language model. Please try again.";

        stream.markdown(errorMessage);
    }

    async function sendToDefaultLanguageModel(
        prompt: string,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<void> {
        try {
            stream.progress(`Using ${model.name} to process your request...`);

            const messages = [
                vscode.LanguageModelChatMessage.User(prompt.trim()),
            ];
            const options: vscode.LanguageModelChatRequestOptions = {
                justification:
                    "Fallback to default language model from MSSQL agent.",
                tools: [], // No tools involved for this fallback
            };

            const chatResponse = await model.sendRequest(
                messages,
                options,
                token,
            );

            let replyText = "";
            for await (const part of chatResponse.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    replyText += part.value;
                }
            }

            if (replyText) {
                stream.markdown(replyText);
            } else {
                stream.markdown(
                    "The language model did not return any output.",
                );
            }
        } catch (err) {
            console.error("Error in fallback language model call:", err);
            stream.markdown("An error occurred while processing your request.");
        }
    }

    function handleError(
        err: unknown,
        stream: vscode.ChatResponseStream,
    ): void {
        if (err instanceof vscode.LanguageModelError) {
            handleLanguageModelError(err, stream);
        } else if (err instanceof Error) {
            console.error("Unhandled Error:", {
                message: err.message,
                stack: err.stack,
            });
            stream.markdown("An error occurred: " + err.message);
        } else {
            console.error("Unknown Error Type:", err);
            stream.markdown("An unknown error occurred. Please try again.");
        }
    }

    return handler;
};
