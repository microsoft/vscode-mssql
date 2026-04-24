/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import * as Constants from "../../constants/constants";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import { logger2 } from "../../models/logger2";
import { getErrorMessage } from "../../utils/utils";
import {
    automaticTriggerDebounceMs,
    buildCompletionRules,
    buildInlineCompletionPromptMessages,
    collectText,
    continuationModeMaxTokens,
    createLanguageModelMaxTokenOptions,
    fixLeadingWhitespace,
    getEffectiveMaxCompletionChars,
    intentModeMaxTokens,
    resolveInlineCompletionRules,
    sanitizeInlineCompletionText,
    selectPreferredModel,
    suppressDocumentSuffixOverlap,
} from "../sqlInlineCompletionProvider";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugExportData,
    InlineCompletionDebugModelOption,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers,
} from "../../sharedInterfaces/inlineCompletionDebug";

export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPrompt";
export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";
const DEFAULT_CUSTOM_PROMPT = buildCompletionRules(false, false);

export class InlineCompletionDebugController extends WebviewPanelController<
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers
> {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private _availableModels: InlineCompletionDebugModelOption[] = [];
    private _effectiveDefaultModelFamily: string | undefined;
    private _savedCustomPromptValue: string | null;
    private _customPromptLastSavedAt: number | undefined;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ) {
        const savedCustomPrompt =
            _extensionContext.workspaceState.get<string | null>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
                null,
            ) ?? null;
        const savedCustomPromptAt =
            _extensionContext.workspaceState.get<number | undefined>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
                undefined,
            ) ?? undefined;

        super(
            _extensionContext,
            vscodeWrapper,
            "inlineCompletionDebug",
            "inlineCompletionDebug",
            createState({
                availableModels: [],
                effectiveDefaultModelFamily: undefined,
                selectedEventId: undefined,
                customPromptDialogOpen: false,
                customPromptValue: savedCustomPrompt,
                customPromptLastSavedAt: savedCustomPromptAt,
            }),
            {
                title: "Copilot Completion Debug",
                viewColumn: vscode.ViewColumn.Active,
                showRestorePromptAfterClose: false,
            },
        );

        this._savedCustomPromptValue = savedCustomPrompt;
        this._customPromptLastSavedAt = savedCustomPromptAt;
        inlineCompletionDebugStore.setPanelOpen(true);
        this.registerDisposables();
        this.registerReducers();
        void this.refreshAvailableModels();
    }

    public override dispose(): void {
        inlineCompletionDebugStore.setPanelOpen(false);
        super.dispose();
    }

    private registerDisposables(): void {
        this.registerDisposable(
            inlineCompletionDebugStore.onDidChange(() => {
                if (!this.isDisposed) {
                    this.updateState(this.createState());
                }
            }),
        );
        this.registerDisposable(
            vscode.lm.onDidChangeChatModels(() => {
                void this.refreshAvailableModels();
            }),
        );
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsUseSchemaContext)
                ) {
                    this.updateState(this.createState());
                }
                if (e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily)) {
                    this._effectiveDefaultModelFamily = getEffectiveDefaultModelFamily(
                        this._availableModels,
                        getConfiguredModelFamily(),
                    );
                    this.updateState(this.createState());
                    void this.refreshAvailableModels();
                }
            }),
        );
    }

    private registerReducers(): void {
        this.registerReducer("clearEvents", (state) => {
            inlineCompletionDebugStore.clearEvents();
            return this.createState({
                selectedEventId: undefined,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("selectEvent", (state, payload) => {
            return this.createState({
                selectedEventId: payload.eventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("updateOverrides", (state, payload) => {
            inlineCompletionDebugStore.updateOverrides(payload.overrides);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("setRecordWhenClosed", async (state, payload) => {
            await vscode.workspace
                .getConfiguration()
                .update(
                    Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    payload.enabled,
                    getConfigurationTarget(),
                );
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("openCustomPromptDialog", (state) => {
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: true,
            });
        });

        this.registerReducer("closeCustomPromptDialog", (state) => {
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: false,
            });
        });

        this.registerReducer("saveCustomPrompt", async (state, payload) => {
            const value = payload.value.length > 0 ? payload.value : null;
            const savedAt = value ? Date.now() : undefined;
            await this.persistCustomPrompt(value, savedAt);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: false,
            });
        });

        this.registerReducer("resetCustomPrompt", async (state) => {
            await this.persistCustomPrompt(null, undefined);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("exportSession", async (state) => {
            await this.exportSession();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("importSession", async (state) => {
            await this.importSession();
            return this.createState({
                selectedEventId: undefined,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("copyEventPayload", async (state, payload) => {
            await this.copyEventPayload(payload.eventId, payload.kind);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("replayEvent", async (state, payload) => {
            await this.replayEvent(payload.eventId);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });
    }

    private createState(
        overrides?: Partial<{
            selectedEventId: string | undefined;
            customPromptDialogOpen: boolean;
            customPromptValue: string | null;
            customPromptLastSavedAt: number | undefined;
        }>,
    ): InlineCompletionDebugWebviewState {
        const customPromptValue = overrides?.customPromptValue ?? this._savedCustomPromptValue;
        const customPromptLastSavedAt =
            overrides?.customPromptLastSavedAt ?? this._customPromptLastSavedAt;
        return createState({
            availableModels: this._availableModels,
            effectiveDefaultModelFamily: this._effectiveDefaultModelFamily,
            selectedEventId: overrides?.selectedEventId ?? this.state?.selectedEventId,
            customPromptDialogOpen:
                overrides?.customPromptDialogOpen ?? this.state?.customPrompt.dialogOpen ?? false,
            customPromptValue,
            customPromptLastSavedAt,
        });
    }

    private async refreshAvailableModels(): Promise<void> {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
            this._effectiveDefaultModelFamily = getEffectiveDefaultModelFamily(
                models,
                getConfiguredModelFamily(),
            );
            const byFamily = new Map<string, InlineCompletionDebugModelOption>();
            for (const model of models) {
                if (!byFamily.has(model.family)) {
                    byFamily.set(model.family, {
                        id: model.id,
                        name: model.name,
                        family: model.family,
                        vendor: model.vendor,
                        version: model.version,
                    });
                }
            }

            this._availableModels = Array.from(byFamily.values()).sort((left, right) =>
                left.family.localeCompare(right.family, undefined, {
                    sensitivity: "base",
                    numeric: true,
                }),
            );
            if (!this.isDisposed) {
                this.updateState(this.createState());
            }
        } catch (error) {
            this._logger.warn(
                `Failed to refresh inline completion debug models: ${getErrorMessage(error)}`,
            );
        }
    }

    private async persistCustomPrompt(
        value: string | null,
        savedAt: number | undefined,
    ): Promise<void> {
        this._savedCustomPromptValue = value;
        this._customPromptLastSavedAt = savedAt;
        await this._extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
            value,
        );
        await this._extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
            savedAt,
        );
        inlineCompletionDebugStore.updateOverrides({ customSystemPrompt: value });
    }

    private async exportSession(): Promise<void> {
        const defaultFileName = `inline-completion-debug-${Date.now()}.json`;
        const defaultFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri ?? this._extensionContext.globalStorageUri;
        const fileUri = await vscode.window.showSaveDialog({
            title: "Export Inline Completion Debug Session",
            filters: {
                JSON: ["json"],
            },
            defaultUri: vscode.Uri.joinPath(defaultFolder, defaultFileName),
        });

        if (!fileUri) {
            return;
        }

        const exportData = inlineCompletionDebugStore.exportSession(
            getRecordWhenClosedSetting(),
            this._customPromptLastSavedAt,
        );
        await vscode.workspace.fs.writeFile(
            fileUri,
            new TextEncoder().encode(JSON.stringify(exportData, undefined, 2)),
        );
    }

    private async importSession(): Promise<void> {
        const fileUris = await vscode.window.showOpenDialog({
            title: "Import Inline Completion Debug Session",
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                JSON: ["json"],
            },
        });

        const fileUri = fileUris?.[0];
        if (!fileUri) {
            return;
        }

        const fileContents = await vscode.workspace.fs.readFile(fileUri);
        const parsed = JSON.parse(
            new TextDecoder().decode(fileContents),
        ) as InlineCompletionDebugExportData;
        inlineCompletionDebugStore.importSession(parsed);
        await vscode.workspace
            .getConfiguration()
            .update(
                Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                parsed.recordWhenClosed ?? false,
                getConfigurationTarget(),
            );
        await this.persistCustomPrompt(
            parsed.overrides?.customSystemPrompt ?? null,
            parsed.customPromptLastSavedAt,
        );
    }

    private async copyEventPayload(
        eventId: string,
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse",
    ): Promise<void> {
        const event = inlineCompletionDebugStore.getEvent(eventId);
        if (!event) {
            return;
        }

        let text = "";
        switch (kind) {
            case "id":
                text = event.id;
                break;
            case "json":
                text = JSON.stringify(event, undefined, 2);
                break;
            case "prompt":
                text = event.promptMessages
                    .map((message, index) => `#${index + 1} ${message.role}\n${message.content}`)
                    .join("\n\n");
                break;
            case "systemPrompt":
                text = event.promptMessages[0]?.content ?? "";
                break;
            case "userPrompt":
                text = event.promptMessages[1]?.content ?? "";
                break;
            case "rawResponse":
                text = event.rawResponse;
                break;
            case "sanitizedResponse":
                text = event.sanitizedResponse ?? event.finalCompletionText ?? "";
                break;
        }

        await vscode.env.clipboard.writeText(text);
    }

    private async replayEvent(eventId: string): Promise<void> {
        const sourceEvent = inlineCompletionDebugStore.getEvent(eventId);
        if (!sourceEvent) {
            return;
        }

        const overrides = inlineCompletionDebugStore.getOverrides();
        const selectedModel = await this.selectReplayModel(overrides.modelFamily);
        if (!selectedModel) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                result: "noModel",
                latencyMs: 0,
                modelFamily: undefined,
                modelId: undefined,
                modelVendor: undefined,
                usedSchemaContext: false,
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: sourceEvent.promptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted: sourceEvent.schemaContextFormatted,
                locals: {
                    ...sourceEvent.locals,
                    replaySourceEventId: sourceEvent.id,
                },
            });
            return;
        }

        const canSendRequest =
            this._extensionContext.languageModelAccessInformation?.canSendRequest(selectedModel);
        if (canSendRequest === false) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                result: "noPermission",
                latencyMs: 0,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                usedSchemaContext: false,
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: sourceEvent.promptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted: sourceEvent.schemaContextFormatted,
                locals: {
                    ...sourceEvent.locals,
                    replaySourceEventId: sourceEvent.id,
                },
            });
            return;
        }

        const linePrefix = asString(sourceEvent.locals.linePrefix);
        const lineSuffix = asString(sourceEvent.locals.lineSuffix);
        const recentPrefix = asString(sourceEvent.locals.recentPrefix);
        const statementPrefix = asString(sourceEvent.locals.statementPrefix);
        const suffix = asString(sourceEvent.locals.suffix);
        const intentMode = overrides.forceIntentMode ?? sourceEvent.intentMode;
        const useSchemaContext = overrides.useSchemaContext ?? getConfiguredUseSchemaContext();
        const schemaContextText =
            useSchemaContext && sourceEvent.schemaContextFormatted
                ? sourceEvent.schemaContextFormatted
                : "-- unavailable";
        const rulesText = resolveInlineCompletionRules({
            customSystemPrompt: overrides.customSystemPrompt,
            inferredSystemQuery: sourceEvent.inferredSystemQuery,
            intentMode,
            schemaContextText,
            linePrefix,
            recentPrefix,
            statementPrefix,
        });
        const promptMessages = buildInlineCompletionPromptMessages({
            rulesText,
            intentMode,
            recentPrefix,
            statementPrefix,
            suffix,
            linePrefix,
            lineSuffix,
            schemaContextText,
        });
        const maxTokens =
            overrides.maxTokens ?? (intentMode ? intentModeMaxTokens : continuationModeMaxTokens);
        const startedAt = Date.now();
        const cancellationTokenSource = new vscode.CancellationTokenSource();

        try {
            const response = await selectedModel.sendRequest(
                promptMessages,
                {
                    justification:
                        "MSSQL inline SQL completion debug replay compares the same prompt against different overrides.",
                    modelOptions: createLanguageModelMaxTokenOptions(maxTokens),
                },
                cancellationTokenSource.token,
            );
            const rawResponse = await collectText(response, cancellationTokenSource.token);
            const sanitizedResponse = sanitizeInlineCompletionText(
                rawResponse,
                getEffectiveMaxCompletionChars(intentMode ? 2000 : 400, overrides.maxTokens),
                linePrefix,
                intentMode,
            );
            let finalCompletionText = fixLeadingWhitespace(
                sanitizedResponse,
                linePrefix,
                undefined,
            );
            finalCompletionText = suppressDocumentSuffixOverlap(finalCompletionText, suffix);
            const result = !sanitizedResponse
                ? rawResponse.trim()
                    ? "emptyFromSanitizer"
                    : "emptyFromModel"
                : finalCompletionText
                  ? "success"
                  : "emptyFromSanitizer";

            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result,
                latencyMs: Date.now() - startedAt,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaObjectCount
                        : 0,
                schemaSystemObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaSystemObjectCount
                        : 0,
                schemaForeignKeyCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaForeignKeyCount
                        : 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map((message) => ({
                    role:
                        message.role === vscode.LanguageModelChatMessageRole.Assistant
                            ? "assistant"
                            : "user",
                    content: message.content
                        .map((part) =>
                            part instanceof vscode.LanguageModelTextPart ? part.value : "",
                        )
                        .join(""),
                })),
                rawResponse,
                sanitizedResponse,
                finalCompletionText,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                locals: {
                    ...sourceEvent.locals,
                    intentMode,
                    useSchemaContext,
                    effectiveMaxTokens: maxTokens,
                    replaySourceEventId: sourceEvent.id,
                    replayedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result: "error",
                latencyMs: Date.now() - startedAt,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaObjectCount
                        : 0,
                schemaSystemObjectCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaSystemObjectCount
                        : 0,
                schemaForeignKeyCount:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? sourceEvent.schemaForeignKeyCount
                        : 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map((message) => ({
                    role:
                        message.role === vscode.LanguageModelChatMessageRole.Assistant
                            ? "assistant"
                            : "user",
                    content: message.content
                        .map((part) =>
                            part instanceof vscode.LanguageModelTextPart ? part.value : "",
                        )
                        .join(""),
                })),
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                locals: {
                    ...sourceEvent.locals,
                    intentMode,
                    useSchemaContext,
                    effectiveMaxTokens: maxTokens,
                    replaySourceEventId: sourceEvent.id,
                    replayedAt: new Date().toISOString(),
                },
                error: {
                    message: getErrorMessage(error),
                    ...(error instanceof Error && error.name ? { name: error.name } : {}),
                    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                },
            });
        } finally {
            cancellationTokenSource.dispose();
        }
    }

    private async selectReplayModel(
        modelFamilyOverride: string | null,
    ): Promise<vscode.LanguageModelChat | undefined> {
        const configuredFamily = getConfiguredModelFamily();
        const effectiveFamily = modelFamilyOverride ?? configuredFamily;

        if (effectiveFamily) {
            const exact = await vscode.lm.selectChatModels({
                vendor: "copilot",
                family: effectiveFamily,
            });
            if (exact.length > 0) {
                return exact[0];
            }
        }

        return selectPreferredModel(await vscode.lm.selectChatModels({ vendor: "copilot" }));
    }
}

function createState(options: {
    availableModels: InlineCompletionDebugModelOption[];
    effectiveDefaultModelFamily: string | undefined;
    selectedEventId: string | undefined;
    customPromptDialogOpen: boolean;
    customPromptValue: string | null;
    customPromptLastSavedAt: number | undefined;
}): InlineCompletionDebugWebviewState {
    const configuredModelFamily = getConfiguredModelFamily();
    return {
        events: inlineCompletionDebugStore.getEvents(),
        overrides: inlineCompletionDebugStore.getOverrides(),
        defaults: {
            configuredModelFamily,
            effectiveModelFamily:
                options.effectiveDefaultModelFamily ??
                getEffectiveDefaultModelFamily(options.availableModels, configuredModelFamily),
            useSchemaContext: getConfiguredUseSchemaContext(),
            debounceMs: automaticTriggerDebounceMs,
            continuationMaxTokens: continuationModeMaxTokens,
            intentMaxTokens: intentModeMaxTokens,
            allowAutomaticTriggers: true,
        },
        availableModels: options.availableModels,
        selectedEventId: options.selectedEventId,
        recordWhenClosed: getRecordWhenClosedSetting(),
        customPrompt: {
            dialogOpen: options.customPromptDialogOpen,
            savedValue: options.customPromptValue,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
            lastSavedAt: options.customPromptLastSavedAt,
        },
    };
}

function getEffectiveDefaultModelFamily<T extends { family: string }>(
    availableModels: T[],
    configuredModelFamily: string | undefined,
): string | undefined {
    if (
        configuredModelFamily &&
        availableModels.some((model) => model.family === configuredModelFamily)
    ) {
        return configuredModelFamily;
    }

    return selectPreferredModel(availableModels)?.family ?? configuredModelFamily;
}

function getConfiguredModelFamily(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
            ?.trim() || undefined
    );
}

function getConfiguredUseSchemaContext(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ?? false
    );
}

function getRecordWhenClosedSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsDebugRecordWhenClosed, false) ??
        false
    );
}

function getConfigurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function cloneBaseEvent(event: InlineCompletionDebugEvent): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: event.timestamp,
        documentUri: event.documentUri,
        documentFileName: event.documentFileName,
        line: event.line,
        column: event.column,
        triggerKind: "invoke",
        explicitFromUser: true,
        intentMode: event.intentMode,
        inferredSystemQuery: event.inferredSystemQuery,
        modelFamily: event.modelFamily,
        modelId: event.modelId,
        modelVendor: event.modelVendor,
        result: event.result,
        latencyMs: event.latencyMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        schemaObjectCount: event.schemaObjectCount,
        schemaSystemObjectCount: event.schemaSystemObjectCount,
        schemaForeignKeyCount: event.schemaForeignKeyCount,
        usedSchemaContext: event.usedSchemaContext,
        overridesApplied: event.overridesApplied,
        promptMessages: event.promptMessages,
        rawResponse: event.rawResponse,
        sanitizedResponse: event.sanitizedResponse,
        finalCompletionText: event.finalCompletionText,
        schemaContextFormatted: event.schemaContextFormatted,
        locals: event.locals,
        error: event.error,
    };
}

function getOverridesApplied(overrides: InlineCompletionDebugOverrides) {
    return {
        ...(overrides.modelFamily ? { modelFamily: overrides.modelFamily } : {}),
        ...(overrides.useSchemaContext !== null
            ? { useSchemaContext: overrides.useSchemaContext }
            : {}),
        ...(overrides.debounceMs !== null ? { debounceMs: overrides.debounceMs } : {}),
        ...(overrides.maxTokens !== null ? { maxTokens: overrides.maxTokens } : {}),
        customSystemPromptUsed: !!overrides.customSystemPrompt,
    };
}
