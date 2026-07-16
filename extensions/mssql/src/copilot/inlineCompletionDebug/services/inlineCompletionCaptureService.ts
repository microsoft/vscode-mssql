/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Live/config domain service for Inline Completion Debug (final plan WI-1.1,
 * addendum §6.1): available-model catalog refresh (with the
 * vscode.lm.onDidChangeChatModels subscription), effective default model
 * resolution, profile materialization for the session-override surface,
 * custom-prompt persistence (workspace mementos), and the record-when-closed
 * setting write.
 *
 * One instance per viewer host (standalone panel / Debug Console page); the
 * singleton inlineCompletionDebugStore remains the shared live-event and
 * overrides truth across viewers. Both adapters call this exact
 * implementation — no reducer business body is forked anywhere.
 */

import * as vscode from "vscode";
import * as Constants from "../../../constants/constants";
import { logger2 } from "../../../models/logger2";
import { getErrorMessage } from "../../../utils/utils";
import {
    normalizeInlineCompletionCategories,
    selectPreferredModel,
} from "../../sqlInlineCompletionProvider";
import { selectConfiguredLanguageModels } from "../../languageModelSelection";
import {
    formatModelDisplayName,
    formatModelSelector,
    formatProviderLabel,
} from "../../languageModels/shared/modelDisplay";
import {
    createInlineCompletionDebugPresetOverrides,
    getInlineCompletionDebugPresetProfile,
    getInlineCompletionModelPreferenceForCategory,
    getInlineCompletionPresetProfileId,
    inlineCompletionConfiguredDefaultProfileId,
    inlineCompletionDebugCustomProfileId,
    InlineCompletionModelPreference,
} from "../inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "../inlineCompletionDebugStore";
import {
    InlineCompletionCategory,
    InlineCompletionDebugModelOption,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugSchemaContextOverrides,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import {
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
    isRecord,
} from "./inlineCompletionDebugConstants";
import { InlineCompletionDebugHostServices } from "./inlineCompletionDebugHostServices";

export interface InlineCompletionCaptureServiceDeps {
    extensionContext: vscode.ExtensionContext;
    hostServices: InlineCompletionDebugHostServices;
}

export class InlineCompletionCaptureService {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
    private readonly _modelSubscription: vscode.Disposable;
    private _availableModels: InlineCompletionDebugModelOption[] = [];
    private _effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    private _savedCustomPromptValue: string | null;
    private _customPromptLastSavedAt: number | undefined;
    private _disposed = false;

    /** Fires when the model catalog or effective default model changed. */
    public readonly onDidChange = this._onDidChangeEmitter.event;

    constructor(private readonly _deps: InlineCompletionCaptureServiceDeps) {
        this._savedCustomPromptValue =
            _deps.extensionContext.workspaceState.get<string | null>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
                null,
            ) ?? null;
        this._customPromptLastSavedAt =
            _deps.extensionContext.workspaceState.get<number | undefined>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
                undefined,
            ) ?? undefined;
        this._modelSubscription = vscode.lm.onDidChangeChatModels(() => {
            void this.refreshAvailableModels();
        });
        void this.refreshAvailableModels();
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._modelSubscription.dispose();
        this._onDidChangeEmitter.dispose();
    }

    public get availableModels(): InlineCompletionDebugModelOption[] {
        return this._availableModels;
    }

    public get effectiveDefaultModelOption(): InlineCompletionDebugModelOption | undefined {
        return this._effectiveDefaultModelOption;
    }

    public get savedCustomPromptValue(): string | null {
        return this._savedCustomPromptValue;
    }

    public get customPromptLastSavedAt(): number | undefined {
        return this._customPromptLastSavedAt;
    }

    public async refreshAvailableModels(): Promise<void> {
        try {
            const models = await selectConfiguredLanguageModels();
            const byModel = new Map<string, InlineCompletionDebugModelOption>();
            for (const model of models) {
                const selector = formatModelSelector(model);
                if (!byModel.has(selector)) {
                    byModel.set(selector, {
                        selector,
                        label: formatModelDisplayName(model),
                        providerLabel: formatProviderLabel(model.vendor),
                        id: model.id,
                        name: model.name,
                        family: model.family,
                        vendor: model.vendor,
                        version: model.version,
                    });
                }
            }

            this._availableModels = Array.from(byModel.values()).sort(compareModelOptions);
            this._effectiveDefaultModelOption = pickDefaultModelOption(
                this._availableModels,
                getConfiguredModelSelector(),
            );
            this.fireChanged();
        } catch (error) {
            this._logger.warn(
                `Failed to refresh inline completion debug models: ${getErrorMessage(error)}`,
            );
        }
    }

    /**
     * Model-selection settings changed: re-pick the effective default from
     * the current catalog immediately, then refresh the catalog itself.
     */
    public refreshEffectiveDefaultModel(): void {
        this._effectiveDefaultModelOption = pickDefaultModelOption(
            this._availableModels,
            getConfiguredModelSelector(),
        );
        this.fireChanged();
        void this.refreshAvailableModels();
    }

    /**
     * When the effective profile is a preset and the update touches a
     * profile-owned dimension, materialize the preset into concrete override
     * values and switch to the Custom profile so the user's edit sticks.
     */
    public prepareUserOverrideUpdate(
        update: Partial<InlineCompletionDebugOverrides>,
    ): Partial<InlineCompletionDebugOverrides> {
        const current = getEffectiveOverridesWithConfiguredProfile(
            inlineCompletionDebugStore.getOverrides(),
        );
        if (!this.shouldSwitchProfileToCustom(current, update)) {
            return update;
        }

        return {
            ...this.materializeProfileOverrides(current),
            ...update,
            profileId: inlineCompletionDebugCustomProfileId,
        };
    }

    public createProfileUpdate(
        profileId: InlineCompletionDebugProfileId,
    ): Partial<InlineCompletionDebugOverrides> {
        if (profileId === inlineCompletionDebugCustomProfileId) {
            return this.materializeProfileOverrides(
                getEffectiveOverridesWithConfiguredProfile(
                    inlineCompletionDebugStore.getOverrides(),
                ),
            );
        }

        return createInlineCompletionDebugPresetOverrides(profileId);
    }

    /** Dialog save: empty text clears the saved prompt. */
    public async saveCustomPrompt(rawValue: string): Promise<void> {
        const value = rawValue.length > 0 ? rawValue : null;
        const savedAt = value ? Date.now() : undefined;
        await this.persistCustomPrompt(value, savedAt, true);
    }

    public async resetCustomPrompt(): Promise<void> {
        await this.persistCustomPrompt(null, undefined, false);
    }

    public async persistCustomPrompt(
        value: string | null,
        savedAt: number | undefined,
        markProfileCustom: boolean,
    ): Promise<void> {
        this._savedCustomPromptValue = value;
        this._customPromptLastSavedAt = savedAt;
        await this._deps.extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
            value,
        );
        await this._deps.extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
            savedAt,
        );
        inlineCompletionDebugStore.updateOverrides(
            markProfileCustom
                ? this.prepareUserOverrideUpdate({ customSystemPrompt: value })
                : { customSystemPrompt: value },
        );
    }

    public async setRecordWhenClosed(enabled: boolean): Promise<void> {
        await this._deps.hostServices.updateConfiguration(
            Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
            enabled,
        );
    }

    private shouldSwitchProfileToCustom(
        current: InlineCompletionDebugOverrides,
        update: Partial<InlineCompletionDebugOverrides>,
    ): boolean {
        if (!getInlineCompletionDebugPresetProfile(current.profileId)) {
            return false;
        }

        return (
            Object.prototype.hasOwnProperty.call(update, "modelSelector") ||
            Object.prototype.hasOwnProperty.call(update, "continuationModelSelector") ||
            Object.prototype.hasOwnProperty.call(update, "forceIntentMode") ||
            Object.prototype.hasOwnProperty.call(update, "useSchemaContext") ||
            Object.prototype.hasOwnProperty.call(update, "includeSqlDiagnostics") ||
            Object.prototype.hasOwnProperty.call(update, "enabledCategories") ||
            Object.prototype.hasOwnProperty.call(update, "debounceMs") ||
            Object.prototype.hasOwnProperty.call(update, "maxTokens") ||
            Object.prototype.hasOwnProperty.call(update, "customSystemPrompt") ||
            Object.prototype.hasOwnProperty.call(update, "schemaContext")
        );
    }

    private materializeProfileOverrides(
        current: InlineCompletionDebugOverrides,
    ): Partial<InlineCompletionDebugOverrides> {
        const profile = getInlineCompletionDebugPresetProfile(current.profileId);
        if (!profile) {
            return {
                profileId: inlineCompletionDebugCustomProfileId,
            };
        }

        const modelOption = pickDefaultModelOption(
            this._availableModels,
            getConfiguredModelSelector(),
            profile.modelPreference,
        );
        const configuredContinuationModelSelector = getConfiguredContinuationModelSelector();
        const continuationModelPreference = getInlineCompletionModelPreferenceForCategory(
            profile,
            "continuation",
        );
        const continuationModelOption = configuredContinuationModelSelector
            ? pickConfiguredModelOption(
                  this._availableModels,
                  configuredContinuationModelSelector,
                  continuationModelPreference,
              )
            : pickDefaultModelOption(this._availableModels, undefined, continuationModelPreference);

        return {
            profileId: inlineCompletionDebugCustomProfileId,
            modelSelector: current.modelSelector ?? modelOption?.selector ?? null,
            continuationModelSelector:
                current.continuationModelSelector ?? continuationModelOption?.selector ?? null,
            forceIntentMode: current.forceIntentMode ?? profile.forceIntentMode,
            useSchemaContext:
                current.useSchemaContext ??
                profile.useSchemaContext ??
                getConfiguredUseSchemaContext(),
            includeSqlDiagnostics:
                current.includeSqlDiagnostics ?? getConfiguredIncludeSqlDiagnostics(),
            enabledCategories: current.enabledCategories ?? [...profile.enabledCategories],
            debounceMs: current.debounceMs ?? profile.debounceMs,
            maxTokens: current.maxTokens ?? profile.maxTokens,
            schemaContext: current.schemaContext ?? profile.schemaContext,
        };
    }

    private fireChanged(): void {
        if (!this._disposed) {
            this._onDidChangeEmitter.fire();
        }
    }
}

