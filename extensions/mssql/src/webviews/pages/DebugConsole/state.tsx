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
    DcBackfillGapRequest,
    DcImportPerfRunRequest,
    DcListSourcesRequest,
    DcLivePushNotification,
    DcNavigateNotification,
    DcPageId,
    DcSetCaptureModeRequest,
    DcSubscribeLiveRequest,
    DcUnsubscribeLiveRequest,
    GapRecord,
} from "../../../sharedInterfaces/debugConsole";
import { describeError } from "./common";

// Routing vocabulary is shared with the host so deep links stay typed.
export type DcPage = DcPageId;

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
    /** Derived: the selected source IS the current live session. */
    isLive: boolean;
    route: DcRoute;
    navigate: (route: DcRoute) => void;
    liveGaps: GapRecord[];
    backfillGap: (gap: GapRecord) => Promise<void>;
    /** Last failed host action (shown in the top bar; cleared on the next success). */
    notice: string | undefined;
    setNotice: (notice: string | undefined) => void;
    captureMode: CaptureMode;
    captureExpiresEpochMs: number | undefined;
    setCaptureMode: (mode: CaptureMode, reason?: string, durationMinutes?: number) => void;
    refreshSources: () => void;
    importPerfRun: () => void;
    search: string;
    setSearch: (text: string) => void;
    dataVersion: number;
}

const DcContext = createContext<DcContextValue | undefined>(undefined);

