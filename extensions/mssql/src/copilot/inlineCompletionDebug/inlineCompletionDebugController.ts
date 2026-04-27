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
    createTraceFolderWatcher,
    indexTraceFile,
    loadTraceFile,
    normalizeTraceFile,
    scanTraceFolder,
} from "./traceLoader";
import {
    getConfiguredTraceFolder,
    getTraceCaptureEnabledSetting,
    saveInlineCompletionTraceNow,
} from "./tracePersistence";
import {
    automaticTriggerDebounceMs,
    buildCompletionRules,
    buildInlineCompletionPromptMessages,
    collectText,
    continuationModeMaxTokens,
    createLanguageModelMaxTokenOptions,
    fixLeadingWhitespace,
    formatSchemaContextForPrompt,
    getEffectiveMaxCompletionChars,
    getInlineCompletionCategory,
    intentModeMaxTokens,
    normalizeInlineCompletionCategories,
    resolveInlineCompletionRules,
    sanitizeInlineCompletionText,
    selectPreferredModel,
    suppressDocumentSuffixOverlap,
} from "../sqlInlineCompletionProvider";
import {
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    SqlInlineCompletionSchemaContext,
    SqlInlineCompletionSchemaContextService,
} from "../sqlInlineCompletionSchemaContextService";
import {
    matchLanguageModelChatToSelector,
    selectConfiguredLanguageModels,
} from "../languageModelSelection";
import {
    formatModelDisplayName,
    formatModelSelector,
    formatProviderLabel,
} from "../languageModels/shared/modelDisplay";
import {
    createInlineCompletionDebugPresetOverrides,
    getInlineCompletionDebugPresetProfile,
    getInlineCompletionModelPreferenceForCategory,
    getInlineCompletionPresetProfileId,
    getInlineCompletionProfileSchemaContextOverrides,
    inlineCompletionConfiguredDefaultProfileId,
    inlineCompletionDebugCustomProfileId,
    inlineCompletionDebugProfileOptions,
    InlineCompletionModelPreference,
} from "./inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import {
    InlineCompletionCategory,
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventTags,
    InlineCompletionDebugModelOption,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugPromptMessage,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayCartAddItem,
    InlineCompletionDebugReplayCartConfigMode,
    InlineCompletionDebugReplayConfig,
    InlineCompletionDebugReplayEventSnapshot,
    InlineCompletionDebugReplayMatrixCell,
    InlineCompletionDebugReplayQueueRow,
    InlineCompletionDebugReplayRun,
    InlineCompletionDebugReplayState,
    InlineCompletionDebugSchemaContextOverrides,
    InlineCompletionDebugSessionsState,
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers,
    InlineCompletionSchemaBudgetProfileId,
    inlineCompletionCategories,
} from "../../sharedInterfaces/inlineCompletionDebug";

export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPrompt";
export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";
const DEFAULT_CUSTOM_PROMPT = buildCompletionRules(false, false);

interface ReplaySchemaContextResult {
    schemaContext: SqlInlineCompletionSchemaContext | undefined;
    schemaContextText: string;
    schemaContextSource: "current" | "captured" | "unavailable" | "disabled";
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
}

export class InlineCompletionDebugController extends WebviewPanelController<
    InlineCompletionDebugWebviewState,
    InlineCompletionDebugReducers
