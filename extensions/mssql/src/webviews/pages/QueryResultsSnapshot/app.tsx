/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pinned results app (C2D-3): the shared Query Studio result pane over a
 * frozen snapshot — no editor, no connection toolbar, no execute. Grids pull
 * bounded windows through the same `qs/getRows` RPC (answered from the
 * snapshot by PinnedResultsController); copy/export/open-cell/plan-link all
 * ride the shared components. An expired snapshot renders a clear recovery
 * message and nothing else.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { installDocumentScrollBackstop } from "../../common/documentScrollBackstop";
import { locConstants } from "../../common/locConstants";
import {
    PinnedResultsState,
    isPinnedResultsState,
} from "../../../sharedInterfaces/queryResultsSnapshot";
import {
    QsGetMessagesRequest,
    QsGetPlanStateRequest,
    QsMessageRow,
} from "../../../sharedInterfaces/queryStudio";
import {
    QueryStudioPanelViewState,
    QsGetPanelViewStateRequest,
    QsUpdatePanelViewStateNotification,
    createQueryStudioPanelViewState,
    orderedQueryStudioTabs,
} from "../../../sharedInterfaces/queryStudioViewState";
import { computeResultsLayout } from "../../../sharedInterfaces/queryStudioResultsLayout";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { MessagesView, ResultGridBlock } from "../QueryStudio/results";
import { QsResultsGridProvider, qsGridRowHeight } from "../QueryStudio/resultsGrid";
import { QueryStudioErrorBoundary } from "../QueryStudio/queryStudioErrorBoundary";

const GRID_HEADER_PX = 34;
const GRID_CHROME_PX = 20;
const GRID_CAPTION_PX = 30;

type PinnedTab = "results" | "messages" | "queryPlan";
// Live-QS parity: pinned plan result sets render as REAL plan graphs in a
// Query Plan tab — never as raw-XML grids (those rendered erratically and
// crawled on multi-MB plan cells). azdataGraph stays a lazy on-use chunk.
const LazyPlanTab = React.lazy(async () => ({
    default: (await import("../QueryStudio/queryPlanTab")).QueryStudioExecutionPlanView,
}));

