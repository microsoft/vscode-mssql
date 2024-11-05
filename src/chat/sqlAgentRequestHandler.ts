/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CopilotService } from "../services/copilotService";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    LanguageModelChatTool,
    MessageRole,
    MessageType,
} from "../models/contracts/copilot";

interface ISqlChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    };
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
    vendor: "copilot",
    family: "gpt-4o",
};

let nextConversationUriId = 1;

export const createSqlAgentRequestHandler = (
    copilotService: CopilotService,
    vscodeWrapper: VscodeWrapper,
    context: vscode.ExtensionContext,
): vscode.ChatRequestHandler => {
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<ISqlChatResult> => {
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

            let conversationUri = `conversationUri${nextConversationUriId++}`;
            let connectionUri = vscodeWrapper.activeTextEditorUri;
            if (!connectionUri) {
                stream.markdown(
                    "Please open a SQL file before asking for help.",
                );
                return { metadata: { command: "" } };
            }

            const success = await copilotService.startConversation(
                conversationUri,
                connectionUri,
                prompt,
            );
            console.log(success ? "Success" : "Failure");

            let sqlTool: LanguageModelChatTool;
            let sqlToolParameters: string;
            let replyText = "";
            let continuePollingMessages = true;
            let printTextout = false;
            while (continuePollingMessages) {
                const result = await copilotService.getNextMessage(
                    conversationUri,
                    replyText,
                    sqlTool,
                    sqlToolParameters,
                );
                replyText = "";
                sqlTool = undefined;
                sqlToolParameters = undefined;

                continuePollingMessages =
                    result.messageType !== MessageType.Complete;
                if (
                    result.messageType === MessageType.Complete ||
                    result.messageType === MessageType.Fragment
                ) {
                    replyText = "";
                } else if (result.messageType === MessageType.RequestLLM) {
                    const { text, tool, parameters, print } =
                        await handleRequestLLMMessage(
                            result,
                            model,
                            stream,
                            token,
                        );

                    replyText = text;
                    sqlTool = tool;
                    sqlToolParameters = parameters;
                    printTextout = print;
                }

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

    async function handleRequestLLMMessage(
        result: any,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
    ): Promise<{
        text: string;
        tool: LanguageModelChatTool;
        parameters: string;
        print: boolean;
    }> {
        const requestTools = result.tools.map(
            (tool): vscode.LanguageModelChatTool => {
                return {
                    name: tool.functionName,
                    description: tool.functionDescription,
                    inputSchema: JSON.parse(tool.functionParameters),
                };
            },
        );

        const options: vscode.LanguageModelChatRequestOptions = {
            justification: "SQL Server Copilot requested this information.",
            tools: requestTools,
        };
        const messages = [];

        for (const message of result.requestMessages) {
            if (message.role == MessageRole.System) {
                messages.push(
                    vscode.LanguageModelChatMessage.Assistant(message.text),
                );
            } else {
                messages.push(
                    vscode.LanguageModelChatMessage.User(message.text),
                );
            }
        }

        let sqlTool: LanguageModelChatTool;
        let sqlToolParameters: string;
        let printTextout = false;
        let functionCalledPreviously = true;
        let replyText = "";
        const chatResponse = await model.sendRequest(messages, options, token);
        let partIdx = 0;
        for await (const part of chatResponse.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                if (partIdx === 0 && !functionCalledPreviously) {
                    break;
                }

                functionCalledPreviously = false;
                replyText += part.value;
                printTextout = true;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                functionCalledPreviously = true;
                const { sqlTool: tool, sqlToolParameters: parameters } =
                    await processToolCall(result.tools, part, stream);
                if (!tool) {
                    continue;
                }

                sqlTool = tool;
                sqlToolParameters = parameters;
            }
            ++partIdx;
        }
        return {
            text: replyText,
            tool: sqlTool,
            parameters: sqlToolParameters,
            print: printTextout,
        };
    }

    // Helper function for tool handling
    async function processToolCall(
        resultTools: Array<any>, // Replace `any` with the actual tool type if available
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
        const tool = resultTools.find(
            (tool) => tool.functionName === part.name,
        );
        if (!tool) {
            stream.markdown(
                `Tool lookup for: ${part.name} - ${JSON.stringify(part.input)}. Invoking external tool.`,
            );
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

    function handleError(err: any, stream: vscode.ChatResponseStream): void {
        console.error("Error Details:", err);

        if (err instanceof vscode.LanguageModelError) {
            console.error(
                "Language Model Error:",
                err.message,
                "Code:",
                err.code,
            );

            switch (err.code) {
                case "model_not_found":
                    stream.markdown(
                        "The requested model could not be found. Please check model availability or try a different model.",
                    );
                    break;

                case "no_permission":
                    stream.markdown(
                        "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
                    );
                    break;

                case "quote_limit_exceeded":
                    stream.markdown(
                        "Usage limits exceeded. Try again later, or consider optimizing your requests.",
                    );
                    break;

                case "off_topic":
                    stream.markdown(
                        "I'm sorry, I can only assist with computer science and SQL-related questions.",
                    );
                    break;

                default:
                    stream.markdown(
                        "An unexpected error occurred with the language model. Please try again.",
                    );
                    break;
            }
        } else {
            // Log non-LanguageModelError details to track down the error
            console.error("Unhandled Error Type:", err);
            stream.markdown(
                "An error occurred while processing your request. Please check your input and try again.",
            );
        }
    }

    return handler;
};
