/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import * as LocalizedConstants from "../../constants/locConstants";
import { logger as rootLogger } from "../../models/logger";
import { isInlineCompletionFeatureEnabled } from "../inlineCompletionFeatureGate";
import { AnthropicSdkLanguageModelProvider } from "./anthropicSdkLanguageModelProvider";
import {
    SdkApiKeyProviderInfo,
    SdkApiKeyResolver,
    sdkApiKeyProviders,
    SdkProviderKind,
} from "./apiKeyResolution";
import { OpenAiSdkLanguageModelProvider } from "./openaiSdkLanguageModelProvider";
import { XAiSdkLanguageModelProvider } from "./xaiSdkLanguageModelProvider";

type RegisterLanguageModelChatProvider = (vendor: string, provider: unknown) => vscode.Disposable;

const logger = rootLogger.withPrefix("SdkLanguageModelProviders");

export function registerSdkLanguageModelProviders(context: vscode.ExtensionContext): void {
    const apiKeys = new SdkApiKeyResolver(context);

    context.subscriptions.push(
        vscode.commands.registerCommand(Constants.cmdSetAnthropicSdkLanguageModelApiKey, () =>
            promptAndStoreApiKey(apiKeys, "anthropic"),
        ),
        vscode.commands.registerCommand(Constants.cmdClearAnthropicSdkLanguageModelApiKey, () =>
            clearApiKey(apiKeys, "anthropic"),
        ),
        vscode.commands.registerCommand(Constants.cmdSetOpenAiSdkLanguageModelApiKey, () =>
            promptAndStoreApiKey(apiKeys, "openai"),
        ),
        vscode.commands.registerCommand(Constants.cmdClearOpenAiSdkLanguageModelApiKey, () =>
            clearApiKey(apiKeys, "openai"),
        ),
        vscode.commands.registerCommand(Constants.cmdSetXAiSdkLanguageModelApiKey, () =>
            promptAndStoreApiKey(apiKeys, "xai"),
        ),
        vscode.commands.registerCommand(Constants.cmdClearXAiSdkLanguageModelApiKey, () =>
            clearApiKey(apiKeys, "xai"),
        ),
    );

    const registerLanguageModelChatProvider = (
        vscode.lm as unknown as {
            registerLanguageModelChatProvider?: RegisterLanguageModelChatProvider;
        }
    ).registerLanguageModelChatProvider;

    if (typeof registerLanguageModelChatProvider !== "function") {
        logger.warn("VS Code does not expose registerLanguageModelChatProvider in this build.");
        return;
    }

    const enabledProviderKinds = getEnabledProviderKinds();

    if (enabledProviderKinds.has("anthropic")) {
        const provider = new AnthropicSdkLanguageModelProvider(context, { apiKeys });
        context.subscriptions.push(registerLanguageModelChatProvider("anthropic-api", provider));
    }

    if (enabledProviderKinds.has("openai")) {
        const provider = new OpenAiSdkLanguageModelProvider(context, { apiKeys });
        context.subscriptions.push(registerLanguageModelChatProvider("openai-api", provider));
    }

    if (enabledProviderKinds.has("xai")) {
        const provider = new XAiSdkLanguageModelProvider(context, { apiKeys });
        context.subscriptions.push(registerLanguageModelChatProvider("xai-api", provider));
    }

    if (enabledProviderKinds.size > 0) {
        void showNoExternalProviderAvailableMessage(context, apiKeys);
    }
}

async function promptAndStoreApiKey(
    apiKeys: SdkApiKeyResolver,
    kind: SdkProviderKind,
): Promise<void> {
    const info = sdkApiKeyProviders[kind];
    const value = await vscode.window.showInputBox({
        title: LocalizedConstants.copilotSdkSetApiKeyTitle(info.label),
        prompt: LocalizedConstants.copilotSdkApiKeyPrompt(info.label),
        password: true,
        ignoreFocusOut: true,
        validateInput: (input) => validateApiKeyInput(info, input),
    });

    if (value === undefined) {
        return;
    }

    await apiKeys.setApiKey(kind, value);
    void vscode.window.showInformationMessage(LocalizedConstants.copilotSdkApiKeySaved(info.label));
}

