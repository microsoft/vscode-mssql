/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Console-hosted Inline Completion Debug host: builds the standalone viewer's
 * webview state from the SINGLETON inlineCompletionDebugStore and dispatches
 * the Live-experience subset of its reducers for the MSSQL Debug Console's
 * Completions page.
 *
 * FORKED from copilot/inlineCompletionDebug/inlineCompletionDebugController.ts
 * (createState + the Live-subset reducer bodies) — the standalone panel remains
 * the reference implementation until replay parity is confirmed, then this and
 * the panel converge. Replay and sessions reducers are deliberately stubbed
 * here (info message pointing at the standalone viewer); state fields that only
 * make sense in the standalone panel carry honest empty/disabled defaults.
 */

import * as vscode from "vscode";
import { TextEncoder } from "util";
import * as Constants from "../constants/constants";
import {
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
} from "../copilot/inlineCompletionDebug/inlineCompletionDebugController";
import {
    createInlineCompletionDebugPresetOverrides,
    getInlineCompletionDebugPresetProfile,
    getInlineCompletionModelPreferenceForCategory,
    getInlineCompletionPresetProfileId,
    inlineCompletionConfiguredDefaultProfileId,
    inlineCompletionDebugCustomProfileId,
    inlineCompletionDebugProfileOptions,
    InlineCompletionModelPreference,
} from "../copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";
import {
    inlineCompletionDebugDefaultOverrides,
    inlineCompletionDebugStore,
} from "../copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import {
    getConfiguredTraceFolder,
    getTraceCaptureEnabledSetting,
} from "../copilot/inlineCompletionDebug/tracePersistence";
import { FeatureCaptureLease } from "./featureCapture/captureStore";
import { CompletionSchemaContextService } from "../copilot/completionSchemaContextService";
import { selectConfiguredLanguageModels } from "../copilot/languageModelSelection";
import {
    formatModelDisplayName,
    formatModelSelector,
    formatProviderLabel,
} from "../copilot/languageModels/shared/modelDisplay";
import {
    automaticTriggerDebounceMs,
    buildCompletionRules,
    continuationModeMaxTokens,
    intentModeMaxTokens,
    normalizeInlineCompletionCategories,
    selectPreferredModel,
} from "../copilot/sqlInlineCompletionProvider";
import { logger2 } from "../models/logger2";
import {
    InlineCompletionDebugModelOption,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReducers,
    InlineCompletionDebugSchemaContextOverrides,
    InlineCompletionDebugSessionsState,
    InlineCompletionDebugWebviewState,
    inlineCompletionCategories,
} from "../sharedInterfaces/inlineCompletionDebug";
import { getErrorMessage } from "../utils/utils";

const DEFAULT_CUSTOM_PROMPT = buildCompletionRules(false, false);
const CHANGE_THROTTLE_MS = 250;

const REPLAY_SESSIONS_STUB_MESSAGE =
    "Replay & sessions run in the standalone viewer for now — MSSQL: Open Inline Completion Debug.";

export interface CompletionsDebugConsoleHostDeps {
    extensionContext: vscode.ExtensionContext;
    /**
     * Mirrors what mainController hands the standalone controller. Unused by
     * the current Live subset (refreshSchemaContext rides the shared command);
     * kept so the replay fork can reuse it when replay parity lands here.
     */
    schemaContextService?: CompletionSchemaContextService;
}

let hostDeps: CompletionsDebugConsoleHostDeps | undefined;

/** Called from mainController right after the schema context service exists. */
export function configureCompletionsDebugHost(deps: CompletionsDebugConsoleHostDeps): void {
    hostDeps = deps;
}

/** Undefined when the inline-completion module never initialized (no deps). */
export function createConsoleCompletionsDebugHost(): ConsoleCompletionsDebugHost | undefined {
    return hostDeps ? new ConsoleCompletionsDebugHost(hostDeps) : undefined;
}

/**
 * Honest default state for when the feature gate is off (or deps are absent):
 * no events, no models, defaults from compile-time constants only.
 */
