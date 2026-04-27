/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type InlineCompletionResult =
    | "success"
    | "accepted"
    | "emptyFromModel"
    | "emptyFromSanitizer"
    | "noModel"
    | "noPermission"
    | "error";

export type InlineCompletionDebugEventResult =
    | InlineCompletionResult
    | "cancelled"
    | "pending"
    | "queued";

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

export interface InlineCompletionDebugEventTags {
    replayTraceId?: string;
    replayRunId?: string;
    replayMatrixCellId?: string;
    replaySourceEventId?: string;
    [key: string]: string | undefined;
}

export interface InlineCompletionDebugEvent {
    id: string;
    timestamp: number;
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

export type InlineCompletionDebugReplayConfig = InlineCompletionDebugOverrides;

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

export interface InlineCompletionDebugReplayCartAddItem {
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
    status: "queued" | "running" | "cancelled" | "completed";
    totalEvents: number;
    completedEvents: number;
    activeMatrixCellId?: string;
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
    overrides: InlineCompletionDebugOverrides;
    defaults: InlineCompletionDebugDefaults;
    profiles: InlineCompletionDebugProfileOption[];
    availableModels: InlineCompletionDebugModelOption[];
    selectedEventId?: string;
    recordWhenClosed: boolean;
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
    };
    runReplayMatrix: {
        profileIds: InlineCompletionDebugProfileId[];
        schemaBudgetProfileIds: InlineCompletionSchemaBudgetProfileId[];
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
}

export interface InlineCompletionDebugLoadedTrace {
    fileKey: string;
    trace: InlineCompletionDebugExportData;
}

export interface InlineCompletionDebugSessionsState {
    traceFolder: string;
    traceIndex: InlineCompletionDebugTraceIndexEntry[];
    loadedTraces: InlineCompletionDebugLoadedTrace[];
    loading: boolean;
    warning?: string;
    error?: string;
    lastRefreshedAt?: number;
}
