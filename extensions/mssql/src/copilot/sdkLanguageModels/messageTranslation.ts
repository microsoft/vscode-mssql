/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface AnthropicMessageTranslation {
    system: string;
    messages: MessageParam[];
}

export function translateForAnthropic(
    messages: vscode.LanguageModelChatMessage[],
): AnthropicMessageTranslation {
    let system = "";
    let chatStart = 0;
    if (messages.length > 0 && messages[0].role === vscode.LanguageModelChatMessageRole.User) {
        system = textOfMessage(messages[0], "Anthropic SDK provider");
        chatStart = 1;
    }

    const chatMessages: MessageParam[] = [];
    for (const message of messages.slice(chatStart)) {
        const role =
            message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
        appendAnthropicMessage(chatMessages, {
            role,
            content: textOfMessage(message, "Anthropic SDK provider"),
        });
    }

    if (chatMessages.length === 0) {
        chatMessages.push({ role: "user", content: "Please respond." });
    } else if (chatMessages[0].role !== "user") {
        chatMessages.unshift({ role: "user", content: "Please respond." });
    }

    return { system, messages: chatMessages };
}

export function translateForOpenAI(
    messages: vscode.LanguageModelChatMessage[],
): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];
    let chatStart = 0;
    if (messages.length > 0 && messages[0].role === vscode.LanguageModelChatMessageRole.User) {
        result.push({
            role: "system",
            content: textOfMessage(messages[0], "OpenAI SDK provider"),
        });
        chatStart = 1;
    }

    for (const message of messages.slice(chatStart)) {
        result.push({
            role:
                message.role === vscode.LanguageModelChatMessageRole.Assistant
                    ? "assistant"
                    : "user",
            content: textOfMessage(message, "OpenAI SDK provider"),
        });
    }

    return result;
}

export function textOfMessage(
    message: vscode.LanguageModelChatMessage,
    providerLabel: string,
): string {
    return message.content
        .map((part) => {
            if (part instanceof vscode.LanguageModelTextPart) {
                return part.value;
            }

            throw new vscode.LanguageModelError(`${providerLabel} only handles text content.`);
        })
        .join("");
}

function appendAnthropicMessage(messages: MessageParam[], next: MessageParam): void {
    const previous = messages.at(-1);
    if (!previous || previous.role !== next.role) {
        messages.push(next);
        return;
    }

    previous.content = `${textOfAnthropicContent(previous.content)}\n\n${textOfAnthropicContent(
        next.content,
    )}`;
}

function textOfAnthropicContent(content: MessageParam["content"]): string {
    return typeof content === "string" ? content : JSON.stringify(content);
}