export function PinnedResultsApp() {
    const {
        extensionRpc: rpc,
        getSnapshot,
        subscribe,
    } = useVscodeWebview<PinnedResultsState, void>();
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const state = isPinnedResultsState(snapshot) ? snapshot : undefined;
    const [activeTab, setActiveTab] = useState<PinnedTab>("results");
    const [mountedTabs, setMountedTabs] = useState<ReadonlySet<PinnedTab>>(
        () => new Set(["results"]),
    );
    const [messages, setMessages] = useState<QsMessageRow[]>([]);
    const [messagesLoaded, setMessagesLoaded] = useState(false);
    const [maximizedGridId, setMaximizedGridId] = useState<string | undefined>(undefined);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const resultsPanelRef = useRef<HTMLDivElement | null>(null);
    const panelViewStateRef = useRef<QueryStudioPanelViewState>(
        createQueryStudioPanelViewState("pinned:loading"),
    );
    const panelViewStateReadyRef = useRef(false);
    const panelViewStateTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const gridStateHandlersRef = useRef<
        Map<string, (state: QueryStudioPanelViewState["results"]["grids"][string]) => void>
    >(new Map());
    const [panelViewStateReady, setPanelViewStateReady] = useState(false);
    const [paneHeight, setPaneHeight] = useState<number | undefined>(undefined);
    const [panelVisible, setPanelVisible] = useState(() => document.visibilityState === "visible");
    const reportPaneError = useCallback(
        (label: string, error: Error, componentStack?: string) =>
            rpc.log.error(
                "Pinned results pane render failure",
                label,
                `${error.name}: ${error.message}`.slice(0, 2_000),
                componentStack?.slice(0, 8_000),
            ),
        [rpc],
    );

    useEffect(() => {
        const onVisibilityChange = () => setPanelVisible(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, []);

    // Same document-scroll discipline as the live Query Studio shell.
    useEffect(
        () =>
            installDocumentScrollBackstop((violation) =>
                rpc.log.error(
                    "Pinned results document scrolled (backstopped to 0)",
                    violation.element,
                    `top=${violation.scrollTop} left=${violation.scrollLeft}`,
                    violation.activeElement,
                ),
            ),
        [rpc],
    );

    const flushPanelViewState = useCallback(() => {
        if (panelViewStateTimerRef.current) {
            clearTimeout(panelViewStateTimerRef.current);
            panelViewStateTimerRef.current = undefined;
        }
        if (panelViewStateReadyRef.current) {
            void rpc.sendNotification(
                QsUpdatePanelViewStateNotification.type,
                panelViewStateRef.current,
            );
        }
    }, [rpc]);

    const updatePanelViewState = useCallback(
        (update: (current: QueryStudioPanelViewState) => QueryStudioPanelViewState) => {
            panelViewStateRef.current = update(panelViewStateRef.current);
            if (!panelViewStateReadyRef.current) {
                return;
            }
            if (panelViewStateTimerRef.current) {
                clearTimeout(panelViewStateTimerRef.current);
            }
            panelViewStateTimerRef.current = setTimeout(flushPanelViewState, 100);
        },
        [flushPanelViewState],
    );

    const persistGridViewState = useCallback(
        (resultSetId: string, gridState: QueryStudioPanelViewState["results"]["grids"][string]) => {
            updatePanelViewState((current) => ({
                ...current,
                results: {
                    ...current.results,
                    grids: { ...current.results.grids, [resultSetId]: gridState },
                },
            }));
        },
        [updatePanelViewState],
    );
    const gridStateHandler = useCallback(
        (resultSetId: string) => {
            let handler = gridStateHandlersRef.current.get(resultSetId);
            if (!handler) {
                handler = (gridState) => persistGridViewState(resultSetId, gridState);
                gridStateHandlersRef.current.set(resultSetId, handler);
            }
            return handler;
        },
        [persistGridViewState],
    );
    const persistResultsScroll = useCallback(() => {
        updatePanelViewState((current) => ({
            ...current,
            results: {
                ...current.results,
                stackScrollTop: resultsPanelRef.current?.scrollTop ?? 0,
            },
        }));
    }, [updatePanelViewState]);
    const persistMessagesViewState = useCallback(
        (messagesState: QueryStudioPanelViewState["messages"]) => {
            updatePanelViewState((current) => ({ ...current, messages: messagesState }));
        },
        [updatePanelViewState],
    );
    const persistPlanViewState = useCallback(
        (queryPlan: QueryStudioPanelViewState["queryPlan"]) => {
            updatePanelViewState((current) => ({ ...current, queryPlan }));
        },
        [updatePanelViewState],
    );
    const selectTab = useCallback(
        (tab: PinnedTab) => {
            setActiveTab(tab);
            updatePanelViewState((current) => ({
                ...current,
                shell: { ...current.shell, activeTab: tab },
            }));
        },
        [updatePanelViewState],
    );
    const setMaximizedGrid = useCallback(
        (resultSetId: string | undefined) => {
            setMaximizedGridId(resultSetId);
            updatePanelViewState((current) => ({
                ...current,
                shell: { ...current.shell, maximizedGridId: resultSetId },
            }));
        },
        [updatePanelViewState],
    );

    useEffect(() => {
        let disposed = false;
        void rpc
            .sendRequest(QsGetPanelViewStateRequest.type, undefined)
            .then((saved) => {
                if (disposed) {
                    return;
                }
                panelViewStateRef.current = saved;
                panelViewStateReadyRef.current = true;
                const savedTab: PinnedTab =
                    saved.shell.activeTab === "messages" || saved.shell.activeTab === "queryPlan"
                        ? saved.shell.activeTab
                        : "results";
                setActiveTab(savedTab);
                setMountedTabs(new Set([savedTab]));
                setMaximizedGridId(saved.shell.maximizedGridId);
                setPanelViewStateReady(true);
            })
            .catch(() => {
                if (!disposed) {
                    panelViewStateReadyRef.current = true;
                    setPanelViewStateReady(true);
                }
            });
        const flushBeforeUnload = () => flushPanelViewState();
        const flushAfterPageHideListeners = () => queueMicrotask(flushPanelViewState);
        window.addEventListener("beforeunload", flushBeforeUnload);
        window.addEventListener("pagehide", flushAfterPageHideListeners);
        return () => {
            disposed = true;
            window.removeEventListener("beforeunload", flushBeforeUnload);
            window.removeEventListener("pagehide", flushAfterPageHideListeners);
            flushPanelViewState();
        };
    }, [flushPanelViewState, rpc]);

    // First-paint mark (C2D-8): the user-perceived end of a pin action;
    // pairs with pin.open.begin for the pin.toRender boundary metric.
    const renderedRef = useRef(false);
    useEffect(() => {
        if (!renderedRef.current && panelViewStateReady && state && !state.expired) {
            renderedRef.current = true;
            perfMarkAfterNextPaint("mssql.queryResults.pin.rendered", {
                resultSets: state.resultSets.length,
                rows: state.totalRows,
            });
        }
    }, [panelViewStateReady, state]);

    // Messages are frozen — fetch once when the tab first shows them.
    const wantMessages =
        activeTab === "messages" && state?.hasLocalMessages === true && !messagesLoaded;
    useEffect(() => {
        if (!wantMessages) {
            return;
        }
        void rpc
            .sendRequest(QsGetMessagesRequest.type, { afterIndex: 0 })
            .then((result) => {
                setMessages((result as { messages: QsMessageRow[] }).messages);
                setMessagesLoaded(true);
            })
            .catch(() => setMessagesLoaded(true));
    }, [rpc, wantMessages]);

    useEffect(() => {
        const el = bodyRef.current;
        if (!el) {
            return;
        }
        const measure = () =>
            setPaneHeight((prev) => (prev === el.clientHeight ? prev : el.clientHeight));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [panelViewStateReady, state?.expired]);

    const gridSummaries = useMemo(
        () => (state?.resultSets ?? []).filter((summary) => summary.isPlanResult !== true),
        [state?.resultSets],
    );
    const planSummaries = useMemo(
        () => (state?.resultSets ?? []).filter((summary) => summary.isPlanResult === true),
        [state?.resultSets],
    );
    // Plan graphs load once (the snapshot is frozen) when the tab first mounts.
    const [planTabState, setPlanTabState] = useState<ExecutionPlanState | undefined>(undefined);
    const planMounted = mountedTabs.has("queryPlan");
    useEffect(() => {
        if (!planMounted || planSummaries.length === 0 || planTabState !== undefined) {
            return;
        }
        let canceled = false;
        void rpc
            .sendRequest(QsGetPlanStateRequest.type, {
                resultSetIds: planSummaries.map((summary) => summary.resultSetId),
            })
            .then((result) => {
                if (canceled) {
                    return;
                }
                setPlanTabState(
                    result.executionPlanState ??
                        ({
                            loadState: ApiStatus.Error,
                            executionPlanGraphs: [],
                            totalCost: 0,
                            errorMessage:
                                result.error ??
                                locConstants.queryStudioCore.executionPlanCouldNotBeLoaded,
                        } satisfies ExecutionPlanState),
                );
            })
            .catch((error) => {
                if (!canceled) {
                    setPlanTabState({
                        loadState: ApiStatus.Error,
                        executionPlanGraphs: [],
                        totalCost: 0,
                        errorMessage: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        return () => {
            canceled = true;
        };
    }, [planMounted, planSummaries, planTabState, rpc]);

    const singleGrid = gridSummaries.length === 1;
    const maximizedGrid = gridSummaries.some((s) => s.resultSetId === maximizedGridId)
        ? maximizedGridId
        : undefined;
    const layout = computeResultsLayout(
        gridSummaries.map((summary) => summary.rowCount),
        paneHeight !== undefined ? paneHeight - 8 : undefined,
        {
            rowHeight: qsGridRowHeight(state?.gridStyle),
            headerHeight: GRID_HEADER_PX,
            chromePx: GRID_CHROME_PX,
            captionPx: GRID_CAPTION_PX,
        },
    );
    const availableTabs = orderedQueryStudioTabs({
        results: gridSummaries.length > 0,
        messages: state?.hasLocalMessages === true || (state?.messageCount ?? 0) > 0,
        queryPlan: planSummaries.length > 0,
    }) as PinnedTab[];
    const visibleActiveTab = availableTabs.includes(activeTab)
        ? activeTab
        : (availableTabs[0] ?? "messages");
    useEffect(() => {
        if (activeTab !== visibleActiveTab) {
            selectTab(visibleActiveTab);
        }
    }, [activeTab, selectTab, visibleActiveTab]);
    useEffect(() => {
        setMountedTabs((current) =>
            current.has(visibleActiveTab)
                ? current
                : new Set<PinnedTab>([...current, visibleActiveTab]),
        );
    }, [visibleActiveTab]);
    const resultsMounted = mountedTabs.has("results");
    useEffect(() => {
        if (panelViewStateReady && resultsMounted && resultsPanelRef.current) {
            resultsPanelRef.current.scrollTop = panelViewStateRef.current.results.stackScrollTop;
        }
    }, [panelViewStateReady, resultsMounted]);

    if (!state || !panelViewStateReady) {
        return (
            <div className="qs-muted qs-pinned-loading">
                {locConstants.queryStudioCore.loadingPinnedResults}
            </div>
        );
    }
    if (state.expired) {
        return (
            <div className="qs-pinned-expired" role="alert">
                <span className="codicon codicon-pinned" aria-hidden="true" />
                <h3>{locConstants.queryStudioCore.thesePinnedResultsAreNoLongerAvailable}</h3>
                <p className="qs-muted">
                    {" "}
                    {locConstants.queryStudioCore.pinnedResultsLiveInMemoryForThisWindow}{" "}
                </p>
            </div>
        );
    }

    const created = state.createdEpochMs ? new Date(state.createdEpochMs) : undefined;
    return (
        <div className="qs-root qs-pinned-root">
            <div className="qs-pinned-header">
                <span className="codicon codicon-pinned" aria-hidden="true" />
                <span className="qs-pinned-title">
                    {state.sourceTitle ?? locConstants.queryStudioCore.queryResults}
                </span>
                <span className="qs-muted">
                    {state.totalRows.toLocaleString()} {"row"}
                    {state.totalRows === 1 ? "" : "s"} · {state.resultSets.length}{" "}
                    {locConstants.queryStudioCore.resultSet}
                    {state.resultSets.length === 1 ? "" : "s"}
                    {created
                        ? locConstants.queryStudioCore.pinnedValue(
                              String(created.toLocaleTimeString()),
                          )
                        : ""}{" "}
                    {locConstants.queryStudioCore.readOnly}{" "}
                </span>
            </div>
            <div className="qs-tabbar" role="tablist">
                {availableTabs.map((tab) => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={visibleActiveTab === tab}
                        className={`qs-tab ${visibleActiveTab === tab ? "active" : ""} ${tab === "messages" && state.errorCount > 0 ? "has-errors" : ""}`}
                        onClick={() => selectTab(tab)}>
                        {tab === "results"
                            ? locConstants.queryStudioCore.resultsValue(
                                  String(
                                      state.totalRows > 0
                                          ? ` (${state.totalRows.toLocaleString()})`
                                          : "",
                                  ),
                              )
                            : tab === "messages"
                              ? locConstants.queryStudioCore.messagesValue(
                                    String(state.errorCount > 0 ? ` (${state.errorCount} ⚠)` : ""),
                                )
                              : locConstants.queryResult.queryPlan(planSummaries.length)}
                    </button>
                ))}
            </div>
            <div className="qs-results-body qs-results-body-panels" ref={bodyRef}>
                {mountedTabs.has("results") ? (
                    <div
                        className={`qs-tab-panel${singleGrid || maximizedGrid ? " qs-tab-panel-fill" : ""}`}
                        hidden={visibleActiveTab !== "results"}
                        ref={resultsPanelRef}
                        onScroll={persistResultsScroll}>
                        <QueryStudioErrorBoundary
                            label={locConstants.queryStudioCore.results}
                            resetKey={`results:${panelViewStateRef.current.generation}`}
                            onError={reportPaneError}>
                            <QsResultsGridProvider>
                                {gridSummaries.map((summary, index) => {
                                    const isMaximized = maximizedGrid === summary.resultSetId;
                                    return (
                                        <ResultGridBlock
                                            key={summary.resultSetId}
                                            rpc={rpc}
                                            summary={summary}
                                            displayOrdinal={index + 1}
                                            rowCount={summary.rowCount}
                                            gridStyle={state.gridStyle}
                                            sizing={
                                                singleGrid || isMaximized
                                                    ? { kind: "fill" }
                                                    : (layout.sizing[index] ?? { kind: "fill" })
                                            }
                                            runActive={false}
                                            hidden={maximizedGrid !== undefined && !isMaximized}
                                            maximized={isMaximized}
                                            onToggleMaximize={
                                                singleGrid
                                                    ? undefined
                                                    : () =>
                                                          setMaximizedGrid(
                                                              isMaximized
                                                                  ? undefined
                                                                  : summary.resultSetId,
                                                          )
                                            }
                                            initialGridState={
                                                panelViewStateRef.current.results.grids[
                                                    summary.resultSetId
                                                ]
                                            }
                                            onGridStateChange={gridStateHandler(
                                                summary.resultSetId,
                                            )}
                                        />
                                    );
                                })}
                            </QsResultsGridProvider>
                        </QueryStudioErrorBoundary>
                    </div>
                ) : null}
                {mountedTabs.has("messages") ? (
                    <div
                        className="qs-tab-panel qs-tab-panel-fill"
                        hidden={visibleActiveTab !== "messages"}>
                        <QueryStudioErrorBoundary
                            label={locConstants.queryStudioCore.messages}
                            resetKey={`messages:${panelViewStateRef.current.generation}`}
                            onError={reportPaneError}>
                            {state.hasLocalMessages && !messagesLoaded ? (
                                <div className="qs-muted qs-pinned-loading">
                                    {locConstants.queryStudioCore.loadingMessages}
                                </div>
                            ) : (
                                <MessagesView
                                    rpc={rpc}
                                    messages={messages}
                                    active={visibleActiveTab === "messages"}
                                    initialViewState={panelViewStateRef.current.messages}
                                    onViewStateChange={persistMessagesViewState}
                                />
                            )}
                        </QueryStudioErrorBoundary>
                    </div>
                ) : null}

                {planSummaries.length > 0 && mountedTabs.has("queryPlan") ? (
                    <div
                        className="qs-tab-panel qs-tab-panel-fill"
                        hidden={visibleActiveTab !== "queryPlan"}>
                        <QueryStudioErrorBoundary
                            label={locConstants.queryStudioCore.queryPlan}
                            resetKey={`plan:${panelViewStateRef.current.generation}`}
                            onError={reportPaneError}>
                            <React.Suspense
                                fallback={
                                    <div className="qs-muted qs-pinned-loading">
                                        {" "}
                                        {locConstants.queryStudioCore.loadingPlanView}{" "}
                                    </div>
                                }>
                                <LazyPlanTab
                                    rpc={rpc}
                                    executionPlanState={planTabState}
                                    active={panelVisible && visibleActiveTab === "queryPlan"}
                                    initialViewState={panelViewStateRef.current.queryPlan}
                                    onViewStateChange={persistPlanViewState}
                                />
                            </React.Suspense>
                        </QueryStudioErrorBoundary>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
