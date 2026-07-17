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
    extractInlineCompletionDocumentContext,
    fixLeadingWhitespace,
    formatSchemaContextForPrompt,
    getEffectiveMaxCompletionChars,
    getInlineCompletionCategory,
    INLINE_COMPLETION_PROMPT_BUILDER_VERSION,
    INLINE_COMPLETION_SANITIZER_VERSION,
    InlineCompletionDocumentContext,
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
    COMPLETION_REPLAY_PROVENANCE_SCHEMA,
    CompletionReplayMode,
    CompletionReplayProvenanceV1,
    CompletionReplaySchemaContextSource,
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
    isCompletionReplayMode,
    isReplayAxisEnabledForMode,
    resolveCompletionReplayModePolicy,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import {
    FeatureReplayCancellationToken,
    FeatureReplayExecuteResult,
} from "../../../sharedInterfaces/featureReplay";
import { sha256OfCanonicalJson } from "../../../diagnostics/featureCapture/configGroups";
import { COMPLETIONS_JOURNAL_EVENT_SCHEMA } from "../completionsJournalProjection";
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
    /**
     * Test seam: replaces live model selection (vscode.lm-backed by default)
     * so mode semantics are testable without a configured language model.
     */
    selectModel?: (
        modelSelectorOverride: string | undefined,
        modelPreference: InlineCompletionModelPreference | undefined,
    ) => Promise<vscode.LanguageModelChat | undefined>;
    /**
     * Test seam: replaces active-editor context resolution for
     * `liveDocumentScenario` (defaults to the active SQL text editor).
     */
    getLiveDocumentContext?: () => InlineCompletionDocumentContext | undefined;
}

interface ReplaySchemaContextResult {
    schemaContext: SqlInlineCompletionSchemaContext | undefined;
    schemaContextText: string;
    schemaContextSource: CompletionReplaySchemaContextSource;
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
}

/** WI-3.4: mode policy stamped onto every config frozen for one queue/matrix run. */
interface ReplayQueueModePolicy {
    replayMode: CompletionReplayMode;
    schemaFallbackToCaptured?: boolean;
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
    /**
     * WI-3.4: the mode policy for the queue/matrix call currently freezing
     * its configs. Set around the SYNCHRONOUS engine queue call only — every
     * row config the engine resolves during that call gets the policy stamped
     * before compaction, so mode + fallback are frozen at queue time and ride
     * the config digest.
     */
    private _queueModePolicy: ReplayQueueModePolicy | undefined;
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

    public queueCart(
        configMode?: InlineCompletionDebugReplayCartConfigMode,
        modePolicy?: ReplayQueueModePolicy,
    ): void {
        this.withQueueModePolicy(modePolicy, () => this._replayEngine.queueCart(configMode));
    }

