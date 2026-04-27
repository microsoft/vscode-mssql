/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { logger2 } from "../models/logger2";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";
import {
    defaultInlineCompletionModelPreference,
    getInlineCompletionDebugPresetProfile,
    getInlineCompletionModelPreferenceForCategory,
    getInlineCompletionPresetProfileId,
    getInlineCompletionProfileSchemaContextOverrides,
    inlineCompletionConfiguredDefaultProfileId,
    InlineCompletionModelPreference,
} from "./inlineCompletionDebug/inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "./inlineCompletionDebug/inlineCompletionDebugStore";
import { isInlineCompletionFeatureEnabled } from "./inlineCompletionFeatureGate";
import { approximateTokenCount } from "./languageModels/shared/tokenApproximation";
import {
    getConfiguredInlineCompletionModelVendors,
    matchLanguageModelChatToSelector,
    selectConfiguredLanguageModels,
} from "./languageModelSelection";
import {
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    SqlInlineCompletionSchemaContext,
    SqlInlineCompletionSchemaContextRuntimeSettings,
    SqlInlineCompletionSchemaContextService,
    SqlInlineCompletionSchemaObject,
} from "./sqlInlineCompletionSchemaContextService";
import {
    InlineCompletionCategory,
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugPromptMessage,
    InlineCompletionResult,
    inlineCompletionCategories,
} from "../sharedInterfaces/inlineCompletionDebug";
import { getLatencyBucket } from "../sharedInterfaces/latencyBuckets";

// MSSQL owns SQL ghost text for this feature. VS Code does not expose a hook to augment
// GitHub Copilot's built-in inline-completion request, so this provider uses Copilot chat
// models directly and assumes github.copilot.enable["sql"] = false to avoid provider races.
// If the user configured mssql.copilot.inlineCompletions.modelFamily — either as a selector
// (`vendor/id`) or as a bare family — we respect it unless an in-memory debug profile is active.
// Profiles carry their own provider/model preference lists so they can trade speed, quality,
// and request volume without adding more workspace settings.

const statementPrefixWindowChars = 2500;
const recentPrefixWindowChars = 1500;
const suffixWindowChars = 500;
const maxCompletionChars = 400;
export const continuationModeMaxTokens = 240;
export const intentModeMaxChars = 2000;
export const intentModeMaxTokens = 800;
export const automaticTriggerDebounceMs = 350;
const inlineCompletionAcceptedCommand = "mssql.copilot.inlineCompletion.accepted";
const statementInitiatingKeywordPattern =
    /^(?:select|with|insert|update|delete|merge|exec|execute|declare)$/i;
const statementInitiatingPostCommentPattern =
    /^\s*(?:select|with|insert|update|delete|merge|exec|execute|declare)\s*$/i;
const instructionalIntentWordPattern =
    /\b(?:write|give|get|show|list|find|return|display|compute|count|sum|report|select|fetch|query|retrieve|calculate|generate|estimate|pull|extract|aggregate|summarize|top|dump|export|match|plot|compare|rank|bucket)\b/i;
