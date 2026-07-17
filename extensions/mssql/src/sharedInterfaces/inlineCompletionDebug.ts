/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FeatureReplayRunStatus } from "./featureReplay";
import { ObservabilityLinkV1 } from "./observabilityLink";
import { ReplayEstimate, ReplaySafetyAssessment } from "./replaySafety";

export type InlineCompletionResult =
    | "success"
    | "accepted"
    | "skipped"
    | "emptyFromModel"
    | "emptyFromSanitizer"
    | "noModel"
    | "noPermission"
    | "error";

export type InlineCompletionDebugEventResult =
    | InlineCompletionResult
    | "cancelled"
    | "pending"
    | "queued"
    /**
     * WI-3.4: a replay item whose mode required inputs that were unavailable
     * (rebuildCurrentSchema without current schema and without a fallback
     * policy; liveDocumentScenario without an active SQL editor). Nothing
     * executed — the honest per-item refusal state, never an "error".
     */
    | "blocked";

export const inlineCompletionCategories = ["continuation", "intent"] as const;

export type InlineCompletionCategory = (typeof inlineCompletionCategories)[number];

export const inlineCompletionDebugProfileIds = ["focused", "balanced", "broad", "custom"] as const;

export type InlineCompletionDebugProfileId = (typeof inlineCompletionDebugProfileIds)[number];

export const inlineCompletionSchemaBudgetProfileIds = [
    "tight",
    "balanced",
    "generous",
    "unlimited",
    "custom",
] as const;

export type InlineCompletionSchemaBudgetProfileId =
    (typeof inlineCompletionSchemaBudgetProfileIds)[number];

export type InlineCompletionSchemaColumnRepresentation = "compact" | "types" | "verbose";

export type InlineCompletionSchemaPromptMessageOrder = "rules-then-data" | "data-then-rules";

export type InlineCompletionSchemaContextChannel = "inline-with-data" | "separate-message";

export interface InlineCompletionDebugProfileOption {
    id: InlineCompletionDebugProfileId;
    label: string;
    description: string;
}

export interface InlineCompletionDebugPromptMessage {
    role: "user" | "assistant";
    content: string;
}

export interface InlineCompletionDebugOverridesApplied {
    profileId?: InlineCompletionDebugProfileId;
    modelSelector?: string;
    continuationModelSelector?: string;
    useSchemaContext?: boolean;
    includeSqlDiagnostics?: boolean;
    debounceMs?: number;
    maxTokens?: number;
    enabledCategories?: InlineCompletionCategory[];
    schemaContext?: InlineCompletionDebugSchemaContextOverrides;
    customSystemPromptUsed: boolean;
}

export interface InlineCompletionDebugSchemaBudgetOverrides {
    maxSchemas?: number;
    maxTables?: number;
    maxViews?: number;
    maxRoutines?: number;
    maxColumnsPerObject?: number;
    maxForeignKeys?: number;
    maxTableNameOnlyInventory?: number;
    maxViewNameOnlyInventory?: number;
    maxRoutineNameOnlyInventory?: number;
    maxSystemObjects?: number;
    maxSchemaContextRelevanceTerms?: number;
    maxParametersPerRoutine?: number;
    smallSchemaThreshold?: number;
    largeSchemaThreshold?: number;
    outlierSchemaThreshold?: number;
    maxPromptChars?: number;
    maxPromptTokens?: number;
    foreignKeyExpansionDepth?: number;
    foreignKeyExpansionObjectCap?: number;
    columnNameRelevanceWeight?: number;
    defaultSchemaWeight?: number;
    cacheTtlMs?: number;
    [key: string]: unknown;
}