export function createEmptyConsoleCompletionsDebugState(): InlineCompletionDebugWebviewState {
    return {
        events: [],
        overrides: { ...inlineCompletionDebugDefaultOverrides },
        defaults: {
            useSchemaContext: false,
            includeSqlDiagnostics: true,
            debounceMs: automaticTriggerDebounceMs,
            continuationMaxTokens: continuationModeMaxTokens,
            intentMaxTokens: intentModeMaxTokens,
            enabledCategories: [...inlineCompletionCategories],
            allowAutomaticTriggers: true,
            schemaContext: null,
        },
        profiles: [...inlineCompletionDebugProfileOptions],
        availableModels: [],
        recordWhenClosed: false,
        customPrompt: {
            dialogOpen: false,
            savedValue: null,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
        },
        sessions: createEmptySessionsState(""),
        replay: {
            cart: [],
            runs: [],
            queueRows: [],
            builderOpen: false,
        },
    };
}

export class ConsoleCompletionsDebugHost {
    private readonly _logger = logger2.withPrefix("ConsoleCompletionsDebug");
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _viewerLease: FeatureCaptureLease;
    private _availableModels: InlineCompletionDebugModelOption[] = [];
    private _effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    private _savedCustomPromptValue: string | null;
    private _customPromptLastSavedAt: number | undefined;
    private _selectedEventId: string | undefined;
    private _customPromptDialogOpen = false;
    private _throttleTimer: ReturnType<typeof setTimeout> | undefined;
    private _lastChangeFiredAt = 0;
    private _disposed = false;

    /** Throttled (≥250 ms) change signal; the webview re-pulls state on it. */
    public readonly onDidChange = this._onDidChangeEmitter.event;