const questionStyleIntentPattern = /\b(?:what|which|who|where|when|why|how)\b/i;
const trailingQuestionIntentPattern = /\?\s*$/;
const metaResponseInsteadOfSqlPattern =
    /^(?:i\b|i[' ]|sorry\b|cannot\b|can't\b|unable\b|however\b|sure\b|here(?:'s| is)\b|of course\b|note:?\b|note that\b|important:?\b|yes,?\b|okay,?\b|there(?:'s| is)\b|the (?:document|query|statement|schema)\b|(?:this|that) (?:document|query|statement)\b|schema context\b|returning\b|not enough\b|insufficient\b|already (?:complete|done)\b|complete\b|done\b|no (?:further )?(?:completion|change|changes)\b)/i;
const emptyStringInstructionEchoPattern =
    /\b(?:return|returns|returning|emit|emits|output|outputs)\s+(?:exactly\s+)?(?:an?\s+)?(?:empty|string empty|empty string)\b/i;

interface InlineCompletionTelemetrySnapshot {
    usedSchemaContext: boolean;
    fallbackWithoutMetadata: boolean;
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
    modelFamily: string;
    triggerKind: string;
    latencyMs: number;
    inferredSystemQuery: boolean;
    completionCategory: InlineCompletionCategory;
    intentMode: boolean;
    schemaBudgetProfile: string;
    schemaSizeKind: string;
    schemaDegradationStepCount: number;
}

export class SqlInlineCompletionProvider
    implements vscode.InlineCompletionItemProvider, vscode.Disposable
{
    private readonly _logger = logger2.withPrefix("SqlInlineCompletion");
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _cachedModels = new Map<string, vscode.LanguageModelChat | undefined>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _schemaContextService: SqlInlineCompletionSchemaContextService,
    ) {
        this._disposables.push(
            vscode.lm.onDidChangeChatModels(() => {
                this.clearModelCache();
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsProfile) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily) ||
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsContinuationModelFamily,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelVendors)
                ) {
                    this.clearModelCache();
                }
            }),
            vscode.commands.registerCommand(
                inlineCompletionAcceptedCommand,
                (snapshot?: InlineCompletionTelemetrySnapshot, eventId?: string) => {
                    if (eventId) {
                        inlineCompletionDebugStore.markAccepted(eventId);
                    }
                    this.sendInlineCompletionTelemetry("accepted", snapshot);
                },
            ),
        );
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this.clearModelCache();
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        if (!this.isEnabledForDocument(document) || context.selectedCompletionInfo) {
            return [];
        }

        const triggerKind = context.triggerKind;
        const overrides = inlineCompletionDebugStore.getOverrides();
        const configuredProfileId = getConfiguredInlineCompletionProfileId();
        const profile = getInlineCompletionDebugPresetProfile(
            overrides.profileId ?? configuredProfileId,
        );
        const debounceMsApplied =
            triggerKind === vscode.InlineCompletionTriggerKind.Automatic
                ? (overrides.debounceMs ?? profile?.debounceMs ?? automaticTriggerDebounceMs)
                : 0;

        if (
            triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
            overrides.allowAutomaticTriggers === false
        ) {
            return [];
        }

        if (triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            await delay(debounceMsApplied, token);
            if (token.isCancellationRequested) {
                return [];
            }
        }

        const line = document.lineAt(position.line);
        const linePrefix = line.text.slice(0, position.character);
        const lineSuffix = line.text.slice(position.character);
        const statementPrefix = getStatementAwarePrefixWindow(
            document,
            position,
            statementPrefixWindowChars,
        );
        const recentPrefix = getRecentDocumentPrefixWindow(
            document,
            position,
            recentPrefixWindowChars,
        );
        const suffix = getSuffixWindow(document, position, suffixWindowChars);
        const inferredSystemQuery = inferSystemQuery(statementPrefix, linePrefix);
        const detectedIntentMode = detectIntentMode(statementPrefix, linePrefix);
        const intentMode =
            overrides.forceIntentMode ?? profile?.forceIntentMode ?? detectedIntentMode;
        const completionCategory = getInlineCompletionCategory(intentMode);
        const modelPreference = getInlineCompletionModelPreferenceForCategory(
            profile,
            completionCategory,
        );
        const enabledCategories =
            overrides.enabledCategories ??
            (profile ? [...profile.enabledCategories] : this.getConfiguredEnabledCategories());
        const effectiveMaxTokens =
            overrides.maxTokens ??
            profile?.maxTokens ??
            (intentMode ? intentModeMaxTokens : continuationModeMaxTokens);
        const effectiveMaxChars = getEffectiveMaxCompletionChars(
            intentMode ? intentModeMaxChars : maxCompletionChars,
            overrides.maxTokens ?? profile?.maxTokens,
        );
        const useSchemaContext =
            overrides.useSchemaContext ??
            profile?.useSchemaContext ??
            this.getConfiguredUseSchemaContext();
        const shouldCaptureDebug = inlineCompletionDebugStore.shouldCapture(
            this.getRecordWhenClosedSetting(),
        );
        const schemaContextOverrides = getInlineCompletionProfileSchemaContextOverrides(
            profile,
            overrides.schemaContext,
        );
        let schemaContextSettings = getSqlInlineCompletionSchemaContextRuntimeSettings(
            undefined,
            schemaContextOverrides,
        );

        if (!isInlineCompletionCategoryEnabled(completionCategory, enabledCategories)) {
            return [];
        }

        if (intentMode && shouldSuppressIntentCompletionOnCommentLine(linePrefix, lineSuffix)) {
            return [];
        }

        let selectedModel: vscode.LanguageModelChat | undefined;
        let schemaContext: SqlInlineCompletionSchemaContext | undefined;
        let schemaContextForPrompt: SqlInlineCompletionSchemaContext | undefined;
        let promptMessages: vscode.LanguageModelChatMessage[] = [];
        let debugPromptMessages: InlineCompletionDebugPromptMessage[] = [];
        let schemaContextText: string | undefined;
        let rawText = "";
        let sanitizedText: string | undefined;
        let finalCompletionText: string | undefined;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let modelCallStarted = false;

        const modelStartedAt = Date.now();
        let pendingDebugEventId: string | undefined;
        const createDebugEvent = (
            result: InlineCompletionDebugEventResult,
            error?: unknown,
            timestamp: number = Date.now(),
        ): Omit<InlineCompletionDebugEvent, "id"> => ({
            timestamp,
            documentUri: document.uri.toString(),
            documentFileName: path.basename(document.fileName || document.uri.fsPath),
            line: position.line + 1,
            column: position.character + 1,
            triggerKind: getTriggerKindName(triggerKind),
            explicitFromUser: triggerKind === vscode.InlineCompletionTriggerKind.Invoke,
            completionCategory,
            intentMode,
            inferredSystemQuery,
            modelFamily: selectedModel?.family,
            modelId: selectedModel?.id,
            modelVendor: selectedModel?.vendor,
            result,
            latencyMs: Date.now() - modelStartedAt,
            inputTokens,
            outputTokens,
            schemaObjectCount:
                (schemaContext?.tables.length ?? 0) + (schemaContext?.views.length ?? 0),
            schemaSystemObjectCount:
                (schemaContext?.systemObjects?.length ?? 0) +
                (schemaContext?.masterSymbols.length ?? 0),
            schemaForeignKeyCount: getForeignKeyCount(schemaContext),
            usedSchemaContext: !!schemaContext,
            overridesApplied: {
                ...(overrides.profileId ? { profileId: overrides.profileId } : {}),
                ...(overrides.modelSelector ? { modelSelector: overrides.modelSelector } : {}),
                ...(overrides.continuationModelSelector
                    ? { continuationModelSelector: overrides.continuationModelSelector }
                    : {}),
                ...(overrides.useSchemaContext !== null
                    ? { useSchemaContext: overrides.useSchemaContext }
                    : {}),
                ...(overrides.debounceMs !== null ? { debounceMs: overrides.debounceMs } : {}),
                ...(overrides.maxTokens !== null ? { maxTokens: overrides.maxTokens } : {}),
                ...(overrides.enabledCategories !== null
                    ? { enabledCategories: overrides.enabledCategories }
                    : {}),
                ...(overrides.schemaContext ? { schemaContext: overrides.schemaContext } : {}),
                customSystemPromptUsed: !!overrides.customSystemPrompt,
            },
            promptMessages: debugPromptMessages,
            rawResponse: rawText,
            sanitizedResponse: sanitizedText,
            finalCompletionText,
            schemaContextFormatted: schemaContextText,
            locals: {
                "context.selectedCompletionInfo": context.selectedCompletionInfo
                    ? "defined"
                    : "undefined",
                "context.triggerKind": context.triggerKind,
                profileId: overrides.profileId ?? configuredProfileId,
                "document.languageId": document.languageId,
                "position.line": position.line,
                "position.character": position.character,
                linePrefix,
                "recentPrefix.length": recentPrefix.length,
                recentPrefix,
                "statementPrefix.length": statementPrefix.length,
                statementPrefix,
                lineSuffix,
                "suffix.length": suffix.length,
                suffix,
                intentMode,
                detectedIntentMode,
                inferredSystemQuery,
                useSchemaContext,
                effectiveMaxTokens,
                effectiveMaxChars,
                debounceMsApplied,
                completionCategory,
                enabledCategories,
                selectedModelMaxInputTokens: selectedModel?.maxInputTokens,
                selectedModelName: selectedModel?.name,
                selectedModelVersion: selectedModel?.version,
                customSystemPromptActive: !!overrides.customSystemPrompt,
                schemaBudgetProfile: schemaContextSettings.budgetProfile,
                schemaSizeKind: schemaContext?.selectionMetadata?.schemaSizeKind,
                schemaDegradationSteps:
                    schemaContext?.selectionMetadata?.degradationSteps.join(",") ?? "",
                schemaMessageOrder: schemaContextSettings.messageOrder,
                schemaContextChannel: schemaContextSettings.schemaContextChannel,
            },
            error: error
                ? {
                      message: getErrorMessage(error),
                      ...(error instanceof Error && error.name ? { name: error.name } : {}),
                      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                  }
                : undefined,
        });
        const recordPendingDebugEvent = (): void => {
            if (!shouldCaptureDebug || pendingDebugEventId) {
                return;
            }

            pendingDebugEventId = inlineCompletionDebugStore.addEvent(
                createDebugEvent("pending", undefined, modelStartedAt),
            ).id;
        };
        const recordDebugEvent = (
            result: InlineCompletionDebugEventResult,
            error?: unknown,
        ): InlineCompletionDebugEvent | undefined => {
            if (!shouldCaptureDebug) {
                return undefined;
            }

            const debugEvent = createDebugEvent(
                result,
                error,
                result === "pending" ? modelStartedAt : Date.now(),
            );
            if (!pendingDebugEventId) {
                return inlineCompletionDebugStore.addEvent(debugEvent);
            }

            return (
                inlineCompletionDebugStore.updateEvent(pendingDebugEventId, debugEvent) ??
                inlineCompletionDebugStore.addEvent(debugEvent)
            );
        };

        const sendResultTelemetry = (
            result: InlineCompletionResult,
        ): InlineCompletionTelemetrySnapshot => {
            const telemetrySnapshot = createInlineTelemetrySnapshot(
                schemaContext,
                selectedModel?.family,
                modelStartedAt,
                triggerKind,
                inferredSystemQuery,
                intentMode,
            );
            this.sendInlineCompletionTelemetry(result, telemetrySnapshot);
            return telemetrySnapshot;
        };

        try {
            recordPendingDebugEvent();

            selectedModel = await this.getLanguageModel(
                getModelSelectorForCompletionCategory(
                    overrides,
                    completionCategory,
                    this.getConfiguredContinuationModelSelector(),
                ),
                modelPreference,
            );
            if (!selectedModel) {
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    undefined,
                    undefined,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry("noModel", telemetrySnapshot);
                recordDebugEvent("noModel");
                return [];
            }

            schemaContextSettings = getSqlInlineCompletionSchemaContextRuntimeSettings(
                selectedModel.maxInputTokens,
                schemaContextOverrides,
            );
            recordDebugEvent("pending");

            const canSendRequest: boolean | undefined =
                this._context.languageModelAccessInformation?.canSendRequest(selectedModel);
            if (
                canSendRequest === false ||
                (canSendRequest === undefined &&
                    triggerKind === vscode.InlineCompletionTriggerKind.Automatic)
            ) {
                const telemetrySnapshot = createInlineTelemetrySnapshot(
                    undefined,
                    selectedModel.family,
                    modelStartedAt,
                    triggerKind,
                    inferredSystemQuery,
                    intentMode,
                );
                this.sendInlineCompletionTelemetry("noPermission", telemetrySnapshot);
                recordDebugEvent("noPermission");
                return [];
            }

            if (useSchemaContext) {
                schemaContext = await this._schemaContextService.getSchemaContext(
                    document,
                    statementPrefix,
                    selectedModel.maxInputTokens,
                    schemaContextOverrides,
                );
            }

            if (token.isCancellationRequested) {
                recordDebugEvent("cancelled");
                return [];
            }

            schemaContextForPrompt = withInferredSystemQuery(schemaContext, inferredSystemQuery);
            schemaContextText = formatSchemaContextForPrompt(
                schemaContextForPrompt,
                inferredSystemQuery,
            );
            const rulesText = resolveInlineCompletionRules({
                customSystemPrompt: overrides.customSystemPrompt,
                inferredSystemQuery,
                intentMode,
                schemaContextText,
                linePrefix,
                recentPrefix,
                statementPrefix,
            });
            promptMessages = buildInlineCompletionPromptMessages({
                rulesText,
                intentMode,
                recentPrefix,
                statementPrefix,
                suffix,
                linePrefix,
                lineSuffix,
                schemaContextText,
                messageOrder: schemaContextSettings.messageOrder,
                schemaContextChannel: schemaContextSettings.schemaContextChannel,
            });
            debugPromptMessages = shouldCaptureDebug
                ? promptMessages.map(toDebugPromptMessage)
                : [];
            const shouldCheckInputBudget = isFinitePositiveNumber(selectedModel.maxInputTokens);
            let estimatedInputTokens = estimateLanguageModelTokens(promptMessages);
            let budgetInputTokens: number | undefined = shouldCheckInputBudget
                ? estimatedInputTokens
                : undefined;
            if (
                shouldCaptureDebug ||
                shouldCountPromptTokensForBudget(estimatedInputTokens, selectedModel.maxInputTokens)
            ) {
                inputTokens = await countLanguageModelTokens(selectedModel, promptMessages, token);
                budgetInputTokens = inputTokens ?? budgetInputTokens;
            }

            if (
                shouldCheckInputBudget &&
                isPromptOverModelBudget(budgetInputTokens, selectedModel.maxInputTokens) &&
                schemaContextText
            ) {
                schemaContextText = trimSchemaContextTextForModelBudget(
                    schemaContextText,
                    selectedModel.maxInputTokens,
                    budgetInputTokens,
                );
                promptMessages = buildInlineCompletionPromptMessages({
                    rulesText,
                    intentMode,
                    recentPrefix,
                    statementPrefix,
                    suffix,
                    linePrefix,
                    lineSuffix,
                    schemaContextText,
                    messageOrder: schemaContextSettings.messageOrder,
                    schemaContextChannel: schemaContextSettings.schemaContextChannel,
                });
                debugPromptMessages = shouldCaptureDebug
                    ? promptMessages.map(toDebugPromptMessage)
                    : [];
                estimatedInputTokens = estimateLanguageModelTokens(promptMessages);
                budgetInputTokens = estimatedInputTokens;
                if (
                    shouldCaptureDebug ||
                    shouldCountPromptTokensForBudget(
                        estimatedInputTokens,
                        selectedModel.maxInputTokens,
                    )
                ) {
                    inputTokens = await countLanguageModelTokens(
                        selectedModel,
                        promptMessages,
                        token,
                    );
                    budgetInputTokens = inputTokens ?? budgetInputTokens;
                }
            }

            recordDebugEvent("pending");
            modelCallStarted = true;
            const response = await selectedModel.sendRequest(
                promptMessages,
                {
                    justification:
                        "MSSQL inline SQL completion uses a language model to generate ghost text.",
                    modelOptions: createLanguageModelMaxTokenOptions(effectiveMaxTokens),
                },
                token,
            );

            rawText = await collectText(response, token);
            if (token.isCancellationRequested) {
                recordDebugEvent("cancelled");
                return [];
            }
            outputTokens = shouldCaptureDebug
                ? await countLanguageModelTokens(selectedModel, rawText, token)
                : undefined;

            sanitizedText = sanitizeInlineCompletionText(
                rawText,
                effectiveMaxChars,
                linePrefix,
                intentMode,
            );

            if (!sanitizedText) {
                const result = rawText.trim() ? "emptyFromSanitizer" : "emptyFromModel";
                sendResultTelemetry(result);
                recordDebugEvent(result);
                return [];
            }

            finalCompletionText = fixLeadingWhitespace(
                sanitizedText,
                linePrefix,
                schemaContextForPrompt,
                intentMode,
            );
            finalCompletionText = suppressDocumentSuffixOverlap(finalCompletionText, suffix);

            if (!finalCompletionText) {
                sendResultTelemetry("emptyFromSanitizer");
                recordDebugEvent("emptyFromSanitizer");
                return [];
            }

            const telemetrySnapshot = sendResultTelemetry("success");
            const storedEvent = recordDebugEvent("success");

            return [
                new vscode.InlineCompletionItem(
                    finalCompletionText,
                    new vscode.Range(position, position),
                    {
                        title: "MSSQL inline SQL completion accepted",
                        command: inlineCompletionAcceptedCommand,
                        arguments: [telemetrySnapshot, storedEvent?.id],
                    },
                ),
            ];
        } catch (error) {
            if (isCancellation(token, error)) {
                if (modelCallStarted || pendingDebugEventId) {
                    recordDebugEvent("cancelled", error);
                }
                return [];
            }

            const errorMessage = getErrorMessage(error);
            this._logger.warn(`Inline completion request failed: ${errorMessage}`);
            sendResultTelemetry("error");
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.InlineCompletion,
                error instanceof Error ? error : new Error(errorMessage),
                false,
            );
            recordDebugEvent("error", error);
            return [];
        }
    }

    private isEnabledForDocument(document: vscode.TextDocument): boolean {
        if (document.languageId !== Constants.languageId) {
            return false;
        }

        return isInlineCompletionFeatureEnabled();
    }

    private getConfiguredUseSchemaContext(): boolean {
        return (
            vscode.workspace
                .getConfiguration()
                .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ??
            false
        );
    }

    private getConfiguredEnabledCategories(): InlineCompletionCategory[] {
        const configured = vscode.workspace
            .getConfiguration()
            .get<unknown>(Constants.configCopilotInlineCompletionsEnabledCategories, [
                ...inlineCompletionCategories,
            ]);
        return normalizeInlineCompletionCategories(configured);
    }

    private getConfiguredModelSelector(): string | undefined {
        return (
            vscode.workspace
                .getConfiguration()
                .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
                ?.trim() || undefined
        );
    }

    private getConfiguredContinuationModelSelector(): string | undefined {
        return (
            vscode.workspace
                .getConfiguration()
                .get<string>(Constants.configCopilotInlineCompletionsContinuationModelFamily, "")
                ?.trim() || undefined
        );
    }

    private getRecordWhenClosedSetting(): boolean {
        return (
            vscode.workspace
                .getConfiguration()
                .get<boolean>(
                    Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    false,
                ) ?? false
        );
    }

    private async getLanguageModel(
        modelSelectorOverride?: string,
        modelPreference?: InlineCompletionModelPreference,
    ): Promise<vscode.LanguageModelChat | undefined> {
        const effectiveSelector =
            modelSelectorOverride ??
            (modelPreference ? undefined : this.getConfiguredModelSelector());
        const cacheKey = `${getConfiguredInlineCompletionModelVendors().join(",")}|${
            effectiveSelector || "__auto__"
        }|${getModelPreferenceCacheKey(modelPreference)}`;

        if (this._cachedModels.has(cacheKey)) {
            return this._cachedModels.get(cacheKey);
        }

        const all = await selectConfiguredLanguageModels();
        if (effectiveSelector) {
            const matched = matchLanguageModelChatToSelector(all, effectiveSelector);
            if (matched) {
                this._cachedModels.set(cacheKey, matched);
                return matched;
            }
            this._logger.debug(
                `Configured model "${effectiveSelector}" not available; selecting best available language model.`,
            );
        }

        const selectedModel = selectPreferredModel(all, modelPreference);
        this._cachedModels.set(cacheKey, selectedModel);
        return selectedModel;
    }

    private sendInlineCompletionTelemetry(
        result: InlineCompletionResult,
        snapshot: InlineCompletionTelemetrySnapshot | undefined,
    ): void {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.InlineCompletion, {
            result,
            usedSchemaContext: (snapshot?.usedSchemaContext ?? false).toString(),
            fallbackWithoutMetadata: (snapshot?.fallbackWithoutMetadata ?? true).toString(),
            schemaObjectCountBucket: getCountBucket(snapshot?.schemaObjectCount ?? 0),
            schemaSystemObjectCountBucket: getCountBucket(snapshot?.schemaSystemObjectCount ?? 0),
            schemaForeignKeyCountBucket: getCountBucket(snapshot?.schemaForeignKeyCount ?? 0),
            modelFamily: snapshot?.modelFamily ?? "unknown",
            triggerKind: snapshot?.triggerKind ?? "unknown",
            latencyBucket: getLatencyBucket(snapshot?.latencyMs ?? 0),
            inferredSystemQuery: (snapshot?.inferredSystemQuery ?? false).toString(),
            completionCategory: snapshot?.completionCategory ?? "unknown",
            intentMode: (snapshot?.intentMode ?? false).toString(),
            schemaBudgetProfile: snapshot?.schemaBudgetProfile ?? "unknown",
            schemaSizeKind: snapshot?.schemaSizeKind ?? "unknown",
            schemaDegradationStepCountBucket: getCountBucket(
                snapshot?.schemaDegradationStepCount ?? 0,
            ),
        });
    }

    private clearModelCache(): void {
        this._cachedModels.clear();
    }
}

