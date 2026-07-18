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
    RbsCancelRunRequest,
    RbsCompileProgressNotification,
    RbsCompileRequest,
    RbsConnectionProfileRef,
    RbsError,
    RbsListConnectionsRequest,
    RbsNavigateNotification,
    RbsOpenDiagnosticsRequest,
    RbsPlannerProgressEvent,
    RbsRespondToGateRequest,
    RbsRoute,
    RbsRunEventNotification,
    RbsSetOutputViewRequest,
    RbsStartRunRequest,
    RbsState,
    RbsUpdateIntentRequest,
    RunbookRunEvent,
} from "../../../sharedInterfaces/runbookStudio";
import { ViewKind } from "../../../sharedInterfaces/runbookPresentation";

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
            : { ...state, endedAt: Date.now(), outcome: action.ok ? "ok" : "error" };
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
    connections: RbsConnectionProfileRef[];
    refreshConnections: () => void;
    updateIntent: (intent: string) => Promise<boolean>;
    /** Parameter form draft — lives here so route changes and started runs
     *  never wipe what the user configured. */
    parameterDraft: Record<string, string>;
    setParameterDraft: (id: string, value: string) => void;
    setOutputView: (nodeId: string, view: ViewKind | undefined) => Promise<boolean>;
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
            return result.runId;
        },
        [rpc],
    );

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
            connections,
            refreshConnections,
            updateIntent,
            parameterDraft,
            setParameterDraft,
            setOutputView,
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
            connections,
            refreshConnections,
            updateIntent,
            parameterDraft,
            setParameterDraft,
            setOutputView,
            startRun,
            cancelRun,
            respondToGate,
            openDiagnostics,
        ],
    );
    return <RbsContext.Provider value={value}>{children}</RbsContext.Provider>;
}
