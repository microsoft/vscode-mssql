/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import Anthropic from "@anthropic-ai/sdk";
import type {
    Message,
    MessageCountTokensParams,
    MessageCreateParamsBase,
    MessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";
import * as Constants from "../../../../src/constants/constants";
import { TelemetryActions } from "../../../../src/sharedInterfaces/telemetry";
import {
    AnthropicSdkClient,
    AnthropicSdkLanguageModelProvider,
} from "../../../../src/copilot/sdkLanguageModels/anthropicSdkLanguageModelProvider";
import { getSecretStorageKey, SdkApiKeyResolver } from "../../../../src/copilot/sdkLanguageModels";
import { defaultAnthropicSdkModels } from "../../../../src/copilot/sdkLanguageModels/sdkModelCatalog";
import { stubTelemetry } from "../../utils";
import {
    createSdkExtensionContext,
    stubWorkspaceConfiguration,
    textOf,
} from "./sdkProviderTestUtils";

suite("AnthropicSdkLanguageModelProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let configuration: Record<string, unknown>;
    let originalAnthropicKey: string | undefined;
    let telemetry: ReturnType<typeof stubTelemetry>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        configuration = {};
        stubWorkspaceConfiguration(sandbox, configuration);
        originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
    });

    teardown(() => {
        if (originalAnthropicKey === undefined) {
            delete process.env.ANTHROPIC_API_KEY;
        } else {
            process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
        }
        sandbox.restore();
    });

    test("prepareLanguageModelChat returns models when API key is configured", async () => {
        const context = createSdkExtensionContext();
        await context.secrets.store(getSecretStorageKey("anthropic"), "sk-ant-test");
        const provider = createProvider(context);

        const models = await provider.prepareLanguageModelChat({}, cancellationToken());

        expect(models.map((model) => model.id)).to.deep.equal(
            defaultAnthropicSdkModels.map((model) => model.id),
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
        configuration[Constants.configCopilotSdkProvidersAnthropicAdditionalModels] = [
            {
                id: "claude-private",
                displayName: "Claude Private",
                family: "claude-sonnet",
                maxInputTokens: 123,
                maxOutputTokens: 45,
            },
        ];
        const context = createSdkExtensionContext();
        await context.secrets.store(getSecretStorageKey("anthropic"), "sk-ant-test");

        const models = await createProvider(context).prepareLanguageModelChat(
            {},
            cancellationToken(),
        );

        expect(models.at(-1)).to.include({
            id: "claude-private",
            name: "Claude Private",
            maxInputTokens: 123,
            maxOutputTokens: 45,
        });
    });

    test("streaming text_delta events drive progress in order", async () => {
        const stream = new FakeAnthropicStream([textDelta("SELECT"), textDelta(" 1")]);
        const streamStub = sandbox.stub().returns(stream);
        const progressParts: vscode.LanguageModelTextPart[] = [];

        await createProviderWithClient(streamStub).provideLanguageModelChatResponse(
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
        const params = streamStub.firstCall.args[0] as MessageCreateParamsBase;
        expect(params.system).to.equal("system rules");
        expect(params.messages).to.deep.equal([{ role: "user", content: "complete this" }]);
        expect(getInvocationMeasurements(telemetry.sendActionEvent)).to.deep.include({
            inputTokens: 10,
            outputTokens: 2,
        });
    });

    test("cancellation aborts the stream and resolves cleanly", async () => {
        const cts = new vscode.CancellationTokenSource();
        const stream = new FakeAnthropicStream([textDelta("ignored")], () => cts.cancel());

        await createProviderWithClient(
            sandbox.stub().returns(stream),
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

    test("AuthenticationError maps to NoPermissions and RateLimitError maps to Blocked", async () => {
        const authError = new Anthropic.AuthenticationError(401, {}, "auth failed", new Headers());
        const rateLimitError = new Anthropic.RateLimitError(429, {}, "rate limit", new Headers());

        expect(await captureError(authError)).to.include({ code: "NoPermissions" });
        expect(await captureError(rateLimitError)).to.include({ code: "Blocked" });
    });

    test("provideTokenCount uses countTokens success and approximation fallback paths", async () => {
        const countTokens = sandbox.stub().resolves({ input_tokens: 12 });
        const provider = createProviderWithClient(
            sandbox.stub().returns(new FakeAnthropicStream()),
            {
                countTokens,
            },
        );

        expect(
            await provider.provideTokenCount(defaultModel(), "hello", cancellationToken()),
        ).to.equal(12);
        expect((countTokens.firstCall.args[0] as MessageCountTokensParams).messages).to.deep.equal([
            { role: "user", content: "hello" },
        ]);

        countTokens.rejects(new Error("count failed"));
        expect(
            await provider.provideTokenCount(defaultModel(), "123456789", cancellationToken()),
        ).to.equal(3);
    });

    test("baseUrl and timeout settings flow to the SDK constructor", async () => {
        configuration[Constants.configCopilotSdkProvidersAnthropicBaseUrl] =
            "https://gateway.example/anthropic";
        configuration[Constants.configCopilotSdkProvidersAnthropicTimeout] = 1234;
        const factory = sandbox
            .stub()
            .returns(createClient(sandbox.stub().returns(new FakeAnthropicStream())));
        const context = createContextWithKey();
        const provider = new AnthropicSdkLanguageModelProvider(context, {
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
            apiKey: "sk-ant-test",
            baseURL: "https://gateway.example/anthropic",
            timeout: 1234,
            maxRetries: 1,
        });
    });

    test("setting a new key invalidates the cached client", async () => {
        const context = createContextWithKey();
        const apiKeys = new SdkApiKeyResolver(context);
        const factory = sandbox
            .stub()
            .returns(createClient(sandbox.stub().returns(new FakeAnthropicStream())));
        const provider = new AnthropicSdkLanguageModelProvider(context, {
            apiKeys,
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
        await apiKeys.setAnthropicApiKey("sk-ant-new");
        await provider.provideLanguageModelChatResponse(
            defaultModel(),
            [vscode.LanguageModelChatMessage.User("rules")],
            {},
            { report: sandbox.stub() },
            cancellationToken(),
        );

        expect(factory.callCount).to.equal(2);
    });

    async function captureError(error: unknown): Promise<vscode.LanguageModelError> {
        let thrown: unknown;
        try {
            await createProviderWithClient(
                sandbox.stub().returns(new ThrowingAnthropicStream(error)),
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

    function createProvider(context: vscode.ExtensionContext): AnthropicSdkLanguageModelProvider {
        return new AnthropicSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            suppressMissingKeyNotification: true,
        });
    }

    function createProviderWithClient(
        stream: sinon.SinonStub,
        options?: { countTokens?: sinon.SinonStub },
    ): AnthropicSdkLanguageModelProvider {
        const context = createContextWithKey();
        return new AnthropicSdkLanguageModelProvider(context, {
            apiKeys: new SdkApiKeyResolver(context),
            clientFactory: () => createClient(stream, options?.countTokens),
            suppressMissingKeyNotification: true,
        });
    }
});

class FakeAnthropicStream implements AsyncIterable<MessageStreamEvent> {
    public readonly controller = new AbortController();

    constructor(
        private readonly _events: MessageStreamEvent[] = [],
        private readonly _beforeYield?: () => void,
    ) {}

    public async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
        for (const event of this._events) {
            await Promise.resolve();
            this._beforeYield?.();
            if (this.controller.signal.aborted) {
                throw new Anthropic.APIUserAbortError();
            }
            yield event;
        }
    }

    public async finalMessage(): Promise<Message> {
        return {
            usage: { input_tokens: 10, output_tokens: 2 },
        } as Message;
    }
}

class ThrowingAnthropicStream extends FakeAnthropicStream {
    constructor(private readonly _error: unknown) {
        super();
    }

    public override async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
        throw this._error;
    }
}

function createClient(
    stream: sinon.SinonStub,
    countTokens: sinon.SinonStub = sinon.stub().resolves({ input_tokens: 1 }),
): AnthropicSdkClient {
    return {
        messages: {
            stream,
            countTokens,
        },
    } as unknown as AnthropicSdkClient;
}

function createContextWithKey(): vscode.ExtensionContext {
    const context = createSdkExtensionContext();
    void context.secrets.store(getSecretStorageKey("anthropic"), "sk-ant-test");
    return context;
}

function defaultModel() {
    return {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        family: "claude-sonnet",
        version: "claude-sonnet-4-6",
        maxInputTokens: 1000000,
        maxOutputTokens: 64000,
        capabilities: { toolCalling: false, imageInput: false },
    };
}

function textDelta(text: string): MessageStreamEvent {
    return {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
    } as MessageStreamEvent;
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