/**
 * Configuration watch shared by both adapters — encodes the completions
 * settings groupings exactly once. Adapters decide what each signal drives
 * (the standalone panel additionally rescans the trace folder; the console
 * only resets its sessions read model).
 */
export function watchCompletionsDebugConfiguration(handlers: {
    /** Any setting that feeds projected webview state changed. */
    onStateAffectingChange(): void;
    /** Model-selection settings changed (effective default must be re-picked). */
    onModelConfigurationChange(): void;
    /** The trace-folder setting changed (sessions domain must re-resolve). */
    onTraceFolderChange(): void;
}): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(Constants.configCopilotInlineCompletionsTraceFolder)) {
            handlers.onTraceFolderChange();
        }
        if (
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsDebugRecordWhenClosed) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsTraceCaptureEnabled) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsProfile) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsUseSchemaContext) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsSchemaContext) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsTraceFolder)
        ) {
            handlers.onStateAffectingChange();
        }
        if (
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsProfile) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily) ||
            e.affectsConfiguration(
                Constants.configCopilotInlineCompletionsContinuationModelFamily,
            ) ||
            e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelVendors)
        ) {
            handlers.onModelConfigurationChange();
        }
    });
}

// --- Effective-model resolution + configured-selector getters ---------------

export function pickDefaultModelOption(
    availableModels: InlineCompletionDebugModelOption[],
    configuredSelector: string | undefined,
    modelPreference?: InlineCompletionModelPreference,
): InlineCompletionDebugModelOption | undefined {
    if (!modelPreference && configuredSelector) {
        const trimmed = configuredSelector.trim();
        const matched =
            availableModels.find((model) => model.selector === trimmed) ??
            availableModels.find((model) => model.family === trimmed);
        if (matched) {
            return matched;
        }
    }

    return selectPreferredModel(availableModels, modelPreference);
}

