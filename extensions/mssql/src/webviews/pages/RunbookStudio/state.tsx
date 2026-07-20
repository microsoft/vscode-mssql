/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Runbook Studio client state: coarse host snapshot + route + typed actions. */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    RbsCancelCompileRequest,
    RbsApplyPresentationLayoutRequest,
    RbsApplyPresentationOverlayRequest,
    RbsCancelRunRequest,
    RbsClearPresentationOverlayRequest,
    RbsCompileProgressNotification,
    RbsCompileRequest,
    RbsConnectionProfileRef,
    RbsError,
    RbsEvidenceExportFormat,
    RbsExecutePlanQueryRequest,
    RbsExportEvidenceRequest,
    RbsGetRunRequest,
    RbsListConnectionsRequest,
    RbsNavigateNotification,
    RbsOpenDiagnosticsRequest,
    RbsPreviewPresentationLayoutRequest,
    RbsPlannerProgressEvent,
    RbsRespondToGateRequest,
    RbsRoute,
    RbsRunEventNotification,
    RbsSelectRunRequest,
    RbsSetOutputViewRequest,
    RbsSetOutputPresentationRequest,
    RbsStartRunRequest,
    RbsState,
    RbsUpdateIntentRequest,
    RunbookRunEvent,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import {
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationMode,
    OutputViewSettings,
    ResolvedPresentation,
    ViewKind,
} from "../../../sharedInterfaces/runbookPresentation";

/** One WORKFLOW STEPS row of the generation console (planner build turn). */
export interface PlannerConsoleTurn {
    seq: number;
    label: string;
    turnKind?: string;
    durationMs?: number;
    done: boolean;
}

/** One LIVE THINKING feed entry (stable id for list keys under capping). */
export interface PlannerFeedEntry {
    id: number;
    event: RbsPlannerProgressEvent;
}

/**
 * Generation-console state accumulated from planner progress events. Reset
 * on each compile start; kept (collapsed to a summary) after completion or
 * failure until the next compile.
 */
export interface PlannerConsoleState {
    /** Undefined until the first compile in this panel starts. */
    startedAt?: number;
    endedAt?: number;
    outcome?: "ok" | "error";
    turns: PlannerConsoleTurn[];
    /** Bounded LIVE THINKING feed (reasoning / tool calls / turn summaries). */
    feed: PlannerFeedEntry[];
    toolCalls: number;
    /** Latest coarse phase one-liner (localized at source). */
    phase?: string;
    /** Comma-joined proposed input names, once proposed. */
    inputs?: string;
    /** Planner model chip: model id + provider label, once resolved. */
    model?: { id: string; providerLabel?: string };
    nextFeedId: number;
}

const PLANNER_FEED_CAP = 300;

const emptyPlannerConsole: PlannerConsoleState = {
    turns: [],
    feed: [],
    toolCalls: 0,
    nextFeedId: 0,
};

type PlannerConsoleAction =
    | { type: "start" }
    | { type: "event"; event: RbsPlannerProgressEvent }
    | { type: "finish"; ok: boolean };

function pushFeed(state: PlannerConsoleState, event: RbsPlannerProgressEvent): PlannerConsoleState {
    const feed = state.feed.concat({ id: state.nextFeedId, event });
    return {
        ...state,
        feed: feed.length > PLANNER_FEED_CAP ? feed.slice(feed.length - PLANNER_FEED_CAP) : feed,
        nextFeedId: state.nextFeedId + 1,
    };
}

