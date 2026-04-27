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
import { TelemetryActions } from "../../../../src/sharedInterfaces/telemetry";
import {
    OpenAiSdkClient,
    OpenAiSdkLanguageModelProvider,
} from "../../../../src/copilot/sdkLanguageModels/openaiSdkLanguageModelProvider";
import { getSecretStorageKey, SdkApiKeyResolver } from "../../../../src/copilot/sdkLanguageModels";
import { defaultOpenAiSdkModels } from "../../../../src/copilot/sdkLanguageModels/sdkModelCatalog";
import { stubTelemetry } from "../../utils";
import {
    createSdkExtensionContext,
    stubWorkspaceConfiguration,
    textOf,
} from "./sdkProviderTestUtils";

suite("OpenAiSdkLanguageModelProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let configuration: Record<string, unknown>;
    let originalOpenAiKey: string | undefined;
    let telemetry: ReturnType<typeof stubTelemetry>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        configuration = {};
        stubWorkspaceConfiguration(sandbox, configuration);
        originalOpenAiKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
    });

    teardown(() => {
        if (originalOpenAiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalOpenAiKey;
        }
        sandbox.restore();
    });

    test("prepareLanguageModelChat returns models when API key is configured", async () => {
        const context = createContextWithKey();
        const models = await createProvider(context).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models.map((model) => model.id)).to.deep.equal(
            defaultOpenAiSdkModels.map((model) => model.id),
        );
    });

    test("prepareLanguageModelChat returns [] when API key is missing", async () => {
        const models = await createProvider(createSdkExtensionContext()).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models).to.deep.equal([]);
    });

    test("user-defined additional models appear in the catalog", async () => {
        configuration[Constants.configCopilotSdkProvidersOpenAiAdditionalModels] = [
            {
                id: "gpt-private",
                displayName: "GPT Private",
                family: "gpt-5",
                maxInputTokens: 321,
                maxOutputTokens: 54,
            },
        ];

        const models = await createProvider(createContextWithKey()).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models.at(-1)).to.include({
            id: "gpt-private",
            name: "GPT Private",
            maxInputTokens: 321,
            maxOutputTokens: 54,
        });
    });

    test("streaming content deltas drive progress and final usage is accepted", async () => {
        const stream = new FakeOpenAiStream([
            textChunk("SELECT"),
            textChunk(""),
            {} as ChatCompletionChunk,
            textChunk(" 1"),
            usageChunk(9, 2),
        ]);
        const create = sandbox.stub().resolves(stream);
        const progressParts: vscode.LanguageModelTextPart[] = [];

        await createProviderWithClient(create).provideLanguageModelChatResponse(
            defaultModel(),
            [
                vscode.LanguageModelChatMessage.User("system rules"),
                vscode.LanguageModelChatMessage.User("complete this"),
            ],
            {},
            { report: (part) => progressParts.push(part) },
            cancellationToken(),
        );

        expect(textOf(progressParts)).to.equal("SELECT 1");
        const params = create.firstCall.args[0] as ChatCompletionCreateParamsStreaming;
        expect(params.stream_options).to.deep.equal({ include_usage: true });
        expect(params.max_completion_tokens).to.equal(128000);
        expect(params).not.to.have.property("max_tokens");
        expect(params.messages).to.deep.equal([
            { role: "system", content: "system rules" },
            { role: "user", content: "complete this" },
        ]);
        expect(getInvocationMeasurements(telemetry.sendActionEvent)).to.deep.include({
            inputTokens: 9,
            outputTokens: 2,
        });
    });

    test("cancellation aborts the stream and resolves cleanly", async () => {
        const cts = new vscode.CancellationTokenSource();
        const stream = new FakeOpenAiStream([textChunk("ignored")], () => cts.cancel());

        await createProviderWithClient(
            sandbox.stub().resolves(stream),
        ).provideLanguageModelChatResponse(
            defaultModel(),
            [vscode.LanguageModelChatMessage.User("rules")],
            {},
            { report: sandbox.stub() },
            cts.token,
        );

        expect(stream.controller.signal.aborted).to.equal(true);
        cts.dispose();
    });

    test("request token limit uses the OpenAI max_completion_tokens parameter", async () => {
        const create = sandbox.stub().resolves(new FakeOpenAiStream([]));

        await createProviderWithClient(create).provideLanguageModelChatResponse(
            defaultModel(),
            [vscode.LanguageModelChatMessage.User("rules")],
            { modelOptions: { maxTokens: 240, max_tokens: 999 } },
            { report: sandbox.stub() },
            cancellationToken(),
        );

        const params = create.firstCall.args[0] as ChatCompletionCreateParamsStreaming;
        expect(params.max_completion_tokens).to.equal(240);
        expect(params).not.to.have.property("max_tokens");
    });

    test("AuthenticationError maps to NoPermissions and RateLimitError maps to Blocked", async () => {
        const authError = new OpenAI.AuthenticationError(401, {}, "auth failed", new Headers());
        const rateLimitError = new OpenAI.RateLimitError(429, {}, "rate limit", new Headers());

        expect(await captureError(authError)).to.include({ code: "NoPermissions" });
        expect(await captureError(rateLimitError)).to.include({ code: "Blocked" });
    });

    test("provideTokenCount uses approximation", async () => {
        expect(
            await createProvider(createContextWithKey()).provideTokenCount(
                defaultModel(),
                "123456789",
                cancellationToken(),
            ),
        ).to.equal(3);
    });

    test("baseUrl and timeout settings flow to the SDK constructor", async () => {
        configuration[Constants.configCopilotSdkProvidersOpenAiBaseUrl] =
            "https://gateway.example/openai";
        configuration[Constants.configCopilotSdkProvidersOpenAiTimeout] = 4321;
        const factory = sandbox
            .stub()
            .returns(createClient(sandbox.stub().resolves(new FakeOpenAiStream([]))));
        const context = createContextWithKey();
        const provider = new OpenAiSdkLanguageModelProvider(context, {
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
            apiKey: "sk-test",
            baseURL: "https://gateway.example/openai",
            timeout: 4321,
            maxRetries: 1,
        });
    });

    async function captureError(error: unknown): Promise<vscode.LanguageModelError> {
        let thrown: unknown;
        try {
            await createProviderWithClient(
                sandbox.stub().resolves(new ThrowingOpenAiStream(error)),
            ).provideLanguageModelChatResponse(
                defaultModel(),
                [vscode.LanguageModelChatMessage.User("rules")],
                {},
                { report: sandbox.stub() },
                cancellationToken(),
            );
        } catch (err) {
            thrown = err;
        }
        return thrown as vscode.LanguageModelError;
    }

    function createProvider(context: vscode.ExtensionContext): OpenAiSdkLanguageModelProvider {
        return new OpenAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            suppressMissingKeyNotification: true,
        });
    }

    function createProviderWithClient(create: sinon.SinonStub): OpenAiSdkLanguageModelProvider {
        const context = createContextWithKey();
        return new OpenAiSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            clientFactory: () => createClient(create),
            suppressMissingKeyNotification: true,
        });
    }
});

