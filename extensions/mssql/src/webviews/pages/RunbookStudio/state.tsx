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
    RbsError,
    RbsNavigateNotification,
    RbsOpenDiagnosticsRequest,
    RbsRespondToGateRequest,
    RbsRoute,
    RbsRunEventNotification,
    RbsStartRunRequest,
    RbsState,
    RbsUpdateIntentRequest,
    RunbookRunEvent,
} from "../../../sharedInterfaces/runbookStudio";

interface RbsContextValue {
    state: RbsState | undefined;
    rpc: ReturnType<typeof useVscodeWebview<RbsState, void>>["extensionRpc"];
    route: RbsRoute;
    navigate: (route: RbsRoute) => void;
    /** Recent run events for the live view (bounded). */
    runEvents: RunbookRunEvent[];
    lastError: RbsError | undefined;
    dismissError: () => void;
    updateIntent: (intent: string) => Promise<boolean>;
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

    const updateIntent = useCallback(
        async (intent: string): Promise<boolean> => {
            const result = await rpc.sendRequest(RbsUpdateIntentRequest.type, { intent });
            return result.applied;
        },
        [rpc],
    );

    const startRun = useCallback(
        async (
            parameterValues: Record<string, string | number | boolean | null>,
        ): Promise<string | undefined> => {
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
            updateIntent,
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
            updateIntent,
            startRun,
            cancelRun,
            respondToGate,
            openDiagnostics,
        ],
    );
    return <RbsContext.Provider value={value}>{children}</RbsContext.Provider>;
}