    public runMatrix(
        profileIds: InlineCompletionDebugProfileId[],
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[],
        modePolicy?: ReplayQueueModePolicy,
    ): void {
        const mode = modePolicy?.replayMode ?? resolveCompletionReplayModePolicy({}).mode;
        const profiles = profileIds
            .map((profileId) => ({
                id: profileId,
                label:
                    inlineCompletionDebugProfileOptions.find((profile) => profile.id === profileId)
                        ?.label ?? profileId,
            }))
            .filter((profile) => profile.id !== inlineCompletionDebugCustomProfileId);
        // WI-3.4 axis-mode compatibility: a mode that disables the
        // schema-budget axis pins every cell to the captured schema (one
        // sentinel column) instead of a schema cartesian product; the
        // profile-axis rule is enforced by the preflight refusal below.
        const schemaAxisEnabled = isReplayAxisEnabledForMode("schemaBudget", mode);
        const schemaProfiles = schemaAxisEnabled
            ? schemaBudgetProfileIds
                  .map((schemaBudgetProfileId) => ({
                      id: schemaBudgetProfileId,
                      label: getSchemaBudgetProfileLabel(schemaBudgetProfileId),
                  }))
                  .filter((schema) => schema.id !== "custom")
            : [{ id: CAPTURED_SCHEMA_CELL_SENTINEL, label: "Captured schema" }];
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

        this.withQueueModePolicy(modePolicy, () => this._replayEngine.runMatrix(cells));
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
     * Re-execute one captured completion event against the live model under
     * an EXPLICIT replay mode (WI-3.4 / addendum §7.7 — no implicit mode
     * switch, no implicit fallback):
     *
     * - `frozenPrompt`: the captured prompt messages are sent verbatim (no
     *   prompt rebuild; schema already embedded);
     * - `rebuildCapturedContext`: prompt rebuilt with the CURRENT builder
     *   over the captured editor context and the captured schema text;
     * - `rebuildCurrentSchema`: prompt rebuilt over the captured editor
     *   context with CURRENT schema — required; when unavailable the item is
     *   `blocked` unless the config carries the explicit
     *   `schemaFallbackToCaptured` policy (a used fallback is recorded as
     *   provenance `schemaContextSource: "explicitFallback"`);
     * - `liveDocumentScenario`: prompt rebuilt against the CURRENT active
     *   document state and current schema (scenario re-execution, not strict
     *   pairing) — blocked when no active SQL editor exists.
     *
     * A config without an explicit mode resolves through the default mapping
     * (`rebuildCurrentSchema` + fallback) — exactly the pre-WI-3.4 behavior,
     * now explicit and recorded. Every recorded event carries an Appendix D
     * `CompletionReplayProvenanceV1` block.
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
        // Compaction stamps the explicit mode policy, so the digest below is
        // identical to the queue-time row digest for engine-driven items.
        const overrides = compactReplayConfig(
            options.overrides ?? inlineCompletionDebugStore.getOverrides(),
        );
        const modePolicy = resolveCompletionReplayModePolicy(overrides);
        const replayMode = modePolicy.mode;
        const rebuildPrompt = replayMode !== "frozenPrompt";
        const effectiveConfigDigest = safeCanonicalDigest(overrides);
        const tags = options.tags;
        const replayTagLocals = getReplayTagLocals(tags, sourceEvent.id);
        // Durable identity for the replayed RESULT event (link id = the §7.3
        // "result capture event ID"), caused by the source event when it has
        // a durable id of its own.
        const replayLink = inlineCompletionDebugStore.createEventLink({
            causeEventId: sourceEvent.link?.captureEventId,
        });
        const profile = getInlineCompletionDebugPresetProfile(overrides.profileId);

        // liveDocumentScenario replays against the CURRENT active document
        // state; every other mode replays the captured editor context.
        const liveContext =
            replayMode === "liveDocumentScenario" ? this.resolveLiveDocumentContext() : undefined;
        const linePrefix = liveContext?.linePrefix ?? asString(sourceEvent.locals.linePrefix);
        const lineSuffix = liveContext?.lineSuffix ?? asString(sourceEvent.locals.lineSuffix);
        const recentPrefix = liveContext?.recentPrefix ?? asString(sourceEvent.locals.recentPrefix);
        const statementPrefix =
            liveContext?.statementPrefix ?? asString(sourceEvent.locals.statementPrefix);
        const suffix = liveContext?.suffix ?? asString(sourceEvent.locals.suffix);
        const inferredSystemQuery =
            liveContext?.inferredSystemQuery ?? sourceEvent.inferredSystemQuery;
        const intentMode =
            overrides.forceIntentMode ??
            profile?.forceIntentMode ??
            (liveContext ? liveContext.detectedIntentMode : sourceEvent.intentMode);
        const completionCategory = getInlineCompletionCategory(intentMode);
        const modelPreference = getInlineCompletionModelPreferenceForCategory(
            profile,
            completionCategory,
        );
        // Live-scenario events carry the LIVE document identity + context;
        // other modes keep the captured source fields from cloneBaseEvent.
        const docOverride = liveContext
            ? {
                  documentUri: liveContext.documentUri,
                  documentFileName: liveContext.documentFileName,
                  line: liveContext.line,
                  column: liveContext.column,
                  inferredSystemQuery,
              }
            : {};
        const contextLocals: Record<string, unknown> = liveContext
            ? {
                  linePrefix,
                  lineSuffix,
                  recentPrefix,
                  statementPrefix,
                  suffix,
                  "document.languageId": liveContext.languageId,
              }
            : {};
        const replayStartedAt = Date.now();

        // Appendix D provenance — attached to EVERY recorded replay event
        // (pending and terminal). Model + schema facts refine as they settle.
        let provenanceModel: CompletionReplayProvenanceV1["model"] = {};
        let schemaContextSource: CompletionReplaySchemaContextSource =
            replayMode === "frozenPrompt" ? "captured" : "unavailable";
        let replaySchemaContextText: string | undefined;
        const buildProvenance = (): CompletionReplayProvenanceV1 => ({
            schema: COMPLETION_REPLAY_PROVENANCE_SCHEMA,
            mode: replayMode,
            ...(rebuildPrompt
                ? { promptBuilderVersion: INLINE_COMPLETION_PROMPT_BUILDER_VERSION }
                : {}),
            sanitizerVersion: INLINE_COMPLETION_SANITIZER_VERSION,
            sourceEventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
            ...(sourceEvent.promptMessages.length > 0
                ? { sourcePromptDigest: safeCanonicalDigest(sourceEvent.promptMessages) }
                : {}),
            ...(sourceEvent.schemaContextFormatted
                ? {
                      sourceSchemaContextDigest: safeCanonicalDigest(
                          sourceEvent.schemaContextFormatted,
                      ),
                  }
                : {}),
            ...(replaySchemaContextText !== undefined
                ? { replaySchemaContextDigest: safeCanonicalDigest(replaySchemaContextText) }
                : {}),
            schemaContextSource,
            extensionVersion: this.getExtensionVersion(),
            model: { ...provenanceModel },
            effectiveConfigDigest,
        });

        let pendingEventId: string | undefined;
        const recordReplayEvent = (
            eventInput: Omit<InlineCompletionDebugEvent, "id">,
        ): InlineCompletionDebugEvent => {
            const event = {
                ...eventInput,
                link: replayLink,
                replayProvenance: buildProvenance(),
            };
            if (!pendingEventId) {
                return inlineCompletionDebugStore.addEvent(event);
            }

            return (
                inlineCompletionDebugStore.updateEvent(pendingEventId, event) ??
                inlineCompletionDebugStore.addEvent(event)
            );
        };

        // liveDocumentScenario without an active SQL editor: nothing to run
        // against — the item is blocked (visible refusal), never guessed.
        if (replayMode === "liveDocumentScenario" && !liveContext) {
            return recordReplayEvent(
                createBlockedReplayEvent(
                    sourceEvent,
                    {
                        completionCategory,
                        intentMode,
                        overridesApplied: getOverridesApplied(overrides),
                        tags,
                        replayStartedAt,
                    },
                    {
                        ...sourceEvent.locals,
                        completionCategory,
                        intentMode,
                        ...replayTagLocals,
                        replayMode,
                        replayBlockedReason: LIVE_DOCUMENT_UNAVAILABLE_REASON,
                    },
                ),
            );
        }
        if (options.showPendingInLive) {
            pendingEventId = inlineCompletionDebugStore.addEvent({
                ...cloneBaseEvent(sourceEvent),
                ...docOverride,
                link: replayLink,
                replayProvenance: buildProvenance(),
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
                    ...contextLocals,
                    profileId: overrides.profileId,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                    replayMode,
                    replayedAt: new Date(replayStartedAt).toISOString(),
                },
            }).id;
        }