function plannerConsoleReducer(
    state: PlannerConsoleState,
    action: PlannerConsoleAction,
): PlannerConsoleState {
    if (action.type === "start") {
        return { ...emptyPlannerConsole, startedAt: Date.now() };
    }
    if (action.type === "finish") {
        return state.startedAt === undefined
            ? state
            : {
                  ...state,
                  endedAt: Date.now(),
                  outcome: action.ok ? "ok" : "error",
                  // No "working…" row may survive completion/failure — mark
                  // every turn done; turns without a duration show the check
                  // alone.
                  turns: state.turns.map((turn) => (turn.done ? turn : { ...turn, done: true })),
              };
    }
    if (state.startedAt === undefined) {
        // Stray event outside a compile (e.g. late arrival) — ignore.
        return state;
    }
    const event = action.event;
    switch (event.kind) {
        case "turn-started": {
            const seq = event.seq ?? state.turns.length + 1;
            const turn: PlannerConsoleTurn = {
                seq,
                label: event.label ?? "",
                ...(event.turnKind ? { turnKind: event.turnKind } : {}),
                done: false,
            };
            const index = state.turns.findIndex((t) => t.seq === seq);
            // A revision attempt restarts an existing turn row in place.
            const turns =
                index >= 0
                    ? state.turns.map((t, i) => (i === index ? turn : t))
                    : state.turns.concat(turn);
            return { ...state, turns };
        }
        case "turn-completed": {
            const turns = state.turns.map((t) =>
                t.seq === event.seq
                    ? {
                          ...t,
                          done: true,
                          ...(event.durationMs !== undefined
                              ? { durationMs: event.durationMs }
                              : {}),
                      }
                    : t,
            );
            const base = event.text ? pushFeed(state, event) : state;
            return { ...base, turns };
        }
        case "reasoning":
            return event.text ? pushFeed(state, event) : state;
        case "tool-call":
            return { ...pushFeed(state, event), toolCalls: state.toolCalls + 1 };
        case "inputs-proposed":
            return { ...state, inputs: event.text ?? "" };
        case "phase":
            return event.text ? { ...state, phase: event.text } : state;
        case "model":
            return event.text
                ? {
                      ...state,
                      model: {
                          id: event.text,
                          ...(event.label ? { providerLabel: event.label } : {}),
                      },
                  }
                : state;
        default:
            return state;
    }
}

interface RbsContextValue {
    state: RbsState | undefined;
    rpc: ReturnType<typeof useVscodeWebview<RbsState, void>>["extensionRpc"];
    route: RbsRoute;
    navigate: (route: RbsRoute) => void;
    /** Recent run events for the live view (bounded). */
    runEvents: RunbookRunEvent[];
    lastError: RbsError | undefined;
    dismissError: () => void;
    compiling: boolean;
    /** Generation console accumulated from planner progress events. */
    plannerConsole: PlannerConsoleState;
    compile: (intent: string) => Promise<boolean>;
    /** Abort an in-flight plan generation; the compile promise settles via
     *  its normal error path ("cancelled" arrives as the compile error). */
    cancelCompile: () => Promise<boolean>;
    connections: RbsConnectionProfileRef[];
    refreshConnections: () => void;
    updateIntent: (intent: string) => Promise<boolean>;
    /** Parameter form draft — lives here so route changes and started runs
     *  never wipe what the user configured. */
    parameterDraft: Record<string, string>;
    setParameterDraft: (id: string, value: string) => void;
    setOutputView: (nodeId: string, view: ViewKind | undefined) => Promise<boolean>;
    setOutputPresentation: (
        nodeId: string,
        views: ViewKind[],
        presentation: PresentationMode,
        defaultView: ViewKind,
        settings: OutputViewSettings | undefined,
        baseRevision: number,
        resetToSuggested?: boolean,
    ) => Promise<{ applied: boolean; reason?: "invalid" | "revisionConflict" }>;
    applyPresentationLayout: (
        edits: PresentationLayoutEdit[],
        policy: PresentationLayoutPolicyEdit | undefined,
        baseRevision: number,
    ) => Promise<{ applied: boolean; reason?: "invalid" | "revisionConflict" | "cancelled" }>;
    previewPresentationLayout: (
        edits: PresentationLayoutEdit[],
        policy: PresentationLayoutPolicyEdit | undefined,
        baseRevision: number,
        target:
            | { kind: "run"; runId: string }
            | {
                  kind: "sample";
                  scenario: "clean" | "blockingErrors" | "approvalRejected";
              },
    ) => Promise<{
        presentation?: ResolvedPresentation;
        reason?: "invalid" | "revisionConflict" | "targetMissing";
    }>;
    applyPresentationOverlay: (
        runId: string,
        edits: PresentationLayoutEdit[],
        policy: PresentationLayoutPolicyEdit | undefined,
        baseRevision: number,
    ) => Promise<{
        applied: boolean;
        reason?: "invalid" | "revisionConflict" | "targetMissing";
    }>;
    clearPresentationOverlay: (runId: string) => Promise<boolean>;
    /** Open and execute a compiled read-query node in Query Studio. */
    executePlanQuery: (nodeId: string) => Promise<boolean>;
    /** Show a prior run's results (persistence-backed). */
    selectRun: (runId: string) => Promise<boolean>;
    /** Load one bounded durable snapshot without changing the selected run. */
    getRun: (runId: string) => Promise<RunbookRunSnapshot | undefined>;
    /** Ask the host to save a secret-safe CI evidence projection. */
    exportEvidence: (runId: string, format: RbsEvidenceExportFormat) => Promise<boolean>;
    startRun: (
        parameterValues: Record<string, string | number | boolean | null>,
    ) => Promise<string | undefined>;
    cancelRun: (runId: string) => Promise<void>;
    respondToGate: (runId: string, nodeId: string, approve: boolean) => Promise<void>;
    openDiagnostics: (runId?: string, nodeId?: string) => void;
}