function getModelSelectorForCompletionCategory(
    overrides: InlineCompletionDebugOverrides,
    completionCategory: InlineCompletionCategory,
    configuredContinuationModelSelector: string | undefined,
): string | undefined {
    if (completionCategory === "continuation") {
        return (
            overrides.continuationModelSelector ??
            configuredContinuationModelSelector ??
            overrides.modelSelector ??
            undefined
        );
    }

    return overrides.modelSelector ?? undefined;
}

function getConfiguredInlineCompletionProfileId() {
    const configured = vscode.workspace
        .getConfiguration()
        .get<string>(
            Constants.configCopilotInlineCompletionsProfile,
            inlineCompletionConfiguredDefaultProfileId,
        );
    return (
        getInlineCompletionPresetProfileId(configured) ?? inlineCompletionConfiguredDefaultProfileId
    );
}

export function getInlineCompletionCategory(intentMode: boolean): InlineCompletionCategory {
    return intentMode ? "intent" : "continuation";
}

function getModelPreferenceCacheKey(
    preference: InlineCompletionModelPreference | undefined,
): string {
    if (!preference) {
        return "__configured__";
    }

    return `${preference.providerVendors.join(",")}|${preference.familyPatterns
        .map((pattern) => pattern.source)
        .join(",")}`;
}

export function normalizeInlineCompletionCategories(value: unknown): InlineCompletionCategory[] {
    if (!Array.isArray(value)) {
        return [...inlineCompletionCategories];
    }

    const enabled = new Set<InlineCompletionCategory>();
    for (const item of value) {
        if (isInlineCompletionCategory(item)) {
            enabled.add(item);
        }
    }

    return inlineCompletionCategories.filter((category) => enabled.has(category));
}

export function isInlineCompletionCategoryEnabled(
    category: InlineCompletionCategory,
    enabledCategories: readonly InlineCompletionCategory[],
): boolean {
    return enabledCategories.includes(category);
}

function isInlineCompletionCategory(value: unknown): value is InlineCompletionCategory {
    return inlineCompletionCategories.includes(value as InlineCompletionCategory);
}

export function buildCompletionRules(inferredSystemQuery: boolean, intentMode: boolean): string {
    const preamble = [
        buildSharedPreamble(inferredSystemQuery),
        buildSchemaInventoryGuidance(),
    ].join("\n");
    const modeRules = intentMode ? buildIntentModeRules() : buildContinuationModeRules();
    return `${preamble}\n\n${modeRules}`;
}

function buildSharedPreamble(inferredSystemQuery: boolean): string {
    return `Shared rules:
- Use only the tables, views, procedures, functions, columns, parameters, keys, and system objects listed in the schema context. Do not invent local database objects.
- Return no markdown, fences, backticks, quotes, labels, or explanations — raw SQL only.
- If the schema context does not contain enough information to satisfy the request, return exactly an empty string. Do not explain why, apologize, mention missing schema context, emit placeholder text such as SELECT, or say that you are returning an empty string.
- Empty string means emit no characters at all; never write prose such as "the document is complete", "done", or "return empty string".
- The document suffix and current line suffix are authoritative context. Generate text that composes naturally with both; if no natural completion fits before the suffix, return exactly an empty string.
- Use the recent document prefix to avoid repeating nearby declarations, CTE names, temp tables, aliases, or setup statements.
- Prefer the simplest canonical query that satisfies the request. Do not add extra joins, columns, filters, aliases, or system objects unless the request or schema context requires them.
- System affinity: inferredSystemQuery=${inferredSystemQuery ? "true" : "false"} — if true, prefer sys.* / INFORMATION_SCHEMA.* / DMV objects from the listed system objects; if false, prefer user tables, views, procedures, and functions.
- Prefer schema-qualified names.`;
}

function buildSchemaInventoryGuidance(): string {
    return `Inventory rules:
- The schema context may include detailed TABLE / VIEW / PROCEDURE / FUNCTION entries and compact TABLE NAMES / VIEW NAMES / ROUTINE NAMES inventory entries. Columns, parameters, return columns, and keys are known only for detailed entries.
- If an object appears only in a names-only inventory entry, treat its columns and parameters as unknown. Use names-only objects only for broad discovery queries, EXEC name exploration, or simple SELECT * exploration.
- If the request needs specific columns, joins, predicates, aggregates, ordering, or routine arguments on a names-only object, return exactly an empty string.`;
}

