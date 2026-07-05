/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import { logger2 } from "../../models/logger2";
import { getLatencyBucket } from "../../sharedInterfaces/latencyBuckets";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import { sendActionEvent } from "../../telemetry/telemetry";
import { getErrorMessage } from "../../utils/utils";
import {
    LanguageModelChatInformation,
    toLanguageModelChatInformation,
} from "../languageModels/shared/providerModelCatalog";
import {
    SdkApiKeyResolver,
    SdkProviderKind,
    SdkProviderVendor,
    sdkApiKeyProviders,
} from "./apiKeyResolution";
import { getSdkModelCatalog } from "./sdkModelCatalog";

export interface LanguageModelChatResponseProgress {
    report(part: vscode.LanguageModelTextPart): void;
}

export interface SdkProviderUsage {
    inputTokens?: number;
    outputTokens?: number;
}

export interface SdkClientOptions {
    apiKey: string;
    baseURL?: string;
    timeout: number;
    maxRetries: number;
}

export interface SdkLanguageModelProviderOptions {
    apiKeys?: SdkApiKeyResolver;
    suppressMissingKeyNotification?: boolean;
}

interface PrepareCache {
    expiresAt: number;
    key: string;
    models: LanguageModelChatInformation[];
}

const prepareCacheTtlMs = 30_000;
const defaultTimeoutMs = 60_000;

export abstract class SdkLanguageModelProviderBase {
    private readonly _logger = logger2.withPrefix("SdkLanguageModelProvider");
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _suppressMissingKeyNotification: boolean;
    private _prepareCache: PrepareCache | undefined;
    private _missingKeyShownThisSession = false;

    public readonly onDidChange = this._onDidChange.event;
    public readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

    protected readonly apiKeys: SdkApiKeyResolver;