export function useDc(): DcContextValue {
    const value = useContext(DcContext);
    if (!value) {
        throw new Error("useDc outside provider");
    }
    return value;
}

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
    // Live is not a mode the user toggles — it IS the current-session source.
    // ("" = initial state before the host pushes the live source id.)
    const isLive = activeSourceId === "" || activeSourceId.startsWith("live:");
    const [route, navigate] = useState<DcRoute>({ page: "overview" });
    // The webview keeps NO event buffer of its own: every page queries the
    // host (which owns the archive) and re-queries on dataVersion, so live
    // pushes only bump the version. Gaps are tracked for the backfill UX.
    const [liveGaps, setLiveGaps] = useState<GapRecord[]>([]);
    const [notice, setNotice] = useState<string | undefined>(undefined);

    // Recover a gap's dropped range from the session store journal into the
    // host archive and record the honest outcome (including the reason).
    const backfillGap = useCallback(
        async (gap: GapRecord): Promise<void> => {
            setLiveGaps((current) =>
                current.map((g) =>
                    g.gapId === gap.gapId ? { ...g, backfillStatus: "running" } : g,
                ),
            );
            try {
                const outcome = await rpc.sendRequest(DcBackfillGapRequest.type, {
                    gapId: gap.gapId,
                    fromSeq: gap.fromSeq,
                    throughSeq: gap.throughSeq,
                });
                setLiveGaps((current) =>
                    current.map((g) =>
                        g.gapId === gap.gapId ? { ...g, backfillStatus: outcome.status } : g,
                    ),
                );
                if (!outcome.ok && outcome.reason) {
                    setNotice(`Backfill ${outcome.status}: ${outcome.reason}`);
                }
            } catch (error) {
                setLiveGaps((current) =>
                    current.map((g) =>
                        g.gapId === gap.gapId ? { ...g, backfillStatus: "failed" } : g,
                    ),
                );
                setNotice(`Backfill failed: ${describeError(error)}`);
            }
        },
        [rpc],
    );
    const [captureMode, setCaptureModeState] = useState<CaptureMode>("off");
    const [captureExpiresEpochMs, setCaptureExpires] = useState<number | undefined>(undefined);
    const [search, setSearch] = useState("");
    const [dataVersion, setDataVersion] = useState(0);
    const subscribedRef = useRef(false);
    const initialPageConsumedRef = useRef(false);

    // Deep link (WI-1.6): a fresh console carries the requested page in the
    // initial state snapshot; an already-open console is steered through the
    // dc/navigate notification (registered with the others below).
    useEffect(() => {
        if (!initialPageConsumedRef.current && state?.initialPage) {
            initialPageConsumedRef.current = true;
            navigate({ page: state.initialPage });
        }
    }, [state?.initialPage]);

    // Live pushes arrive every ~120ms during a run; every dataVersion bump
    // re-queries the visible page (several RPCs). Throttle to 1/sec so a busy
    // run never freezes the console or the extension host.
    const versionThrottle = useRef<{ timer?: ReturnType<typeof setTimeout>; lastMs: number }>({
        lastMs: 0,
    });
    const bumpDataVersion = useCallback(() => {
        const state = versionThrottle.current;
        if (state.timer) {
            return; // trailing bump already scheduled
        }
        const elapsed = Date.now() - state.lastMs;
        if (elapsed >= 1000) {
            state.lastMs = Date.now();
            setDataVersion((v) => v + 1);
        } else {
            state.timer = setTimeout(() => {
                state.timer = undefined;
                state.lastMs = Date.now();
                setDataVersion((v) => v + 1);
            }, 1000 - elapsed);
        }
    }, []);

    useEffect(
        () => () => {
            const timer = versionThrottle.current.timer;
            if (timer) {
                clearTimeout(timer);
                versionThrottle.current.timer = undefined;
            }
        },
        [],
    );

    const refreshSources = useCallback(() => {
        rpc.sendRequest(DcListSourcesRequest.type).then(
            (list) => setSources(list),
            (error: unknown) => setNotice(`Could not list sources: ${describeError(error)}`),
        );
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
                bumpDataVersion();
            } else {
                setLiveGaps((current) => [...current, push.gap]);
            }
        });
        rpc.onNotification(DcCaptureChangedNotification.type, (change) => {
            setCaptureModeState(change.mode);
            setCaptureExpires(change.expiresEpochMs);
        });
        rpc.onNotification(DcNavigateNotification.type, ({ page }) => {
            navigate({ page });
        });
    }, []);

    useEffect(() => {
        if (isLive && !subscribedRef.current) {
            subscribedRef.current = true;
            rpc.sendRequest(DcSubscribeLiveRequest.type).then(
                () => setDataVersion((v) => v + 1),
                (error: unknown) => setNotice(`Live subscription failed: ${describeError(error)}`),
            );
        } else if (!isLive && subscribedRef.current) {
            subscribedRef.current = false;
            rpc.sendRequest(DcUnsubscribeLiveRequest.type).then(
                () => undefined,
                () => undefined,
            );
        }
    }, [isLive]);

    const setCaptureMode = useCallback(
        (mode: CaptureMode, reason?: string, durationMinutes?: number) => {
            rpc.sendRequest(DcSetCaptureModeRequest.type, {
                mode,
                ...(reason !== undefined ? { reason } : {}),
                ...(durationMinutes !== undefined ? { durationMinutes } : {}),
            }).then(
                (result) => {
                    setCaptureModeState(result.mode);
                    setCaptureExpires(result.expiresEpochMs);
                },
                (error: unknown) => setNotice(`Capture change failed: ${describeError(error)}`),
            );
        },
        [rpc],
    );

    const importPerfRun = useCallback(() => {
        rpc.sendRequest(DcImportPerfRunRequest.type).then(
            (list) => {
                if (list) {
                    setSources(list);
                    const perfRun = list.filter((s) => s.kind === "perfRun").pop();
                    if (perfRun) {
                        setActiveSourceId(perfRun.id);
                    }
                }
            },
            (error: unknown) => setNotice(`Import failed: ${describeError(error)}`),
        );
    }, [rpc]);

    const value = useMemo<DcContextValue>(
        () => ({
            state,
            rpc,
            sources,
            activeSourceId,
            setActiveSourceId,
            isLive,

            route,
            navigate,
            liveGaps,
            backfillGap,
            notice,
            setNotice,
            captureMode,
            captureExpiresEpochMs,
            setCaptureMode,
            refreshSources,
            importPerfRun,
            search,
            setSearch,
            dataVersion,
        }),
        [
            state,
            rpc,
            sources,
            activeSourceId,
            isLive,
            route,
            liveGaps,
            backfillGap,
            notice,
            captureMode,
            captureExpiresEpochMs,
            setCaptureMode,
            refreshSources,
            importPerfRun,
            search,
            dataVersion,
        ],
    );
    return <DcContext.Provider value={value}>{children}</DcContext.Provider>;
}
