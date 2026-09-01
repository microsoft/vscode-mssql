/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as Constants from "../../../../src/constants/constants";
import {
    getSecretStorageKey,
    SdkApiKeyResolver,
} from "../../../../src/copilot/sdkLanguageModels/apiKeyResolution";
import { stubTelemetry } from "../../utils";
import { createSdkExtensionContext, stubWorkspaceConfiguration } from "./sdkProviderTestUtils";

suite("SdkApiKeyResolver", () => {
    let sandbox: sinon.SinonSandbox;
    let originalAnthropicKey: string | undefined;
    let originalOpenAiKey: string | undefined;
    let originalXAiKey: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubWorkspaceConfiguration(sandbox);
        originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
        originalOpenAiKey = process.env.OPENAI_API_KEY;
        originalXAiKey = process.env.XAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.XAI_API_KEY;
    });

    teardown(() => {
        restoreEnv("ANTHROPIC_API_KEY", originalAnthropicKey);
        restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
        restoreEnv("XAI_API_KEY", originalXAiKey);
        sandbox.restore();
    });

    test("SecretStorage value wins over process env var", async () => {
        const context = createSdkExtensionContext();
        const resolver = new SdkApiKeyResolver(context);
        process.env.ANTHROPIC_API_KEY = "env-key";
        await context.secrets.store(getSecretStorageKey("anthropic"), "secret-key");

        expect(await resolver.resolveAnthropic()).to.equal("secret-key");
    });

    test("configured env setting wins over process env var when SecretStorage is empty", async () => {
        sandbox.restore();
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubWorkspaceConfiguration(sandbox, {
            [Constants.configCopilotSdkProvidersAnthropicEnv]: {
                ANTHROPIC_API_KEY: "configured-key",
            },
        });
        const resolver = new SdkApiKeyResolver(createSdkExtensionContext());
        process.env.ANTHROPIC_API_KEY = "env-key";

        expect(await resolver.resolveAnthropic()).to.equal("configured-key");
    });

    test("process env var wins when SecretStorage is empty", async () => {
        const resolver = new SdkApiKeyResolver(createSdkExtensionContext());
        process.env.XAI_API_KEY = "env-xai-key";

        expect(await resolver.resolveXAI()).to.equal("env-xai-key");
    });

    test("empty everywhere returns undefined", async () => {
        const resolver = new SdkApiKeyResolver(createSdkExtensionContext());

        expect(await resolver.resolveAnthropic()).to.equal(undefined);
        expect(await resolver.resolveOpenAI()).to.equal(undefined);
        expect(await resolver.resolveXAI()).to.equal(undefined);
    });

    test("setting the key updates SecretStorage and fires change listeners", async () => {
        const context = createSdkExtensionContext();
        const resolver = new SdkApiKeyResolver(context);
        const changed: string[] = [];
        resolver.onDidChange((kind) => changed.push(kind));

        await resolver.setAnthropicApiKey("sk-ant-test");

        expect(await context.secrets.get(getSecretStorageKey("anthropic"))).to.equal("sk-ant-test");
        expect(changed).to.include("anthropic");
    });

    test("clearing the key removes SecretStorage entry", async () => {
        const context = createSdkExtensionContext();
        const resolver = new SdkApiKeyResolver(context);
        await resolver.setXAIApiKey("xai-test");

        await resolver.clearXAIApiKey();

        expect(await context.secrets.get(getSecretStorageKey("xai"))).to.equal(undefined);
    });
});

function restoreEnv(
    name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "XAI_API_KEY",
    value: string | undefined,
): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