export interface InlineCompletionDebugSchemaContextOverrides {
    budgetProfile?: InlineCompletionSchemaBudgetProfileId;
    schemaSizeAdaptive?: boolean;
    includeRoutines?: boolean;
    relevanceTermRecencyBias?: boolean;
    columnRepresentation?: InlineCompletionSchemaColumnRepresentation;
    messageOrder?: InlineCompletionSchemaPromptMessageOrder;
    schemaContextChannel?: InlineCompletionSchemaContextChannel;
    budgetOverrides?: InlineCompletionDebugSchemaBudgetOverrides;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Explicit completion replay modes (final plan WI-3.4 / addendum §7.7 —
// NORMATIVE). No implicit mode switch: every replay execution resolves ONE of
// these modes, and the resolved mode + fallback policy are frozen into the
// row config at queue time and recorded as provenance on the result event.
// ---------------------------------------------------------------------------

export const completionReplayModes = [
    "frozenPrompt",
    "rebuildCapturedContext",
    "rebuildCurrentSchema",
    "liveDocumentScenario",
] as const;

export type CompletionReplayMode = (typeof completionReplayModes)[number];

export function isCompletionReplayMode(value: unknown): value is CompletionReplayMode {
    return (
        typeof value === "string" && (completionReplayModes as readonly string[]).includes(value)
    );
}

/**
 * The addendum §7.7 mode table, one line per mode — rendered by the drawer's
 * mode selector and the Replay Lab.
 */
export const completionReplayModeOptions: ReadonlyArray<{
    id: CompletionReplayMode;
    label: string;
    description: string;
}> = [
    {
        id: "frozenPrompt",
        label: "Frozen prompt",
        description: "Captured exact prompt messages; no rebuild — compare models or sanitizer.",
    },
    {
        id: "rebuildCapturedContext",
        label: "Rebuild · captured context",
        description:
            "Rebuild with the current prompt builder over captured editor + schema context.",
    },
    {
        id: "rebuildCurrentSchema",
        label: "Rebuild · current schema",
        description:
            "Rebuild over captured editor context with CURRENT schema (required unless fallback).",
    },
    {
        id: "liveDocumentScenario",
        label: "Live document scenario",
        description:
            "Re-run against the current active document state and schema — not strict pairing.",
    },
];

/**
 * Matrix axes the completions replay matrix offers, and which modes each axis
 * is compatible with (§7.7: matrix axes declare which modes they affect).
 * - `profile` changes prompt construction → meaningless under `frozenPrompt`;
 * - `schemaBudget` changes schema retrieval → meaningless under `frozenPrompt`
 *   (schema embedded in the frozen prompt) and `rebuildCapturedContext`
 *   (captured schema text replayed verbatim).
 * Queue-time enforcement lives in the completions replay service (preflight
 * refusal); this table is the single data source both the UI and the service
 * consult.
 */
export const completionReplayMatrixAxes = ["profile", "schemaBudget"] as const;

export type CompletionReplayMatrixAxis = (typeof completionReplayMatrixAxes)[number];

export const completionReplayAxisCompatibility: Record<
    CompletionReplayMatrixAxis,
    readonly CompletionReplayMode[]
> = {
    profile: ["rebuildCapturedContext", "rebuildCurrentSchema", "liveDocumentScenario"],
    schemaBudget: ["rebuildCurrentSchema", "liveDocumentScenario"],
};

export function isReplayAxisEnabledForMode(
    axis: CompletionReplayMatrixAxis,
    mode: CompletionReplayMode,
): boolean {
    return completionReplayAxisCompatibility[axis].includes(mode);
}

/** One-line UI explanation for a mode's disabled axes (dense, not a banner). */
export function getReplayAxisDisabledReason(mode: CompletionReplayMode): string | undefined {
    switch (mode) {
        case "frozenPrompt":
            return "Frozen prompt replays the captured messages verbatim — no prompt-construction axis applies.";
        case "rebuildCapturedContext":
            return "Schema-budget axis disabled — this mode replays the captured schema context verbatim.";
        default:
            return undefined;
    }
}

/**
 * Default mapping (WI-3.4): a config with NO explicit mode behaves like the
 * pre-WI-3.4 implicit replay — fresh schema when available, captured schema
 * otherwise — which is exactly `rebuildCurrentSchema` with the explicit
 * fallback policy on. Every legacy entry point (single-event replay, session
 * replay, queue/matrix without a mode selection) resolves through here, so
 * behavior is preserved while becoming explicit and recorded.
 */
export function resolveCompletionReplayModePolicy(config: {
    replayMode?: CompletionReplayMode;
    schemaFallbackToCaptured?: boolean;
}): { mode: CompletionReplayMode; fallbackToCaptured: boolean } {
    const mode = isCompletionReplayMode(config.replayMode) ? config.replayMode : DEFAULT_MODE;
    return {
        mode,
        fallbackToCaptured:
            typeof config.schemaFallbackToCaptured === "boolean"
                ? config.schemaFallbackToCaptured
                : true,
    };
}

const DEFAULT_MODE: CompletionReplayMode = "rebuildCurrentSchema";

/** Frozen schema id (addendum Appendix D — normative). */
export const COMPLETION_REPLAY_PROVENANCE_SCHEMA = "mssql.completionsReplayProvenance/1";

/**
 * Where the replayed request's schema context came from (§7.7 rules):
 * `explicitFallback` = current schema was required but unavailable AND the
 * run was queued with `fallbackToCaptured` — a recorded dimension, never an
 * implicit switch.
 */
export type CompletionReplaySchemaContextSource =
    | "captured"
    | "current"
    | "disabled"
    | "unavailable"
    | "explicitFallback";

/** Addendum Appendix D — normative. Attached to every replayed result event. */
export interface CompletionReplayProvenanceV1 {
    schema: typeof COMPLETION_REPLAY_PROVENANCE_SCHEMA;
    mode: CompletionReplayMode;
    promptBuilderVersion?: string;
    sanitizerVersion?: string;
    sourceEventSchema: string;
    sourcePromptDigest?: string;
    sourceSchemaContextDigest?: string;
    replaySchemaContextDigest?: string;
    schemaContextSource: CompletionReplaySchemaContextSource;
    extensionVersion: string;
    extensionCommit?: string;
    model: {
        requestedSelector?: string;
        resolvedVendor?: string;
        resolvedFamily?: string;
        resolvedId?: string;
    };
    effectiveConfigDigest: string;
}

export interface InlineCompletionDebugEventTags {
    replayTraceId?: string;
    replayRunId?: string;
    replayMatrixCellId?: string;
    replaySourceEventId?: string;
    [key: string]: string | undefined;
}

export interface InlineCompletionDebugEvent {
    /** Ring-local display ordinal; durable identity is link.captureEventId. */
    id: string;
    timestamp: number;
    /** Cross-plane identity block (mssql.observabilityLink/1); absent on legacy traces. */
    link?: ObservabilityLinkV1;
    documentUri: string;
    documentFileName: string;
    line: number;
    column: number;
    triggerKind: "automatic" | "invoke";
    explicitFromUser: boolean;
    completionCategory: InlineCompletionCategory;
    intentMode: boolean;
    inferredSystemQuery: boolean;
    modelFamily: string | undefined;
    modelId: string | undefined;
    modelVendor: string | undefined;
    result: InlineCompletionDebugEventResult;
    latencyMs: number;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    schemaObjectCount: number;
    schemaSystemObjectCount: number;
    schemaForeignKeyCount: number;
    usedSchemaContext: boolean;
    overridesApplied: InlineCompletionDebugOverridesApplied;
    promptMessages: InlineCompletionDebugPromptMessage[];
    rawResponse: string;
    sanitizedResponse: string | undefined;
    finalCompletionText: string | undefined;
    schemaContextFormatted: string | undefined;
    tags?: InlineCompletionDebugEventTags;
    /**
     * WI-3.4 (additive): replay executions attach their Appendix D provenance
     * — mode, prompt-builder/sanitizer versions, schema-context source (incl.
     * explicit fallback), resolved model, effective config digest. Absent on
     * live (non-replay) events and on captures made before the field existed.
     */
    replayProvenance?: CompletionReplayProvenanceV1;
    locals: {
        [key: string]: unknown;
    };
    error?: {
        message: string;
        name?: string;
        stack?: string;
    };
}

export interface InlineCompletionDebugOverrides {
    profileId: InlineCompletionDebugProfileId | null;
    // A model selector is `<vendor>/<id>`, but a bare family string is also
    // accepted for backwards compatibility with `mssql.copilot.inlineCompletions.modelFamily`.
    modelSelector: string | null;
    // Optional continuation-only model selector. When unset, continuation uses modelSelector
    // or the active profile/configured default model.
    continuationModelSelector: string | null;
    useSchemaContext: boolean | null;
    includeSqlDiagnostics: boolean | null;
    debounceMs: number | null;
    maxTokens: number | null;
    enabledCategories: InlineCompletionCategory[] | null;
    forceIntentMode: boolean | null;
    customSystemPrompt: string | null;
    allowAutomaticTriggers: boolean | null;
    schemaContext?: InlineCompletionDebugSchemaContextOverrides | null;
}

export interface InlineCompletionDebugModelOption {
    selector: string;
    label: string;
    providerLabel: string;
    id: string;
    name: string;
    family: string;
    vendor: string;
    version?: string;
}

export interface InlineCompletionDebugDefaults {
    configuredModelSelector?: string;
    configuredContinuationModelSelector?: string;
    configuredProfileId?: InlineCompletionDebugProfileId;
    effectiveProfileId?: InlineCompletionDebugProfileId;
    effectiveModelSelector?: string;
    effectiveModelLabel?: string;
    effectiveContinuationModelSelector?: string;
    effectiveContinuationModelLabel?: string;
    useSchemaContext: boolean;
    includeSqlDiagnostics: boolean;
    debounceMs: number;
    continuationMaxTokens: number;
    intentMaxTokens: number;
    enabledCategories: InlineCompletionCategory[];
    allowAutomaticTriggers: boolean;
    schemaContext: InlineCompletionDebugSchemaContextOverrides | null;
}

export interface InlineCompletionDebugCustomPromptState {
    dialogOpen: boolean;
    savedValue: string | null;
    defaultValue: string;
    lastSavedAt?: number;
}

/**
 * The frozen per-row replay configuration: the overrides surface plus the
 * WI-3.4 mode policy. Both additive fields are OPTIONAL so every
 * `InlineCompletionDebugOverrides` value remains assignable (legacy captures,
 * live toolbar overrides); `compactReplayConfig` stamps them explicitly when
 * a config freezes at queue time, which makes the mode part of the
 * effective-config digest input (and therefore of config-group identity).
 */
export interface InlineCompletionDebugReplayConfig extends InlineCompletionDebugOverrides {
    /** Explicit replay mode; absent = the default mapping (rebuildCurrentSchema + fallback). */
    replayMode?: CompletionReplayMode;
    /**
     * rebuildCurrentSchema only: when required current schema is unavailable,
     * fall back to the captured schema context (recorded as provenance
     * `schemaContextSource: "explicitFallback"`) instead of blocking the item.
     */
    schemaFallbackToCaptured?: boolean;
}

export type InlineCompletionDebugReplayCartConfigMode = "snapshot" | "override" | "live";

export interface InlineCompletionDebugReplayEventSnapshot {
    id: string;
    sourceEventId: string;
    sourceLabel: string;
    capturedAt: number;
    event: InlineCompletionDebugEvent;
    capturedConfig: InlineCompletionDebugReplayConfig;
    configMode: InlineCompletionDebugReplayCartConfigMode;
    override?: Partial<InlineCompletionDebugReplayConfig> | null;
}

/**
 * One event added to the replay cart. Callers that hold the full event body
 * (session traces loaded locally) pass `event`; thin-transport callers (the
 * console-hosted live grid, which only holds content-free row projections)
 * pass `liveEventId` and the command handler resolves the full body from the
 * live ring host-side — event content never has to round-trip the webview.
 */
export type InlineCompletionDebugReplayCartAddItem =
    | { event: InlineCompletionDebugEvent; liveEventId?: undefined; sourceLabel?: string }
    | { liveEventId: string; event?: undefined; sourceLabel?: string };

/** The resolved form the replay service consumes (post live-ring lookup). */
export interface InlineCompletionDebugReplayCartResolvedItem {
    event: InlineCompletionDebugEvent;
    sourceLabel?: string;
}

export interface InlineCompletionDebugReplayMatrixCell {
    profileId: InlineCompletionDebugProfileId;
    profileLabel: string;
    schemaBudgetProfileId: InlineCompletionSchemaBudgetProfileId;
    schemaLabel: string;
    cellId: string;
    ordinal: number;
}

export interface InlineCompletionDebugReplayRun {
    id: string;
    traceId: string;
    kind: "single" | "matrix";
    matrixCells?: InlineCompletionDebugReplayMatrixCell[];
    startedAt: number;
    completedAt?: number;
    status: FeatureReplayRunStatus;
    totalEvents: number;
    completedEvents: number;
    activeMatrixCellId?: string;
    /** WI-3.2 additive fields (rendered by the Replay Lab page, WI-3.5). */
    cancelRequestedAt?: number;
    errorMessage?: string;
    estimate?: ReplayEstimate;
    safety?: ReplaySafetyAssessment;
    durable?: boolean;
    /** WI-3.4: items refused because mode-required inputs were unavailable. */
    blockedEvents?: number;
}

export interface InlineCompletionDebugReplayQueueRow {
    id: string;
    runId: string;
    traceId: string;
    snapshotId: string;
    sourceEventId: string;
    position: number;
    total: number;
    status: "queued" | "running";
    queuedAt: number;
    startedAt?: number;
    config: InlineCompletionDebugReplayConfig;
    /** sha256 of the frozen config's canonical JSON (queue-time freeze). */
    configDigest?: string;
    /** Repetition ordinal (always 1 until repetitions land). */
    repetition?: number;
    matrixCellId?: string;
    matrixCellLabel?: string;
    event: InlineCompletionDebugEvent;
}

export interface InlineCompletionDebugReplayState {
    cart: InlineCompletionDebugReplayEventSnapshot[];
    runs: InlineCompletionDebugReplayRun[];
    queueRows: InlineCompletionDebugReplayQueueRow[];
    activeRunId?: string;
    builderOpen: boolean;
    lastAddedAt?: number;
}

export interface InlineCompletionDebugWebviewState {
    events: InlineCompletionDebugEvent[];
    /**
     * Events evicted from the live ring this capture epoch (honest
     * truncation state — addendum §2.2). Optional for older serialized
     * snapshots; absent means unknown, 0 means nothing was dropped.
     */
    liveEvictedCount?: number;
    overrides: InlineCompletionDebugOverrides;
    defaults: InlineCompletionDebugDefaults;
    profiles: InlineCompletionDebugProfileOption[];
    availableModels: InlineCompletionDebugModelOption[];
    selectedEventId?: string;
    recordWhenClosed: boolean;
    /**
     * True while an ACTIVE capture stream persists full-fidelity content
     * (prompts, responses) to the local journal — the toolbar shows a
     * persistent "full capture" marker (addendum §9.4). Optional additive
     * field; absent means unknown/off.
     */
    sensitiveCaptureActive?: boolean;
    customPrompt: InlineCompletionDebugCustomPromptState;
    sessions: InlineCompletionDebugSessionsState;
    replay: InlineCompletionDebugReplayState;
}

export interface InlineCompletionDebugReducers {
    clearEvents: Record<string, never>;
    selectEvent: {
        eventId?: string;
    };
    updateOverrides: {
        overrides: Partial<InlineCompletionDebugOverrides>;
    };
    selectProfile: {
        profileId: InlineCompletionDebugProfileId;
    };
    setRecordWhenClosed: {
        enabled: boolean;
    };
    openCustomPromptDialog: Record<string, never>;
    closeCustomPromptDialog: Record<string, never>;
    saveCustomPrompt: {
        value: string;
    };
    resetCustomPrompt: Record<string, never>;
    refreshSchemaContext: Record<string, never>;
    importSession: Record<string, never>;
    exportSession: Record<string, never>;
    saveTraceNow: Record<string, never>;
    sessionsActivated: Record<string, never>;
    sessionsRefresh: Record<string, never>;
    sessionsToggleTrace: {
        fileKey: string;
        included: boolean;
    };
    sessionsSetAllTraces: {
        included: boolean;
    };
    sessionsLoadIncluded: Record<string, never>;
    sessionsAddFile: Record<string, never>;
    sessionsChangeFolder: Record<string, never>;
    sessionsEnableTraceCollection: Record<string, never>;
    sessionsSyncToDatabase: Record<string, never>;
    replayEvent: {
        eventId: string;
    };
    replaySessionEvent: {
        event: InlineCompletionDebugEvent;
    };
    openReplayBuilder: Record<string, never>;
    closeReplayBuilder: {
        restoreCart: boolean;
    };
    addEventsToReplayCart: {
        items: InlineCompletionDebugReplayCartAddItem[];
    };
    addSessionToReplayCart: {
        fileKey: string;
    };
    replaySessionNow: {
        fileKey: string;
    };
    removeFromReplayCart: {
        snapshotId: string;
    };
    reorderReplayCart: {
        fromIndex: number;
        toIndex: number;
    };
    clearReplayCart: Record<string, never>;
    reverseReplayCart: Record<string, never>;
    setReplayCartOverride: {
        snapshotId: string;
        override: Partial<InlineCompletionDebugReplayConfig> | null;
    };
    setReplayCartConfigMode: {
        snapshotId: string;
        configMode: InlineCompletionDebugReplayCartConfigMode;
    };
    queueReplayCart: {
        configMode?: InlineCompletionDebugReplayCartConfigMode;
        /** WI-3.4: explicit mode selection; absent = the default mapping. */
        replayMode?: CompletionReplayMode;
        schemaFallbackToCaptured?: boolean;
    };
    runReplayMatrix: {
        profileIds: InlineCompletionDebugProfileId[];
        /** Empty when the mode disables the schema-budget axis (captured schema cells). */
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[];
        /** WI-3.4: explicit mode selection; absent = the default mapping. */
        replayMode?: CompletionReplayMode;
        schemaFallbackToCaptured?: boolean;
    };
    cancelReplayRun: {
        runId?: string;
    };
    copyEventPayload: {
        eventId: string;
        kind:
            | "id"
            | "json"
            | "prompt"
            | "systemPrompt"
            | "userPrompt"
            | "rawResponse"
            | "sanitizedResponse";
    };
}

export interface InlineCompletionDebugExportData {
    version: 1;
    exportedAt: number;
    _savedAt: string;
    _extensionVersion: string;
    _truncated?: true;
    overrides: InlineCompletionDebugOverrides;
    recordWhenClosed: boolean;
    customPromptLastSavedAt?: number;
    events: InlineCompletionDebugEvent[];
}

/**
 * Where a Sessions dataset entry came from (additive, WI-2.5):
 * - "folder": a trace file discovered in the configured trace folder;
 * - "imported": a trace file the user added explicitly;
 * - "storedSession": a journal-backed capture session from the local
 *   observability store (indexed from its manifest only; read-only in this
 *   stage — retention owns deletion).
 * Absent on entries produced before the field existed (treat as folder/
 * imported via the `imported` flag).
 */
export type InlineCompletionDebugTraceSourceKind = "folder" | "imported" | "storedSession";

export interface InlineCompletionDebugTraceIndexEntry {
    fileKey: string;
    filename: string;
    path: string;
    savedAt?: string;
    sessionId?: string;
    eventCount: number;
    dateRange?: {
        start: number;
        end: number;
    };
    fileSizeBytes: number;
    profile?: string;
    schemaMode?: string;
    schemaSizeKind?: string;
    included: boolean;
    loaded: boolean;
    imported: boolean;
    loadError?: string;
    sourceKind?: InlineCompletionDebugTraceSourceKind;
    /** Stored sessions only: capture policy id from the stream manifest. */
    capturePolicyId?: string;
    /** Stored sessions only: journal record count from the stream manifest. */
    recordCount?: number;
}

export interface InlineCompletionDebugLoadedTrace {
    fileKey: string;
    trace: InlineCompletionDebugExportData;
}

export interface InlineCompletionDebugSessionsState {
    traceFolder: string;
    traceCaptureEnabled: boolean;
    traceIndex: InlineCompletionDebugTraceIndexEntry[];
    loadedTraces: InlineCompletionDebugLoadedTrace[];
    loading: boolean;
    warning?: string;
    error?: string;
    lastRefreshedAt?: number;
}