> {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private _availableModels: InlineCompletionDebugModelOption[] = [];
    private _effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    private _savedCustomPromptValue: string | null;
    private _customPromptLastSavedAt: number | undefined;
    private _sessionsState: InlineCompletionDebugSessionsState;
    private _replayState: InlineCompletionDebugReplayState = createEmptyReplayState();
    private _replayCartDialogSnapshot: InlineCompletionDebugReplayEventSnapshot[] | undefined;
    private _replaySnapshotCounter = 0;
    private _replayTraceCounter = 0;
    private _replayRunCounter = 0;
    private _replayQueueCounter = 0;
    private _replayDrainActive = false;
    private _traceFolderWatcher: vscode.FileSystemWatcher | undefined;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private readonly _schemaContextService?: SqlInlineCompletionSchemaContextService,
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
                effectiveDefaultModelOption: undefined,
                sessions: createEmptySessionsState(getConfiguredTraceFolder(_extensionContext)),
                replay: createEmptyReplayState(),
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
        this._sessionsState = createEmptySessionsState(getConfiguredTraceFolder(_extensionContext));
        this._replayState = this.state.replay;
        inlineCompletionDebugStore.setPanelOpen(true);
        this.registerDisposables();
        this.registerReducers();
        void this.refreshAvailableModels();
    }

    public override dispose(): void {
        this._traceFolderWatcher?.dispose();
        this._traceFolderWatcher = undefined;
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
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsSchemaContext) ||
                    e.affectsConfiguration(Constants.configCopilotInlineCompletionsTraceFolder)
                ) {
                    if (
                        e.affectsConfiguration(Constants.configCopilotInlineCompletionsTraceFolder)
                    ) {
                        void this.refreshSessions({ resetFolder: true });
                    }
                    this.updateState(this.createState());
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
            inlineCompletionDebugStore.updateOverrides(
                this.prepareUserOverrideUpdate(payload.overrides),
            );
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("selectProfile", (state, payload) => {
            inlineCompletionDebugStore.updateOverrides(this.createProfileUpdate(payload.profileId));
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
            await this.persistCustomPrompt(value, savedAt, true);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: false,
            });
        });

        this.registerReducer("resetCustomPrompt", async (state) => {
            await this.persistCustomPrompt(null, undefined, false);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("refreshSchemaContext", async (state) => {
            await vscode.commands.executeCommand(
                Constants.cmdCopilotInlineCompletionRefreshSchemaContext,
            );
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

        this.registerReducer("saveTraceNow", async (state) => {
            await saveInlineCompletionTraceNow(this._extensionContext);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsActivated", async (state) => {
            await this.refreshSessions();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsRefresh", async (state) => {
            await this.refreshSessions();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsToggleTrace", async (state, payload) => {
            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((entry) =>
                    entry.fileKey === payload.fileKey
                        ? { ...entry, included: payload.included }
                        : entry,
                ),
            };
            await this.loadIncludedSessionTraces();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsSetAllTraces", async (state, payload) => {
            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                    ...entry,
                    included: payload.included,
                })),
            };
            await this.loadIncludedSessionTraces();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsLoadIncluded", async (state) => {
            await this.loadIncludedSessionTraces();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsAddFile", async (state) => {
            await this.addSessionTraceFile();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsChangeFolder", async (state) => {
            await this.changeTraceFolder();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsEnableTraceCollection", async (state) => {
            await this.enableTraceCollection();
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("sessionsSyncToDatabase", async (state) => {
            await this.showSyncToDatabaseNotImplemented();
            return this.createState({
                selectedEventId: state.selectedEventId,
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

        this.registerReducer("replaySessionEvent", async (state, payload) => {
            await this.replaySourceEvent(payload.event, { showPendingInLive: true });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("openReplayBuilder", (state) => {
            this._replayCartDialogSnapshot = cloneJson(this._replayState.cart);
            this.updateReplayState({
                ...this._replayState,
                builderOpen: true,
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("closeReplayBuilder", (state, payload) => {
            const restoredCart =
                payload.restoreCart && this._replayCartDialogSnapshot
                    ? cloneJson(this._replayCartDialogSnapshot)
                    : this._replayState.cart;
            this._replayCartDialogSnapshot = undefined;
            this.updateReplayState({
                ...this._replayState,
                builderOpen: false,
                cart: restoredCart,
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("addEventsToReplayCart", (state, payload) => {
            this.addEventsToReplayCart(payload.items);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("addSessionToReplayCart", async (state, payload) => {
            await this.addSessionToReplayCart(payload.fileKey);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("replaySessionNow", async (state, payload) => {
            await this.replaySessionNow(payload.fileKey);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("removeFromReplayCart", (state, payload) => {
            this.updateReplayState({
                ...this._replayState,
                cart: this._replayState.cart.filter((item) => item.id !== payload.snapshotId),
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("reorderReplayCart", (state, payload) => {
            this.updateReplayState({
                ...this._replayState,
                cart: moveReplayCartItem(
                    this._replayState.cart,
                    payload.fromIndex,
                    payload.toIndex,
                ),
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("clearReplayCart", (state) => {
            this.updateReplayState({
                ...this._replayState,
                cart: [],
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("reverseReplayCart", (state) => {
            this.updateReplayState({
                ...this._replayState,
                cart: [...this._replayState.cart].reverse(),
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("setReplayCartOverride", (state, payload) => {
            this.updateReplayCartSnapshot(payload.snapshotId, {
                override: payload.override ? cloneJson(payload.override) : null,
                configMode: payload.override ? "override" : "snapshot",
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("setReplayCartConfigMode", (state, payload) => {
            this.updateReplayCartSnapshot(payload.snapshotId, {
                configMode: payload.configMode,
            });
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("queueReplayCart", (state, payload) => {
            this.queueReplayCart(payload.configMode);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("runReplayMatrix", (state, payload) => {
            this.runReplayMatrix(payload.profileIds, payload.schemaBudgetProfileIds);
            return this.createState({
                selectedEventId: state.selectedEventId,
                customPromptDialogOpen: state.customPrompt.dialogOpen,
            });
        });

        this.registerReducer("cancelReplayRun", (state, payload) => {
            this.cancelReplayRun(payload.runId);
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
            effectiveDefaultModelOption: this._effectiveDefaultModelOption,
            sessions: {
                ...this._sessionsState,
                traceCaptureEnabled: getTraceCaptureEnabledSetting(),
            },
            replay: this._replayState,
            selectedEventId: overrides?.selectedEventId ?? this.state?.selectedEventId,
            customPromptDialogOpen:
                overrides?.customPromptDialogOpen ?? this.state?.customPrompt.dialogOpen ?? false,
            customPromptValue,
            customPromptLastSavedAt,
        });
    }

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
            if (!this.isDisposed) {
                this.updateState(this.createState());
            }
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
        await this._extensionContext.workspaceState.update(
            INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
            value,
        );
        await this._extensionContext.workspaceState.update(
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
            getExtensionVersion(this._extensionContext),
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
        const parsed = normalizeTraceFile(
            JSON.parse(new TextDecoder().decode(fileContents)),
            fileUri.fsPath,
        );
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
            false,
        );
    }

    private async refreshSessions(options: { resetFolder?: boolean } = {}): Promise<void> {
        const traceFolder = getConfiguredTraceFolder(this._extensionContext);
        if (options.resetFolder || traceFolder !== this._sessionsState.traceFolder) {
            this._traceFolderWatcher?.dispose();
            this._traceFolderWatcher = undefined;
            this._sessionsState = createEmptySessionsState(traceFolder);
        }

        this.ensureTraceFolderWatcher(traceFolder);
        this._sessionsState = {
            ...this._sessionsState,
            traceFolder,
            loading: true,
            error: undefined,
        };
        this.updateState(this.createState());

        try {
            const hadExistingIndex = this._sessionsState.traceIndex.length > 0;
            const includedFileKeys = new Set(
                this._sessionsState.traceIndex
                    .filter((entry) => entry.included)
                    .map((entry) => entry.fileKey),
            );
            const loadedFileKeys = new Set(
                this._sessionsState.loadedTraces.map((trace) => trace.fileKey),
            );
            const folderEntries = await scanTraceFolder(
                traceFolder,
                hadExistingIndex ? includedFileKeys : new Set(),
                loadedFileKeys,
            );
            const importedEntries = this._sessionsState.traceIndex.filter(
                (entry) => entry.imported,
            );
            const mergedEntries = mergeTraceIndexEntries(folderEntries, importedEntries);

            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: mergedEntries,
                loading: false,
                lastRefreshedAt: Date.now(),
            };
            await this.loadIncludedSessionTraces();
        } catch (error) {
            this._sessionsState = {
                ...this._sessionsState,
                loading: false,
                error: getErrorMessage(error),
            };
        }

        if (!this.isDisposed) {
            this.updateState(this.createState());
        }
    }

    private ensureTraceFolderWatcher(traceFolder: string): void {
        if (this._traceFolderWatcher) {
            return;
        }

        this._traceFolderWatcher = createTraceFolderWatcher(traceFolder, () => {
            if (!this.isDisposed) {
                void this.refreshSessions();
            }
        });
    }

    private async loadIncludedSessionTraces(): Promise<void> {
        const includedEntries = this._sessionsState.traceIndex.filter(
            (entry) => entry.included && !entry.loadError,
        );
        const cached = new Map(
            this._sessionsState.loadedTraces.map((loaded) => [loaded.fileKey, loaded.trace]),
        );
        const unloadedEntries = includedEntries.filter((entry) => !cached.has(entry.fileKey));
        const totalEventCount = includedEntries.reduce((sum, entry) => sum + entry.eventCount, 0);

        if (totalEventCount > 100_000) {
            const selection = await vscode.window.showWarningMessage(
                `The selected trace dataset contains ${totalEventCount.toLocaleString()} events. Loading it may use significant memory.`,
                { modal: false },
                "Load traces",
            );
            if (selection !== "Load traces") {
                this._sessionsState = {
                    ...this._sessionsState,
                    warning: "Dataset load cancelled because it exceeds 100,000 events.",
                };
                return;
            }
        }

        if (unloadedEntries.length === 0) {
            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                    ...entry,
                    loaded: cached.has(entry.fileKey),
                })),
                warning: undefined,
            };
            return;
        }

        this._sessionsState = {
            ...this._sessionsState,
            loading: true,
            warning: undefined,
        };
        this.updateState(this.createState());

        const newlyLoaded = [];
        const loadErrors = new Map<string, string>();
        for (const entry of unloadedEntries) {
            try {
                const trace = await loadTraceFile(entry.path);
                cached.set(entry.fileKey, trace);
                newlyLoaded.push({ fileKey: entry.fileKey, trace });
            } catch (error) {
                loadErrors.set(entry.fileKey, getErrorMessage(error));
            }
        }

        this._sessionsState = {
            ...this._sessionsState,
            loadedTraces: [
                ...this._sessionsState.loadedTraces,
                ...newlyLoaded.filter(
                    (loaded) =>
                        !this._sessionsState.loadedTraces.some(
                            (existing) => existing.fileKey === loaded.fileKey,
                        ),
                ),
            ],
            traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                ...entry,
                loaded: cached.has(entry.fileKey),
                loadError: loadErrors.get(entry.fileKey) ?? entry.loadError,
            })),
            loading: false,
        };
    }

    private async addSessionTraceFile(): Promise<void> {
        const fileUris = await vscode.window.showOpenDialog({
            title: "Add Inline Completion Trace File",
            canSelectFiles: true,
            canSelectMany: true,
            filters: {
                JSON: ["json"],
            },
        });

        if (!fileUris?.length) {
            return;
        }

        const loadedTraces = [...this._sessionsState.loadedTraces];
        const entries = [...this._sessionsState.traceIndex];
        for (const fileUri of fileUris) {
            const trace = await loadTraceFile(fileUri.fsPath);
            const stat = await vscode.workspace.fs.stat(fileUri);
            const entry = await indexTraceFile(fileUri.fsPath, {
                included: true,
                loaded: true,
                imported: true,
            });
            entries.push({ ...entry, fileSizeBytes: stat.size });
            loadedTraces.push({ fileKey: fileUri.fsPath, trace });
        }

        this._sessionsState = {
            ...this._sessionsState,
            traceIndex: mergeTraceIndexEntries(entries, []),
            loadedTraces: dedupeLoadedTraces(loadedTraces),
            error: undefined,
        };
    }

    private async changeTraceFolder(): Promise<void> {
        const selectedFolders = await vscode.window.showOpenDialog({
            title: "Choose Inline Completion Trace Folder",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(this._sessionsState.traceFolder),
        });
        const selectedFolder = selectedFolders?.[0];
        if (!selectedFolder) {
            return;
        }

        await vscode.workspace
            .getConfiguration()
            .update(
                Constants.configCopilotInlineCompletionsTraceFolder,
                selectedFolder.fsPath,
                getConfigurationTarget(),
            );
        await this.refreshSessions({ resetFolder: true });
    }

    private async enableTraceCollection(): Promise<void> {
        const currentFolder = getConfiguredTraceFolder(this._extensionContext);
        const useFolder = "Use this folder";
        const chooseOtherFolder = "Choose other folder";
        const selection = await vscode.window.showInformationMessage(
            `Enable inline completion trace collection and save trace files to ${currentFolder}?`,
            useFolder,
            chooseOtherFolder,
        );

        if (!selection) {
            return;
        }

        let resetFolder = false;
        if (selection === chooseOtherFolder) {
            const selectedFolders = await vscode.window.showOpenDialog({
                title: "Choose Inline Completion Trace Folder",
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: vscode.Uri.file(currentFolder),
            });
            const selectedFolder = selectedFolders?.[0];
            if (!selectedFolder) {
                return;
            }

            await vscode.workspace
                .getConfiguration()
                .update(
                    Constants.configCopilotInlineCompletionsTraceFolder,
                    selectedFolder.fsPath,
                    getConfigurationTarget(),
                );
            resetFolder = true;
        }

        await vscode.workspace
            .getConfiguration()
            .update(
                Constants.configCopilotInlineCompletionsTraceCaptureEnabled,
                true,
                getConfigurationTarget(),
            );
        await this.refreshSessions({ resetFolder });
    }

    private async showSyncToDatabaseNotImplemented(): Promise<void> {
        await vscode.window.showInformationMessage(
            `Database sync is not yet implemented. Traces are currently saved to: ${getConfiguredTraceFolder(
                this._extensionContext,
            )}`,
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

    private addEventsToReplayCart(items: InlineCompletionDebugReplayCartAddItem[]): void {
        const snapshots = items
            .filter((item) => item.event.result !== "pending" && item.event.result !== "queued")
            .map((item) => this.createReplaySnapshot(item.event, item.sourceLabel));
        if (snapshots.length === 0) {
            return;
        }

        this.updateReplayState({
            ...this._replayState,
            cart: [...this._replayState.cart, ...snapshots],
            lastAddedAt: Date.now(),
        });
    }

    private async addSessionToReplayCart(fileKey: string): Promise<void> {
        const loaded = await this.getLoadedTrace(fileKey);
        if (!loaded) {
            return;
        }

        this.addEventsToReplayCart(
            loaded.trace.events.map((event) => ({
                event,
                sourceLabel: loaded.trace._savedAt
                    ? `${loaded.trace._savedAt} · ${loaded.trace.events.length} events`
                    : fileKey,
            })),
        );
    }

    private async replaySessionNow(fileKey: string): Promise<void> {
        const loaded = await this.getLoadedTrace(fileKey);
        if (!loaded) {
            return;
        }

        const snapshots = loaded.trace.events
            .filter((event) => event.result !== "pending" && event.result !== "queued")
            .map((event) => ({
                ...this.createReplaySnapshot(
                    event,
                    loaded.trace._savedAt
                        ? `${loaded.trace._savedAt} · ${loaded.trace.events.length} events`
                        : fileKey,
                ),
                configMode: "live" as const,
                override: null,
            }));
        this.queueReplaySnapshots(snapshots, "single");
    }

    private async getLoadedTrace(
        fileKey: string,
    ): Promise<InlineCompletionDebugSessionsState["loadedTraces"][number] | undefined> {
        const cached = this._sessionsState.loadedTraces.find((trace) => trace.fileKey === fileKey);
        if (cached) {
            return cached;
        }

        const entry = this._sessionsState.traceIndex.find((trace) => trace.fileKey === fileKey);
        if (!entry || entry.loadError) {
            return undefined;
        }

        try {
            const trace = await loadTraceFile(entry.path);
            const loaded = { fileKey, trace };
            this._sessionsState = {
                ...this._sessionsState,
                loadedTraces: dedupeLoadedTraces([...this._sessionsState.loadedTraces, loaded]),
                traceIndex: this._sessionsState.traceIndex.map((item) =>
                    item.fileKey === fileKey ? { ...item, loaded: true } : item,
                ),
            };
            return loaded;
        } catch (error) {
            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((item) =>
                    item.fileKey === fileKey
                        ? { ...item, loaded: false, loadError: getErrorMessage(error) }
                        : item,
                ),
            };
            return undefined;
        }
    }

    private updateReplayCartSnapshot(
        snapshotId: string,
        update: Partial<Pick<InlineCompletionDebugReplayEventSnapshot, "configMode" | "override">>,
    ): void {
        this.updateReplayState({
            ...this._replayState,
            cart: this._replayState.cart.map((snapshot) =>
                snapshot.id === snapshotId
                    ? {
                          ...snapshot,
                          ...update,
                      }
                    : snapshot,
            ),
        });
    }

    private createReplaySnapshot(
        event: InlineCompletionDebugEvent,
        sourceLabel: string | undefined,
    ): InlineCompletionDebugReplayEventSnapshot {
        return {
            id: `snapshot-${++this._replaySnapshotCounter}`,
            sourceEventId: event.id,
            sourceLabel: sourceLabel ?? `Live · ${formatReplayTime(event.timestamp)}`,
            capturedAt: Date.now(),
            event: cloneJson(event),
            capturedConfig: this.createCapturedReplayConfig(event),
            configMode: "snapshot",
            override: null,
        };
    }

    private createCapturedReplayConfig(
        event: InlineCompletionDebugEvent,
    ): InlineCompletionDebugReplayConfig {
        const current = this.getCurrentReplayConfig();
        const schemaBudgetProfile = getSchemaBudgetProfileId(
            event.overridesApplied.schemaContext?.budgetProfile ?? event.locals.schemaBudgetProfile,
        );
        const eventModelSelector = this.getEventModelSelector(event);
        return compactReplayConfig({
            ...current,
            profileId:
                getInlineCompletionDebugProfileId(
                    event.overridesApplied.profileId ?? event.locals.profileId,
                ) ?? current.profileId,
            modelSelector: event.overridesApplied.modelSelector ?? eventModelSelector,
            continuationModelSelector:
                event.overridesApplied.continuationModelSelector ??
                current.continuationModelSelector,
            useSchemaContext: event.overridesApplied.useSchemaContext ?? current.useSchemaContext,
            includeSqlDiagnostics:
                event.overridesApplied.includeSqlDiagnostics ?? current.includeSqlDiagnostics,
            debounceMs: event.overridesApplied.debounceMs ?? current.debounceMs,
            maxTokens: event.overridesApplied.maxTokens ?? current.maxTokens,
            enabledCategories: event.overridesApplied.enabledCategories
                ? [...event.overridesApplied.enabledCategories]
                : current.enabledCategories,
            schemaContext:
                cloneJson(event.overridesApplied.schemaContext) ??
                (schemaBudgetProfile
                    ? { budgetProfile: schemaBudgetProfile }
                    : current.schemaContext),
        });
    }

    private getEventModelSelector(event: InlineCompletionDebugEvent): string | null {
        if (event.modelVendor && event.modelId) {
            const selector = `${event.modelVendor}/${event.modelId}`;
            if (this._availableModels.some((model) => model.selector === selector)) {
                return selector;
            }
        }

        if (event.modelFamily) {
            return (
                this._availableModels.find((model) => model.family === event.modelFamily)
                    ?.selector ?? null
            );
        }

        return null;
    }

    private getCurrentReplayConfig(): InlineCompletionDebugReplayConfig {
        return compactReplayConfig(inlineCompletionDebugStore.getOverrides());
    }

    private queueReplayCart(configMode?: InlineCompletionDebugReplayCartConfigMode): void {
        this.queueReplaySnapshots(this._replayState.cart, "single", [], configMode);
    }

    private runReplayMatrix(
        profileIds: InlineCompletionDebugProfileId[],
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[],
    ): void {
        const profiles = profileIds
            .map((profileId) => ({
                id: profileId,
                label:
                    inlineCompletionDebugProfileOptions.find((profile) => profile.id === profileId)
                        ?.label ?? profileId,
            }))
            .filter((profile) => profile.id !== inlineCompletionDebugCustomProfileId);
        const schemaProfiles = schemaBudgetProfileIds
            .map((schemaBudgetProfileId) => ({
                id: schemaBudgetProfileId,
                label: getSchemaBudgetProfileLabel(schemaBudgetProfileId),
            }))
            .filter((schema) => schema.id !== "custom");
        if (profiles.length === 0 || schemaProfiles.length === 0) {
            return;
        }

        const cells: InlineCompletionDebugReplayMatrixCell[] = [];
        for (const profile of profiles) {
            for (const schema of schemaProfiles) {
                cells.push({
                    profileId: profile.id,
                    profileLabel: profile.label,
                    schemaBudgetProfileId: schema.id,
                    schemaLabel: schema.label,
                    cellId: `cell-${cells.length + 1}`,
                    ordinal: cells.length + 1,
                });
            }
        }

        this.queueReplaySnapshots(this._replayState.cart, "matrix", cells);
    }

    private queueReplaySnapshots(
        snapshots: InlineCompletionDebugReplayEventSnapshot[],
        kind: InlineCompletionDebugReplayRun["kind"],
        matrixCells: InlineCompletionDebugReplayMatrixCell[] = [],
        configMode?: InlineCompletionDebugReplayCartConfigMode,
    ): void {
        const runnableSnapshots = snapshots.filter(
            (snapshot) => snapshot.event.result !== "pending" && snapshot.event.result !== "queued",
        );
        if (runnableSnapshots.length === 0) {
            return;
        }

        const traceId = `trace-${new Date().toISOString().replace(/[:.]/g, "-")}-${++this
            ._replayTraceCounter}`;
        const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${++this
            ._replayRunCounter}`;
        const cells = kind === "matrix" ? matrixCells : [];
        const total = (cells.length || 1) * runnableSnapshots.length;
        const startedAt = Date.now();
        const run: InlineCompletionDebugReplayRun = {
            id: runId,
            traceId,
            kind,
            startedAt,
            status: "queued",
            totalEvents: total,
            completedEvents: 0,
            matrixCells: cells.length > 0 ? cells : undefined,
        };
        let runPosition = 0;
        const queueRows =
            kind === "matrix"
                ? cells.flatMap((cell) =>
                      runnableSnapshots.map((snapshot) =>
                          this.createReplayQueueRow(snapshot, run, ++runPosition, total, cell),
                      ),
                  )
                : runnableSnapshots.map((snapshot) =>
                      this.createReplayQueueRow(
                          snapshot,
                          run,
                          ++runPosition,
                          total,
                          undefined,
                          configMode,
                      ),
                  );

        this.updateReplayState({
            ...this._replayState,
            runs: [...this._replayState.runs, run],
            queueRows: [...this._replayState.queueRows, ...queueRows],
            activeRunId: this._replayState.activeRunId ?? run.id,
            builderOpen: false,
        });
        this.startReplayQueueDrain();
    }

    private createReplayQueueRow(
        snapshot: InlineCompletionDebugReplayEventSnapshot,
        run: InlineCompletionDebugReplayRun,
        position: number,
        total: number,
        matrixCell: InlineCompletionDebugReplayMatrixCell | undefined,
        configMode?: InlineCompletionDebugReplayCartConfigMode,
    ): InlineCompletionDebugReplayQueueRow {
        this._replayQueueCounter++;
        const config = matrixCell
            ? this.resolveMatrixCellConfig(matrixCell)
            : this.resolveSnapshotReplayConfig(snapshot, configMode);
        return {
            id: `queue-${this._replayQueueCounter}`,
            runId: run.id,
            traceId: run.traceId,
            snapshotId: snapshot.id,
            sourceEventId: snapshot.sourceEventId,
            position,
            total,
            status: "queued",
            queuedAt: Date.now(),
            config,
            matrixCellId: matrixCell?.cellId,
            matrixCellLabel: matrixCell
                ? `${matrixCell.profileLabel} x ${matrixCell.schemaLabel}`
                : undefined,
            event: createQueuedReplayEvent(snapshot, config, run, position, total, matrixCell),
        };
    }

    private resolveSnapshotReplayConfig(
        snapshot: InlineCompletionDebugReplayEventSnapshot,
        configModeOverride?: InlineCompletionDebugReplayCartConfigMode,
    ): InlineCompletionDebugReplayConfig {
        const configMode = configModeOverride ?? snapshot.configMode;
        if (configMode === "live") {
            return this.getCurrentReplayConfig();
        }

        return compactReplayConfig({
            ...snapshot.capturedConfig,
            ...(configMode === "override" ? compactPartialReplayConfig(snapshot.override) : {}),
        });
    }

    private resolveMatrixCellConfig(
        matrixCell: InlineCompletionDebugReplayMatrixCell,
    ): InlineCompletionDebugReplayConfig {
        return compactReplayConfig({
            ...this.getCurrentReplayConfig(),
            ...createInlineCompletionDebugPresetOverrides(matrixCell.profileId),
            profileId: matrixCell.profileId,
            schemaContext: {
                budgetProfile: matrixCell.schemaBudgetProfileId,
            },
        });
    }

    private startReplayQueueDrain(): void {
        if (this._replayDrainActive) {
            return;
        }

        this._replayDrainActive = true;
        void this.drainReplayQueue();
    }

    private async drainReplayQueue(): Promise<void> {
        try {
            while (!this.isDisposed) {
                const nextRow = this._replayState.queueRows[0];
                if (!nextRow) {
                    this.updateReplayState({
                        ...this._replayState,
                        activeRunId: undefined,
                    });
                    return;
                }

                const run = this._replayState.runs.find((item) => item.id === nextRow.runId);
                if (!run) {
                    this.updateReplayState({
                        ...this._replayState,
                        queueRows: this._replayState.queueRows.slice(1),
                    });
                    continue;
                }

                const startedAt = Date.now();
                this.updateReplayState({
                    ...this._replayState,
                    activeRunId: run.id,
                    runs: this._replayState.runs.map((item) =>
                        item.id === run.id
                            ? {
                                  ...item,
                                  status: item.status === "cancelled" ? "cancelled" : "running",
                                  activeMatrixCellId: nextRow.matrixCellId,
                              }
                            : item,
                    ),
                    queueRows: this._replayState.queueRows.map((item) =>
                        item.id === nextRow.id
                            ? {
                                  ...item,
                                  status: "running",
                                  startedAt,
                                  event: {
                                      ...item.event,
                                      timestamp: startedAt,
                                      result: "pending",
                                  },
                              }
                            : item,
                    ),
                });

                const tags = this.createReplayEventTags(nextRow);
                await this.replaySourceEvent(nextRow.event, {
                    overrides: nextRow.config,
                    tags,
                });

                this.completeReplayQueueRow(nextRow);
            }
        } finally {
            this._replayDrainActive = false;
            if (!this.isDisposed && this._replayState.queueRows.length > 0) {
                this.startReplayQueueDrain();
            }
        }
    }

    private completeReplayQueueRow(row: InlineCompletionDebugReplayQueueRow): void {
        const currentRun = this._replayState.runs.find((run) => run.id === row.runId);
        const completedEvents = (currentRun?.completedEvents ?? 0) + 1;
        const remainingRows = this._replayState.queueRows.filter((item) => item.id !== row.id);
        const runHasQueuedRows = remainingRows.some((item) => item.runId === row.runId);
        const updatedRuns = this._replayState.runs.map((run) => {
            if (run.id !== row.runId) {
                return run;
            }

            const status: InlineCompletionDebugReplayRun["status"] =
                run.status === "cancelled"
                    ? "cancelled"
                    : runHasQueuedRows
                      ? "running"
                      : "completed";
            return {
                ...run,
                completedEvents,
                status,
                activeMatrixCellId: runHasQueuedRows ? run.activeMatrixCellId : undefined,
                completedAt: runHasQueuedRows ? run.completedAt : Date.now(),
            };
        });

        this.updateReplayState({
            ...this._replayState,
            queueRows: remainingRows,
            runs: updatedRuns,
            activeRunId: remainingRows[0]?.runId,
        });
    }

    private cancelReplayRun(runId: string | undefined): void {
        const effectiveRunId = runId ?? this._replayState.activeRunId;
        if (!effectiveRunId) {
            return;
        }

        const remainingRows = this._replayState.queueRows.filter(
            (row) => row.runId !== effectiveRunId || row.status === "running",
        );
        const hasRunningRow = remainingRows.some((row) => row.runId === effectiveRunId);
        this.updateReplayState({
            ...this._replayState,
            queueRows: remainingRows,
            activeRunId: remainingRows[0]?.runId,
            runs: this._replayState.runs.map((run) =>
                run.id === effectiveRunId
                    ? {
                          ...run,
                          status: "cancelled",
                          completedAt: hasRunningRow ? run.completedAt : Date.now(),
                      }
                    : run,
            ),
        });
    }

    private createReplayEventTags(
        row: InlineCompletionDebugReplayQueueRow,
    ): InlineCompletionDebugEventTags {
        return {
            replayTraceId: row.traceId,
            replayRunId: row.runId,
            ...(row.matrixCellId ? { replayMatrixCellId: row.matrixCellId } : {}),
            replaySourceEventId: row.sourceEventId,
        };
    }

    private updateReplayState(next: InlineCompletionDebugReplayState): void {
        this._replayState = next;
        if (!this.isDisposed) {
            this.updateState(this.createState());
        }
    }

    private async replayEvent(eventId: string): Promise<void> {
        const sourceEvent = inlineCompletionDebugStore.getEvent(eventId);
        if (!sourceEvent) {
            return;
        }

        await this.replaySourceEvent(sourceEvent, { showPendingInLive: true });
    }

    private async replaySourceEvent(
        sourceEvent: InlineCompletionDebugEvent,
        options: {
            overrides?: InlineCompletionDebugReplayConfig;
            tags?: InlineCompletionDebugEventTags;
            showPendingInLive?: boolean;
        } = {},
    ): Promise<InlineCompletionDebugEvent | undefined> {
        const overrides = options.overrides ?? inlineCompletionDebugStore.getOverrides();
        const tags = options.tags;
        const replayTagLocals = getReplayTagLocals(tags, sourceEvent.id);
        const profile = getInlineCompletionDebugPresetProfile(overrides.profileId);
        const linePrefix = asString(sourceEvent.locals.linePrefix);
        const lineSuffix = asString(sourceEvent.locals.lineSuffix);
        const recentPrefix = asString(sourceEvent.locals.recentPrefix);
        const statementPrefix = asString(sourceEvent.locals.statementPrefix);
        const suffix = asString(sourceEvent.locals.suffix);
        const intentMode =
            overrides.forceIntentMode ?? profile?.forceIntentMode ?? sourceEvent.intentMode;
        const completionCategory = getInlineCompletionCategory(intentMode);
        const modelPreference = getInlineCompletionModelPreferenceForCategory(
            profile,
            completionCategory,
        );
        const replayStartedAt = Date.now();
        let pendingEventId: string | undefined;
        const recordReplayEvent = (
            event: Omit<InlineCompletionDebugEvent, "id">,
        ): InlineCompletionDebugEvent => {
            if (!pendingEventId) {
                return inlineCompletionDebugStore.addEvent(event);
            }

            return (
                inlineCompletionDebugStore.updateEvent(pendingEventId, event) ??
                inlineCompletionDebugStore.addEvent(event)
            );
        };
        if (options.showPendingInLive) {
            pendingEventId = inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: replayStartedAt,
                completionCategory,
                intentMode,
                result: "pending",
                latencyMs: 0,
                inputTokens: undefined,
                outputTokens: undefined,
                usedSchemaContext: false,
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: sourceEvent.promptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted: undefined,
                tags,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                    replayedAt: new Date(replayStartedAt).toISOString(),
                },
            }).id;
        }

        const selectedModel = await this.selectReplayModel(
            getModelSelectorForCompletionCategory(
                overrides,
                completionCategory,
                getConfiguredContinuationModelSelector(),
            ),
            modelPreference,
        );
        if (!selectedModel) {
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
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
                tags,
                locals: {
                    ...sourceEvent.locals,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                },
            });
        }

        const canSendRequest =
            this._extensionContext.languageModelAccessInformation?.canSendRequest(selectedModel);
        if (canSendRequest === false) {
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
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
                tags,
                locals: {
                    ...sourceEvent.locals,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                },
            });
        }

        const useSchemaContext =
            overrides.useSchemaContext ??
            profile?.useSchemaContext ??
            getConfiguredUseSchemaContext();
        const includeSqlDiagnostics =
            overrides.includeSqlDiagnostics ?? getConfiguredIncludeSqlDiagnostics();
        const sqlDiagnosticsText = includeSqlDiagnostics
            ? asString(sourceEvent.locals.sqlDiagnostics)
            : "";
        const schemaContextOverrides = getInlineCompletionProfileSchemaContextOverrides(
            profile,
            overrides.schemaContext,
        );
        const schemaContextSettings = getSqlInlineCompletionSchemaContextRuntimeSettings(
            selectedModel.maxInputTokens,
            schemaContextOverrides,
        );
        const replaySchemaContext = useSchemaContext
            ? await this.getReplaySchemaContext(
                  sourceEvent,
                  statementPrefix,
                  selectedModel.maxInputTokens,
                  schemaContextOverrides,
              )
            : {
                  schemaContext: undefined,
                  schemaContextText: "-- unavailable",
                  schemaContextSource: "disabled" as const,
                  schemaObjectCount: 0,
                  schemaSystemObjectCount: 0,
                  schemaForeignKeyCount: 0,
              };
        const schemaContextText = replaySchemaContext.schemaContextText;
        const rulesText = resolveInlineCompletionRules({
            customSystemPrompt: overrides.customSystemPrompt,
            inferredSystemQuery: sourceEvent.inferredSystemQuery,
            intentMode,
            schemaContextText,
            linePrefix,
            recentPrefix,
            statementPrefix,
            sqlDiagnosticsText,
        });
        const promptMessages = buildInlineCompletionPromptMessages({
            rulesText,
            intentMode,
            recentPrefix,
            statementPrefix,
            suffix,
            linePrefix,
            lineSuffix,
            sqlDiagnosticsText,
            schemaContextText,
            messageOrder: schemaContextSettings.messageOrder,
            schemaContextChannel: schemaContextSettings.schemaContextChannel,
        });
        const maxTokens =
            overrides.maxTokens ??
            profile?.maxTokens ??
            (intentMode ? intentModeMaxTokens : continuationModeMaxTokens);
        const startedAt = replayStartedAt;
        const cancellationTokenSource = new vscode.CancellationTokenSource();
        let replayInputTokens: number | undefined;
        let replayOutputTokens: number | undefined;
        if (pendingEventId) {
            recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: startedAt,
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result: "pending",
                latencyMs: 0,
                inputTokens: undefined,
                outputTokens: undefined,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount: replaySchemaContext.schemaObjectCount,
                schemaSystemObjectCount: replaySchemaContext.schemaSystemObjectCount,
                schemaForeignKeyCount: replaySchemaContext.schemaForeignKeyCount,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map(toDebugPromptMessage),
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                tags,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    useSchemaContext,
                    includeSqlDiagnostics,
                    effectiveMaxTokens: maxTokens,
                    sqlDiagnostics: sqlDiagnosticsText,
                    "sqlDiagnostics.length": sqlDiagnosticsText.length,
                    ...replayTagLocals,
                    replaySchemaContextSource: replaySchemaContext.schemaContextSource,
                    schemaBudgetProfile: schemaContextSettings.budgetProfile,
                    schemaSizeKind:
                        replaySchemaContext.schemaContext?.selectionMetadata?.schemaSizeKind,
                    schemaDegradationSteps:
                        replaySchemaContext.schemaContext?.selectionMetadata?.degradationSteps.join(
                            ",",
                        ) ?? "",
                    schemaMessageOrder: schemaContextSettings.messageOrder,
                    schemaContextChannel: schemaContextSettings.schemaContextChannel,
                    replayedAt: new Date(startedAt).toISOString(),
                },
            });
        }

        try {
            replayInputTokens = await countLanguageModelTokens(
                selectedModel,
                promptMessages,
                cancellationTokenSource.token,
            );
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
            replayOutputTokens = await countLanguageModelTokens(
                selectedModel,
                rawResponse,
                cancellationTokenSource.token,
            );
            const sanitizedResponse = sanitizeInlineCompletionText(
                rawResponse,
                getEffectiveMaxCompletionChars(
                    intentMode ? 2000 : 400,
                    overrides.maxTokens ?? profile?.maxTokens,
                ),
                linePrefix,
                intentMode,
            );
            let finalCompletionText = fixLeadingWhitespace(
                sanitizedResponse,
                linePrefix,
                undefined,
                intentMode,
            );
            finalCompletionText = suppressDocumentSuffixOverlap(finalCompletionText, suffix);
            const result = !sanitizedResponse
                ? rawResponse.trim()
                    ? "emptyFromSanitizer"
                    : "emptyFromModel"
                : finalCompletionText
                  ? "success"
                  : "emptyFromSanitizer";

            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result,
                latencyMs: Date.now() - startedAt,
                inputTokens: replayInputTokens,
                outputTokens: replayOutputTokens,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount: replaySchemaContext.schemaObjectCount,
                schemaSystemObjectCount: replaySchemaContext.schemaSystemObjectCount,
                schemaForeignKeyCount: replaySchemaContext.schemaForeignKeyCount,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map(toDebugPromptMessage),
                rawResponse,
                sanitizedResponse,
                finalCompletionText,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                tags,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    useSchemaContext,
                    includeSqlDiagnostics,
                    effectiveMaxTokens: maxTokens,
                    sqlDiagnostics: sqlDiagnosticsText,
                    "sqlDiagnostics.length": sqlDiagnosticsText.length,
                    ...replayTagLocals,
                    replaySchemaContextSource: replaySchemaContext.schemaContextSource,
                    schemaBudgetProfile: schemaContextSettings.budgetProfile,
                    schemaSizeKind:
                        replaySchemaContext.schemaContext?.selectionMetadata?.schemaSizeKind,
                    schemaDegradationSteps:
                        replaySchemaContext.schemaContext?.selectionMetadata?.degradationSteps.join(
                            ",",
                        ) ?? "",
                    schemaMessageOrder: schemaContextSettings.messageOrder,
                    schemaContextChannel: schemaContextSettings.schemaContextChannel,
                    replayedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result: "error",
                latencyMs: Date.now() - startedAt,
                inputTokens: replayInputTokens,
                outputTokens: replayOutputTokens,
                usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                schemaObjectCount: replaySchemaContext.schemaObjectCount,
                schemaSystemObjectCount: replaySchemaContext.schemaSystemObjectCount,
                schemaForeignKeyCount: replaySchemaContext.schemaForeignKeyCount,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: promptMessages.map(toDebugPromptMessage),
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                schemaContextFormatted:
                    useSchemaContext && schemaContextText !== "-- unavailable"
                        ? schemaContextText
                        : undefined,
                tags,
                locals: {
                    ...sourceEvent.locals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    useSchemaContext,
                    includeSqlDiagnostics,
                    effectiveMaxTokens: maxTokens,
                    sqlDiagnostics: sqlDiagnosticsText,
                    "sqlDiagnostics.length": sqlDiagnosticsText.length,
                    ...replayTagLocals,
                    replaySchemaContextSource: replaySchemaContext.schemaContextSource,
                    schemaBudgetProfile: schemaContextSettings.budgetProfile,
                    schemaSizeKind:
                        replaySchemaContext.schemaContext?.selectionMetadata?.schemaSizeKind,
                    schemaDegradationSteps:
                        replaySchemaContext.schemaContext?.selectionMetadata?.degradationSteps.join(
                            ",",
                        ) ?? "",
                    schemaMessageOrder: schemaContextSettings.messageOrder,
                    schemaContextChannel: schemaContextSettings.schemaContextChannel,
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

    private async getReplaySchemaContext(
        sourceEvent: InlineCompletionDebugEvent,
        statementPrefix: string,
        modelMaxInputTokens: number | undefined,
        schemaContextOverrides: InlineCompletionDebugSchemaContextOverrides | null | undefined,
    ): Promise<ReplaySchemaContextResult> {
        if (this._schemaContextService) {
            try {
                const refreshedContext =
                    await this._schemaContextService.getSchemaContextForOwnerUri(
                        sourceEvent.documentUri,
                        statementPrefix,
                        modelMaxInputTokens,
                        schemaContextOverrides,
                    );
                if (refreshedContext) {
                    const schemaContext = {
                        ...refreshedContext,
                        inferredSystemQuery: sourceEvent.inferredSystemQuery,
                    };
                    return {
                        schemaContext,
                        schemaContextText: formatSchemaContextForPrompt(
                            schemaContext,
                            sourceEvent.inferredSystemQuery,
                        ),
                        schemaContextSource: "current",
                        schemaObjectCount: schemaContext.tables.length + schemaContext.views.length,
                        schemaSystemObjectCount:
                            (schemaContext.systemObjects?.length ?? 0) +
                            schemaContext.masterSymbols.length,
                        schemaForeignKeyCount: getForeignKeyCount(schemaContext),
                    };
                }
            } catch (error) {
                this._logger.warn(
                    `Failed to refresh schema context for inline completion replay: ${getErrorMessage(
                        error,
                    )}`,
                );
            }
        }

        if (sourceEvent.schemaContextFormatted) {
            return {
                schemaContext: undefined,
                schemaContextText: sourceEvent.schemaContextFormatted,
                schemaContextSource: "captured",
                schemaObjectCount: sourceEvent.schemaObjectCount,
                schemaSystemObjectCount: sourceEvent.schemaSystemObjectCount,
                schemaForeignKeyCount: sourceEvent.schemaForeignKeyCount,
            };
        }

        return {
            schemaContext: undefined,
            schemaContextText: "-- unavailable",
            schemaContextSource: "unavailable",
            schemaObjectCount: 0,
            schemaSystemObjectCount: 0,
            schemaForeignKeyCount: 0,
        };
    }

    private async selectReplayModel(
        modelSelectorOverride: string | undefined,
        modelPreference: InlineCompletionModelPreference | undefined,
    ): Promise<vscode.LanguageModelChat | undefined> {
        const effectiveSelector =
            modelSelectorOverride ?? (modelPreference ? undefined : getConfiguredModelSelector());
        const all = await selectConfiguredLanguageModels();
        if (effectiveSelector) {
            const matched = matchLanguageModelChatToSelector(all, effectiveSelector);
            if (matched) {
                return matched;
            }
        }

        return selectPreferredModel(all, modelPreference);
    }
}

function createState(options: {
    availableModels: InlineCompletionDebugModelOption[];
    effectiveDefaultModelOption: InlineCompletionDebugModelOption | undefined;
    sessions: InlineCompletionDebugSessionsState;
    replay: InlineCompletionDebugReplayState;
    selectedEventId: string | undefined;
    customPromptDialogOpen: boolean;
    customPromptValue: string | null;
    customPromptLastSavedAt: number | undefined;
}): InlineCompletionDebugWebviewState {
    const overrides = inlineCompletionDebugStore.getOverrides();
    const configuredProfileId = getConfiguredInlineCompletionProfileId();
    const effectiveProfileId = overrides.profileId ?? configuredProfileId;
    const profile = getInlineCompletionDebugPresetProfile(effectiveProfileId);
    const configuredModelSelector = getConfiguredModelSelector();
    const configuredContinuationModelSelector = getConfiguredContinuationModelSelector();
    const continuationModelPreference = profile?.continuationModelPreference;
    const effectiveOption =
        (profile ? undefined : options.effectiveDefaultModelOption) ??
        pickDefaultModelOption(
            options.availableModels,
            configuredModelSelector,
            profile?.modelPreference,
        );
    const effectiveContinuationOption = configuredContinuationModelSelector
        ? pickConfiguredModelOption(
              options.availableModels,
              configuredContinuationModelSelector,
              continuationModelPreference ?? profile?.modelPreference,
          )
        : continuationModelPreference
          ? pickDefaultModelOption(options.availableModels, undefined, continuationModelPreference)
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
        availableModels: options.availableModels,
        selectedEventId: options.selectedEventId,
        recordWhenClosed: getRecordWhenClosedSetting(),
        customPrompt: {
            dialogOpen: options.customPromptDialogOpen,
            savedValue: options.customPromptValue,
            defaultValue: DEFAULT_CUSTOM_PROMPT,
            lastSavedAt: options.customPromptLastSavedAt,
        },
        sessions: options.sessions,
        replay: options.replay,
    };
}

function createEmptyReplayState(): InlineCompletionDebugReplayState {
    return {
        cart: [],
        runs: [],
        queueRows: [],
        builderOpen: false,
    };
}

function createEmptySessionsState(traceFolder: string): InlineCompletionDebugSessionsState {
    return {
        traceFolder,
        traceCaptureEnabled: getTraceCaptureEnabledSetting(),
        traceIndex: [],
        loadedTraces: [],
        loading: false,
    };
}

function mergeTraceIndexEntries(
    primaryEntries: InlineCompletionDebugSessionsState["traceIndex"],
    secondaryEntries: InlineCompletionDebugSessionsState["traceIndex"],
): InlineCompletionDebugSessionsState["traceIndex"] {
    const byKey = new Map<string, InlineCompletionDebugSessionsState["traceIndex"][number]>();
    for (const entry of [...secondaryEntries, ...primaryEntries]) {
        byKey.set(entry.fileKey, {
            ...byKey.get(entry.fileKey),
            ...entry,
        });
    }

    return Array.from(byKey.values()).sort(
        (left, right) =>
            (right.savedAt ?? "").localeCompare(left.savedAt ?? "") ||
            left.filename.localeCompare(right.filename),
    );
}

function dedupeLoadedTraces(
    traces: InlineCompletionDebugSessionsState["loadedTraces"],
): InlineCompletionDebugSessionsState["loadedTraces"] {
    const byKey = new Map<string, InlineCompletionDebugSessionsState["loadedTraces"][number]>();
    for (const trace of traces) {
        byKey.set(trace.fileKey, trace);
    }
    return Array.from(byKey.values());
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

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function cloneJson<T>(value: T): T {
    if (value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function compactReplayConfig(
    config: Partial<InlineCompletionDebugReplayConfig>,
): InlineCompletionDebugReplayConfig {
    return {
        profileId: getInlineCompletionDebugProfileId(config.profileId) ?? null,
        modelSelector: normalizeStringOrNull(config.modelSelector),
        continuationModelSelector: normalizeStringOrNull(config.continuationModelSelector),
        useSchemaContext: normalizeBooleanOrNull(config.useSchemaContext),
        includeSqlDiagnostics: normalizeBooleanOrNull(config.includeSqlDiagnostics),
        debounceMs: normalizeNumberOrNull(config.debounceMs),
        maxTokens: normalizeNumberOrNull(config.maxTokens),
        enabledCategories: Array.isArray(config.enabledCategories)
            ? inlineCompletionCategories.filter((category) =>
                  config.enabledCategories?.includes(category),
              )
            : null,
        forceIntentMode: normalizeBooleanOrNull(config.forceIntentMode),
        customSystemPrompt: normalizeStringOrNull(config.customSystemPrompt, true),
        allowAutomaticTriggers: normalizeBooleanOrNull(config.allowAutomaticTriggers),
        schemaContext: isRecord(config.schemaContext)
            ? (cloneJson(config.schemaContext) as InlineCompletionDebugSchemaContextOverrides)
            : null,
    };
}

function compactPartialReplayConfig(
    config: Partial<InlineCompletionDebugReplayConfig> | null | undefined,
): Partial<InlineCompletionDebugReplayConfig> {
    if (!config) {
        return {};
    }

    const output: Partial<InlineCompletionDebugReplayConfig> = {};
    for (const key of Object.keys(config) as Array<keyof InlineCompletionDebugReplayConfig>) {
        const value = config[key];
        if (value !== undefined) {
            (output as Record<string, unknown>)[key] = cloneJson(value);
        }
    }
    return output;
}

function normalizeStringOrNull(value: unknown, preserveWhitespace: boolean = false): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = preserveWhitespace ? value : value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeBooleanOrNull(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function normalizeNumberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getInlineCompletionDebugProfileId(
    value: unknown,
): InlineCompletionDebugProfileId | undefined {
    return inlineCompletionDebugProfileOptions.find((profile) => profile.id === value)?.id;
}

function getSchemaBudgetProfileId(
    value: unknown,
): InlineCompletionSchemaBudgetProfileId | undefined {
    return typeof value === "string" &&
        (["tight", "balanced", "generous", "unlimited", "custom"] as string[]).includes(value)
        ? (value as InlineCompletionSchemaBudgetProfileId)
        : undefined;
}

function getSchemaBudgetProfileLabel(profileId: InlineCompletionSchemaBudgetProfileId): string {
    switch (profileId) {
        case "tight":
            return "Tight";
        case "balanced":
            return "Balanced";
        case "generous":
            return "Generous";
        case "unlimited":
            return "Unlimited";
        case "custom":
            return "Custom";
    }
}

function moveReplayCartItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
    if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= items.length ||
        toIndex >= items.length ||
        fromIndex === toIndex
    ) {
        return items;
    }

    const next = [...items];
    const [item] = next.splice(fromIndex, 1);
    if (item !== undefined) {
        next.splice(toIndex, 0, item);
    }
    return next;
}

function formatReplayTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function getReplayTagLocals(
    tags: InlineCompletionDebugEventTags | undefined,
    fallbackSourceEventId: string,
): Record<string, string> {
    return {
        ...(tags?.replayTraceId ? { replayTraceId: tags.replayTraceId } : {}),
        ...(tags?.replayRunId ? { replayRunId: tags.replayRunId } : {}),
        ...(tags?.replayMatrixCellId ? { replayMatrixCellId: tags.replayMatrixCellId } : {}),
        replaySourceEventId: tags?.replaySourceEventId ?? fallbackSourceEventId,
    };
}

function createQueuedReplayEvent(
    snapshot: InlineCompletionDebugReplayEventSnapshot,
    config: InlineCompletionDebugReplayConfig,
    run: InlineCompletionDebugReplayRun,
    position: number,
    total: number,
    matrixCell: InlineCompletionDebugReplayMatrixCell | undefined,
): InlineCompletionDebugEvent {
    const tags: InlineCompletionDebugEventTags = {
        replayTraceId: run.traceId,
        replayRunId: run.id,
        ...(matrixCell ? { replayMatrixCellId: matrixCell.cellId } : {}),
        replaySourceEventId: snapshot.sourceEventId,
    };
    return {
        ...cloneJson(snapshot.event),
        id: `R-${position}`,
        timestamp: Date.now(),
        triggerKind: "invoke",
        explicitFromUser: true,
        result: "queued",
        latencyMs: 0,
        inputTokens: undefined,
        outputTokens: undefined,
        modelFamily:
            config.modelSelector ??
            config.continuationModelSelector ??
            snapshot.event.modelFamily ??
            "default",
        rawResponse: "",
        sanitizedResponse: undefined,
        finalCompletionText: undefined,
        tags,
        locals: {
            ...snapshot.event.locals,
            ...getReplayTagLocals(tags, snapshot.sourceEventId),
            replayQueuedAt: new Date().toISOString(),
            replayQueuePosition: position,
            replayQueueTotal: total,
            replayMatrixCellLabel: matrixCell
                ? `${matrixCell.profileLabel} x ${matrixCell.schemaLabel}`
                : undefined,
        },
    };
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
        completionCategory:
            event.completionCategory ?? getInlineCompletionCategory(event.intentMode),
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
        tags: event.tags ? { ...event.tags } : undefined,
        locals: event.locals,
        error: event.error,
    };
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

function getForeignKeyCount(schemaContext: SqlInlineCompletionSchemaContext | undefined): number {
    return (schemaContext?.tables ?? []).reduce(
        (sum, table) => sum + (table.foreignKeys?.length ?? 0),
        0,
    );
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

function getOverridesApplied(overrides: InlineCompletionDebugOverrides) {
    return {
        ...(overrides.profileId ? { profileId: overrides.profileId } : {}),
        ...(overrides.modelSelector ? { modelSelector: overrides.modelSelector } : {}),
        ...(overrides.continuationModelSelector
            ? { continuationModelSelector: overrides.continuationModelSelector }
            : {}),
        ...(overrides.useSchemaContext !== null
            ? { useSchemaContext: overrides.useSchemaContext }
            : {}),
        ...(overrides.includeSqlDiagnostics !== null
            ? { includeSqlDiagnostics: overrides.includeSqlDiagnostics }
            : {}),
        ...(overrides.debounceMs !== null ? { debounceMs: overrides.debounceMs } : {}),
        ...(overrides.maxTokens !== null ? { maxTokens: overrides.maxTokens } : {}),
        ...(overrides.enabledCategories !== null
            ? { enabledCategories: overrides.enabledCategories }
            : {}),
        ...(overrides.schemaContext ? { schemaContext: overrides.schemaContext } : {}),
        customSystemPromptUsed: !!overrides.customSystemPrompt,
    };
}
