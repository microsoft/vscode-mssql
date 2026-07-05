/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type {
    Message,
    MessageCountTokensParams,
    MessageCreateParamsBase,
    MessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";
import { approximateTokenCount } from "../languageModels/shared/tokenApproximation";
import { LanguageModelChatInformation } from "../languageModels/shared/providerModelCatalog";
import {
    getSdkErrorMessage,
    LanguageModelChatResponseProgress,
    SdkClientOptions,
    SdkLanguageModelProviderBase,
    SdkLanguageModelProviderOptions,
    SdkProviderUsage,
} from "./sdkLanguageModelProviderBase";
import { textOfMessage, translateForAnthropic } from "./messageTranslation";

type AnthropicMessageStream = AsyncIterable<MessageStreamEvent> & {
    controller: AbortController;
    finalMessage(): Promise<Message>;
};

export interface AnthropicSdkClient {
    messages: {
        stream(params: MessageCreateParamsBase): AnthropicMessageStream;
        countTokens(params: MessageCountTokensParams): Promise<{ input_tokens: number }>;
    };
}

export type AnthropicSdkClientFactory = (options: ClientOptions) => AnthropicSdkClient;

export interface AnthropicSdkLanguageModelProviderOptions extends SdkLanguageModelProviderOptions {
    clientFactory?: AnthropicSdkClientFactory;
}

export class AnthropicSdkLanguageModelProvider extends SdkLanguageModelProviderBase {
    private readonly _clientFactory: AnthropicSdkClientFactory;
    private _clientCache:
        | {
              key: string;
              client: AnthropicSdkClient;
          }
        | undefined;

    constructor(
        context: vscode.ExtensionContext,
        options?: AnthropicSdkLanguageModelProviderOptions,
    ) {
        super(context, "anthropic", options);
        this._clientFactory = options?.clientFactory ?? ((opts) => new Anthropic(opts));
    }

    public async provideTokenCount(
        model: LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatMessage,
        token: vscode.CancellationToken,
    ): Promise<number> {
        const value =
            typeof text === "string" ? text : textOfMessage(text, "Anthropic SDK provider");
        if (token.isCancellationRequested) {
            return 0;
        }

        const apiKey = await this.apiKeys.resolveAnthropic();
        if (!apiKey || token.isCancellationRequested) {
            return approximateTokenCount(value);
        }

        try {
            const result = await this.getClient(this.toClientOptions(apiKey)).messages.countTokens({
                model: this.getModelId(model),
                messages: [{ role: "user", content: value }],
            });
            return result.input_tokens;
        } catch {
            return approximateTokenCount(value);
        }
    }

    protected async streamResponse(
        clientOptions: SdkClientOptions,
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        maxTokens: number,
        progress: LanguageModelChatResponseProgress,
        token: vscode.CancellationToken,
    ): Promise<SdkProviderUsage | undefined> {
        const translated = translateForAnthropic(messages);
        const stream = this.getClient(clientOptions).messages.stream({
            model: this.getModelId(model),
            ...(translated.system ? { system: translated.system } : {}),
            messages: translated.messages,
            max_tokens: maxTokens,
        });
        const cancellation = token.onCancellationRequested(() => stream.controller.abort());

        try {
            for await (const event of stream) {
                if (token.isCancellationRequested) {
                    break;
                }

                const delta = extractTextDelta(event);
                if (delta) {
                    progress.report(new vscode.LanguageModelTextPart(delta));
                }
            }

            if (token.isCancellationRequested) {
                return undefined;
            }

            const final = await stream.finalMessage();
            return {
                inputTokens: final.usage.input_tokens,
                outputTokens: final.usage.output_tokens,
            };
        } catch (error) {
            if (this.isAbortError(error)) {
                return undefined;
            }
            throw error;
        } finally {
            cancellation.dispose();
        }
    }

    protected mapError(error: unknown): vscode.LanguageModelError {
        return mapAnthropicError(error);
    }

    protected classifyError(error: unknown): string {
        if (error instanceof Anthropic.AuthenticationError) {
            return "auth";
        }
        if (error instanceof Anthropic.RateLimitError) {
            return "rateLimit";
        }
        if (error instanceof Anthropic.BadRequestError) {
            return "badRequest";
        }
        if (error instanceof Anthropic.APIError) {
            return "api";
        }
        return "other";
    }

    protected isAbortError(error: unknown): boolean {
        return error instanceof Anthropic.APIUserAbortError;
    }

    protected invalidateClient(): void {
        this._clientCache = undefined;
    }

    private getClient(options: SdkClientOptions): AnthropicSdkClient {
        const key = JSON.stringify(options);
        if (this._clientCache?.key === key) {
            return this._clientCache.client;
        }

        const client = this._clientFactory(options);
        this._clientCache = { key, client };
        return client;
    }

    private toClientOptions(apiKey: string): SdkClientOptions {
        return {
            apiKey,
            baseURL: this.getBaseUrl(),
            timeout: this.getTimeout(),
            maxRetries: 1,
        };
    }
}

export function mapAnthropicError(error: unknown): vscode.LanguageModelError {
    if (error instanceof Anthropic.AuthenticationError) {
        return vscode.LanguageModelError.NoPermissions(
            "Anthropic API authentication failed. Check your API key.",
        );
    }
    if (error instanceof Anthropic.RateLimitError) {
        return vscode.LanguageModelError.Blocked("Anthropic API rate limit exceeded.");
    }
    if (error instanceof Anthropic.BadRequestError) {
        return new vscode.LanguageModelError(
            `Anthropic API rejected the request: ${error.message}`,
        );
    }
    if (error instanceof Anthropic.APIError) {
        return new vscode.LanguageModelError(
            `Anthropic API error (${error.status}): ${error.message}`,
        );
    }
    return new vscode.LanguageModelError(getSdkErrorMessage(error));
}

function extractTextDelta(event: MessageStreamEvent): string | undefined {
    if (event.type !== "content_block_delta") {
        return undefined;
    }

    const delta = event.delta as unknown as Record<string, unknown>;
    return delta.type === "text_delta" && typeof delta.text === "string" ? delta.text : undefined;
}
