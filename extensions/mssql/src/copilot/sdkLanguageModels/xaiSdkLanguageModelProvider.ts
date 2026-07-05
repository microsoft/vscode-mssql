/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import OpenAI, { type ClientOptions } from "openai";
import type {
    ChatCompletionChunk,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/core/streaming";
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
import { textOfMessage, translateForOpenAI } from "./messageTranslation";

const defaultXAiBaseUrl = "https://api.x.ai/v1";

export interface XAiSdkClient {
    chat: {
        completions: {
            create(
                params: ChatCompletionCreateParamsStreaming,
            ): Promise<Stream<ChatCompletionChunk>>;
        };
    };
}

export type XAiSdkClientFactory = (options: ClientOptions) => XAiSdkClient;

export interface XAiSdkLanguageModelProviderOptions extends SdkLanguageModelProviderOptions {
    clientFactory?: XAiSdkClientFactory;
}

export class XAiSdkLanguageModelProvider extends SdkLanguageModelProviderBase {
    private readonly _clientFactory: XAiSdkClientFactory;
    private _clientCache:
        | {
              key: string;
              client: XAiSdkClient;
          }
        | undefined;

    constructor(context: vscode.ExtensionContext, options?: XAiSdkLanguageModelProviderOptions) {
        super(context, "xai", options);
        this._clientFactory = options?.clientFactory ?? ((opts) => new OpenAI(opts));
    }

    public async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatMessage,
        token: vscode.CancellationToken,
    ): Promise<number> {
        if (token.isCancellationRequested) {
            return 0;
        }

        return approximateTokenCount(
            typeof text === "string" ? text : textOfMessage(text, "xAI SDK provider"),
        );
    }

    protected async streamResponse(
        clientOptions: SdkClientOptions,
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        maxTokens: number,
        progress: LanguageModelChatResponseProgress,
        token: vscode.CancellationToken,
    ): Promise<SdkProviderUsage | undefined> {
        const stream = await this.getClient(clientOptions).chat.completions.create({
            model: this.getModelId(model),
            messages: translateForOpenAI(messages),
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
        });
        const cancellation = token.onCancellationRequested(() => stream.controller.abort());
        let usage: SdkProviderUsage | undefined;

        try {
            for await (const chunk of stream) {
                if (token.isCancellationRequested) {
                    break;
                }

                const delta = chunk.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                    progress.report(new vscode.LanguageModelTextPart(delta));
                }

                if (chunk.usage) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens,
                        outputTokens: chunk.usage.completion_tokens,
                    };
                }
            }

            return usage;
        } catch (error) {
            if (this.isAbortError(error)) {
                return usage;
            }
            throw error;
        } finally {
            cancellation.dispose();
        }
    }

    protected mapError(error: unknown): vscode.LanguageModelError {
        return mapXAiError(error);
    }

    protected classifyError(error: unknown): string {
        if (error instanceof OpenAI.AuthenticationError) {
            return "auth";
        }
        if (error instanceof OpenAI.RateLimitError) {
            return "rateLimit";
        }
        if (error instanceof OpenAI.BadRequestError) {
            return "badRequest";
        }
        if (error instanceof OpenAI.APIError) {
            return "api";
        }
        return "other";
    }

    protected isAbortError(error: unknown): boolean {
        return error instanceof OpenAI.APIUserAbortError;
    }

    protected invalidateClient(): void {
        this._clientCache = undefined;
    }

    protected override getBaseUrl(): string {
        return super.getBaseUrl() ?? defaultXAiBaseUrl;
    }

    private getClient(options: SdkClientOptions): XAiSdkClient {
        const key = JSON.stringify(options);
        if (this._clientCache?.key === key) {
            return this._clientCache.client;
        }

        const client = this._clientFactory(options);
        this._clientCache = { key, client };
        return client;
    }
}

export function mapXAiError(error: unknown): vscode.LanguageModelError {
    if (error instanceof OpenAI.AuthenticationError) {
        return vscode.LanguageModelError.NoPermissions(
            "xAI API authentication failed. Check your API key.",
        );
    }
    if (error instanceof OpenAI.RateLimitError) {
        return vscode.LanguageModelError.Blocked("xAI API rate limit exceeded.");
    }
    if (error instanceof OpenAI.BadRequestError) {
        return new vscode.LanguageModelError(`xAI API rejected the request: ${error.message}`);
    }
    if (error instanceof OpenAI.APIError) {
        return new vscode.LanguageModelError(`xAI API error (${error.status}): ${error.message}`);
    }
    return new vscode.LanguageModelError(getSdkErrorMessage(error));
}