function buildIntentModeRules(): string {
    // The "already typed SELECT or WITH" rule stays here (not in preamble or continuation)
    // because it only arises when intent mode fires on a comment + partial statement:
    //   -- Write a query to list orders
    //   SELECT [cursor]
    // Continuation mode handles cursor-continuation naturally; this rule prevents intent
    // mode from generating a fresh "SELECT ..." that would echo the keyword already typed.
    return `You generate a T-SQL query for Visual Studio Code ghost text based on a natural-language description the user wrote as a comment directly above the cursor.

Intent-mode rules:
- Return the complete SQL statement (or statements, if the intent clearly requires more than one) that satisfies the preceding comment.
- Multiple clauses, CTEs, subqueries, window functions, and aggregations are all allowed and expected.
- Do not repeat the comment text.
- Prefer stable conventional formatting over stylistic variation.
- For metadata-discovery prompts, prefer the simplest conventional catalog source that satisfies the request (for example INFORMATION_SCHEMA for basic table/column listings; sys.* only when SQL Server-specific details are needed).
- For multi-clause SELECT queries, use a canonical multiline layout: SELECT on its own line, one select item per line when there are several, and FROM, JOIN, WHERE, GROUP BY, HAVING, and ORDER BY on separate lines.
- Prefer uppercase SQL keywords.
- If the user has already typed a statement-initiating keyword such as SELECT or WITH before the cursor, continue from exactly that point — do not repeat the keyword.
- If the cursor is on a blank line after the comment, start the first SQL token directly (leading whitespace is handled by the host).
- If the cursor is still on the comment line, start the query on a new line before the first SQL token.
- End the statement with a semicolon when it is a complete standalone statement.`;
}

function buildContinuationModeRules(): string {
    return `You generate a single T-SQL inline completion for Visual Studio Code ghost text.

Continuation-mode rules:
- Return only the text to insert at the cursor.
- Return at most one logical unit: one JOIN with ON, one APPLY, one WHERE predicate, one SELECT expression, one identifier continuation, etc.
- Do not repeat text already before the cursor. Continue from the current cursor exactly.
- If no natural single-unit continuation fits the current line suffix and document suffix, return exactly an empty string. Do not invent a fresh standalone statement.
- Do not end with a semicolon. Do not emit multiple clauses chained together.
- If the cursor is after a non-whitespace character, choose the right leading space or newline. New clauses such as WHERE, JOIN, APPLY, GROUP BY, ORDER BY, OPTION, FOR JSON, and FOR XML should start on a new line.
- When completing a qualified name, preserve the dot. If the cursor is after sys and sys.databases is available, return .databases.
- JOIN context: infer join predicates from actual PK/FK metadata and compatible column names. Never write a same-side tautology such as T.Col = T.Col.`;
}

interface InlineCompletionPromptBuildOptions {
    rulesText: string;
    intentMode: boolean;
    recentPrefix: string;
    statementPrefix: string;
    suffix: string;
    linePrefix: string;
    lineSuffix: string;
    schemaContextText: string;
    messageOrder?: SqlInlineCompletionSchemaContextRuntimeSettings["messageOrder"];
    schemaContextChannel?: SqlInlineCompletionSchemaContextRuntimeSettings["schemaContextChannel"];
}

interface InlineCompletionPromptRuleOptions {
    customSystemPrompt: string | null | undefined;
    inferredSystemQuery: boolean;
    intentMode: boolean;
    schemaContextText: string;
    linePrefix: string;
    recentPrefix: string;
    statementPrefix: string;
}

export function resolveInlineCompletionRules(options: InlineCompletionPromptRuleOptions): string {
    if (!options.customSystemPrompt) {
        return buildCompletionRules(options.inferredSystemQuery, options.intentMode);
    }

    return applyCustomSystemPromptTemplate(options.customSystemPrompt, options);
}

export function applyCustomSystemPromptTemplate(
    template: string,
    options: Omit<InlineCompletionPromptRuleOptions, "customSystemPrompt">,
): string {
    let result = template;
    const replacements: Array<[string, string]> = [
        ["{{inferredSystemQuery}}", options.inferredSystemQuery ? "true" : "false"],
        ["{{intentMode}}", options.intentMode ? "true" : "false"],
        ["{{schemaContext}}", options.schemaContextText],
        ["{{linePrefix}}", options.linePrefix],
        ["{{recentPrefix}}", options.recentPrefix],
        ["{{statementPrefix}}", options.statementPrefix],
    ];

    for (const [placeholder, value] of replacements) {
        result = result.split(placeholder).join(value);
    }

    return result;
}

export function buildInlineCompletionPromptMessages(
    options: InlineCompletionPromptBuildOptions,
): vscode.LanguageModelChatMessage[] {
    // VS Code LM API exposes only User and Assistant roles; there is no System role.
    // The rules message is sent as User because that is the only available channel.
    const schemaContextChannel = options.schemaContextChannel ?? "inline-with-data";
    const dataMessage = buildPromptDataMessage(
        options,
        schemaContextChannel === "inline-with-data",
    );
    const messages =
        (options.messageOrder ?? "rules-then-data") === "data-then-rules"
            ? [
                  vscode.LanguageModelChatMessage.User(dataMessage),
                  vscode.LanguageModelChatMessage.User(options.rulesText),
              ]
            : [
                  vscode.LanguageModelChatMessage.User(options.rulesText),
                  vscode.LanguageModelChatMessage.User(dataMessage),
              ];

    if (schemaContextChannel === "separate-message") {
        messages.push(
            vscode.LanguageModelChatMessage.User(
                `<schema_context>
${options.schemaContextText}
</schema_context>`,
            ),
        );
    }

    return messages;
}

function buildPromptDataMessage(
    options: InlineCompletionPromptBuildOptions,
    includeSchemaContext: boolean,
): string {
    const mode = options.intentMode
        ? "intent (return complete query)"
        : "continuation (return one unit)";
    const parts = [
        `<mode>${mode}</mode>`,
        `<recent_document_prefix>\n${options.recentPrefix}\n</recent_document_prefix>`,
        `<current_statement_prefix>\n${options.statementPrefix}\n</current_statement_prefix>`,
        `<document_suffix>\n${options.suffix}\n</document_suffix>`,
        `<current_line_prefix>\n${options.linePrefix}\n</current_line_prefix>`,
        `<current_line_suffix>\n${options.lineSuffix}\n</current_line_suffix>`,
    ];

    if (includeSchemaContext) {
        parts.push(`<schema_context>\n${options.schemaContextText}\n</schema_context>`);
    }

    return parts.join("\n\n");
}

export function selectPreferredModel<
    T extends {
        family: string;
        vendor?: string;
        id?: string;
        name?: string;
        version?: string;
    },
>(
    models: T[],
    preference:
        | InlineCompletionModelPreference
        | undefined = defaultInlineCompletionModelPreference,
): T | undefined {
    const familyPatterns =
        preference.familyPatterns.length > 0
            ? preference.familyPatterns
            : defaultInlineCompletionModelPreference.familyPatterns;

    for (const pattern of familyPatterns) {
        const candidates = models.filter((model) => modelMatchesPreferencePattern(model, pattern));
        const match = selectPreferredProviderModel(candidates, preference.providerVendors);
        if (match) {
            return match;
        }
    }
    return selectPreferredProviderModel(models, preference.providerVendors);
}

function selectPreferredProviderModel<
    T extends { vendor?: string; id?: string; version?: string; name?: string },
>(models: T[], providerVendors: readonly string[]): T | undefined {
    for (const vendor of providerVendors) {
        const best = selectBestVersionedModel(models.filter((model) => model.vendor === vendor));
        if (best) {
            return best;
        }
    }

    return selectBestVersionedModel(models);
}

function selectBestVersionedModel<T extends { id?: string; version?: string; name?: string }>(
    models: T[],
): T | undefined {
    if (models.length <= 1) {
        return models[0];
    }

    return [...models].sort(compareModelVersionDescending)[0];
}

function compareModelVersionDescending(
    left: { id?: string; version?: string; name?: string },
    right: { id?: string; version?: string; name?: string },
): number {
    const leftParts = getModelVersionParts(left);
    const rightParts = getModelVersionParts(right);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index++) {
        const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }

    return getModelVersionText(right).localeCompare(getModelVersionText(left), undefined, {
        sensitivity: "base",
        numeric: true,
    });
}

function getModelVersionParts(model: { id?: string; version?: string; name?: string }): number[] {
    return (getModelVersionText(model).match(/\d+/g) ?? []).map((part) => Number(part));
}

function getModelVersionText(model: { id?: string; version?: string; name?: string }): string {
    const version = model.version?.trim();
    if (version && version !== "1") {
        return version;
    }

    return model.id ?? version ?? model.name ?? "";
}

function modelMatchesPreferencePattern(
    model: { family: string; id?: string; name?: string },
    pattern: RegExp,
): boolean {
    return [model.family, model.id, model.name].some((value) => {
        if (!value) {
            return false;
        }

        return [value, normalizeModelPreferenceText(value)].some((candidate) => {
            pattern.lastIndex = 0;
            return pattern.test(candidate);
        });
    });
}

function normalizeModelPreferenceText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export async function collectText(
    response: vscode.LanguageModelChatResponse,
    token: vscode.CancellationToken,
): Promise<string> {
    const parts: string[] = [];
    for await (const part of response.stream) {
        if (token.isCancellationRequested) {
            break;
        }
        if (part instanceof vscode.LanguageModelTextPart) {
            parts.push(part.value);
        }
    }

    return parts.join("");
}

export function createLanguageModelMaxTokenOptions(maxTokens: number): { [name: string]: number } {
    // Keep both spellings because VS Code LM providers are not fully uniform: built-in
    // providers use maxTokens, while some provider shims forward OpenAI-style max_tokens.
    return {
        maxTokens,
        max_tokens: maxTokens,
    };
}

export function getEffectiveMaxCompletionChars(
    defaultMaxChars: number,
    maxTokensOverride: number | null | undefined,
): number {
    if (
        maxTokensOverride === null ||
        maxTokensOverride === undefined ||
        !Number.isFinite(maxTokensOverride) ||
        maxTokensOverride <= 0
    ) {
        return defaultMaxChars;
    }

    return Math.max(1, Math.min(defaultMaxChars, Math.ceil(maxTokensOverride * 6)));
}

async function countLanguageModelTokens(
    model: vscode.LanguageModelChat,
    textOrMessages: string | vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken,
): Promise<number | undefined> {
    const countTokens = (model as { countTokens?: vscode.LanguageModelChat["countTokens"] })
        .countTokens;
    if (!countTokens || token.isCancellationRequested) {
        return undefined;
    }

    try {
        if (typeof textOrMessages === "string") {
            return await countTokens.call(model, textOrMessages, token);
        }

        const counts = await Promise.all(
            textOrMessages.map((message) => countTokens.call(model, message, token)),
        );
        return counts.reduce((sum, count) => sum + count, 0);
    } catch {
        return undefined;
    }
}

function isFinitePositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPromptOverModelBudget(
    inputTokens: number | undefined,
    maxInputTokens: number | undefined,
): boolean {
    return (
        isFinitePositiveNumber(inputTokens) &&
        isFinitePositiveNumber(maxInputTokens) &&
        inputTokens > Math.floor(maxInputTokens * 0.9)
    );
}

function shouldCountPromptTokensForBudget(
    estimatedInputTokens: number,
    maxInputTokens: number | undefined,
): boolean {
    return (
        isFinitePositiveNumber(maxInputTokens) &&
        estimatedInputTokens > Math.floor(maxInputTokens * 0.75)
    );
}

function estimateLanguageModelTokens(
    textOrMessages: string | vscode.LanguageModelChatMessage[],
): number {
    if (typeof textOrMessages === "string") {
        return approximateTokenCount(textOrMessages);
    }

    return approximateTokenCount(textOrMessages.map(getLanguageModelMessageText).join("\n\n"));
}

function getLanguageModelMessageText(message: vscode.LanguageModelChatMessage): string {
    return message.content
        .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
        .join("");
}

function trimSchemaContextTextForModelBudget(
    schemaContextText: string,
    maxInputTokens: number | undefined,
    inputTokens: number | undefined,
): string {
    if (!isFinitePositiveNumber(maxInputTokens) || !isFinitePositiveNumber(inputTokens)) {
        return schemaContextText;
    }

    const usableInputTokens = Math.floor(maxInputTokens * 0.85);
    const schemaTokenEstimate = Math.max(1, approximateTokenCount(schemaContextText));
    const nonSchemaTokens = Math.max(0, inputTokens - schemaTokenEstimate);
    const targetSchemaTokens = Math.max(128, usableInputTokens - nonSchemaTokens);
    const targetChars = Math.max(
        1024,
        Math.min(schemaContextText.length, Math.floor(targetSchemaTokens * 4)),
    );
    return trimSchemaContextTextForPrompt(schemaContextText, targetChars);
}

function trimSchemaContextTextForPrompt(schemaContextText: string, targetChars: number): string {
    if (schemaContextText.length <= targetChars) {
        return schemaContextText;
    }

    const lines = schemaContextText.split("\n");
    const selectedLines: string[] = [];
    let length = 0;
    for (const line of lines) {
        if (length + line.length + 1 > targetChars) {
            break;
        }
        selectedLines.push(line);
        length += line.length + 1;
    }

    selectedLines.push(
        "-- schema context truncated because the selected model has a smaller input window",
    );
    return selectedLines.join("\n");
}

function toDebugPromptMessage(
    message: vscode.LanguageModelChatMessage,
): InlineCompletionDebugPromptMessage {
    return {
        role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
        content: message.content
            .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
            .join(""),
    };
}

// SQL keywords that start a new clause and should land on their own line when the
// cursor is at the end of the previous token with no trailing whitespace.
const newLineClausePattern =
    /^(with|where|from|join|left(?:\s+outer)?\s+join|right(?:\s+outer)?\s+join|inner\s+join|outer\s+join|cross\s+join|full(?:\s+outer)?\s+join|cross\s+apply|outer\s+apply|apply|group\s+by|order\s+by|having|union(?:\s+all)?|intersect|except|on|set|values|returning|output|pivot|unpivot|for\s+json|for\s+xml|window|option)\b/i;
const similaritySensitiveLeadingTokens = new Set([
    "select",
    "with",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "full",
    "cross",
    "outer",
    "where",
    "group",
    "order",
    "having",
]);

export function fixLeadingWhitespace(
    completionText: string | undefined,
    linePrefix: string,
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    intentMode: boolean = false,
): string | undefined {
    if (!completionText) {
        return undefined;
    }

    if (!linePrefix.trim()) {
        return completionText.replace(/^\s+/, "");
    }

    if (intentMode && isIntentCommentLinePrefix(linePrefix)) {
        const indentation = /^\s*/.exec(linePrefix)?.[0] ?? "";
        return `\n${indentation}${completionText.replace(/^\s+/, "")}`;
    }

    if (isAfterStatementTerminator(linePrefix)) {
        return `\n${completionText.replace(/^\s+/, "")}`;
    }

    if (/[\s.]$/.test(linePrefix) || /^[\s.]/.test(completionText)) {
        return completionText;
    }

    if (/[@#\[(]$/.test(linePrefix)) {
        return completionText;
    }

    if (newLineClausePattern.test(completionText)) {
        return "\n" + completionText;
    }

    if (/^[a-zA-Z0-9_@#"'\[`]/.test(completionText)) {
        const trailingWord = /([a-zA-Z0-9_#@$]+)$/.exec(linePrefix)?.[1];
        if (
            trailingWord &&
            schemaContext &&
            isKnownDottedName(trailingWord, completionText, schemaContext)
        ) {
            return "." + completionText;
        }
        return " " + completionText;
    }
    return completionText;
}

function isAfterStatementTerminator(linePrefix: string): boolean {
    return /;\s*$/.test(linePrefix);
}

function isIntentCommentLinePrefix(linePrefix: string): boolean {
    const trimmedLinePrefix = linePrefix.trim();
    return /^\s*--/.test(linePrefix) || trimmedLinePrefix.endsWith("*/");
}

function shouldSuppressIntentCompletionOnCommentLine(
    linePrefix: string,
    lineSuffix: string,
): boolean {
    return isIntentCommentLinePrefix(linePrefix) && !!lineSuffix.trim();
}

export function suppressDocumentSuffixOverlap(
    completionText: string | undefined,
    documentSuffix: string,
): string | undefined {
    if (!completionText) {
        return undefined;
    }

    const normalizedCompletion = completionText.replace(/\r\n/g, "\n").trimStart();
    const normalizedSuffix = documentSuffix.replace(/\r\n/g, "\n").trimStart();
    if (!normalizedCompletion || !normalizedSuffix) {
        return completionText;
    }

    if (normalizedSuffix.startsWith(normalizedCompletion)) {
        const nextCharacter = normalizedSuffix[normalizedCompletion.length];
        if (
            nextCharacter &&
            /[a-zA-Z0-9_]/.test(nextCharacter) &&
            /[a-zA-Z0-9_]$/.test(normalizedCompletion)
        ) {
            return completionText;
        }

        return undefined;
    }

    if (isSimilarRewriteOfDocumentSuffix(normalizedCompletion, normalizedSuffix)) {
        return undefined;
    }

    return completionText;
}

function isSimilarRewriteOfDocumentSuffix(completionText: string, documentSuffix: string): boolean {
    const completionTokens = getSqlSimilarityTokens(completionText);
    const suffixTokens = getSqlSimilarityTokens(documentSuffix);
    if (completionTokens.length < 8 || suffixTokens.length < 8) {
        return false;
    }

    if (completionTokens[0] !== suffixTokens[0]) {
        return false;
    }

    if (!similaritySensitiveLeadingTokens.has(completionTokens[0])) {
        return false;
    }

    const suffixWindow = suffixTokens.slice(0, Math.max(completionTokens.length, 16));
    return getTokenSetSimilarity(completionTokens, suffixWindow) >= 0.78;
}

function getSqlSimilarityTokens(text: string): string[] {
    return (
        text
            .replace(/\[[^\]]+\]/g, (identifier) => identifier.slice(1, -1))
            .toLowerCase()
            .match(/[a-z_][a-z0-9_]*|#[a-z_][a-z0-9_]*|@[a-z_][a-z0-9_]*/g) ?? []
    );
}

function getTokenSetSimilarity(leftTokens: string[], rightTokens: string[]): number {
    const left = new Set(leftTokens);
    const right = new Set(rightTokens);
    let intersectionSize = 0;
    for (const token of left) {
        if (right.has(token)) {
            intersectionSize++;
        }
    }

    return intersectionSize / Math.max(left.size, right.size);
}

function isKnownDottedName(
    prefix: string,
    completion: string,
    context: SqlInlineCompletionSchemaContext,
): boolean {
    const firstCompletionToken = completion.split(/[\s(,;]/, 1)[0]?.replace(/^[.]+/, "");
    if (!firstCompletionToken) {
        return false;
    }

    const candidate = `${prefix}.${firstCompletionToken}`.toLowerCase();
    const objectNames = [
        ...context.tables.map((t) => t.name),
        ...context.views.map((v) => v.name),
        ...(context.routines ?? []).map((r) => r.name),
        ...(context.systemObjects ?? []).map((o) => o.name),
        ...context.masterSymbols,
        ...context.schemas,
    ];

    return objectNames.some((name) => name.toLowerCase().startsWith(candidate));
}

function isCancellation(token: vscode.CancellationToken, error: unknown): boolean {
    if (token.isCancellationRequested) {
        return true;
    }
    if (error instanceof vscode.CancellationError) {
        return true;
    }
    if (error instanceof Error && error.message === "Canceled") {
        return true;
    }
    return false;
}

function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
    if (token.isCancellationRequested) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            disposable.dispose();
            resolve();
        }, ms);
        const disposable = token.onCancellationRequested(() => {
            clearTimeout(timeout);
            disposable.dispose();
            resolve();
        });
    });
}

function getStatementAwarePrefixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    targetMaxChars: number,
): string {
    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const boundaryIndex = findLastStatementBoundary(prefix);
    const statementPrefix = prefix.slice(boundaryIndex).replace(/^\s+/, "");

    // Prefer preserving the full current statement because mid-statement truncation hurts
    // completion quality more than a slightly larger prompt, but clamp pathological statements
    // to a hard ceiling so giant single-statement scripts cannot grow unbounded.
    const hardCap = targetMaxChars * 2;
    if (statementPrefix.length > hardCap) {
        return statementPrefix.slice(-hardCap);
    }

    return statementPrefix;
}

function getRecentDocumentPrefixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxChars: number,
): string {
    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const boundaryIndex = findLastStatementBoundary(prefix);
    const recentPrefix = prefix.slice(0, boundaryIndex).trimEnd();
    if (!recentPrefix) {
        return "";
    }

    return recentPrefix.slice(-maxChars).replace(/^\s+/, "");
}

function findLastStatementBoundary(text: string): number {
    return Math.max(findLastGoBoundary(text), findLastTopLevelSemicolon(text));
}

function findLastGoBoundary(text: string): number {
    const goPattern = /(?:^|\r?\n)[ \t]*GO(?:[ \t]+\d+)?[ \t]*(?:--[^\r\n]*)?(?=\r?\n|$)/gi;
    let boundaryIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = goPattern.exec(text)) !== null) {
        boundaryIndex = match.index + match[0].length;
        if (text.slice(boundaryIndex, boundaryIndex + 2) === "\r\n") {
            boundaryIndex += 2;
        } else if (text[boundaryIndex] === "\n") {
            boundaryIndex += 1;
        }
    }

    return boundaryIndex;
}

function findLastTopLevelSemicolon(text: string): number {
    let lastBoundaryIndex = 0;
    let parenthesisDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBracketIdentifier = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const current = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (current === "\n" || current === "\r") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (current === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inSingleQuote) {
            if (current === "'" && next === "'") {
                i++;
            } else if (current === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (current === '"' && next === '"') {
                i++;
            } else if (current === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inBracketIdentifier) {
            if (current === "]" && next === "]") {
                i++;
            } else if (current === "]") {
                inBracketIdentifier = false;
            }
            continue;
        }

        if (current === "-" && next === "-") {
            inLineComment = true;
            i++;
            continue;
        }

        if (current === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        if (current === "'") {
            inSingleQuote = true;
            continue;
        }

        if (current === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (current === "[") {
            inBracketIdentifier = true;
            continue;
        }

        if (current === "(") {
            parenthesisDepth++;
            continue;
        }

        if (current === ")" && parenthesisDepth > 0) {
            parenthesisDepth--;
            continue;
        }

        if (current === ";" && parenthesisDepth === 0) {
            lastBoundaryIndex = i + 1;
        }
    }

    return lastBoundaryIndex;
}

function getSuffixWindow(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxChars: number,
): string {
    const endPosition = document.lineAt(document.lineCount - 1).range.end;
    const suffix = document.getText(new vscode.Range(position, endPosition));
    return suffix.slice(0, maxChars);
}

export function detectIntentComment(statementPrefix: string, linePrefix: string): boolean {
    const trimmedPrefix = statementPrefix.trimEnd();
    const intentComment = findIntentComment(trimmedPrefix);
    if (!intentComment) {
        return false;
    }

    if (!matchesIntentPostComment(intentComment.postComment)) {
        return false;
    }

    if (!matchesIntentLinePrefix(linePrefix)) {
        return false;
    }

    return (
        trailingQuestionIntentPattern.test(intentComment.commentText) ||
        instructionalIntentWordPattern.test(intentComment.commentText) ||
        questionStyleIntentPattern.test(intentComment.commentText)
    );
}

// Both automatic and explicit (Alt+\) trigger kinds use comment-based detection as the
// single signal for intent mode. This is the canonical entry point for that check.
function detectIntentMode(statementPrefix: string, linePrefix: string): boolean {
    return detectIntentComment(statementPrefix, linePrefix);
}

export function sanitizeInlineCompletionText(
    completionText: string,
    maxChars: number,
    linePrefix: string,
    intentMode: boolean,
): string | undefined {
    return sanitizeInlineCompletionTextWithOptions({
        completionText,
        maxChars,
        linePrefix,
        intentMode,
    });
}

interface SanitizeInlineCompletionTextOptions {
    completionText: string;
    maxChars: number;
    linePrefix: string;
    intentMode: boolean;
}

function sanitizeInlineCompletionTextWithOptions(
    options: SanitizeInlineCompletionTextOptions,
): string | undefined {
    let normalized = options.completionText.replace(/\r\n/g, "\n");
    normalized = stripMarkdownFences(normalized);
    normalized = stripModelPreamble(normalized);
    normalized = unwrapQuotedResponse(normalized);
    normalized = options.intentMode ? normalized.trimEnd() : normalized.trim();

    if (isSentinelCompletion(normalized)) {
        return undefined;
    }

    normalized = removeEchoedLinePrefix(normalized, options.linePrefix);
    normalized = options.intentMode ? normalized.trimEnd() : normalized.trim();
    if (isLikelyMetaResponseInsteadOfSql(normalized)) {
        return undefined;
    }

    if (options.intentMode) {
        normalized = stripTrailingStandaloneLineComment(normalized).trimEnd();
        if (isLikelyMetaResponseInsteadOfSql(normalized)) {
            return undefined;
        }
    } else {
        normalized = truncateAtInlineStop(normalized).trim();
        if (isLikelyMetaResponseInsteadOfSql(normalized)) {
            return undefined;
        }
    }

    // The second sentinel pass intentionally catches model replies that only become
    // empty-string sentinels after echo/preamble/meta cleanup above.
    if (isSentinelCompletion(normalized)) {
        return undefined;
    }

    if (normalized.length <= options.maxChars) {
        return normalized;
    }

    const candidate = normalized.slice(0, options.maxChars);
    const lastWhitespaceIndex = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\n"));
    if (lastWhitespaceIndex > Math.floor(options.maxChars / 2)) {
        return candidate.slice(0, lastWhitespaceIndex).trimEnd();
    }

    return candidate.trimEnd();
}

function stripMarkdownFences(text: string): string {
    const fencedBlock = /^\s*```(?:sql|tsql|sqlserver)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
    if (fencedBlock) {
        return fencedBlock[1];
    }

    const fenceLinePattern = /(^|\n)[ \t]*```(?:sql|tsql|sqlserver)?[ \t]*(?=\n|$)/gi;
    const fenceMatches = [...text.matchAll(fenceLinePattern)];
    if (fenceMatches.length < 2 || fenceMatches.length % 2 !== 0) {
        return text;
    }

    return text.replace(fenceLinePattern, "$1");
}

function stripModelPreamble(text: string): string {
    return text.replace(
        /^\s*(?:completion|insert text|ghost text|sql|query|answer|result|output)\s*:\s*/i,
        "",
    );
}

function unwrapQuotedResponse(text: string): string {
    const trimmed = text.trim();
    const quotePairs: Array<[string, string]> = [
        ['"', '"'],
        ["'", "'"],
        ["\u201C", "\u201D"],
        ["\u2018", "\u2019"],
    ];

    for (const [openQuote, closeQuote] of quotePairs) {
        if (trimmed.startsWith(openQuote) && trimmed.endsWith(closeQuote)) {
            return trimmed.slice(openQuote.length, trimmed.length - closeQuote.length);
        }
    }

    return text;
}

function isSentinelCompletion(text: string): boolean {
    return (
        !text.trim() ||
        /^(?:""|''|none|no completion|n\/a|null|undefined|empty|string empty|empty string|\(none\))$/i.test(
            text.trim(),
        )
    );
}

function removeEchoedLinePrefix(completionText: string, linePrefix: string): string {
    const trimmedLinePrefix = linePrefix.trim();
    const trimmedCompletion = completionText.trimStart();

    if (trimmedLinePrefix.length < 3) {
        return completionText;
    }

    if (!trimmedCompletion.toLowerCase().startsWith(trimmedLinePrefix.toLowerCase())) {
        return completionText;
    }

    const nextCharacter = trimmedCompletion[trimmedLinePrefix.length];
    if (nextCharacter && /[a-zA-Z0-9_]/.test(nextCharacter)) {
        return completionText;
    }

    const remainder = trimmedCompletion.slice(trimmedLinePrefix.length);
    return /\s$/.test(linePrefix) ? remainder.trimStart() : remainder;
}

function truncateAtInlineStop(text: string): string {
    const stopIndex = findInlineStopIndex(text);

    if (stopIndex < 0) {
        return text;
    }

    return text.slice(0, stopIndex).trimEnd();
}

function findInlineStopIndex(text: string): number {
    let inSingleQuotedString = false;
    let inDoubleQuotedString = false;
    let inBracketIdentifier = false;

    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];

        if (inSingleQuotedString) {
            if (current === "'" && next === "'") {
                index++;
                continue;
            }
            if (current === "'") {
                inSingleQuotedString = false;
            }
            continue;
        }

        if (inDoubleQuotedString) {
            if (current === '"' && next === '"') {
                index++;
                continue;
            }
            if (current === '"') {
                inDoubleQuotedString = false;
            }
            continue;
        }

        if (inBracketIdentifier) {
            if (current === "]" && next === "]") {
                index++;
                continue;
            }
            if (current === "]") {
                inBracketIdentifier = false;
            }
            continue;
        }

        if (current === "'") {
            inSingleQuotedString = true;
            continue;
        }
        if (current === '"') {
            inDoubleQuotedString = true;
            continue;
        }
        if (current === "[") {
            inBracketIdentifier = true;
            continue;
        }

        if (current === "\n" && next === "\n") {
            return index;
        }
        if (current === ";") {
            return index;
        }
        if (current === "-" && next === "-") {
            return index;
        }
        if (current === "/" && next === "*") {
            return index;
        }
    }

    return -1;
}

function stripTrailingStandaloneLineComment(text: string): string {
    const lines = text.split("\n");
    let lastNonEmptyLineIndex = lines.length - 1;
    while (lastNonEmptyLineIndex >= 0 && !lines[lastNonEmptyLineIndex].trim()) {
        lastNonEmptyLineIndex--;
    }

    if (lastNonEmptyLineIndex >= 0 && /^\s*--/.test(lines[lastNonEmptyLineIndex])) {
        return lines.slice(0, lastNonEmptyLineIndex).join("\n");
    }

    return text;
}

function isLikelyMetaResponseInsteadOfSql(text: string): boolean {
    const firstNonEmptyLine = text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);

    if (!firstNonEmptyLine) {
        return false;
    }

    return (
        metaResponseInsteadOfSqlPattern.test(firstNonEmptyLine) ||
        emptyStringInstructionEchoPattern.test(firstNonEmptyLine)
    );
}