const RbsContext = createContext<RbsContextValue | undefined>(undefined);

export function useRbs(): RbsContextValue {
    const value = useContext(RbsContext);
    if (!value) {
        throw new Error("useRbs outside provider");
    }
    return value;
}

const RUN_EVENT_VIEW_CAP = 2000;

export function RbsProvider({ children }: { children: React.ReactNode }) {
    const { getSnapshot, subscribe, extensionRpc: rpc } = useVscodeWebview<RbsState, void>();
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const state: RbsState | undefined =
        snapshot && Object.keys(snapshot).length > 0 ? snapshot : undefined;
    const [route, navigate] = useState<RbsRoute>("author");
    const [runEvents, setRunEvents] = useState<RunbookRunEvent[]>([]);
    const [lastError, setLastError] = useState<RbsError | undefined>(undefined);
    const [autoResultsRunId, setAutoResultsRunId] = useState<string | undefined>(undefined);
    const initialRouteConsumedRef = useRef(false);

    // One-shot deep-link route from the initial snapshot.
    useEffect(() => {
        if (!initialRouteConsumedRef.current && state?.initialRoute) {
            initialRouteConsumedRef.current = true;
            navigate(state.initialRoute);
        }
    }, [state?.initialRoute]);

    useEffect(() => {
        rpc.onNotification(RbsNavigateNotification.type, ({ route: target }) => {
            navigate(target);
        });
        rpc.onNotification(RbsCompileProgressNotification.type, (event) => {
            dispatchPlannerConsole({ type: "event", event });
        });
        rpc.onNotification(RbsRunEventNotification.type, (event) => {
            setRunEvents((current) => {
                const next = current.concat(event);
                return next.length > RUN_EVENT_VIEW_CAP
                    ? next.slice(next.length - RUN_EVENT_VIEW_CAP)
                    : next;
            });
        });
    }, []);

    const dismissError = useCallback(() => setLastError(undefined), []);

    const [compiling, setCompiling] = useState(false);
    const [plannerConsole, dispatchPlannerConsole] = useReducer(
        plannerConsoleReducer,
        emptyPlannerConsole,
    );
    const compile = useCallback(
        async (intent: string): Promise<boolean> => {
            setLastError(undefined);
            setCompiling(true);
            dispatchPlannerConsole({ type: "start" });
            let ok = false;
            try {
                const result = await rpc.sendRequest(RbsCompileRequest.type, { intent });
                if (result.error) {
                    setLastError(result.error);
                }
                ok = result.ok;
                return result.ok;
            } finally {
                setCompiling(false);
                dispatchPlannerConsole({ type: "finish", ok });
            }
        },
        [rpc],
    );

    const cancelCompile = useCallback(async (): Promise<boolean> => {
        const result = await rpc.sendRequest(RbsCancelCompileRequest.type, {});
        return result.cancelled;
    }, [rpc]);

    const [connections, setConnections] = useState<RbsConnectionProfileRef[]>([]);
    const refreshConnections = useCallback(() => {
        void rpc
            .sendRequest(RbsListConnectionsRequest.type)
            .then((result) => setConnections(result.profiles));
    }, [rpc]);
    useEffect(() => {
        refreshConnections();
    }, []);

    const updateIntent = useCallback(
        async (intent: string): Promise<boolean> => {
            const result = await rpc.sendRequest(RbsUpdateIntentRequest.type, { intent });
            return result.applied;
        },
        [rpc],
    );

    const [parameterDraft, setParameterDraftState] = useState<Record<string, string>>({});
    const setParameterDraft = useCallback((id: string, value: string) => {
        setParameterDraftState((current) => ({ ...current, [id]: value }));
    }, []);

    const setOutputView = useCallback(
        async (nodeId: string, view: ViewKind | undefined): Promise<boolean> => {
            const result = await rpc.sendRequest(RbsSetOutputViewRequest.type, { nodeId, view });
            return result.applied;
        },
        [rpc],
    );

    const setOutputPresentation = useCallback(
        async (
            nodeId: string,
            views: ViewKind[],
            presentation: PresentationMode,
            defaultView: ViewKind,
            settings: OutputViewSettings | undefined,
            baseRevision: number,
            resetToSuggested = false,
        ) =>
            rpc.sendRequest(RbsSetOutputPresentationRequest.type, {
                nodeId,
                views,
                presentation,
                defaultView,
                ...(settings ? { settings } : {}),
                baseRevision,
                ...(resetToSuggested ? { resetToSuggested: true } : {}),
            }),
        [rpc],
    );

    const applyPresentationLayout = useCallback(
        async (
            edits: PresentationLayoutEdit[],
            policy: PresentationLayoutPolicyEdit | undefined,
            baseRevision: number,
        ) =>
            rpc.sendRequest(RbsApplyPresentationLayoutRequest.type, {
                edits,
                ...(policy ? { policy } : {}),
                baseRevision,
            }),
        [rpc],
    );

    const previewPresentationLayout = useCallback(
        (
            edits: PresentationLayoutEdit[],
            policy: PresentationLayoutPolicyEdit | undefined,
            baseRevision: number,
            target:
                | { kind: "run"; runId: string }
                | {
                      kind: "sample";
                      scenario: "clean" | "blockingErrors" | "approvalRejected";
                  },
        ) =>
            rpc.sendRequest(RbsPreviewPresentationLayoutRequest.type, {
                edits,
                ...(policy ? { policy } : {}),
                baseRevision,
                target,
            }),
        [rpc],
    );

    const applyPresentationOverlay = useCallback(
        (
            runId: string,
            edits: PresentationLayoutEdit[],
            policy: PresentationLayoutPolicyEdit | undefined,
            baseRevision: number,
        ) =>
            rpc.sendRequest(RbsApplyPresentationOverlayRequest.type, {
                runId,
                edits,
                ...(policy ? { policy } : {}),
                baseRevision,
            }),
        [rpc],
    );

    const clearPresentationOverlay = useCallback(
        async (runId: string) =>
            (await rpc.sendRequest(RbsClearPresentationOverlayRequest.type, { runId })).cleared,
        [rpc],
    );

    const executePlanQuery = useCallback(
        async (nodeId: string): Promise<boolean> => {
            setLastError(undefined);
            const connectionValues: Record<string, string> = {};
            for (const parameter of state?.artifact?.parameters ?? []) {
                if (parameter.type !== "connection") {
                    continue;
                }
                const value = parameterDraft[parameter.id];
                if (value !== undefined && value !== "") {
                    connectionValues[parameter.id] = value;
                }
            }
            const result = await rpc.sendRequest(RbsExecutePlanQueryRequest.type, {
                nodeId,
                connectionValues,
            });
            if (result.error) {
                setLastError(result.error);
            }
            return result.opened;
        },
        [rpc, state?.artifact?.parameters, parameterDraft],
    );

    const selectRun = useCallback(
        async (runId: string): Promise<boolean> => {
            const result = await rpc.sendRequest(RbsSelectRunRequest.type, { runId });
            return result.ok;
        },
        [rpc],
    );

    const getRun = useCallback(
        async (runId: string): Promise<RunbookRunSnapshot | undefined> =>
            rpc.sendRequest(RbsGetRunRequest.type, { runId }),
        [rpc],
    );

    const exportEvidence = useCallback(
        async (runId: string, format: RbsEvidenceExportFormat): Promise<boolean> => {
            setLastError(undefined);
            const result = await rpc.sendRequest(RbsExportEvidenceRequest.type, { runId, format });
            if (result.error) {
                setLastError(result.error);
            }
            return result.exported;
        },
        [rpc],
    );

    const startRun = useCallback(
        async (
            parameterValues: Record<string, string | number | boolean | null>,
        ): Promise<string | undefined> => {
            // A fresh run must never wear the previous attempt's error.
            setLastError(undefined);
            setRunEvents([]);
            // Switch to the Run page IMMEDIATELY — publish/launch can take
            // seconds and the user should watch the run queue up, not wait
            // on the Parameters page. Errors surface in the top bar either
            // way.
            navigate("run");
            const result = await rpc.sendRequest(RbsStartRunRequest.type, { parameterValues });
            if (result.error) {
                setLastError(result.error);
                return undefined;
            }
            setAutoResultsRunId(result.runId);
            return result.runId;
        },
        [rpc],
    );

    // Follow only runs launched by this webview. A terminal run restored
    // from history must not unexpectedly redirect the user on open.
    useEffect(() => {
        if (
            autoResultsRunId !== undefined &&
            state?.run?.runId === autoResultsRunId &&
            ["succeeded", "failed", "cancelled"].includes(state.run.state)
        ) {
            setAutoResultsRunId(undefined);
            navigate("results");
        }
    }, [autoResultsRunId, state?.run?.runId, state?.run?.state]);

    const cancelRun = useCallback(
        async (runId: string): Promise<void> => {
            await rpc.sendRequest(RbsCancelRunRequest.type, { runId });
        },
        [rpc],
    );

    const respondToGate = useCallback(
        async (runId: string, nodeId: string, approve: boolean): Promise<void> => {
            const result = await rpc.sendRequest(RbsRespondToGateRequest.type, {
                runId,
                nodeId,
                approve,
            });
            if (result.error) {
                setLastError(result.error);
            }
        },
        [rpc],
    );

    const openDiagnostics = useCallback(
        (runId?: string, nodeId?: string) => {
            void rpc.sendRequest(RbsOpenDiagnosticsRequest.type, { runId, nodeId });
        },
        [rpc],
    );

    const value = useMemo<RbsContextValue>(
        () => ({
            state,
            rpc,
            route,
            navigate,
            runEvents,
            lastError,
            dismissError,
            compiling,
            plannerConsole,
            compile,
            cancelCompile,
            connections,
            refreshConnections,
            updateIntent,
            parameterDraft,
            setParameterDraft,
            setOutputView,
            setOutputPresentation,
            applyPresentationLayout,
            previewPresentationLayout,
            applyPresentationOverlay,
            clearPresentationOverlay,
            executePlanQuery,
            selectRun,
            getRun,
            exportEvidence,
            startRun,
            cancelRun,
            respondToGate,
            openDiagnostics,
        }),
        [
            state,
            rpc,
            route,
            runEvents,
            lastError,
            dismissError,
            compiling,
            plannerConsole,
            compile,
            cancelCompile,
            connections,
            refreshConnections,
            updateIntent,
            parameterDraft,
            setParameterDraft,
            setOutputView,
            setOutputPresentation,
            applyPresentationLayout,
            previewPresentationLayout,
            applyPresentationOverlay,
            clearPresentationOverlay,
            executePlanQuery,
            selectRun,
            getRun,
            exportEvidence,
            startRun,
            cancelRun,
            respondToGate,
            openDiagnostics,
        ],
    );
    return <RbsContext.Provider value={value}>{children}</RbsContext.Provider>;
}
