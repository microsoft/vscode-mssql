/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import { sendActionEvent } from "../../telemetry/telemetry";

export type SdkProviderKind = "anthropic" | "openai" | "xai";
export type SdkProviderVendor = "anthropic-api" | "openai-api" | "xai-api";

export interface SdkApiKeyProviderInfo {
    kind: SdkProviderKind;
    vendor: SdkProviderVendor;
    label: "Anthropic" | "OpenAI" | "xAI";
    envVarName: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "XAI_API_KEY";
    envSetting: string;
    setCommand: string;
    clearCommand: string;
    keyPrefixes: readonly string[];
}

export const sdkApiKeyProviders: Record<SdkProviderKind, SdkApiKeyProviderInfo> = {
    anthropic: {
        kind: "anthropic",
        vendor: "anthropic-api",
        label: "Anthropic",
        envVarName: "ANTHROPIC_API_KEY",
        envSetting: Constants.configCopilotSdkProvidersAnthropicEnv,
        setCommand: Constants.cmdSetAnthropicSdkLanguageModelApiKey,
        clearCommand: Constants.cmdClearAnthropicSdkLanguageModelApiKey,
        keyPrefixes: ["sk-ant-"],
    },
    openai: {
        kind: "openai",
        vendor: "openai-api",
        label: "OpenAI",
        envVarName: "OPENAI_API_KEY",
        envSetting: Constants.configCopilotSdkProvidersOpenAiEnv,
        setCommand: Constants.cmdSetOpenAiSdkLanguageModelApiKey,
        clearCommand: Constants.cmdClearOpenAiSdkLanguageModelApiKey,
        keyPrefixes: ["sk-"],
    },
    xai: {
        kind: "xai",
        vendor: "xai-api",
        label: "xAI",
        envVarName: "XAI_API_KEY",
        envSetting: Constants.configCopilotSdkProvidersXAiEnv,
        setCommand: Constants.cmdSetXAiSdkLanguageModelApiKey,
        clearCommand: Constants.cmdClearXAiSdkLanguageModelApiKey,
        keyPrefixes: [],
    },
};

export class SdkApiKeyResolver {
    private readonly _onDidChange = new vscode.EventEmitter<SdkProviderKind>();
    public readonly onDidChange = this._onDidChange.event;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._context.subscriptions.push(this._onDidChange);
        const secretChange = this._context.secrets?.onDidChange;
        if (secretChange) {
            this._context.subscriptions.push(
                secretChange((event) => {
                    const kind = kindFromSecretKey(event.key);
                    if (kind) {
                        this._onDidChange.fire(kind);
                    }
                }),
            );
        }
    }

    public resolveAnthropic(): Promise<string | undefined> {
        return this.resolveProvider("anthropic");
    }

    public resolveOpenAI(): Promise<string | undefined> {
        return this.resolveProvider("openai");
    }

    public resolveXAI(): Promise<string | undefined> {
        return this.resolveProvider("xai");
    }

    public async resolveProvider(kind: SdkProviderKind): Promise<string | undefined> {
        const info = sdkApiKeyProviders[kind];
        const secret = await this._context.secrets?.get(getSecretStorageKey(kind));
        if (isNonEmpty(secret)) {
            return secret.trim();
        }

        const configured = this.getConfiguredEnvValue(info);
        if (configured) {
            return configured;
        }

        const env = process.env[info.envVarName];
        return isNonEmpty(env) ? env.trim() : undefined;
    }

    public setAnthropicApiKey(apiKey: string): Promise<void> {
        return this.setApiKey("anthropic", apiKey);
    }

    public setOpenAIApiKey(apiKey: string): Promise<void> {
        return this.setApiKey("openai", apiKey);
    }

    public setXAIApiKey(apiKey: string): Promise<void> {
        return this.setApiKey("xai", apiKey);
    }

    public clearAnthropicApiKey(): Promise<void> {
        return this.clearApiKey("anthropic");
    }

    public clearOpenAIApiKey(): Promise<void> {
        return this.clearApiKey("openai");
    }

    public clearXAIApiKey(): Promise<void> {
        return this.clearApiKey("xai");
    }

    public async setApiKey(kind: SdkProviderKind, apiKey: string): Promise<void> {
        const trimmed = apiKey.trim();
        const previous = await this._context.secrets?.get(getSecretStorageKey(kind));
        await this._context.secrets.store(getSecretStorageKey(kind), trimmed);
        this._onDidChange.fire(kind);

        if (!isNonEmpty(previous)) {
            sendActionEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.SdkProviderApiKeyConfigured,
                {
                    vendor: sdkApiKeyProviders[kind].vendor,
                },
            );
        }
    }

    public async clearApiKey(kind: SdkProviderKind): Promise<void> {
        await this._context.secrets.delete(getSecretStorageKey(kind));
        this._onDidChange.fire(kind);
    }

    private getConfiguredEnvValue(info: SdkApiKeyProviderInfo): string | undefined {
        const configured =
            vscode.workspace.getConfiguration().get<Record<string, unknown>>(info.envSetting, {}) ??
            {};
        const raw = configured[info.envVarName];
        if (!isNonEmpty(raw)) {
            return undefined;
        }

        const configuredValue = raw.trim();
        const envVarName = configuredValue.startsWith("$")
            ? configuredValue.slice(1)
            : configuredValue;
        const resolvedFromNamedEnv = process.env[envVarName];
        return isNonEmpty(resolvedFromNamedEnv) ? resolvedFromNamedEnv.trim() : configuredValue;
    }
}

export function getSecretStorageKey(kind: SdkProviderKind): string {
    return `mssql.copilot.sdkProviders.${kind}.apiKey`;
}

function kindFromSecretKey(key: string): SdkProviderKind | undefined {
    if (key === getSecretStorageKey("anthropic")) {
        return "anthropic";
    }
    if (key === getSecretStorageKey("openai")) {
        return "openai";
    }
    if (key === getSecretStorageKey("xai")) {
        return "xai";
    }
    return undefined;
}

function isNonEmpty(value: unknown): value is string {
    return typeof value === "string" && !!value.trim();
}