type SchemaContextSelectionMetadata = NonNullable<
    SqlInlineCompletionSchemaContext["selectionMetadata"]
>;
type SchemaContextRoutine = NonNullable<SqlInlineCompletionSchemaContext["routines"]>[number];

export function formatSchemaContextForPrompt(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    inferredSystemQuery: boolean,
): string {
    if (!schemaContext) {
        return "-- unavailable";
    }

    const metadata = schemaContext.selectionMetadata;
    const inventoryChunkSize = metadata?.inventoryChunkSize ?? 8;
    const lines: string[] = [];
    lines.push(
        `-- connection: ${schemaContext.server ?? "unknown server"} / ${
            schemaContext.database ?? "unknown database"
        }, default schema ${schemaContext.defaultSchema ?? "dbo"}, engine: ${
            schemaContext.engineEditionName ?? "unknown"
        }`,
    );
    lines.push(
        `-- inferred system query: ${
            (schemaContext.inferredSystemQuery ?? inferredSystemQuery) ? "yes" : "no"
        }`,
    );

    if (metadata) {
        lines.push(`-- ${metadata.schemaSizeSummary}`);
        lines.push(
            `-- schema budget: profile ${metadata.budgetProfile}, size ${metadata.schemaSizeKind}, columns ${metadata.columnRepresentation}, max prompt chars ${metadata.maxPromptChars}`,
        );
        if (metadata.degradationSteps.length > 0) {
            lines.push(`-- schema compaction applied: ${metadata.degradationSteps.join(" -> ")}`);
        }
        if (metadata.schemaSizeKind === "outlier") {
            lines.push(
                "-- very large schema: only the most relevant names are shown. Be conservative and return an empty string when specific required columns or relationships are not shown.",
            );
        }
    }

    if (schemaContext.schemas.length > 0) {
        lines.push(`-- schemas (user): ${schemaContext.schemas.join(", ")}`);
    }

    const tableInventory = schemaContext.tableNameOnlyInventory ?? [];
    const viewInventory = schemaContext.viewNameOnlyInventory ?? [];
    const routineInventory = schemaContext.routineNameOnlyInventory ?? [];
    const routines = schemaContext.routines ?? [];
    const totalTableCount = Math.max(
        schemaContext.totalTableCount ?? schemaContext.tables.length + tableInventory.length,
        schemaContext.tables.length + tableInventory.length,
    );
    const totalViewCount = Math.max(
        schemaContext.totalViewCount ?? schemaContext.views.length + viewInventory.length,
        schemaContext.views.length + viewInventory.length,
    );
    const totalRoutineCount = Math.max(
        schemaContext.totalRoutineCount ?? routines.length + routineInventory.length,
        routines.length + routineInventory.length,
    );

    if (totalTableCount > schemaContext.tables.length) {
        lines.push(`-- user tables: detailed ${schemaContext.tables.length} of ${totalTableCount}`);
    }

    for (const table of schemaContext.tables) {
        lines.push(`TABLE ${table.name} (${formatColumnsForPrompt(table, metadata)})`);
    }

    if (tableInventory.length > 0) {
        const unlistedTableCount = Math.max(
            0,
            totalTableCount - schemaContext.tables.length - tableInventory.length,
        );
        lines.push(
            `-- additional tables listed without columns${
                unlistedTableCount > 0 ? ` (${unlistedTableCount} more omitted)` : ""
            }:`,
        );
        lines.push(
            ...formatQualifiedNameInventoryForPrompt(
                "TABLE NAMES",
                tableInventory,
                inventoryChunkSize,
            ),
        );
    }

    if (totalViewCount > schemaContext.views.length) {
        lines.push(`-- user views: detailed ${schemaContext.views.length} of ${totalViewCount}`);
    }

    for (const view of schemaContext.views) {
        lines.push(`VIEW ${view.name} (${formatColumnsForPrompt(view, metadata)})`);
    }

    if (viewInventory.length > 0) {
        const unlistedViewCount = Math.max(
            0,
            totalViewCount - schemaContext.views.length - viewInventory.length,
        );
        lines.push(
            `-- additional views listed without columns${
                unlistedViewCount > 0 ? ` (${unlistedViewCount} more omitted)` : ""
            }:`,
        );
        lines.push(
            ...formatQualifiedNameInventoryForPrompt(
                "VIEW NAMES",
                viewInventory,
                inventoryChunkSize,
            ),
        );
    }

    if (routines.length > 0) {
        if (totalRoutineCount > routines.length) {
            lines.push(`-- user routines: detailed ${routines.length} of ${totalRoutineCount}`);
        }
        for (const routine of routines) {
            lines.push(formatRoutineForPrompt(routine));
        }
    }

    if (routineInventory.length > 0) {
        const unlistedRoutineCount = Math.max(
            0,
            totalRoutineCount - routines.length - routineInventory.length,
        );
        lines.push(
            `-- additional routines listed without parameters${
                unlistedRoutineCount > 0 ? ` (${unlistedRoutineCount} more omitted)` : ""
            }:`,
        );
        lines.push(
            ...formatQualifiedNameInventoryForPrompt(
                "ROUTINE NAMES",
                routineInventory,
                inventoryChunkSize,
            ),
        );
    }

    if ((schemaContext.systemObjects ?? []).length > 0) {
        lines.push("-- system catalog / DMVs available:");
        for (const object of schemaContext.systemObjects ?? []) {
            lines.push(`${object.name} (${formatColumnsForPrompt(object, metadata)})`);
        }
    }

    if (schemaContext.masterSymbols.length > 0) {
        lines.push(`-- master symbols: ${schemaContext.masterSymbols.join(", ")}`);
    }

    return lines.join("\n");
}

function formatColumnsForPrompt(
    object: SqlInlineCompletionSchemaObject,
    metadata: SchemaContextSelectionMetadata | undefined,
): string {
    if (object.columns.length === 0) {
        return "columns unknown";
    }

    const representation = metadata?.columnRepresentation ?? "verbose";
    if (representation === "compact") {
        return formatColumnsCompactForPrompt(object);
    }

    const detailedColumns = object.columnDefinitions?.length
        ? object.columnDefinitions
        : object.columns;
    if (representation === "types") {
        return detailedColumns.map(stripColumnNullabilityForPrompt).join(", ");
    }

    return detailedColumns.map(sanitizePromptFragment).join(", ");
}

function formatColumnsCompactForPrompt(object: SqlInlineCompletionSchemaObject): string {
    const primaryKeys = new Set(
        (object.primaryKeyColumns ?? []).map((column) => column.toLowerCase()),
    );
    const foreignKeyByColumn = new Map<string, string>();
    for (const foreignKey of object.foreignKeys ?? []) {
        foreignKeyByColumn.set(
            foreignKey.column.toLowerCase(),
            `${foreignKey.referencedTable}.${foreignKey.referencedColumn}`,
        );
    }

    return object.columns
        .map((column) => {
            const annotations: string[] = [];
            if (primaryKeys.has(column.toLowerCase())) {
                annotations.push("PK");
            }
            const foreignKeyTarget = foreignKeyByColumn.get(column.toLowerCase());
            if (foreignKeyTarget) {
                annotations.push(`FK->${foreignKeyTarget}`);
            }
            return annotations.length > 0
                ? `${sanitizePromptFragment(column)} ${annotations.join(" ")}`
                : sanitizePromptFragment(column);
        })
        .join(", ");
}

function stripColumnNullabilityForPrompt(definition: string): string {
    return sanitizePromptFragment(definition)
        .replace(/\s+NOT\s+NULL\b/gi, "")
        .replace(/\s+NULL\b/gi, "")
        .replace(/\s+COLLATE\s+\S+/gi, "")
        .trim();
}

function formatRoutineForPrompt(routine: SchemaContextRoutine): string {
    const routineKind = getRoutineKindForPrompt(routine.type);
    const parameters = formatRoutineParametersForPrompt(routine);
    const returns = formatRoutineReturnForPrompt(routine);
    return `${routineKind} ${routine.name}(${parameters})${returns}`;
}

function getRoutineKindForPrompt(type: string | undefined): string {
    switch ((type ?? "").toUpperCase()) {
        case "P":
        case "PC":
            return "PROCEDURE";
        case "IF":
        case "TF":
        case "FT":
            return "TABLE FUNCTION";
        case "FN":
        case "FS":
            return "SCALAR FUNCTION";
        default:
            return "ROUTINE";
    }
}

function formatRoutineParametersForPrompt(routine: SchemaContextRoutine): string {
    const parameters = routine.parameters ?? [];
    if (parameters.length === 0) {
        return "";
    }

    return parameters
        .map((parameter) => {
            if (parameter.definition) {
                return sanitizePromptFragment(parameter.definition);
            }

            const parts = [sanitizePromptFragment(parameter.name)];
            if (parameter.direction?.toUpperCase() === "OUTPUT") {
                parts.push("OUTPUT");
            }
            return parts.join(" ");
        })
        .join(", ");
}

function formatRoutineReturnForPrompt(routine: SchemaContextRoutine): string {
    const returnColumns = routine.returnColumns ?? [];
    if (returnColumns.length > 0) {
        return ` RETURNS TABLE (${returnColumns.map(sanitizePromptFragment).join(", ")})`;
    }

    if (routine.returnType) {
        return ` RETURNS ${sanitizePromptFragment(routine.returnType)}`;
    }

    return "";
}

function formatQualifiedNameInventoryForPrompt(
    prefix: string,
    qualifiedNames: string[],
    chunkSize: number = 8,
): string[] {
    const namesBySchema = new Map<string, string[]>();
    for (const qualifiedName of qualifiedNames) {
        const [schemaName, objectName] = splitQualifiedName(qualifiedName);
        const key = schemaName ?? "";
        const existing = namesBySchema.get(key) ?? [];
        existing.push(objectName);
        namesBySchema.set(key, existing);
    }

    const lines: string[] = [];
    for (const [schemaName, objectNames] of namesBySchema) {
        for (const chunk of chunkStrings(objectNames, Math.max(1, chunkSize))) {
            if (schemaName) {
                lines.push(`${prefix} ${schemaName} (${chunk.join(", ")})`);
                continue;
            }

            lines.push(`${prefix} (${chunk.join(", ")})`);
        }
    }

    return lines;
}

