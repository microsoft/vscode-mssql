/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Debug Console implementation of the shared Inline Completion Debug provider
 * contract (final plan WI-1.4/1.5) — the SAME components as the standalone
 * panel, driven over the typed thin transport:
 *
 * - config/sessions/replay slices: legacy full-state pull with
 *   `omitEvents: true` (live event bodies never ride the initial payload;
 *   loaded traces join the sessions slice only after the USER loads them —
 *   interim until Phase-2 host-side aggregation);
 * - live events: dc/completionLiveRows (cursor-paged, content-free rows)
 *   projected to event view models with pendingDetail flags;
 * - detail: dc/completionEventDetail on selection, cached per event+section,
 *   merged back into the view models (no layout shift — DetailPane reserves
 *   space with inline skeletons while flags are set);
 * - commands: dc/icDebugCommand (typed union, validated host-side);
 * - refresh: dc/icDebugChanged2 revisions — only the changed domains re-pull.
 *
 * Grid "Info" previews (sanitized completion text) hydrate lazily through the
 * same detail channel for the newest terminal rows, so the streaming grid
 * keeps its at-a-glance readability without content ever riding live rows.
 */

import { ReactNode, useEffect, useMemo, useRef } from "react";
import {
    DcIcDebugStateRequest,
    DcIcDebugStateParams,
} from "../../../../sharedInterfaces/debugConsole";
import {
    CompletionLiveRowV1,
    DcCompletionEventDetailRequest,
    DcCompletionEventDetailResult,
    DcCompletionEventDetailSource,
    DcCompletionLiveRowsRequest,
    DcIcDebugChanged2Notification,
    DcIcDebugCommandRequest,
    IcDebugCommand,
    IcDetailSection,
} from "../../../../sharedInterfaces/completionsDebugRpc";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugWebviewState,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import {
    IcDebugStateStore,
    InlineCompletionDebugContextProps,
    InlineCompletionDebugEventVm,
    InlineCompletionDebugPendingDetail,
    InlineCompletionDebugProviderBridge,
} from "../../InlineCompletionDebug/inlineCompletionDebugStateProvider";
import { useDc } from "../state";

/** Newest terminal rows whose Info preview is hydrated eagerly. */
const INFO_PREVIEW_HYDRATION_LIMIT = 150;
/** Hard stop for cursor-paging the live ring (ring capacity is 500). */
const MAX_LIVE_PAGES = 6;

/** Rendered until the first pulls resolve. */
function createInitialClientState(): InlineCompletionDebugWebviewState {
    return {
        events: [],
        liveEvictedCount: 0,
        overrides: {
            profileId: null,
            modelSelector: null,
            continuationModelSelector: null,
            useSchemaContext: null,
            includeSqlDiagnostics: null,
            debounceMs: null,
            maxTokens: null,
            enabledCategories: null,
            forceIntentMode: null,
            customSystemPrompt: null,
            allowAutomaticTriggers: null,
            schemaContext: null,
        },
        defaults: {
            useSchemaContext: false,
            includeSqlDiagnostics: true,
            debounceMs: 0,
            continuationMaxTokens: 0,
            intentMaxTokens: 0,
            enabledCategories: [],
            allowAutomaticTriggers: true,
            schemaContext: null,
        },
        profiles: [],
        availableModels: [],
        recordWhenClosed: false,
        customPrompt: {
            dialogOpen: false,
            savedValue: null,
            defaultValue: "",
        },
        sessions: {
            traceFolder: "",
            traceCaptureEnabled: false,
            traceIndex: [],
            loadedTraces: [],
            loading: false,
        },
        replay: {
            cart: [],
            runs: [],
            queueRows: [],
            builderOpen: false,
        },
    };
}