    constructor(private readonly _deps: CompletionsDebugConsoleHostDeps) {
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

        // Named viewer lease: disposing the console never affects a
        // concurrently open standalone panel's lease (final plan WI-0.4).
        this._viewerLease = inlineCompletionDebugStore.acquireViewer("debugConsole.completions");

        this._disposables.push(
            inlineCompletionDebugStore.onDidChange(() => this.fireChanged()),
            vscode.lm.onDidChangeChatModels(() => {
                void this.refreshAvailableModels();
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                    ) ||
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsTraceCaptureEnabled,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsProfile) ||
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsUseSchemaContext,
                    ) ||
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsSchemaContext)
                ) {
                    this.fireChanged();
                }
                if (
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsProfile) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelFamily) ||
                    e.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsContinuationModelFamily,
                    ) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsModelVendors)
                ) {
                    this._effectiveDefaultModelOption = pickDefaultModelOption(
                        this._availableModels,
                        getConfiguredModelSelector(),
                    );
                    this.fireChanged();
                    void this.refreshAvailableModels();
                }
            }),
        );
        void this.refreshAvailableModels();
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._throttleTimer) {
            clearTimeout(this._throttleTimer);
            this._throttleTimer = undefined;
        }
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables.length = 0;
        this._viewerLease.dispose();
        this._onDidChangeEmitter.dispose();
    }

    public getState(): InlineCompletionDebugWebviewState {
        return this.buildState();
    }

    /**
     * Dispatch a reducer-named action from the console webview. Only the Live
     * experience subset is implemented; replay/sessions actions surface an
     * info message and return the current state unchanged (never throw).
     */
    public async dispatchAction(
        name: string,
        payload: unknown,
    ): Promise<InlineCompletionDebugWebviewState> {
        switch (name as keyof InlineCompletionDebugReducers) {
            case "clearEvents": {
                inlineCompletionDebugStore.clearEvents();
                this._selectedEventId = undefined;
                break;
            }
            case "selectEvent": {
                const p = payload as InlineCompletionDebugReducers["selectEvent"] | undefined;
                this._selectedEventId = p?.eventId;
                break;
            }
            case "updateOverrides": {
                const p = payload as InlineCompletionDebugReducers["updateOverrides"];
                inlineCompletionDebugStore.updateOverrides(
                    this.prepareUserOverrideUpdate(p.overrides ?? {}),
                );
                break;
            }
            case "selectProfile": {
                const p = payload as InlineCompletionDebugReducers["selectProfile"];
                inlineCompletionDebugStore.updateOverrides(this.createProfileUpdate(p.profileId));
                break;
            }
            case "setRecordWhenClosed": {
                const p = payload as InlineCompletionDebugReducers["setRecordWhenClosed"];
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                        p.enabled,
                        getConfigurationTarget(),
                    );
                break;
            }
            case "openCustomPromptDialog": {
                this._customPromptDialogOpen = true;
                break;
            }
            case "closeCustomPromptDialog": {
                this._customPromptDialogOpen = false;
                break;
            }
            case "saveCustomPrompt": {
                const p = payload as InlineCompletionDebugReducers["saveCustomPrompt"];
                const value = p.value.length > 0 ? p.value : null;
                const savedAt = value ? Date.now() : undefined;
                await this.persistCustomPrompt(value, savedAt, true);
                this._customPromptDialogOpen = false;
                break;
            }
            case "resetCustomPrompt": {
                await this.persistCustomPrompt(null, undefined, false);
                break;
            }
            case "refreshSchemaContext": {
                await vscode.commands.executeCommand(
                    Constants.cmdCopilotInlineCompletionRefreshSchemaContext,
                );
                break;
            }
            case "exportSession": {
                await this.exportSession();
                break;
            }
            case "copyEventPayload": {
                const p = payload as InlineCompletionDebugReducers["copyEventPayload"];
                await this.copyEventPayload(p.eventId, p.kind);
                break;
            }
            default: {
                void vscode.window.showInformationMessage(REPLAY_SESSIONS_STUB_MESSAGE);
                break;
            }
        }

        return this.buildState();
    }

    // --- FORKED reducer helpers (InlineCompletionDebugController) ----------

    private async refreshAvailableModels(): Promise<void> {
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

    private prepareUserOverrideUpdate(
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

    private createProfileUpdate(
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

    private async persistCustomPrompt(
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

    private async exportSession(): Promise<void> {
        const defaultFileName = `inline-completion-debug-${Date.now()}.json`;
        const defaultFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri ??
            this._deps.extensionContext.globalStorageUri;
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
            getExtensionVersion(this._deps.extensionContext),
            this._customPromptLastSavedAt,
        );
        await vscode.workspace.fs.writeFile(
            fileUri,
            new TextEncoder().encode(JSON.stringify(exportData, undefined, 2)),
        );
    }

    private async copyEventPayload(
        eventId: string,
        kind: InlineCompletionDebugReducers["copyEventPayload"]["kind"],
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

    // --- FORKED state assembly (InlineCompletionDebugController.createState) --

    private buildState(): InlineCompletionDebugWebviewState {
        const overrides = inlineCompletionDebugStore.getOverrides();
        const configuredProfileId = getConfiguredInlineCompletionProfileId();
        const effectiveProfileId = overrides.profileId ?? configuredProfileId;
        const profile = getInlineCompletionDebugPresetProfile(effectiveProfileId);
        const configuredModelSelector = getConfiguredModelSelector();
        const configuredContinuationModelSelector = getConfiguredContinuationModelSelector();
        const continuationModelPreference = profile?.continuationModelPreference;
        const effectiveOption =
            (profile ? undefined : this._effectiveDefaultModelOption) ??
            pickDefaultModelOption(
                this._availableModels,
                configuredModelSelector,
                profile?.modelPreference,
            );
        const effectiveContinuationOption = configuredContinuationModelSelector
            ? pickConfiguredModelOption(
                  this._availableModels,
                  configuredContinuationModelSelector,
                  continuationModelPreference ?? profile?.modelPreference,
              )
            : continuationModelPreference
              ? pickDefaultModelOption(
                    this._availableModels,
                    undefined,
                    continuationModelPreference,
                )
              : undefined;
        const configuredSchemaContext = getConfiguredSchemaContextSetting();
        return {
            events: inlineCompletionDebugStore.getEvents(),
            overrides,
            defaults: {
                configuredModelSelector,
                configuredContinuationModelSelector,
                configuredProfileId,
                effectiveProfileId,
                effectiveModelSelector: effectiveOption?.selector,
                effectiveModelLabel: effectiveOption?.label,
                effectiveContinuationModelSelector: effectiveContinuationOption?.selector,
                effectiveContinuationModelLabel: effectiveContinuationOption?.label,
                useSchemaContext: profile?.useSchemaContext ?? getConfiguredUseSchemaContext(),
                includeSqlDiagnostics: getConfiguredIncludeSqlDiagnostics(),
                debounceMs: profile?.debounceMs ?? automaticTriggerDebounceMs,
                continuationMaxTokens: continuationModeMaxTokens,
                intentMaxTokens: intentModeMaxTokens,
                enabledCategories: profile
                    ? [...profile.enabledCategories]
                    : getConfiguredEnabledCategories(),
                allowAutomaticTriggers: true,
                schemaContext: mergeSchemaContextDefaults(
                    configuredSchemaContext,
                    profile?.schemaContext,
                ),
            },
            profiles: [...inlineCompletionDebugProfileOptions],
            availableModels: this._availableModels,
            selectedEventId: this._selectedEventId,
            recordWhenClosed: getRecordWhenClosedSetting(),
            customPrompt: {
                dialogOpen: this._customPromptDialogOpen,
                savedValue: this._savedCustomPromptValue,
                defaultValue: DEFAULT_CUSTOM_PROMPT,
                lastSavedAt: this._customPromptLastSavedAt,
            },
            // Sessions & replay live in the standalone viewer; the console fork
            // surfaces honest empty/disabled placeholders that match the types.
            sessions: createEmptySessionsState(
                getConfiguredTraceFolder(this._deps.extensionContext),
            ),
            replay: {
                cart: [],
                runs: [],
                queueRows: [],
                builderOpen: false,
            },
        };
    }

    private fireChanged(): void {
        if (this._disposed || this._throttleTimer) {
            return;
        }
        const elapsed = Date.now() - this._lastChangeFiredAt;
        const delay = Math.max(0, CHANGE_THROTTLE_MS - elapsed);
        this._throttleTimer = setTimeout(() => {
            this._throttleTimer = undefined;
            if (this._disposed) {
                return;
            }
            this._lastChangeFiredAt = Date.now();
            this._onDidChangeEmitter.fire();
        }, delay);
    }
}

// --- FORKED module helpers (InlineCompletionDebugController) ---------------

function createEmptySessionsState(traceFolder: string): InlineCompletionDebugSessionsState {
    return {
        traceFolder,
        traceCaptureEnabled: getTraceCaptureEnabledSetting(),
        traceIndex: [],
        loadedTraces: [],
        loading: false,
    };
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: unknown } | undefined;
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
}

function pickDefaultModelOption(
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

function pickConfiguredModelOption(
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

function compareModelOptions(
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

function getConfiguredModelSelector(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsModelFamily, "")
            ?.trim() || undefined
    );
}

function getConfiguredContinuationModelSelector(): string | undefined {
    return (
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsContinuationModelFamily, "")
            ?.trim() || undefined
    );
}

function getConfiguredInlineCompletionProfileId(): InlineCompletionDebugProfileId | undefined {
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

function getEffectiveOverridesWithConfiguredProfile(
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

function getConfiguredUseSchemaContext(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ?? false
    );
}

function getConfiguredIncludeSqlDiagnostics(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics, true) ??
        true
    );
}

function getConfiguredSchemaContextSetting(): InlineCompletionDebugSchemaContextOverrides | null {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(Constants.configCopilotInlineCompletionsSchemaContext, undefined);
    return isRecord(configured)
        ? (configured as InlineCompletionDebugSchemaContextOverrides)
        : null;
}

function mergeSchemaContextDefaults(
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

function getConfiguredEnabledCategories() {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(Constants.configCopilotInlineCompletionsEnabledCategories, undefined);
    return normalizeInlineCompletionCategories(configured);
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