function splitQualifiedName(qualifiedName: string): [string | undefined, string] {
    const separatorIndex = qualifiedName.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === qualifiedName.length - 1) {
        return [undefined, qualifiedName];
    }

    return [qualifiedName.slice(0, separatorIndex), qualifiedName.slice(separatorIndex + 1)];
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
    const chunks: string[][] = [];
    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }

    return chunks;
}

function sanitizePromptFragment(value: string): string {
    return value.replace(/[\r\n]+/g, " ").trim();
}

function inferSystemQuery(statementPrefix: string, linePrefix: string): boolean {
    return /\b(?:sys|INFORMATION_SCHEMA)\s*\./i.test(
        stripSqlCommentsAndStringLiterals(`${statementPrefix}\n${linePrefix}`),
    );
}

function stripSqlCommentsAndStringLiterals(text: string): string {
    let result = "";
    let inSingleQuotedString = false;
    let inDoubleQuotedString = false;
    let inBracketIdentifier = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];

        if (inLineComment) {
            if (current === "\n" || current === "\r") {
                inLineComment = false;
                result += current;
            } else {
                result += " ";
            }
            continue;
        }

        if (inBlockComment) {
            if (current === "*" && next === "/") {
                inBlockComment = false;
                result += "  ";
                index++;
            } else {
                result += current === "\n" || current === "\r" ? current : " ";
            }
            continue;
        }

        if (inSingleQuotedString) {
            if (current === "'" && next === "'") {
                result += "  ";
                index++;
                continue;
            }
            if (current === "'") {
                inSingleQuotedString = false;
            }
            result += current === "\n" || current === "\r" ? current : " ";
            continue;
        }

        if (inDoubleQuotedString) {
            if (current === '"' && next === '"') {
                result += "  ";
                index++;
                continue;
            }
            if (current === '"') {
                inDoubleQuotedString = false;
            }
            result += current === "\n" || current === "\r" ? current : " ";
            continue;
        }

        if (inBracketIdentifier) {
            if (current === "]" && next === "]") {
                result += "  ";
                index++;
                continue;
            }
            if (current === "]") {
                inBracketIdentifier = false;
            }
            result += current;
            continue;
        }

        if (current === "-" && next === "-") {
            inLineComment = true;
            result += "  ";
            index++;
            continue;
        }
        if (current === "/" && next === "*") {
            inBlockComment = true;
            result += "  ";
            index++;
            continue;
        }
        if (current === "'") {
            inSingleQuotedString = true;
            result += " ";
            continue;
        }
        if (current === '"') {
            inDoubleQuotedString = true;
            result += " ";
            continue;
        }
        if (current === "[") {
            inBracketIdentifier = true;
            result += current;
            continue;
        }

        result += current;
    }

    return result;
}

function withInferredSystemQuery(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    inferredSystemQuery: boolean,
): SqlInlineCompletionSchemaContext | undefined {
    if (!schemaContext) {
        return undefined;
    }

    return {
        ...schemaContext,
        inferredSystemQuery,
    };
}

function createInlineTelemetrySnapshot(
    schemaContext: SqlInlineCompletionSchemaContext | undefined,
    modelFamily: string | undefined,
    startedAt: number,
    triggerKind: vscode.InlineCompletionTriggerKind,
    inferredSystemQuery: boolean,
    intentMode: boolean,
): InlineCompletionTelemetrySnapshot {
    const usedSchemaContext = !!schemaContext;
    return {
        usedSchemaContext,
        fallbackWithoutMetadata: !usedSchemaContext,
        schemaObjectCount: (schemaContext?.tables.length ?? 0) + (schemaContext?.views.length ?? 0),
        schemaSystemObjectCount:
            (schemaContext?.systemObjects?.length ?? 0) +
            (schemaContext?.masterSymbols.length ?? 0),
        schemaForeignKeyCount: getForeignKeyCount(schemaContext),
        modelFamily: modelFamily ?? "unknown",
        triggerKind: getTriggerKindName(triggerKind),
        latencyMs: Date.now() - startedAt,
        inferredSystemQuery,
        completionCategory: getInlineCompletionCategory(intentMode),
        intentMode,
        schemaBudgetProfile: schemaContext?.selectionMetadata?.budgetProfile ?? "unknown",
        schemaSizeKind: schemaContext?.selectionMetadata?.schemaSizeKind ?? "unknown",
        schemaDegradationStepCount: schemaContext?.selectionMetadata?.degradationSteps.length ?? 0,
    };
}

function getForeignKeyCount(schemaContext: SqlInlineCompletionSchemaContext | undefined): number {
    return (schemaContext?.tables ?? []).reduce(
        (sum, table) => sum + (table.foreignKeys?.length ?? 0),
        0,
    );
}

function getTriggerKindName(
    triggerKind: vscode.InlineCompletionTriggerKind,
): "automatic" | "invoke" {
    return triggerKind === vscode.InlineCompletionTriggerKind.Automatic ? "automatic" : "invoke";
}

function getCountBucket(count: number): string {
    if (count === 0) {
        return "0";
    }

    if (count <= 5) {
        return "1-5";
    }

    if (count <= 10) {
        return "6-10";
    }

    if (count <= 20) {
        return "11-20";
    }

    return "20+";
}

type IntentCommentMatch = {
    commentText: string;
    postComment: string;
};

function findIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    return (
        findTrailingLineIntentComment(trimmedPrefix) ??
        findTrailingBlockIntentComment(trimmedPrefix)
    );
}

function findTrailingLineIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    if (!trimmedPrefix) {
        return undefined;
    }

    const lines = getTextLines(trimmedPrefix);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
        return undefined;
    }

    let postCommentStart = trimmedPrefix.length;
    if (isStatementInitiatingKeyword(lastLine.text.trim())) {
        postCommentStart = lastLine.start;
    } else if (!isLineCommentOnly(lastLine.text)) {
        return undefined;
    }

    let commentEndLineIndex = lines.length - 1;
    if (postCommentStart !== trimmedPrefix.length) {
        commentEndLineIndex = findLastNonEmptyLineBefore(lines, lastLine.start);
        if (commentEndLineIndex < 0) {
            return undefined;
        }
    }

    if (!isLineCommentOnly(lines[commentEndLineIndex].text)) {
        return undefined;
    }

    let commentStartLineIndex = commentEndLineIndex;
    while (commentStartLineIndex > 0 && isLineCommentOnly(lines[commentStartLineIndex - 1].text)) {
        commentStartLineIndex--;
    }

    const commentEnd = lines[commentEndLineIndex].end;
    const commentText = lines
        .slice(commentStartLineIndex, commentEndLineIndex + 1)
        .map((line) => line.text.replace(/^\s*--\s?/, "").trim())
        .join(" ")
        .trim();

    if (!commentText) {
        return undefined;
    }

    return {
        commentText,
        postComment: trimmedPrefix.slice(commentEnd),
    };
}

function findTrailingBlockIntentComment(trimmedPrefix: string): IntentCommentMatch | undefined {
    if (!trimmedPrefix) {
        return undefined;
    }

    const lines = getTextLines(trimmedPrefix);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
        return undefined;
    }

    let postCommentStart = trimmedPrefix.length;
    if (isStatementInitiatingKeyword(lastLine.text.trim())) {
        postCommentStart = lastLine.start;
    }

    const prefixBeforePostComment = trimmedPrefix.slice(0, postCommentStart);
    const commentCandidate = prefixBeforePostComment.trimEnd();
    if (!commentCandidate.endsWith("*/")) {
        return undefined;
    }

    const commentStart = findMatchingBlockCommentStart(commentCandidate);
    if (commentStart === undefined) {
        return undefined;
    }

    const commentText = commentCandidate
        .slice(commentStart + 2, commentCandidate.length - 2)
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
        .join(" ")
        .trim();

    if (!commentText) {
        return undefined;
    }

    return {
        commentText,
        postComment: trimmedPrefix.slice(commentCandidate.length),
    };
}

function findMatchingBlockCommentStart(text: string): number | undefined {
    const blockCommentStarts: number[] = [];

    for (let i = 0; i < text.length - 1; i++) {
        if (text[i] === "/" && text[i + 1] === "*") {
            blockCommentStarts.push(i);
            i++;
            continue;
        }

        if (text[i] === "*" && text[i + 1] === "/") {
            const start = blockCommentStarts.pop();
            if (start === undefined) {
                return undefined;
            }

            if (i + 2 === text.length) {
                return start;
            }

            i++;
        }
    }

    return undefined;
}

function matchesIntentPostComment(postComment: string): boolean {
    return !postComment.trim() || statementInitiatingPostCommentPattern.test(postComment);
}

function matchesIntentLinePrefix(linePrefix: string): boolean {
    const trimmedLinePrefix = linePrefix.trim();
    return (
        !trimmedLinePrefix ||
        isStatementInitiatingKeyword(trimmedLinePrefix) ||
        /^\s*--/.test(linePrefix) ||
        trimmedLinePrefix.includes("*/")
    );
}

function isStatementInitiatingKeyword(text: string): boolean {
    return statementInitiatingKeywordPattern.test(text);
}

function isLineCommentOnly(text: string): boolean {
    return /^\s*--/.test(text);
}

function getTextLines(text: string): { text: string; start: number; end: number }[] {
    const result: { text: string; start: number; end: number }[] = [];
    const linePattern = /.*(?:\r?\n|$)/g;
    let match: RegExpExecArray | null;

    while ((match = linePattern.exec(text)) !== null) {
        const rawLine = match[0];
        if (!rawLine && match.index === text.length) {
            break;
        }

        const line = rawLine.replace(/\r?\n$/, "");
        result.push({
            text: line,
            start: match.index,
            end: match.index + line.length,
        });

        if (!rawLine) {
            break;
        }
    }

    return result;
}

function findLastNonEmptyLineBefore(
    lines: { text: string; start: number; end: number }[],
    beforeOffset: number,
): number {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].start >= beforeOffset) {
            continue;
        }

        if (lines[i].text.trim()) {
            return i;
        }
    }

    return -1;
}