interface DetailCacheEntry {
    fetched: Set<IcDetailSection>;
    sections: Partial<Record<IcDetailSection, unknown>>;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalResult(result: InlineCompletionDebugEvent["result"]): boolean {
    return result !== "pending" && result !== "queued";
}

/**
 * Thin row → event view model (the console-side WI-1.4 mapper; the
 * standalone panel's events need no mapping). Content fields start empty;
 * cached detail sections merge in below and pendingDetail advertises what is
 * still host-side only.
 */
function createLiveEventVm(
    row: CompletionLiveRowV1,
    cache: DetailCacheEntry | undefined,
): InlineCompletionDebugEventVm {
    const vm: InlineCompletionDebugEventVm = {
        id: row.eventId,
        timestamp: row.timestamp,
        documentUri: "",
        documentFileName: row.documentFileName ?? "",
        line: row.line ?? 0,
        column: row.column ?? 0,
        triggerKind: row.trigger,
        explicitFromUser: row.trigger === "invoke",
        completionCategory: row.completionCategory ?? (row.intentMode ? "intent" : "continuation"),
        intentMode: row.intentMode ?? false,
        inferredSystemQuery: false,
        // The host resolved the display label already; getEventModelLabel
        // falls back through modelId so the grid shows it verbatim.
        modelFamily: row.modelLabel,
        modelId: row.modelLabel,
        modelVendor: undefined,
        result: row.result,
        latencyMs: row.latencyMs ?? 0,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: false,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [],
        rawResponse: "",
        sanitizedResponse: undefined,
        finalCompletionText: undefined,
        schemaContextFormatted: undefined,
        locals: {},
    };
    if (row.replayRunId !== undefined || row.matrixCellLabel !== undefined) {
        vm.tags = {
            ...(row.replayRunId !== undefined ? { replayRunId: row.replayRunId } : {}),
            ...(row.matrixCellLabel !== undefined
                ? { replayMatrixCellId: row.matrixCellLabel }
                : {}),
        };
    }

    if (cache) {
        applyDetailSections(vm, cache.sections);
    }
    const pending = computePendingDetail(row, cache?.fetched);
    if (pending) {
        vm.pendingDetail = pending;
    }
    return vm;
}

function computePendingDetail(
    row: CompletionLiveRowV1,
    fetched: Set<IcDetailSection> | undefined,
): InlineCompletionDebugPendingDetail | undefined {
    const has = (section: IcDetailSection) => fetched?.has(section) === true;
    const flags: InlineCompletionDebugPendingDetail = {
        summary: !has("summary"),
        prompt: row.detailAvailable.prompt && !has("prompt"),
        rawResponse: row.detailAvailable.response && !has("rawResponse"),
        sanitizedResponse: row.detailAvailable.response && !has("sanitizedResponse"),
        schema: row.detailAvailable.schema && !has("schemaContext"),
        locals: row.detailAvailable.locals && !has("locals"),
        error: row.detailAvailable.error && !has("error"),
    };
    return flags.summary ||
        flags.prompt ||
        flags.rawResponse ||
        flags.sanitizedResponse ||
        flags.schema ||
        flags.locals ||
        flags.error
        ? flags
        : undefined;
}

/** Merge fetched detail sections into a view model (inverse of the host's projection). */
function applyDetailSections(
    vm: InlineCompletionDebugEventVm,
    sections: Partial<Record<IcDetailSection, unknown>>,
): void {
    if ("summary" in sections && isJsonRecord(sections.summary)) {
        const summary = sections.summary;
        vm.modelVendor = asOptionalString(summary.modelVendor);
        vm.modelId = asOptionalString(summary.modelId) ?? vm.modelId;
        vm.modelFamily = asOptionalString(summary.modelFamily) ?? vm.modelFamily;
        if (typeof summary.explicitFromUser === "boolean") {
            vm.explicitFromUser = summary.explicitFromUser;
        }
        if (typeof summary.inferredSystemQuery === "boolean") {
            vm.inferredSystemQuery = summary.inferredSystemQuery;
        }
        if (typeof summary.usedSchemaContext === "boolean") {
            vm.usedSchemaContext = summary.usedSchemaContext;
        }
        if (typeof summary.schemaObjectCount === "number") {
            vm.schemaObjectCount = summary.schemaObjectCount;
        }
        if (typeof summary.schemaSystemObjectCount === "number") {
            vm.schemaSystemObjectCount = summary.schemaSystemObjectCount;
        }
        if (typeof summary.schemaForeignKeyCount === "number") {
            vm.schemaForeignKeyCount = summary.schemaForeignKeyCount;
        }
        if (isJsonRecord(summary.link)) {
            vm.link = summary.link as unknown as InlineCompletionDebugEvent["link"];
        }
        if (isJsonRecord(summary.tags)) {
            vm.tags = { ...vm.tags, ...(summary.tags as InlineCompletionDebugEvent["tags"]) };
        }
    }
    if ("overrides" in sections && isJsonRecord(sections.overrides)) {
        vm.overridesApplied =
            sections.overrides as unknown as InlineCompletionDebugEvent["overridesApplied"];
    }
    if ("prompt" in sections) {
        vm.promptMessages = Array.isArray(sections.prompt)
            ? (sections.prompt as InlineCompletionDebugEvent["promptMessages"])
            : [];
    }
    if ("rawResponse" in sections) {
        vm.rawResponse = typeof sections.rawResponse === "string" ? sections.rawResponse : "";
    }
    if ("sanitizedResponse" in sections && isJsonRecord(sections.sanitizedResponse)) {
        vm.sanitizedResponse = asOptionalString(sections.sanitizedResponse.sanitizedResponse);
        vm.finalCompletionText = asOptionalString(sections.sanitizedResponse.finalCompletionText);
    }
    if ("schemaContext" in sections) {
        vm.schemaContextFormatted = asOptionalString(sections.schemaContext);
    }
    if ("locals" in sections) {
        vm.locals = isJsonRecord(sections.locals) ? sections.locals : {};
    }
    if ("error" in sections && isJsonRecord(sections.error)) {
        vm.error = sections.error as InlineCompletionDebugEvent["error"];
    }
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Sections that make the grid's Info column readable for one row. */
function infoPreviewSections(row: CompletionLiveRowV1): IcDetailSection[] {
    const sections: IcDetailSection[] = [];
    if (row.detailAvailable.response) {
        sections.push("sanitizedResponse");
    }
    if (row.detailAvailable.error) {
        sections.push("error");
    }
    // skipReason / replay labels / pendingStage live in locals.
    if (row.detailAvailable.locals && (row.result === "skipped" || row.result === "pending")) {
        sections.push("locals");
    }
    return sections;
}

export const ConsoleCompletionsDebugStateProvider = ({ children }: { children: ReactNode }) => {
    const { rpc } = useDc();
    const mountedRef = useRef(true);
    const baseRef = useRef<InlineCompletionDebugWebviewState>(createInitialClientState());
    const liveRowsRef = useRef<CompletionLiveRowV1[]>([]); // oldest-first
    const liveDroppedRef = useRef(false);
    const detailCacheRef = useRef(new Map<string, DetailCacheEntry>());
    const composedRef = useRef<InlineCompletionDebugWebviewState>(baseRef.current);
    const listenersRef = useRef(new Set<() => void>());
    const hydrationQueueRef = useRef<Array<{ eventId: string; sections: IcDetailSection[] }>>([]);
    const hydrationQueuedIdsRef = useRef(new Set<string>());
    const hydrationRunningRef = useRef(false);

    const recompose = () => {
        if (!mountedRef.current) {
            return;
        }
        const cache = detailCacheRef.current;
        const base = baseRef.current;
        composedRef.current = {
            ...base,
            events: liveRowsRef.current.map((row) =>
                createLiveEventVm(row, cache.get(row.eventId)),
            ),
            liveEvictedCount: liveDroppedRef.current
                ? Math.max(1, base.liveEvictedCount ?? 0)
                : (base.liveEvictedCount ?? 0),
        };
        listenersRef.current.forEach((listener) => listener());
    };

    // Stable across the provider's lifetime; reads/writes go through refs.
    const io = useMemo(() => {
        const pullBase = async () => {
            const params: DcIcDebugStateParams = { omitEvents: true };
            const next = await rpc.sendRequest(DcIcDebugStateRequest.type, params);
            if (!mountedRef.current) {
                return;
            }
            baseRef.current = next;
            recompose();
        };

        const pullLive = async () => {
            const rows: CompletionLiveRowV1[] = [];
            let cursor: string | undefined;
            let dropped = false;
            for (let page = 0; page < MAX_LIVE_PAGES; page++) {
                const result = await rpc.sendRequest(
                    DcCompletionLiveRowsRequest.type,
                    cursor !== undefined ? { cursor } : {},
                );
                rows.push(...result.rows);
                dropped = result.droppedFromRing;
                cursor = result.nextCursor;
                if (cursor === undefined) {
                    break;
                }
            }
            if (!mountedRef.current) {
                return;
            }
            // Newest-first pages → the store's oldest-first order.
            rows.reverse();
            liveRowsRef.current = rows;
            liveDroppedRef.current = dropped;
            // Terminal rows that settled since the last pull re-hydrate their
            // cached-but-stale sections lazily: drop cache entries for ids no
            // longer present to bound memory.
            const present = new Set(rows.map((row) => row.eventId));
            for (const key of [...detailCacheRef.current.keys()]) {
                if (!present.has(key)) {
                    detailCacheRef.current.delete(key);
                }
            }
            recompose();
            scheduleInfoHydration(rows);
        };

        const fetchDetailIntoCache = async (
            eventId: string,
            sections: IcDetailSection[],
            cacheable: boolean,
        ): Promise<DcCompletionEventDetailResult> => {
            const result = await rpc.sendRequest(DcCompletionEventDetailRequest.type, {
                source: { kind: "live" },
                eventId,
                sections,
            });
            if (mountedRef.current && result.found && cacheable) {
                const entry = detailCacheRef.current.get(eventId) ?? {
                    fetched: new Set<IcDetailSection>(),
                    sections: {},
                };
                for (const section of sections) {
                    entry.fetched.add(section);
                    entry.sections[section] = result.sections[section];
                }
                detailCacheRef.current.set(eventId, entry);
                recompose();
            }
            return result;
        };

        const scheduleInfoHydration = (rowsOldestFirst: CompletionLiveRowV1[]) => {
            const cache = detailCacheRef.current;
            const queued = hydrationQueuedIdsRef.current;
            const newestFirst = [...rowsOldestFirst].reverse();
            let considered = 0;
            for (const row of newestFirst) {
                if (considered >= INFO_PREVIEW_HYDRATION_LIMIT) {
                    break;
                }
                considered++;
                const sections = infoPreviewSections(row);
                if (sections.length === 0 || queued.has(row.eventId)) {
                    continue;
                }
                const terminal = isTerminalResult(row.result);
                const entry = cache.get(row.eventId);
                const missing = sections.filter((section) => entry?.fetched.has(section) !== true);
                if (terminal && missing.length === 0) {
                    continue;
                }
                queued.add(row.eventId);
                hydrationQueueRef.current.push({
                    eventId: row.eventId,
                    sections: terminal ? missing : sections,
                });
            }
            void runHydrationQueue();
        };

        const runHydrationQueue = async () => {
            if (hydrationRunningRef.current) {
                return;
            }
            hydrationRunningRef.current = true;
            try {
                while (mountedRef.current && hydrationQueueRef.current.length > 0) {
                    const item = hydrationQueueRef.current.shift()!;
                    hydrationQueuedIdsRef.current.delete(item.eventId);
                    const row = liveRowsRef.current.find((r) => r.eventId === item.eventId);
                    if (!row) {
                        continue;
                    }
                    const terminal = isTerminalResult(row.result);
                    try {
                        const result = await fetchDetailIntoCache(
                            item.eventId,
                            item.sections,
                            terminal,
                        );
                        // Pending rows: apply transiently (content still
                        // evolving — never cached), directly onto the vm.
                        if (!terminal && result.found && mountedRef.current) {
                            const vm = composedRef.current.events.find(
                                (event) => event.id === item.eventId,
                            ) as InlineCompletionDebugEventVm | undefined;
                            if (vm) {
                                applyDetailSections(vm, result.sections);
                                listenersRef.current.forEach((listener) => listener());
                            }
                        }
                    } catch {
                        // Preview hydration is best-effort; the row stays
                        // metadata-only and detail loads on selection.
                    }
                }
            } finally {
                hydrationRunningRef.current = false;
            }
        };

        const send = (command: IcDebugCommand) => {
            void rpc
                .sendRequest(DcIcDebugCommandRequest.type, { command })
                .then(() => pullBase())
                .catch(() => undefined);
        };

        return { pullBase, pullLive, fetchDetailIntoCache, send };
        // recompose/scheduleInfoHydration close over refs only.
    }, [rpc]);

    useEffect(() => {
        mountedRef.current = true;
        // Re-registering on remount replaces the previous (guarded) handler on
        // the shared connection — same pattern DcProvider uses for its own
        // notifications.
        rpc.onNotification(DcIcDebugChanged2Notification.type, ({ changed }) => {
            if (!mountedRef.current) {
                return;
            }
            if (changed.includes("live")) {
                void io.pullLive();
            }
            if (
                changed.includes("config") ||
                changed.includes("sessions") ||
                changed.includes("replay")
            ) {
                void io.pullBase();
            }
        });
        void io.pullBase();
        void io.pullLive();
        return () => {
            mountedRef.current = false;
        };
    }, [rpc, io]);

    const store = useMemo<IcDebugStateStore>(
        () => ({
            getSnapshot: () => composedRef.current,
            subscribe: (listener: () => void) => {
                listenersRef.current.add(listener);
                return () => {
                    listenersRef.current.delete(listener);
                };
            },
        }),
        [],
    );

    const actions = useMemo<InlineCompletionDebugContextProps>(
        () => ({
            clearEvents: () => io.send({ name: "clearEvents", payload: {} }),
            selectEvent: (eventId) => {
                // Optimistic: selection must feel instant in the grid; the
                // host round-trip reconciles on the pullBase that follows.
                baseRef.current = { ...baseRef.current, selectedEventId: eventId };
                recompose();
                io.send({ name: "selectEvent", payload: { eventId } });
            },
            updateOverrides: (overrides) =>
                io.send({ name: "updateOverrides", payload: { overrides } }),
            selectProfile: (profileId) =>
                io.send({ name: "selectProfile", payload: { profileId } }),
            setRecordWhenClosed: (enabled) =>
                io.send({ name: "setRecordWhenClosed", payload: { enabled } }),
            openCustomPromptDialog: () => io.send({ name: "openCustomPromptDialog", payload: {} }),
            closeCustomPromptDialog: () =>
                io.send({ name: "closeCustomPromptDialog", payload: {} }),
            saveCustomPrompt: (value) => io.send({ name: "saveCustomPrompt", payload: { value } }),
            resetCustomPrompt: () => io.send({ name: "resetCustomPrompt", payload: {} }),
            refreshSchemaContext: () => io.send({ name: "refreshSchemaContext", payload: {} }),
            importSession: () => io.send({ name: "importSession", payload: {} }),
            exportSession: () => io.send({ name: "exportSession", payload: {} }),
            saveTraceNow: () => io.send({ name: "saveTraceNow", payload: {} }),
            sessionsActivated: () => io.send({ name: "sessionsActivated", payload: {} }),
            sessionsRefresh: () => io.send({ name: "sessionsRefresh", payload: {} }),
            sessionsToggleTrace: (fileKey, included) =>
                io.send({ name: "sessionsToggleTrace", payload: { fileKey, included } }),
            sessionsSetAllTraces: (included) =>
                io.send({ name: "sessionsSetAllTraces", payload: { included } }),
            sessionsLoadIncluded: () => io.send({ name: "sessionsLoadIncluded", payload: {} }),
            sessionsAddFile: () => io.send({ name: "sessionsAddFile", payload: {} }),
            sessionsChangeFolder: () => io.send({ name: "sessionsChangeFolder", payload: {} }),
            sessionsEnableTraceCollection: () =>
                io.send({ name: "sessionsEnableTraceCollection", payload: {} }),
            sessionsSyncToDatabase: () => io.send({ name: "sessionsSyncToDatabase", payload: {} }),
            replayEvent: (eventId) => io.send({ name: "replayEvent", payload: { eventId } }),
            replaySessionEvent: (event) =>
                io.send({ name: "replaySessionEvent", payload: { event } }),
            openReplayBuilder: () => io.send({ name: "openReplayBuilder", payload: {} }),
            closeReplayBuilder: (restoreCart) =>
                io.send({ name: "closeReplayBuilder", payload: { restoreCart } }),
            addEventsToReplayCart: (items) =>
                io.send({ name: "addEventsToReplayCart", payload: { items } }),
            addSessionToReplayCart: (fileKey) =>
                io.send({ name: "addSessionToReplayCart", payload: { fileKey } }),
            replaySessionNow: (fileKey) =>
                io.send({ name: "replaySessionNow", payload: { fileKey } }),
            removeFromReplayCart: (snapshotId) =>
                io.send({ name: "removeFromReplayCart", payload: { snapshotId } }),
            reorderReplayCart: (fromIndex, toIndex) =>
                io.send({ name: "reorderReplayCart", payload: { fromIndex, toIndex } }),
            clearReplayCart: () => io.send({ name: "clearReplayCart", payload: {} }),
            reverseReplayCart: () => io.send({ name: "reverseReplayCart", payload: {} }),
            setReplayCartOverride: (snapshotId, override) =>
                io.send({ name: "setReplayCartOverride", payload: { snapshotId, override } }),
            setReplayCartConfigMode: (snapshotId, configMode) =>
                io.send({ name: "setReplayCartConfigMode", payload: { snapshotId, configMode } }),
            queueReplayCart: (configMode, modeSelection) =>
                io.send({
                    name: "queueReplayCart",
                    payload: {
                        ...(configMode ? { configMode } : {}),
                        ...(modeSelection ?? {}),
                    },
                }),
            runReplayMatrix: (profileIds, schemaBudgetProfileIds, modeSelection) =>
                io.send({
                    name: "runReplayMatrix",
                    payload: {
                        profileIds,
                        schemaBudgetProfileIds,
                        ...(modeSelection ?? {}),
                    },
                }),
            cancelReplayRun: (runId) => io.send({ name: "cancelReplayRun", payload: { runId } }),
            copyEventPayload: (eventId, kind) =>
                io.send({ name: "copyEventPayload", payload: { eventId, kind } }),
            getEventDetail: async (
                source: DcCompletionEventDetailSource,
                eventId: string,
                sections: IcDetailSection[],
            ) => {
                if (source.kind !== "live") {
                    // Loaded-trace events are held in full in the sessions
                    // slice (standalone semantics); nothing fetches them today
                    // — pass straight through for completeness.
                    return rpc.sendRequest(DcCompletionEventDetailRequest.type, {
                        source,
                        eventId,
                        sections,
                    });
                }
                const row = liveRowsRef.current.find((candidate) => candidate.eventId === eventId);
                const terminal = row !== undefined && isTerminalResult(row.result);
                const entry = detailCacheRef.current.get(eventId);
                // "summary" implies overrides too — one round trip fills the
                // model/config fidelity the summary tab and analysis expect.
                const expanded = sections.includes("summary")
                    ? [...new Set<IcDetailSection>([...sections, "overrides"])]
                    : sections;
                const missing = terminal
                    ? expanded.filter((section) => entry?.fetched.has(section) !== true)
                    : expanded;
                if (missing.length === 0 && entry) {
                    const cached: Partial<Record<IcDetailSection, unknown>> = {};
                    for (const section of sections) {
                        cached[section] = entry.sections[section];
                    }
                    return { found: true, revision: 0, sections: cached };
                }
                return io.fetchDetailIntoCache(eventId, missing, terminal);
            },
        }),
        // io is stable per connection; refs carry the mutable state.
        [io, rpc],
    );

    return (
        <InlineCompletionDebugProviderBridge store={store} actions={actions}>
            {children}
        </InlineCompletionDebugProviderBridge>
    );
};
