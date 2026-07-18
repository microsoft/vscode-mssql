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
    /** Latest planner phase label while compiling ("Workflow shape", ...). */
    compileProgress: string | undefined;
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
        rpc.onNotification(RbsCompileProgressNotification.type, ({ label }) => {
            setCompileProgress(label);
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
    const [compileProgress, setCompileProgress] = useState<string | undefined>(undefined);
    const compile = useCallback(
        async (intent: string): Promise<boolean> => {
            setLastError(undefined);
            setCompiling(true);
            setCompileProgress(undefined);
            try {
                const result = await rpc.sendRequest(RbsCompileRequest.type, { intent });
                if (result.error) {
                    setLastError(result.error);
                }
                return result.ok;
            } finally {
                setCompiling(false);
                setCompileProgress(undefined);
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
            const result = await rpc.sendRequest(RbsStartRunRequest.type, { parameterValues });
            if (result.error) {
                setLastError(result.error);
                return undefined;
            }
            navigate("run");
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
            compileProgress,
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
            compileProgress,
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
