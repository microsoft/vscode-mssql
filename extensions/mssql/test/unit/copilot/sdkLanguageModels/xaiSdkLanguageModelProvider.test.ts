/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import OpenAI from "openai";
import type {
    ChatCompletionChunk,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import * as Constants from "../../../../src/constants/constants";
import {
    XAiSdkClient,
    XAiSdkLanguageModelProvider,
} from "../../../../src/copilot/sdkLanguageModels/xaiSdkLanguageModelProvider";
import { getSecretStorageKey, SdkApiKeyResolver } from "../../../../src/copilot/sdkLanguageModels";
import { defaultXAiSdkModels } from "../../../../src/copilot/sdkLanguageModels/sdkModelCatalog";
import { stubTelemetry } from "../../utils";
import {
    createSdkExtensionContext,
    stubWorkspaceConfiguration,
    textOf,
} from "./sdkProviderTestUtils";

suite("XAiSdkLanguageModelProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let configuration: Record<string, unknown>;
    let originalXAiKey: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        configuration = {};
        stubWorkspaceConfiguration(sandbox, configuration);
        originalXAiKey = process.env.XAI_API_KEY;
        delete process.env.XAI_API_KEY;
    });

    teardown(() => {
        if (originalXAiKey === undefined) {
            delete process.env.XAI_API_KEY;
        } else {
            process.env.XAI_API_KEY = originalXAiKey;
        }
        sandbox.restore();
    });

    test("prepareLanguageModelChat returns models when API key is configured", async () => {
        const models = await createProvider(createContextWithKey()).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models.map((model) => model.id)).to.deep.equal(
            defaultXAiSdkModels.map((model) => model.id),
        );
    });

    test("user-defined additional models appear in the catalog", async () => {
        configuration[Constants.configCopilotSdkProvidersXAiAdditionalModels] = [
            {
                id: "grok-private",
                displayName: "Grok Private",
                family: "grok-private",
                maxInputTokens: 123,
                maxOutputTokens: 45,
            },
        ];

        const models = await createProvider(createContextWithKey()).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models.at(-1)).to.include({
            id: "grok-private",
            name: "Grok Private",
            maxInputTokens: 123,
            maxOutputTokens: 45,
        });
    });

    test("streaming content deltas drive progress with xAI chat completion parameters", async () => {
        const stream = new FakeXAiStream([textChunk("SELECT"), textChunk(" 1")]);
        const create = sandbox.stub().resolves(stream);
        const progressParts: vscode.LanguageModelTextPart[] = [];

        await createProviderWithClient(create).provideLanguageModelChatResponse(
            defaultModel(),
            [
                vscode.LanguageModelChatMessage.User("system rules"),
                vscode.LanguageModelChatMessage.User("complete this"),
            ],
            { modelOptions: { maxTokens: 240 } },
            { report: (part) => progressParts.push(part) },
            cancellationToken(),
        );

        expect(textOf(progressParts)).to.equal("SELECT 1");
        const params = create.firstCall.args[0] as ChatCompletionCreateParamsStreaming;
        expect(params.model).to.equal("grok-4-1-fast-non-reasoning");
        expect(params.max_tokens).to.equal(240);
        expect(params).not.to.have.property("max_completion_tokens");
        expect(params.stream_options).to.deep.equal({ include_usage: true });
        expect(params.messages).to.deep.equal([
            { role: "system", content: "system rules" },
            { role: "user", content: "complete this" },
        ]);
    });

    test("default xAI baseUrl and configured timeout flow to the SDK constructor", async () => {
        configuration[Constants.configCopilotSdkProvidersXAiTimeout] = 4321;
        const factory = sandbox
            .stub()
            .returns(createClient(sandbox.stub().resolves(new FakeXAiStream([]))));
        const context = createContextWithKey();
        const provider = new XAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            clientFactory: factory,
            suppressMissingKeyNotification: true,
        });

        await provider.provideLanguageModelChatResponse(
            defaultModel(),
            [vscode.LanguageModelChatMessage.User("rules")],
            {},
            { report: sandbox.stub() },
            cancellationToken(),
        );

        expect(factory.firstCall.args[0]).to.include({
            apiKey: "xai-test",
            baseURL: "https://api.x.ai/v1",
            timeout: 4321,
            maxRetries: 1,
        });
    });

    test("configured baseUrl overrides the xAI default", async () => {
        configuration[Constants.configCopilotSdkProvidersXAiBaseUrl] =
            "https://gateway.example/xai";
        const factory = sandbox
            .stub()
            .returns(createClient(sandbox.stub().resolves(new FakeXAiStream([]))));
        const context = createContextWithKey();
        const provider = new XAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            clientFactory: factory,
            suppressMissingKeyNotification: true,
        });

        await provider.provideLanguageModelChatResponse(
            defaultModel(),
            [vscode.LanguageModelChatMessage.User("rules")],
            {},
            { report: sandbox.stub() },
            cancellationToken(),
        );

        expect(factory.firstCall.args[0]).to.include({
            baseURL: "https://gateway.example/xai",
        });
    });

    function createProvider(context: vscode.ExtensionContext): XAiSdkLanguageModelProvider {
        return new XAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            suppressMissingKeyNotification: true,
        });
    }

    function createProviderWithClient(create: sinon.SinonStub): XAiSdkLanguageModelProvider {
        const context = createContextWithKey();
        return new XAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            clientFactory: () => createClient(create),
            suppressMissingKeyNotification: true,
        });
    }
});

class FakeXAiStream implements AsyncIterable<ChatCompletionChunk> {
    public readonly controller = new AbortController();

    constructor(private readonly _chunks: ChatCompletionChunk[]) {}

    public async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
        for (const chunk of this._chunks) {
            await Promise.resolve();
            if (this.controller.signal.aborted) {
                throw new OpenAI.APIUserAbortError();
            }
            yield chunk;
        }
    }
}

function createClient(create: sinon.SinonStub): XAiSdkClient {
    return {
        chat: {
            completions: {
                create,
            },
        },
    } as unknown as XAiSdkClient;
}

function createContextWithKey(): vscode.ExtensionContext {
    const context = createSdkExtensionContext();
    void context.secrets.store(getSecretStorageKey("xai"), "xai-test");
    return context;
}

function defaultModel() {
    return {
        id: "grok-4-1-fast-non-reasoning",
        name: "Grok 4.1 Fast Non-Reasoning",
        family: "grok-4.1-fast",
        version: "grok-4-1-fast-non-reasoning",
        maxInputTokens: 2000000,
        maxOutputTokens: 30000,
        capabilities: { toolCalling: false, imageInput: false },
    };
}

function textChunk(content?: string): ChatCompletionChunk {
    return {
        id: "chunk",
        created: 0,
        model: "grok-4-1-fast-non-reasoning",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
    } as ChatCompletionChunk;
}

function cancellationToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
    } as vscode.CancellationToken;
}