        const requestedSelector = getModelSelectorForCompletionCategory(
            overrides,
            completionCategory,
            getConfiguredContinuationModelSelector(),
        );
        if (requestedSelector !== undefined) {
            provenanceModel = { ...provenanceModel, requestedSelector };
        }
        const selectedModel = await this.selectReplayModel(requestedSelector, modelPreference);
        if (!selectedModel) {
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                ...docOverride,
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
                    ...contextLocals,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                    replayMode,
                },
            });
        }
        provenanceModel = {
            ...provenanceModel,
            resolvedVendor: selectedModel.vendor,
            resolvedFamily: selectedModel.family,
            resolvedId: selectedModel.id,
        };

        const canSendRequest =
            this._deps.extensionContext.languageModelAccessInformation?.canSendRequest(
                selectedModel,
            );
        if (canSendRequest === false) {
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                ...docOverride,
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
                    ...contextLocals,
                    completionCategory,
                    intentMode,
                    ...replayTagLocals,
                    replayMode,
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
            ? (liveContext?.sqlDiagnosticsText ?? asString(sourceEvent.locals.sqlDiagnostics))
            : "";
        const schemaContextOverrides = getInlineCompletionProfileSchemaContextOverrides(
            profile,
            overrides.schemaContext,
        );
        const schemaContextSettings = getSqlInlineCompletionSchemaContextRuntimeSettings(
            selectedModel.maxInputTokens,
            schemaContextOverrides,
        );
        // §7.7 mode/schema matrix. `frozenPrompt` performs NO schema work —
        // the captured prompt already embeds whatever schema it had.
        const replaySchemaContext =
            replayMode === "frozenPrompt"
                ? capturedSchemaContextResult(sourceEvent, "captured")
                : await this.resolveModeSchemaContext({
                      mode: replayMode,
                      fallbackToCaptured: modePolicy.fallbackToCaptured,
                      useSchemaContext,
                      sourceEvent,
                      ownerUri: liveContext?.documentUri ?? sourceEvent.documentUri,
                      statementPrefix,
                      inferredSystemQuery,
                      modelMaxInputTokens: selectedModel.maxInputTokens,
                      schemaContextOverrides,
                  });
        schemaContextSource = replaySchemaContext.schemaContextSource;
        if (
            replayMode !== "frozenPrompt" &&
            replaySchemaContext.schemaContextText !== "-- unavailable"
        ) {
            replaySchemaContextText = replaySchemaContext.schemaContextText;
        }

        // rebuildCurrentSchema REQUIRES current schema: unavailable without
        // the explicit fallback policy blocks the item (§7.7 rules).
        if (
            replayMode === "rebuildCurrentSchema" &&
            useSchemaContext &&
            schemaContextSource === "unavailable" &&
            !modePolicy.fallbackToCaptured
        ) {
            return recordReplayEvent(
                createBlockedReplayEvent(
                    sourceEvent,
                    {
                        completionCategory,
                        intentMode,
                        overridesApplied: getOverridesApplied(overrides),
                        tags,
                        replayStartedAt,
                        model: selectedModel,
                    },
                    {
                        ...sourceEvent.locals,
                        ...contextLocals,
                        completionCategory,
                        intentMode,
                        ...replayTagLocals,
                        replayMode,
                        replaySchemaContextSource: schemaContextSource,
                        replayBlockedReason: CURRENT_SCHEMA_UNAVAILABLE_REASON,
                    },
                ),
            );
        }

        const schemaContextText = replaySchemaContext.schemaContextText;
        // frozenPrompt: captured exact messages, NO prompt rebuild (§7.7).
        const languageModelMessages = rebuildPrompt
            ? buildInlineCompletionPromptMessages({
                  rulesText: resolveInlineCompletionRules({
                      customSystemPrompt: overrides.customSystemPrompt,
                      inferredSystemQuery,
                      intentMode,
                      schemaContextText,
                      linePrefix,
                      recentPrefix,
                      statementPrefix,
                      sqlDiagnosticsText,
                  }),
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
              })
            : toLanguageModelChatMessages(sourceEvent.promptMessages);
        const promptMessages = languageModelMessages;
        const recordedPromptMessages = rebuildPrompt
            ? promptMessages.map(toDebugPromptMessage)
            : sourceEvent.promptMessages;
        // Schema facts recorded on the result rows: frozenPrompt keeps the
        // SOURCE's schema facts (embedded); rebuild modes record what the
        // rebuilt prompt actually used.
        const recordedSchemaFields =
            replayMode === "frozenPrompt"
                ? {
                      usedSchemaContext: sourceEvent.usedSchemaContext,
                      schemaObjectCount: sourceEvent.schemaObjectCount,
                      schemaSystemObjectCount: sourceEvent.schemaSystemObjectCount,
                      schemaForeignKeyCount: sourceEvent.schemaForeignKeyCount,
                      schemaContextFormatted: sourceEvent.schemaContextFormatted,
                  }
                : {
                      usedSchemaContext: useSchemaContext && schemaContextText !== "-- unavailable",
                      schemaObjectCount: replaySchemaContext.schemaObjectCount,
                      schemaSystemObjectCount: replaySchemaContext.schemaSystemObjectCount,
                      schemaForeignKeyCount: replaySchemaContext.schemaForeignKeyCount,
                      schemaContextFormatted:
                          useSchemaContext && schemaContextText !== "-- unavailable"
                              ? schemaContextText
                              : undefined,
                  };
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
        // Locals shared by every record from here on: effective knobs, mode,
        // and the resolved schema-context provenance dimensions.
        const runtimeLocals: Record<string, unknown> = {
            ...sourceEvent.locals,
            ...contextLocals,
            profileId: overrides.profileId,
            completionCategory,
            intentMode,
            useSchemaContext,
            includeSqlDiagnostics,
            effectiveMaxTokens: maxTokens,
            sqlDiagnostics: sqlDiagnosticsText,
            "sqlDiagnostics.length": sqlDiagnosticsText.length,
            ...replayTagLocals,
            replayMode,
            replaySchemaContextSource: replaySchemaContext.schemaContextSource,
            schemaBudgetProfile: schemaContextSettings.budgetProfile,
            schemaSizeKind: replaySchemaContext.schemaContext?.selectionMetadata?.schemaSizeKind,
            schemaDegradationSteps:
                replaySchemaContext.schemaContext?.selectionMetadata?.degradationSteps.join(",") ??
                "",
            schemaMessageOrder: schemaContextSettings.messageOrder,
            schemaContextChannel: schemaContextSettings.schemaContextChannel,
        };
        if (pendingEventId) {
            recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                ...docOverride,
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
                ...recordedSchemaFields,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: recordedPromptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                tags,
                locals: {
                    ...runtimeLocals,
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
                ...docOverride,
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
                ...recordedSchemaFields,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: recordedPromptMessages,
                rawResponse,
                sanitizedResponse,
                finalCompletionText,
                tags,
                locals: {
                    ...runtimeLocals,
                    replayedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            // A cancel that interrupted the request is a "cancelled" result,
            // not an error (honesty: the model was cut off, it didn't fail).
            const wasCancelled = cancellationTokenSource.token.isCancellationRequested;
            return recordReplayEvent({
                ...cloneBaseEvent(sourceEvent),
                ...docOverride,
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
                ...recordedSchemaFields,
                overridesApplied: getOverridesApplied(overrides),
                promptMessages: recordedPromptMessages,
                rawResponse: "",
                sanitizedResponse: undefined,
                finalCompletionText: undefined,
                tags,
                locals: {
                    ...runtimeLocals,
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
            // Queue-time freeze point (WI-3.4): the active queue call's mode
            // policy is stamped BEFORE compaction, so mode + fallback ride
            // the frozen row config and its digest.
            compactConfig: (config) => compactReplayConfig(this.stampQueueModePolicy(config)),
            compactPartialConfig: (partial) => compactPartialReplayConfig(partial),
            resolveMatrixCellConfig: (cell) =>
                compactReplayConfig(
                    this.stampQueueModePolicy({
                        ...this.getCurrentReplayConfig(),
                        ...createInlineCompletionDebugPresetOverrides(cell.profileId),
                        profileId: cell.profileId,
                        // The captured-schema sentinel cell (schema axis
                        // disabled by mode) keeps the base schema config —
                        // the mode replays captured schema text anyway.
                        ...(cell.schemaBudgetProfileId === CAPTURED_SCHEMA_CELL_SENTINEL &&
                        cell.schemaLabel === CAPTURED_SCHEMA_CELL_LABEL
                            ? {}
                            : {
                                  schemaContext: {
                                      budgetProfile: cell.schemaBudgetProfileId,
                                  },
                              }),
                    }),
                ),
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
                    // WI-3.4: blocked items are the honest per-item refusal;
                    // mode + schema source ride into the durable item record.
                    ...(recorded.result === "blocked"
                        ? {
                              blockedReason:
                                  asString(recorded.locals.replayBlockedReason) ||
                                  "replay mode inputs unavailable",
                          }
                        : {}),
                    ...(recorded.replayProvenance
                        ? {
                              replayMode: recorded.replayProvenance.mode,
                              schemaContextSource: recorded.replayProvenance.schemaContextSource,
                          }
                        : {}),
                };
                return result;
            },
            // WI-3.4 axis-mode compatibility backstop: the drawer disables
            // incompatible axes, and this refuses honestly anything that
            // reaches the queue anyway (run flips to `failed` with reason).
            preflight: async (context) => {
                if (context.matrixCells > 0) {
                    const modes = new Set(
                        context.configs.map(
                            (config) => resolveCompletionReplayModePolicy(config).mode,
                        ),
                    );
                    if (modes.has("frozenPrompt")) {
                        return {
                            ok: false,
                            blockedReason:
                                "Matrix axes are incompatible with the frozenPrompt mode: the captured prompt is replayed verbatim, so profile and schema-budget axes cannot apply. Choose a rebuild mode or queue without a matrix.",
                        };
                    }
                }
                return { ok: true };
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
                    ...(outcome.replayMode ? { replayMode: outcome.replayMode } : {}),
                    ...(outcome.schemaContextSource
                        ? { schemaContextSource: outcome.schemaContextSource }
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

    /**
     * WI-3.4 mode/schema matrix (§7.7). One source resolution per mode, no
     * implicit switching:
     * - disabled config ⇒ "disabled" for every mode;
     * - `rebuildCapturedContext` ⇒ captured text or "unavailable" — the
     *   schema service is NEVER consulted;
     * - `rebuildCurrentSchema` ⇒ current required; unavailable resolves
     *   "explicitFallback" (captured, when the policy allows and a capture
     *   exists), or "unavailable" (the caller blocks unless the policy is on);
     * - `liveDocumentScenario` ⇒ current for the LIVE document or
     *   "unavailable" (proceeds — the live scenario has nothing captured to
     *   fall back to).
     */
    private async resolveModeSchemaContext(options: {
        mode: Exclude<CompletionReplayMode, "frozenPrompt">;
        fallbackToCaptured: boolean;
        useSchemaContext: boolean;
        sourceEvent: InlineCompletionDebugEvent;
        ownerUri: string;
        statementPrefix: string;
        inferredSystemQuery: boolean;
        modelMaxInputTokens: number | undefined;
        schemaContextOverrides: InlineCompletionDebugSchemaContextOverrides | null | undefined;
    }): Promise<ReplaySchemaContextResult> {
        if (!options.useSchemaContext) {
            return {
                schemaContext: undefined,
                schemaContextText: "-- unavailable",
                schemaContextSource: "disabled",
                schemaObjectCount: 0,
                schemaSystemObjectCount: 0,
                schemaForeignKeyCount: 0,
            };
        }

        if (options.mode === "rebuildCapturedContext") {
            return options.sourceEvent.schemaContextFormatted
                ? capturedSchemaContextResult(options.sourceEvent, "captured")
                : unavailableSchemaContextResult();
        }

        const current = await this.fetchCurrentSchemaContext(options);
        if (current) {
            return current;
        }
        if (
            options.mode === "rebuildCurrentSchema" &&
            options.fallbackToCaptured &&
            options.sourceEvent.schemaContextFormatted
        ) {
            // The RECORDED fallback dimension (§7.7): current was required,
            // unavailable, and the user's explicit policy fell back.
            return capturedSchemaContextResult(options.sourceEvent, "explicitFallback");
        }
        return unavailableSchemaContextResult();
    }

    private async fetchCurrentSchemaContext(options: {
        ownerUri: string;
        statementPrefix: string;
        inferredSystemQuery: boolean;
        modelMaxInputTokens: number | undefined;
        schemaContextOverrides: InlineCompletionDebugSchemaContextOverrides | null | undefined;
    }): Promise<ReplaySchemaContextResult | undefined> {
        if (!this._deps.schemaContextService) {
            return undefined;
        }
        try {
            const refreshedContext =
                await this._deps.schemaContextService.getSchemaContextForOwnerUri(
                    options.ownerUri,
                    options.statementPrefix,
                    options.modelMaxInputTokens,
                    options.schemaContextOverrides,
                );
            if (!refreshedContext) {
                return undefined;
            }
            const schemaContext = {
                ...refreshedContext,
                inferredSystemQuery: options.inferredSystemQuery,
            };
            return {
                schemaContext,
                schemaContextText: formatSchemaContextForPrompt(
                    schemaContext,
                    options.inferredSystemQuery,
                ),
                schemaContextSource: "current",
                schemaObjectCount: schemaContext.tables.length + schemaContext.views.length,
                schemaSystemObjectCount:
                    (schemaContext.systemObjects?.length ?? 0) + schemaContext.masterSymbols.length,
                schemaForeignKeyCount: getForeignKeyCount(schemaContext),
            };
        } catch (error) {
            this._logger.warn(
                `Failed to refresh schema context for inline completion replay: ${getErrorMessage(
                    error,
                )}`,
            );
            return undefined;
        }
    }

    /** Active SQL editor context for `liveDocumentScenario` (or the test seam). */
    private resolveLiveDocumentContext(): InlineCompletionDocumentContext | undefined {
        if (this._deps.getLiveDocumentContext) {
            return this._deps.getLiveDocumentContext();
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "sql") {
            return undefined;
        }
        return extractInlineCompletionDocumentContext(editor.document, editor.selection.active);
    }

    /** Apply the active queue call's mode policy (see _queueModePolicy). */
    private stampQueueModePolicy(
        config: InlineCompletionDebugReplayConfig,
    ): InlineCompletionDebugReplayConfig {
        const policy = this._queueModePolicy;
        if (!policy) {
            return config;
        }
        return {
            ...config,
            replayMode: policy.replayMode,
            ...(policy.replayMode === "rebuildCurrentSchema"
                ? { schemaFallbackToCaptured: policy.schemaFallbackToCaptured ?? true }
                : { schemaFallbackToCaptured: undefined }),
        };
    }

    /** Scope the mode policy to one SYNCHRONOUS engine queue call. */
    private withQueueModePolicy(
        policy: ReplayQueueModePolicy | undefined,
        queue: () => void,
    ): void {
        this._queueModePolicy = policy;
        try {
            queue();
        } finally {
            this._queueModePolicy = undefined;
        }
    }

    private getExtensionVersion(): string {
        const packageJson = this._deps.extensionContext.extension?.packageJSON as
            | { version?: string }
            | undefined;
        return packageJson?.version ?? "unknown";
    }

    private async selectReplayModel(
        modelSelectorOverride: string | undefined,
        modelPreference: InlineCompletionModelPreference | undefined,
    ): Promise<vscode.LanguageModelChat | undefined> {
        if (this._deps.selectModel) {
            return this._deps.selectModel(modelSelectorOverride, modelPreference);
        }
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

// --- WI-3.4 mode helpers -----------------------------------------------------

/**
 * Sentinel cell id used when a mode disables the schema-budget axis: the
 * matrix keeps ONE schema column pinned to the captured schema context.
 * "custom" is safe as the sentinel because runMatrix filters real "custom"
 * selections out of enabled-axis cells; the label disambiguates.
 */
export const CAPTURED_SCHEMA_CELL_SENTINEL: InlineCompletionSchemaBudgetProfileId = "custom";
export const CAPTURED_SCHEMA_CELL_LABEL = "Captured schema";

export const CURRENT_SCHEMA_UNAVAILABLE_REASON =
    "Current schema context is required by rebuildCurrentSchema and was unavailable (no schema service result for the source document). Queue with the captured-schema fallback policy to proceed.";
export const LIVE_DOCUMENT_UNAVAILABLE_REASON =
    "liveDocumentScenario needs an active SQL editor to re-run against — none was open.";

function capturedSchemaContextResult(
    sourceEvent: InlineCompletionDebugEvent,
    schemaContextSource: "captured" | "explicitFallback",
): ReplaySchemaContextResult {
    return {
        schemaContext: undefined,
        schemaContextText: sourceEvent.schemaContextFormatted ?? "-- unavailable",
        schemaContextSource,
        schemaObjectCount: sourceEvent.schemaObjectCount,
        schemaSystemObjectCount: sourceEvent.schemaSystemObjectCount,
        schemaForeignKeyCount: sourceEvent.schemaForeignKeyCount,
    };
}

function unavailableSchemaContextResult(): ReplaySchemaContextResult {
    return {
        schemaContext: undefined,
        schemaContextText: "-- unavailable",
        schemaContextSource: "unavailable",
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
    };
}

/** frozenPrompt: the captured debug messages sent verbatim (no rebuild). */
function toLanguageModelChatMessages(
    messages: InlineCompletionDebugPromptMessage[],
): vscode.LanguageModelChatMessage[] {
    return messages.map((message) =>
        message.role === "assistant"
            ? vscode.LanguageModelChatMessage.Assistant(message.content)
            : vscode.LanguageModelChatMessage.User(message.content),
    );
}

/** Terminal shape of a per-item mode refusal (result: "blocked"). */
function createBlockedReplayEvent(
    sourceEvent: InlineCompletionDebugEvent,
    context: {
        completionCategory: InlineCompletionCategory;
        intentMode: boolean;
        overridesApplied: InlineCompletionDebugEvent["overridesApplied"];
        tags: InlineCompletionDebugEventTags | undefined;
        replayStartedAt: number;
        model?: vscode.LanguageModelChat;
    },
    locals: Record<string, unknown>,
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        ...cloneBaseEvent(sourceEvent),
        timestamp: Date.now(),
        completionCategory: context.completionCategory,
        intentMode: context.intentMode,
        result: "blocked",
        latencyMs: Date.now() - context.replayStartedAt,
        inputTokens: undefined,
        outputTokens: undefined,
        modelFamily: context.model?.family,
        modelId: context.model?.id,
        modelVendor: context.model?.vendor,
        usedSchemaContext: false,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        overridesApplied: context.overridesApplied,
        promptMessages: sourceEvent.promptMessages,
        rawResponse: "",
        sanitizedResponse: undefined,
        finalCompletionText: undefined,
        schemaContextFormatted: undefined,
        tags: context.tags,
        locals,
    };
}

/** Digest failures must never break a replay — recorded as "" honestly. */
function safeCanonicalDigest(value: unknown): string {
    try {
        return sha256OfCanonicalJson(value);
    } catch {
        return "";
    }
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

export function compactReplayConfig(
    config: Partial<InlineCompletionDebugReplayConfig>,
): InlineCompletionDebugReplayConfig {
    // WI-3.4: normalization makes the mode policy EXPLICIT on every compact
    // config (the default mapping resolves absent modes), so the mode is part
    // of the effective-config digest input and of config-group identity. The
    // fallback flag exists only where it means something (rebuildCurrentSchema).
    const modePolicy = resolveCompletionReplayModePolicy({
        replayMode: isCompletionReplayMode(config.replayMode) ? config.replayMode : undefined,
        ...(typeof config.schemaFallbackToCaptured === "boolean"
            ? { schemaFallbackToCaptured: config.schemaFallbackToCaptured }
            : {}),
    });
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
        replayMode: modePolicy.mode,
        ...(modePolicy.mode === "rebuildCurrentSchema"
            ? { schemaFallbackToCaptured: modePolicy.fallbackToCaptured }
            : {}),
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
