/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Debug Console client state: source selection, live subscription, routing. */

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
    CaptureMode,
    DebugConsoleState,
    DebugSource,
    DcCaptureChangedNotification,
    DcCancelSelfTestRequest,
    DcImportPerfRunRequest,
    DcListSourcesRequest,
    DcLivePushNotification,
    DcRunSelfTestRequest,
    DcSelfTestProgressNotification,
    DcSetCaptureModeRequest,
    DcSubscribeLiveRequest,
    DcUnsubscribeLiveRequest,
    DiagEvent,
    GapRecord,
    SelfTestProgress,
    SelfTestRunRequest,
    SelfTestRunStarted,
} from "../../../sharedInterfaces/debugConsole";

export interface SelfTestState {
    runId: string;
    active: boolean;
    events: SelfTestProgress[];
    summary?: {
        runStatus: string;
        passed: number;
        failed: number;
        skipped: number;
        perfRunsRoot: string;
    };
}

export type DcPage =
    | "overview"
    | "trace"
    | "waterfall"
    | "perf"
    | "history"
    | "completions"
    | "replay"
    | "sql"
    | "connections"
    | "query"
    | "oe"
    | "exports"
    | "settings";

export interface DcRoute {
    page: DcPage;
    traceId?: string;
    eventId?: string;
}

interface DcContextValue {
    state: DebugConsoleState | undefined;
    rpc: ReturnType<typeof useVscodeWebview<DebugConsoleState, void>>["extensionRpc"];
    sources: DebugSource[];
    activeSourceId: string;
    setActiveSourceId: (id: string) => void;
    isLive: boolean;
    setIsLive: (live: boolean) => void;
    route: DcRoute;
    navigate: (route: DcRoute) => void;
    liveEvents: DiagEvent[];
    liveGaps: GapRecord[];
    captureMode: CaptureMode;
    captureExpiresEpochMs: number | undefined;
    setCaptureMode: (mode: CaptureMode, reason?: string, durationMinutes?: number) => void;
    refreshSources: () => void;
    importPerfRun: () => void;
    search: string;
    setSearch: (text: string) => void;
    dataVersion: number;
    selfTest: SelfTestState | undefined;
    runSelfTest: (request: SelfTestRunRequest) => Promise<SelfTestRunStarted>;
    cancelSelfTest: () => void;
}

const DcContext = createContext<DcContextValue | undefined>(undefined);

export function useDc(): DcContextValue {
    const value = useContext(DcContext);
    if (!value) {
        throw new Error("useDc outside provider");
    }
    return value;
}

const LIVE_VIEW_CAP = 20_000;