    protected constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly kind: SdkProviderKind,
        options?: SdkLanguageModelProviderOptions,
    ) {
        this.apiKeys = options?.apiKeys ?? new SdkApiKeyResolver(context);
        this._suppressMissingKeyNotification = options?.suppressMissingKeyNotification ?? false;

        this.context.subscriptions.push(
            this._onDidChange,
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("mssql.copilot.sdkProviders")) {
                    this.invalidateCache();
                    this._logger.info(
                        "SDK language model provider settings changed; reload may be required " +
                            "for enable/disable changes to affect provider registration.",
                    );
                }
            }),
            this.apiKeys.onDidChange((changedKind) => {
                if (changedKind === this.kind) {
                    this.invalidateCache();
                }
            }),
        );
    }

    public invalidateCache(): void {
        this._prepareCache = undefined;
        this.invalidateClient();
        this._onDidChange.fire();
    }

    public async prepareLanguageModelChat(
        _options: unknown,
        token: vscode.CancellationToken,
    ): Promise<LanguageModelChatInformation[]> {
        if (token.isCancellationRequested || !this.isEnabled()) {
            return [];
        }

        const apiKey = await this.resolveApiKey();
        if (!apiKey || token.isCancellationRequested) {
            void this.showMissingApiKeyMessage();
            return [];
        }

        const cacheKey = `${this.vendor}|${apiKey.slice(-8)}|${this.getBaseUrl()}|${this.getTimeout()}`;
        if (
            this._prepareCache &&
            this._prepareCache.key === cacheKey &&
            this._prepareCache.expiresAt > Date.now()
        ) {
            return [...this._prepareCache.models];
        }

        const models = getSdkModelCatalog(this.kind).map((entry) =>
            toLanguageModelChatInformation(this.vendor, entry),
        );
        this._prepareCache = {
            key: cacheKey,
            expiresAt: Date.now() + prepareCacheTtlMs,
            models,
        };
        return [...models];
    }

    public provideLanguageModelChatInformation(
        options: unknown,
        token: vscode.CancellationToken,
    ): Promise<LanguageModelChatInformation[]> {
        return this.prepareLanguageModelChat(options, token);
    }

    public async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        progress: LanguageModelChatResponseProgress,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const startedAt = Date.now();
        let result: "success" | "error" | "cancelled" = "success";
        let usage: SdkProviderUsage | undefined;

        try {
            const apiKey = await this.resolveApiKey();
            if (!apiKey) {
                this.sendErrorTelemetry("auth");
                throw vscode.LanguageModelError.NoPermissions(
                    `${this.providerLabel} API key is not configured.`,
                );
            }

            usage = await this.streamResponse(
                this.getClientOptions(apiKey),
                model,
                messages,
                this.getMaxTokens(model, options),
                progress,
                token,
            );

            if (token.isCancellationRequested) {
                result = "cancelled";
            }
        } catch (error) {
            if (token.isCancellationRequested || this.isAbortError(error)) {
                result = "cancelled";
                return;
            }

            result = "error";
            const errorClass = this.classifyError(error);
            this.sendErrorTelemetry(errorClass);
            throw error instanceof vscode.LanguageModelError ? error : this.mapError(error);
        } finally {
            this.sendInvocationTelemetry(model, startedAt, result, usage);
        }
    }

    public abstract provideTokenCount(
        model: LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatMessage,
        token: vscode.CancellationToken,
    ): Promise<number>;

    protected abstract streamResponse(
        clientOptions: SdkClientOptions,
        model: LanguageModelChatInformation,
        messages: vscode.LanguageModelChatMessage[],
        maxTokens: number,
        progress: LanguageModelChatResponseProgress,
        token: vscode.CancellationToken,
    ): Promise<SdkProviderUsage | undefined>;

    protected abstract mapError(error: unknown): vscode.LanguageModelError;

    protected abstract classifyError(error: unknown): string;

    protected abstract isAbortError(error: unknown): boolean;

    protected abstract invalidateClient(): void;

    protected get vendor(): SdkProviderVendor {
        return sdkApiKeyProviders[this.kind].vendor;
    }

    protected get providerLabel(): string {
        return sdkApiKeyProviders[this.kind].label;
    }

    protected getModelId(model: LanguageModelChatInformation): string {
        return model.id;
    }

    protected getBaseUrl(): string | undefined {
        const setting = getBaseUrlSetting(this.kind);
        return vscode.workspace.getConfiguration().get<string>(setting, "")?.trim() || undefined;
    }

    protected getTimeout(): number {
        const setting = getTimeoutSetting(this.kind);
        const configured = vscode.workspace
            .getConfiguration()
            .get<number>(setting, defaultTimeoutMs);
        return typeof configured === "number" && Number.isFinite(configured) && configured > 0
            ? configured
            : defaultTimeoutMs;
    }

    private isEnabled(): boolean {
        const setting = getEnabledSetting(this.kind);
        return vscode.workspace.getConfiguration().get<boolean>(setting, true) ?? true;
    }

    private resolveApiKey(): Promise<string | undefined> {
        return this.apiKeys.resolveProvider(this.kind);
    }

    private getClientOptions(apiKey: string): SdkClientOptions {
        return {
            apiKey,
            baseURL: this.getBaseUrl(),
            timeout: this.getTimeout(),
            maxRetries: 1,
        };
    }

    private getMaxTokens(
        model: LanguageModelChatInformation,
        options: vscode.LanguageModelChatRequestOptions,
    ): number {
        const requested =
            getPositiveIntegerOption(options.modelOptions?.maxTokens) ??
            getPositiveIntegerOption(options.modelOptions?.max_tokens);
        return Math.max(1, Math.min(requested ?? model.maxOutputTokens, model.maxOutputTokens));
    }

    private async showMissingApiKeyMessage(): Promise<void> {
        if (this._suppressMissingKeyNotification || this._missingKeyShownThisSession) {
            return;
        }

        const dontShowKey = `mssql.copilot.sdkProviders.${this.kind}.missingKey.dontShow`;
        if (this.context.globalState.get<boolean>(dontShowKey, false)) {
            return;
        }

        this._missingKeyShownThisSession = true;
        const setKey = "Set API Key";
        const openSettings = "Open Settings";
        const dontShow = "Don't show again";
        const selection = await vscode.window.showInformationMessage(
            `Configure your ${this.providerLabel} API key to enable ${this.providerLabel} models in MSSQL inline completion.`,
            setKey,
            openSettings,
            dontShow,
        );

        if (selection === setKey) {
            await vscode.commands.executeCommand(sdkApiKeyProviders[this.kind].setCommand);
        } else if (selection === openSettings) {
            await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "@id:mssql.copilot.sdkProviders",
            );
        } else if (selection === dontShow) {
            await this.context.globalState.update(dontShowKey, true);
        }
    }

    private sendInvocationTelemetry(
        model: LanguageModelChatInformation,
        startedAt: number,
        result: "success" | "error" | "cancelled",
        usage: SdkProviderUsage | undefined,
    ): void {
        sendActionEvent(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.SdkProviderInvocation,
            {
                vendor: this.vendor,
                family: model.family,
                latencyBucket: getLatencyBucket(Date.now() - startedAt),
                result,
            },
            {
                inputTokens: usage?.inputTokens ?? 0,
                outputTokens: usage?.outputTokens ?? 0,
            },
        );
    }

    private sendErrorTelemetry(errorClass: string): void {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.SdkProviderError, {
            vendor: this.vendor,
            errorClass,
        });
    }
}

export function getSdkErrorMessage(error: unknown): string {
    return getErrorMessage(error);
}

function getPositiveIntegerOption(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function getEnabledSetting(kind: SdkProviderKind): string {
    switch (kind) {
        case "anthropic":
            return Constants.configCopilotSdkProvidersAnthropicEnabled;
        case "openai":
            return Constants.configCopilotSdkProvidersOpenAiEnabled;
        case "xai":
            return Constants.configCopilotSdkProvidersXAiEnabled;
    }
}

function getBaseUrlSetting(kind: SdkProviderKind): string {
    switch (kind) {
        case "anthropic":
            return Constants.configCopilotSdkProvidersAnthropicBaseUrl;
        case "openai":
            return Constants.configCopilotSdkProvidersOpenAiBaseUrl;
        case "xai":
            return Constants.configCopilotSdkProvidersXAiBaseUrl;
    }
}

function getTimeoutSetting(kind: SdkProviderKind): string {
    switch (kind) {
        case "anthropic":
            return Constants.configCopilotSdkProvidersAnthropicTimeout;
        case "openai":
            return Constants.configCopilotSdkProvidersOpenAiTimeout;
        case "xai":
            return Constants.configCopilotSdkProvidersXAiTimeout;
    }
}