export function pickConfiguredModelOption(
    availableModels: InlineCompletionDebugModelOption[],
    configuredSelector: string,
    modelPreference?: InlineCompletionModelPreference,
): InlineCompletionDebugModelOption | undefined {
    const trimmed = configuredSelector.trim();
    if (trimmed) {
        const matched =
            availableModels.find((model) => model.selector === trimmed) ??
            availableModels.find((model) => model.family === trimmed);
        if (matched) {
            return matched;
        }
    }

    return selectPreferredModel(availableModels, modelPreference);
}

export function compareModelOptions(
    left: InlineCompletionDebugModelOption,
    right: InlineCompletionDebugModelOption,
): number {
    return (
        left.providerLabel.localeCompare(right.providerLabel, undefined, { sensitivity: "base" }) ||
        left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
            numeric: true,
        }) ||
        left.id.localeCompare(right.id, undefined, { sensitivity: "base" })
    );
}

export function getConfiguredModelSelector(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
            ?.trim() || undefined
    );
}

export function getConfiguredContinuationModelSelector(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsContinuationModelFamily, "")
            ?.trim() || undefined
    );
}

export function getConfiguredInlineCompletionProfileId():
    | InlineCompletionDebugProfileId
    | undefined {
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

export function getEffectiveOverridesWithConfiguredProfile(
    overrides: InlineCompletionDebugOverrides,
): InlineCompletionDebugOverrides {
    if (overrides.profileId) {
        return overrides;
    }

    return {
        ...overrides,
        profileId: getConfiguredInlineCompletionProfileId() ?? null,
    };
}

export function getConfiguredUseSchemaContext(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ?? false
    );
}

export function getConfiguredIncludeSqlDiagnostics(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics, true) ??
        true
    );
}

export function getConfiguredSchemaContextSetting(): InlineCompletionDebugSchemaContextOverrides | null {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(Constants.configCopilotInlineCompletionsSchemaContext, undefined);
    return isRecord(configured)
        ? (configured as InlineCompletionDebugSchemaContextOverrides)
        : null;
}

export function mergeSchemaContextDefaults(
    configured: InlineCompletionDebugSchemaContextOverrides | null,
    profileSchemaContext: InlineCompletionDebugSchemaContextOverrides | null | undefined,
): InlineCompletionDebugSchemaContextOverrides | null {
    if (!configured && !profileSchemaContext) {
        return null;
    }

    return {
        ...(configured ?? {}),
        ...(profileSchemaContext ?? {}),
        budgetOverrides: {
            ...(configured?.budgetOverrides ?? {}),
            ...(profileSchemaContext?.budgetOverrides ?? {}),
        },
    };
}

export function getConfiguredEnabledCategories(): InlineCompletionCategory[] {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(Constants.configCopilotInlineCompletionsEnabledCategories, undefined);
    return normalizeInlineCompletionCategories(configured);
}

export function getRecordWhenClosedSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsDebugRecordWhenClosed, false) ??
        false
    );
}