class FakeOpenAiStream implements AsyncIterable<ChatCompletionChunk> {
    public readonly controller = new AbortController();

    constructor(
        private readonly _chunks: ChatCompletionChunk[],
        private readonly _beforeYield?: () => void,
    ) {}

    public async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
        for (const chunk of this._chunks) {
            await Promise.resolve();
            this._beforeYield?.();
            if (this.controller.signal.aborted) {
                throw new OpenAI.APIUserAbortError();
            }
            yield chunk;
        }
    }
}

class ThrowingOpenAiStream extends FakeOpenAiStream {
    constructor(private readonly _error: unknown) {
        super([]);
    }

    public override async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
        throw this._error;
    }
}

function createClient(create: sinon.SinonStub): OpenAiSdkClient {
    return {
        chat: {
            completions: {
                create,
            },
        },
    } as unknown as OpenAiSdkClient;
}

function createContextWithKey(): vscode.ExtensionContext {
    const context = createSdkExtensionContext();
    void context.secrets.store(getSecretStorageKey("openai"), "sk-test");
    return context;
}

function defaultModel() {
    return {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        family: "gpt-5.4-mini",
        version: "gpt-5.4-mini",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
        capabilities: { toolCalling: false, imageInput: false },
    };
}

function textChunk(content?: string): ChatCompletionChunk {
    return {
        id: "chunk",
        created: 0,
        model: "gpt-5.4-mini",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
    } as ChatCompletionChunk;
}

function usageChunk(promptTokens: number, completionTokens: number): ChatCompletionChunk {
    return {
        id: "chunk",
        created: 0,
        model: "gpt-5.4-mini",
        object: "chat.completion.chunk",
        choices: [],
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
        },
    } as ChatCompletionChunk;
}

function cancellationToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} }),
    } as vscode.CancellationToken;
}

function getInvocationMeasurements(sendActionEvent: sinon.SinonStub): Record<string, number> {
    const call = sendActionEvent
        .getCalls()
        .find((candidate) => candidate.args[1] === TelemetryActions.SdkProviderInvocation);
    return call?.args[3] as Record<string, number>;
}
