/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay domain service for Inline Completion Debug (final plan WI-1.1,
 * addendum §6.1): owns the generic FeatureReplayEngine and everything
 * completions-specific around it — the replay host callbacks, the
 * replaySourceEvent re-execution engine (schema-context refresh/fallback,
 * model selection, prompt rebuild, sanitize pipeline, error/permission/
 * no-model terminal shapes), queued-event creation, config compaction,
 * matrix-cell resolution, cart operations (incl. the builder-open cart
 * snapshot/restore semantics), and run cancellation.
 *
 * One instance per viewer host; replay results are recorded into the shared
 * singleton inlineCompletionDebugStore so every viewer sees them live.
 */

import * as vscode from "vscode";
import { logger2 } from "../../../models/logger2";
import { getErrorMessage } from "../../../utils/utils";
import {
    FeatureReplayEngine,
    FeatureReplayHost,
    FeatureReplayRunObserver,
} from "../../../diagnostics/featureCapture/replayEngine";
import { ReplayRunRepository } from "../../../diagnostics/featureCapture/replayRunRepository";
import {
    buildInlineCompletionPromptMessages,
    collectText,
    continuationModeMaxTokens,
    createLanguageModelMaxTokenOptions,
    fixLeadingWhitespace,
    formatSchemaContextForPrompt,
    getEffectiveMaxCompletionChars,
    getInlineCompletionCategory,
    intentModeMaxTokens,
    resolveInlineCompletionRules,
    sanitizeInlineCompletionText,
    selectPreferredModel,
    suppressDocumentSuffixOverlap,
} from "../../sqlInlineCompletionProvider";
import {
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    SqlInlineCompletionSchemaContext,
} from "../../completionSchemaContextCore";
import { CompletionSchemaContextService } from "../../completionSchemaContextService";
import {
    matchLanguageModelChatToSelector,
    selectConfiguredLanguageModels,
} from "../../languageModelSelection";
import {
    createInlineCompletionDebugPresetOverrides,
    getInlineCompletionDebugPresetProfile,
    getInlineCompletionModelPreferenceForCategory,
    getInlineCompletionProfileSchemaContextOverrides,
    inlineCompletionDebugCustomProfileId,
    inlineCompletionDebugProfileOptions,
    InlineCompletionModelPreference,
} from "../inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "../inlineCompletionDebugStore";
import {
    InlineCompletionCategory,
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventTags,
    InlineCompletionDebugExportData,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugPromptMessage,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugReplayCartResolvedItem,
    InlineCompletionDebugReplayCartConfigMode,
    InlineCompletionDebugReplayConfig,
    InlineCompletionDebugReplayEventSnapshot,
    InlineCompletionDebugReplayMatrixCell,
    InlineCompletionDebugReplayRun,
    InlineCompletionDebugReplayState,
    InlineCompletionDebugSchemaContextOverrides,
    InlineCompletionSchemaBudgetProfileId,
    inlineCompletionCategories,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import {
    FeatureReplayCancellationToken,
    FeatureReplayExecuteResult,
} from "../../../sharedInterfaces/featureReplay";
import { createInlineCompletionConfigGroup } from "../inlineCompletionConfigGroups";
import { createCompletionsReplayRunRepository } from "../completionsReplayRunPersistence";
import {
    getConfiguredContinuationModelSelector,
    getConfiguredIncludeSqlDiagnostics,
    getConfiguredModelSelector,
    getConfiguredUseSchemaContext,
    InlineCompletionCaptureService,
} from "./inlineCompletionCaptureService";
import { isRecord } from "./inlineCompletionDebugConstants";

export interface InlineCompletionReplayServiceDeps {
    extensionContext: vscode.ExtensionContext;
    schemaContextService: CompletionSchemaContextService | undefined;
    captureService: InlineCompletionCaptureService;
}

interface ReplaySchemaContextResult {
    schemaContext: SqlInlineCompletionSchemaContext | undefined;
    schemaContextText: string;
    schemaContextSource: "current" | "captured" | "unavailable" | "disabled";
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
}

/** Per-run lookups the durable item records need (durable ids, group ids). */
interface ReplayRunPersistLookup {
    /** ring source event id → durable captureEventId used in the manifest. */
    sourceCaptureIds: Map<string, string>;
    /** frozen config digest → config group id. */
    groupIdsByDigest: Map<string, string>;
}

export class InlineCompletionReplayService {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
    private readonly _replayEngine: FeatureReplayEngine<
        InlineCompletionDebugEvent,
        InlineCompletionDebugReplayConfig,
        InlineCompletionDebugReplayMatrixCell
    >;
    /** Durable run persistence (WI-3.3); undefined when the store is unwired. */
    private readonly _runRepository: ReplayRunRepository | undefined;
    private readonly _runPersistLookups = new Map<string, ReplayRunPersistLookup>();
    private _replayCartDialogSnapshot: InlineCompletionDebugReplayEventSnapshot[] | undefined;
    private _disposed = false;

    /** Fires after every replay engine state change (cart/queue/run progress). */
    public readonly onDidChange = this._onDidChangeEmitter.event;

    constructor(private readonly _deps: InlineCompletionReplayServiceDeps) {
        this._runRepository = createCompletionsReplayRunRepository();
        this._replayEngine = new FeatureReplayEngine(this.createReplayHost(), {
            observer: this.createRunObserver(),
        });
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        // Engine dispose marks interrupted runs `partial` (never silently
        // lose run evidence) and notifies the observer BEFORE the repository
        // flushes its final manifests.
        this._replayEngine.dispose();
        void this._runRepository?.dispose();
        this._runPersistLookups.clear();
        this._onDidChangeEmitter.dispose();
    }

    public getState(): InlineCompletionDebugReplayState {
        return this._replayEngine.getState();
    }

    // ------------------------------------------------------------------ cart

    /** Builder open snapshots the cart so Cancel can restore it verbatim. */
    public openBuilder(): void {
        this._replayCartDialogSnapshot = cloneJson(this._replayEngine.getState().cart);
        this._replayEngine.setBuilderOpen(true);
    }

    public closeBuilder(restoreCart: boolean): void {
        if (restoreCart && this._replayCartDialogSnapshot) {
            this._replayEngine.replaceCart(cloneJson(this._replayCartDialogSnapshot));
        }
        this._replayCartDialogSnapshot = undefined;
        this._replayEngine.setBuilderOpen(false);
    }

    public addEventsToCart(items: InlineCompletionDebugReplayCartResolvedItem[]): void {
        this._replayEngine.addToCart(items);
    }

    /** Add every event of a loaded session trace to the cart. */
    public addTraceToCart(trace: InlineCompletionDebugExportData, fileKey: string): void {
        this.addEventsToCart(
            trace.events.map((event) => ({
                event,
                sourceLabel: formatTraceSourceLabel(trace, fileKey),
            })),
        );
    }

    /** Queue a loaded session trace directly (bypassing the cart) in live-config mode. */
    public queueTrace(trace: InlineCompletionDebugExportData, fileKey: string): void {
        this._replayEngine.queueEvents(
            trace.events,
            "single",
            formatTraceSourceLabel(trace, fileKey),
            "live",
        );
    }

    public removeFromCart(snapshotId: string): void {
        this._replayEngine.removeFromCart(snapshotId);
    }

    public moveCartItem(fromIndex: number, toIndex: number): void {
        this._replayEngine.moveCartItem(fromIndex, toIndex);
    }

    public clearCart(): void {
        this._replayEngine.clearCart();
    }

    public reverseCart(): void {
        this._replayEngine.reverseCart();
    }

    public setCartOverride(
        snapshotId: string,
        override: Partial<InlineCompletionDebugReplayConfig> | null,
    ): void {
        this.updateReplayCartSnapshot(snapshotId, {
            override: override ? cloneJson(override) : null,
            configMode: override ? "override" : "snapshot",
        });
    }

    public setCartConfigMode(
        snapshotId: string,
        configMode: InlineCompletionDebugReplayCartConfigMode,
    ): void {
        this.updateReplayCartSnapshot(snapshotId, { configMode });
    }

    // ----------------------------------------------------------------- runs

    public queueCart(configMode?: InlineCompletionDebugReplayCartConfigMode): void {
        this._replayEngine.queueCart(configMode);
    }

    public runMatrix(
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

        this._replayEngine.runMatrix(cells);
    }

    public cancelRun(runId: string | undefined): void {
        this._replayEngine.cancelRun(runId);
    }

    /** Replay a live-ring event by id, showing the pending row in Live. */
    public async replayEvent(eventId: string): Promise<void> {
        const sourceEvent = inlineCompletionDebugStore.getEvent(eventId);
        if (!sourceEvent) {
            return;
        }

        await this.replaySourceEvent(sourceEvent, { showPendingInLive: true });
    }

    /**
     * Re-execute one captured completion event against the live model with
     * the given config: rebuilds the prompt from captured locals, refreshes
     * schema context when the schema service can (falling back to the
     * captured text), and records pending/terminal events into the shared
     * store with replay tags.
     */
    public async replaySourceEvent(
        sourceEvent: InlineCompletionDebugEvent,
        options: {
            overrides?: InlineCompletionDebugReplayConfig;
            tags?: InlineCompletionDebugEventTags;
            showPendingInLive?: boolean;
            /** Engine-run cancellation (addendum §7.4): threaded into the
             *  model request and response collection. */
            cancellation?: FeatureReplayCancellationToken;
        } = {},
    ): Promise<InlineCompletionDebugEvent | undefined> {
        const overrides = options.overrides ?? inlineCompletionDebugStore.getOverrides();
        const tags = options.tags;
        const replayTagLocals = getReplayTagLocals(tags, sourceEvent.id);
        // Durable identity for the replayed RESULT event (link id = the §7.3
        // "result capture event ID"), caused by the source event when it has
        // a durable id of its own.
        const replayLink = inlineCompletionDebugStore.createEventLink({
            causeEventId: sourceEvent.link?.captureEventId,
        });
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
            eventInput: Omit<InlineCompletionDebugEvent, "id">,
        ): InlineCompletionDebugEvent => {
            const event = { ...eventInput, link: replayLink };
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
                link: replayLink,
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
            this._deps.extensionContext.languageModelAccessInformation?.canSendRequest(
                selectedModel,
            );
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
        // Bridge the engine's webview-free token into the vscode token that
        // rides the LM request/response APIs (addendum §7.4).
        let cancellationBridge: { dispose(): void } | undefined;
        if (options.cancellation) {
            if (options.cancellation.isCancellationRequested) {
                cancellationTokenSource.cancel();
            } else {
                cancellationBridge = options.cancellation.onCancellationRequested(() =>
                    cancellationTokenSource.cancel(),
                );
            }
        }
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
            // A cancel that interrupted the request is a "cancelled" result,
            // not an error (honesty: the model was cut off, it didn't fail).
            const wasCancelled = cancellationTokenSource.token.isCancellationRequested;
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                timestamp: Date.now(),
                completionCategory,
                intentMode,
                modelFamily: selectedModel.family,
                modelId: selectedModel.id,
                modelVendor: selectedModel.vendor,
                result: wasCancelled ? "cancelled" : "error",
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
            cancellationBridge?.dispose();
            cancellationTokenSource.dispose();
        }
    }

    // -------------------------------------------------------------- internal

    private createReplayHost(): FeatureReplayHost<
        InlineCompletionDebugEvent,
        InlineCompletionDebugReplayConfig,
        InlineCompletionDebugReplayMatrixCell
    > {
        return {
            feature: "completions",
            isRunnable: (event) => event.result !== "pending" && event.result !== "queued",
            captureConfig: (event) => this.createCapturedReplayConfig(event),
            resolveLiveConfig: () => this.getCurrentReplayConfig(),
            compactConfig: (config) => compactReplayConfig(config),
            compactPartialConfig: (partial) => compactPartialReplayConfig(partial),
            resolveMatrixCellConfig: (cell) =>
                compactReplayConfig({
                    ...this.getCurrentReplayConfig(),
                    ...createInlineCompletionDebugPresetOverrides(cell.profileId),
                    profileId: cell.profileId,
                    schemaContext: {
                        budgetProfile: cell.schemaBudgetProfileId,
                    },
                }),
            formatCellLabel: (cell) => `${cell.profileLabel} x ${cell.schemaLabel}`,
            formatSourceLabel: (event) => `Live · ${formatReplayTime(event.timestamp)}`,
            createQueuedEvent: (snapshot, config, run, position, total, cell) =>
                createQueuedReplayEvent(snapshot, config, run, position, total, cell),
            markEventRunning: (event, startedAt) => ({
                ...event,
                timestamp: startedAt,
                result: "pending",
            }),
            execute: async (event, config, tags, cancellation) => {
                const recorded = await this.replaySourceEvent(event, {
                    overrides: config,
                    tags: {
                        replayTraceId: tags.replayTraceId,
                        replayRunId: tags.replayRunId,
                        ...(tags.replayMatrixCellId
                            ? { replayMatrixCellId: tags.replayMatrixCellId }
                            : {}),
                        replaySourceEventId: tags.replaySourceEventId,
                    },
                    cancellation,
                });
                if (!recorded) {
                    return undefined;
                }
                const result: FeatureReplayExecuteResult = {
                    resultEventId: recorded.id,
                    ...(recorded.link
                        ? { resultCaptureEventId: recorded.link.captureEventId }
                        : {}),
                    ...(recorded.result === "cancelled"
                        ? { cancellationOutcome: "cancelledInFlight" as const }
                        : {}),
                };
                return result;
            },
            // §7.5: pre-queue cost estimate — sources × cells × 1 repetition,
            // input tokens summed from captured events where present.
            estimate: (sources, cells, repetitions) => {
                const reps = repetitions ?? 1;
                const cellCount = Math.max(cells.length, 1);
                const totalExecutions = sources.length * cellCount * reps;
                const knownInputTokens = sources
                    .map((snapshot) => snapshot.event.inputTokens)
                    .filter((tokens): tokens is number => typeof tokens === "number");
                const estimatedInputTokens =
                    knownInputTokens.length > 0
                        ? knownInputTokens.reduce((sum, tokens) => sum + tokens, 0) *
                          cellCount *
                          reps
                        : undefined;
                const warnings: string[] = [];
                if (totalExecutions > 100) {
                    // Same threshold as the matrix builder's over-100 warning.
                    warnings.push(
                        `Large run: ${totalExecutions} model calls (over the 100-completion warning threshold).`,
                    );
                }
                return {
                    sourceItems: sources.length,
                    matrixCells: cells.length,
                    repetitions: reps,
                    totalExecutions,
                    ...(estimatedInputTokens !== undefined ? { estimatedInputTokens } : {}),
                    warnings,
                };
            },
            classifySafety: () => ({
                sideEffectClass: "none",
                targetBinding: "none",
                requiresConfirmation: false,
                requiresSandbox: false,
                reasons: ["model call only"],
            }),
            onStateChanged: () => {
                if (!this._disposed) {
                    this._onDidChangeEmitter.fire();
                }
            },
            isDisposed: () => this._disposed,
        };
    }

    /**
     * Durable-state observer (WI-3.3): forwards run/item lifecycle into the
     * replay run repository. Everything here is fire-and-forget and
     * failure-isolated — persistence never affects a run.
     */
    private createRunObserver():
        | FeatureReplayRunObserver<
              InlineCompletionDebugEvent,
              InlineCompletionDebugReplayConfig,
              InlineCompletionDebugReplayMatrixCell
          >
        | undefined {
        const repository = this._runRepository;
        if (!repository) {
            return undefined;
        }
        return {
            onRunQueued: (run, items) => {
                const lookup: ReplayRunPersistLookup = {
                    sourceCaptureIds: new Map(),
                    groupIdsByDigest: new Map(),
                };
                const configGroups = new Map<
                    string,
                    ReturnType<typeof createInlineCompletionConfigGroup>
                >();
                const cellGroupIds = new Map<string, string>();
                const sources = new Map<
                    string,
                    {
                        captureSessionId?: string;
                        captureEventId: string;
                        label: string;
                        snapshotJson: unknown;
                    }
                >();
                for (const item of items) {
                    if (!configGroups.has(item.configDigest)) {
                        configGroups.set(
                            item.configDigest,
                            createInlineCompletionConfigGroup(
                                item.config,
                                item.matrixCellLabel ?? formatConfigGroupLabel(item.config),
                            ),
                        );
                    }
                    const group = configGroups.get(item.configDigest)!;
                    lookup.groupIdsByDigest.set(item.configDigest, group.configGroupId);
                    if (item.matrixCellId && !cellGroupIds.has(item.matrixCellId)) {
                        cellGroupIds.set(item.matrixCellId, group.configGroupId);
                    }
                    if (!sources.has(item.sourceEventId)) {
                        // Durable identity when the event carries a link;
                        // ring/display id as the honest fallback for legacy
                        // captures that never got one.
                        const captureEventId =
                            item.sourceEvent.link?.captureEventId ?? item.sourceEventId;
                        sources.set(item.sourceEventId, {
                            captureSessionId: item.sourceEvent.link?.captureSessionId,
                            captureEventId,
                            label: item.sourceLabel,
                            snapshotJson: item.sourceEvent,
                        });
                        lookup.sourceCaptureIds.set(item.sourceEventId, captureEventId);
                    }
                }
                this._runPersistLookups.set(run.id, lookup);
                void repository
                    .beginRun({
                        replayRunId: run.id,
                        createdAt: run.startedAt,
                        sources: [...sources.values()],
                        configGroups: [...configGroups.values()],
                        cells: (run.matrixCells ?? []).map((cell) => ({
                            matrixCellId: cell.cellId,
                            configGroupId: cellGroupIds.get(cell.cellId) ?? "",
                            label: `${cell.profileLabel} x ${cell.schemaLabel}`,
                            ordinal: cell.ordinal,
                        })),
                        repetitions: 1,
                        expectedItems: run.totalEvents,
                        ...(run.estimate ? { estimate: run.estimate } : {}),
                        ...(run.safety ? { safety: run.safety } : {}),
                    })
                    .then((durable) => {
                        if (durable && !this._disposed) {
                            this._replayEngine.setRunDurable(run.id, true);
                        }
                    });
            },
            onRunUpdated: (run) => {
                repository.noteRunStatus({ replayRunId: run.id, status: run.status });
                if (
                    run.status === "completed" ||
                    run.status === "cancelled" ||
                    run.status === "partial" ||
                    run.status === "failed"
                ) {
                    this._runPersistLookups.delete(run.id);
                }
            },
            onItemSettled: (outcome) => {
                const lookup = this._runPersistLookups.get(outcome.runId);
                repository.recordItem(outcome.runId, {
                    replayItemId: outcome.replayItemId,
                    sourceCaptureEventId:
                        lookup?.sourceCaptureIds.get(outcome.sourceEventId) ??
                        outcome.sourceEventId,
                    ...(outcome.matrixCellId ? { matrixCellId: outcome.matrixCellId } : {}),
                    ...(lookup?.groupIdsByDigest.has(outcome.configDigest)
                        ? { configGroupId: lookup.groupIdsByDigest.get(outcome.configDigest)! }
                        : {}),
                    repetition: outcome.repetition,
                    queuedAt: outcome.queuedAt,
                    ...(outcome.startedAt !== undefined ? { startedAt: outcome.startedAt } : {}),
                    endedAt: outcome.endedAt,
                    resolvedConfigDigest: outcome.configDigest,
                    status: outcome.status,
                    ...(outcome.resultCaptureEventId
                        ? { resultCaptureEventId: outcome.resultCaptureEventId }
                        : {}),
                    ...(outcome.resultEventId ? { resultEventId: outcome.resultEventId } : {}),
                    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
                    ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
                    ...(outcome.cancellationOutcome
                        ? { cancellationOutcome: outcome.cancellationOutcome }
                        : {}),
                    attempt: outcome.attempt,
                });
            },
        };
    }

    private updateReplayCartSnapshot(
        snapshotId: string,
        update: Partial<Pick<InlineCompletionDebugReplayEventSnapshot, "configMode" | "override">>,
    ): void {
        this._replayEngine.updateCartSnapshot(snapshotId, {
            ...(Object.prototype.hasOwnProperty.call(update, "configMode")
                ? { configMode: update.configMode }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(update, "override")
                ? { override: update.override ?? null }
                : {}),
        });
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
        const availableModels = this._deps.captureService.availableModels;
        if (event.modelVendor && event.modelId) {
            const selector = `${event.modelVendor}/${event.modelId}`;
            if (availableModels.some((model) => model.selector === selector)) {
                return selector;
            }
        }

        if (event.modelFamily) {
            return (
                availableModels.find((model) => model.family === event.modelFamily)?.selector ??
                null
            );
        }

        return null;
    }

    private getCurrentReplayConfig(): InlineCompletionDebugReplayConfig {
        return compactReplayConfig(inlineCompletionDebugStore.getOverrides());
    }

    private async getReplaySchemaContext(
        sourceEvent: InlineCompletionDebugEvent,
        statementPrefix: string,
        modelMaxInputTokens: number | undefined,
        schemaContextOverrides: InlineCompletionDebugSchemaContextOverrides | null | undefined,
    ): Promise<ReplaySchemaContextResult> {
        if (this._deps.schemaContextService) {
            try {
                const refreshedContext =
                    await this._deps.schemaContextService.getSchemaContextForOwnerUri(
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

// --- Replay config + queued-event helpers -----------------------------------

/** Config-group label for non-matrix rows (matrix rows use the cell label). */
function formatConfigGroupLabel(config: InlineCompletionDebugReplayConfig): string {
    return config.profileId ? `Profile: ${config.profileId}` : "Custom overrides";
}

export function formatTraceSourceLabel(
    trace: InlineCompletionDebugExportData,
    fileKey: string,
): string {
    return trace._savedAt ? `${trace._savedAt} · ${trace.events.length} events` : fileKey;
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

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function cloneJson<T>(value: T): T {
    if (value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}