export function DcProvider({ children }: { children: React.ReactNode }) {
    const {
        getSnapshot,
        subscribe,
        extensionRpc: rpc,
    } = useVscodeWebview<DebugConsoleState, void>();
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const state: DebugConsoleState | undefined =
        snapshot && Object.keys(snapshot).length > 0 ? snapshot : undefined;
    const [sources, setSources] = useState<DebugSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>("");
    const [isLive, setIsLive] = useState(true);
    const [route, navigate] = useState<DcRoute>({ page: "overview" });
    const [liveEvents, setLiveEvents] = useState<DiagEvent[]>([]);
    const [liveGaps, setLiveGaps] = useState<GapRecord[]>([]);
    const [captureMode, setCaptureModeState] = useState<CaptureMode>("off");
    const [captureExpiresEpochMs, setCaptureExpires] = useState<number | undefined>(undefined);
    const [search, setSearch] = useState("");
    const [dataVersion, setDataVersion] = useState(0);
    const [selfTest, setSelfTest] = useState<SelfTestState | undefined>(undefined);
    const subscribedRef = useRef(false);

    const refreshSources = useCallback(() => {
        void rpc.sendRequest(DcListSourcesRequest.type).then((list) => setSources(list));
    }, [rpc]);

    useEffect(() => {
        if (!state) {
            return;
        }
        setCaptureModeState(state.captureMode);
        setCaptureExpires(state.captureExpiresEpochMs);
        if (!activeSourceId) {
            setActiveSourceId(state.activeSourceId);
        }
        refreshSources();
    }, [state?.activeSourceId]);

    // Live subscription lifecycle.
    useEffect(() => {
        rpc.onNotification(DcLivePushNotification.type, (push) => {
            if (push.kind === "events") {
                setLiveEvents((current) => {
                    const next = current.concat(push.events);
                    return next.length > LIVE_VIEW_CAP
                        ? next.slice(next.length - LIVE_VIEW_CAP)
                        : next;
                });
                setDataVersion((v) => v + 1);
            } else {
                setLiveGaps((current) => [...current, push.gap]);
            }
        });
        rpc.onNotification(DcCaptureChangedNotification.type, (change) => {
            setCaptureModeState(change.mode);
            setCaptureExpires(change.expiresEpochMs);
        });
        rpc.onNotification(DcSelfTestProgressNotification.type, (progress) => {
            setSelfTest((current) => {
                const base =
                    current && current.runId === progress.runId
                        ? current
                        : { runId: progress.runId, active: true, events: [] };
                const events = base.events.concat(progress).slice(-500);
                if (progress.phase === "runEnd") {
                    return {
                        runId: base.runId,
                        active: false,
                        events,
                        summary: {
                            runStatus: progress.runStatus ?? "unknown",
                            passed: progress.passed ?? 0,
                            failed: progress.failed ?? 0,
                            skipped: progress.skipped ?? 0,
                            perfRunsRoot: progress.perfRunsRoot ?? "",
                        },
                    };
                }
                if (progress.phase === "error") {
                    return { ...base, events, active: false };
                }
                return { ...base, events, active: true };
            });
            if (progress.phase === "runEnd") {
                // New run persisted → Perf & History pages refresh.
                setDataVersion((v) => v + 1);
            }
        });
    }, []);

    useEffect(() => {
        if (isLive && !subscribedRef.current) {
            subscribedRef.current = true;
            void rpc.sendRequest(DcSubscribeLiveRequest.type).then((initial) => {
                const events = initial.snapshot.rows.filter(
                    (row): row is DiagEvent => row.kind !== "gap",
                );
                setLiveEvents(events);
                setDataVersion((v) => v + 1);
            });
        } else if (!isLive && subscribedRef.current) {
            subscribedRef.current = false;
            void rpc.sendRequest(DcUnsubscribeLiveRequest.type);
        }
    }, [isLive]);

    const setCaptureMode = useCallback(
        (mode: CaptureMode, reason?: string, durationMinutes?: number) => {
            void rpc
                .sendRequest(DcSetCaptureModeRequest.type, {
                    mode,
                    ...(reason !== undefined ? { reason } : {}),
                    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
                })
                .then((result) => {
                    setCaptureModeState(result.mode);
                    setCaptureExpires(result.expiresEpochMs);
                });
        },
        [rpc],
    );

    const importPerfRun = useCallback(() => {
        void rpc.sendRequest(DcImportPerfRunRequest.type).then((list) => {
            if (list) {
                setSources(list);
                const perfRun = list.filter((s) => s.kind === "perfRun").pop();
                if (perfRun) {
                    setActiveSourceId(perfRun.id);
                    setIsLive(false);
                }
            }
        });
    }, [rpc]);

    const runSelfTest = useCallback(
        (request: SelfTestRunRequest) => {
            // Reset the panel for the new run; progress arrives via notification.
            setSelfTest({ runId: "", active: true, events: [] });
            return rpc.sendRequest(DcRunSelfTestRequest.type, request).then((started) => {
                if (!started.accepted) {
                    setSelfTest(undefined);
                }
                return started;
            });
        },
        [rpc],
    );

    const cancelSelfTest = useCallback(() => {
        void rpc.sendRequest(DcCancelSelfTestRequest.type);
    }, [rpc]);

    const value = useMemo<DcContextValue>(
        () => ({
            state,
            rpc,
            sources,
            activeSourceId,
            setActiveSourceId,
            isLive,
            setIsLive,
            route,
            navigate,
            liveEvents,
            liveGaps,
            captureMode,
            captureExpiresEpochMs,
            setCaptureMode,
            refreshSources,
            importPerfRun,
            search,
            setSearch,
            dataVersion,
            selfTest,
            runSelfTest,
            cancelSelfTest,
        }),
        [
            state,
            rpc,
            sources,
            activeSourceId,
            isLive,
            route,
            liveEvents,
            liveGaps,
            captureMode,
            captureExpiresEpochMs,
            setCaptureMode,
            refreshSources,
            importPerfRun,
            search,
            dataVersion,
            selfTest,
            runSelfTest,
            cancelSelfTest,
        ],
    );
    return <DcContext.Provider value={value}>{children}</DcContext.Provider>;
}