async function clearApiKey(apiKeys: SdkApiKeyResolver, kind: SdkProviderKind): Promise<void> {
    const info = sdkApiKeyProviders[kind];
    await apiKeys.clearApiKey(kind);
    void vscode.window.showInformationMessage(
        LocalizedConstants.copilotSdkApiKeyCleared(info.label),
    );
}

function validateApiKeyInput(info: SdkApiKeyProviderInfo, input: string): string | undefined {
    const trimmed = input.trim();
    if (!trimmed) {
        return LocalizedConstants.copilotSdkApiKeyRequired(info.label);
    }
    if (
        info.keyPrefixes.length > 0 &&
        !info.keyPrefixes.some((prefix) => trimmed.startsWith(prefix))
    ) {
        return LocalizedConstants.copilotSdkApiKeyPrefix(info.label, info.keyPrefixes.join(" or "));
    }
    return undefined;
}

async function showNoExternalProviderAvailableMessage(
    context: vscode.ExtensionContext,
    apiKeys: SdkApiKeyResolver,
): Promise<void> {
    const dontShowKey = "mssql.copilot.sdkProviders.noAvailableProviders.dontShow";
    if (
        context.globalState.get<boolean>(dontShowKey, false) ||
        !isInlineCompletionFeatureEnabled()
    ) {
        return;
    }

    const [anthropicKey, openAiKey, xAiKey] = await Promise.all([
        apiKeys.resolveAnthropic(),
        apiKeys.resolveOpenAI(),
        apiKeys.resolveXAI(),
    ]);
    let copilotModels: vscode.LanguageModelChat[] = [];
    try {
        copilotModels = await vscode.lm.selectChatModels({ vendor: "copilot" });
    } catch {
        copilotModels = [];
    }
    if (anthropicKey || openAiKey || xAiKey || copilotModels.length > 0) {
        return;
    }

    const setAnthropic = LocalizedConstants.copilotSdkSetAnthropicApiKey;
    const setOpenAi = LocalizedConstants.copilotSdkSetOpenAiApiKey;
    const setXAi = LocalizedConstants.copilotSdkSetXAiApiKey;
    const dontShow = LocalizedConstants.copilotSdkDontShowAgain;
    const selection = await vscode.window.showInformationMessage(
        LocalizedConstants.copilotSdkNoProviderAvailable,
        setAnthropic,
        setOpenAi,
        setXAi,
        dontShow,
    );

    if (selection === setAnthropic) {
        await vscode.commands.executeCommand(Constants.cmdSetAnthropicSdkLanguageModelApiKey);
    } else if (selection === setOpenAi) {
        await vscode.commands.executeCommand(Constants.cmdSetOpenAiSdkLanguageModelApiKey);
    } else if (selection === setXAi) {
        await vscode.commands.executeCommand(Constants.cmdSetXAiSdkLanguageModelApiKey);
    } else if (selection === dontShow) {
        await context.globalState.update(dontShowKey, true);
    }
}

function getEnabledProviderKinds(): Set<SdkProviderKind> {
    const enabledProviderKinds = new Set<SdkProviderKind>();
    if (isSettingEnabled(Constants.configCopilotSdkProvidersAnthropicEnabled, false)) {
        enabledProviderKinds.add("anthropic");
    }
    if (isSettingEnabled(Constants.configCopilotSdkProvidersOpenAiEnabled, false)) {
        enabledProviderKinds.add("openai");
    }
    if (isSettingEnabled(Constants.configCopilotSdkProvidersXAiEnabled, false)) {
        enabledProviderKinds.add("xai");
    }
    return enabledProviderKinds;
}

function isSettingEnabled(setting: string, defaultValue: boolean): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(setting, defaultValue) ?? defaultValue;
}

export { AnthropicSdkLanguageModelProvider } from "./anthropicSdkLanguageModelProvider";
export { OpenAiSdkLanguageModelProvider } from "./openaiSdkLanguageModelProvider";
export { XAiSdkLanguageModelProvider } from "./xaiSdkLanguageModelProvider";
export { getSecretStorageKey, SdkApiKeyResolver } from "./apiKeyResolution";
