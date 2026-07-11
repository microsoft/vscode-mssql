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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    PinnedResultsState,
    isPinnedResultsState,
} from "../../../sharedInterfaces/queryResultsSnapshot";
import { QsGetMessagesRequest, QsMessageRow } from "../../../sharedInterfaces/queryStudio";
import { computeResultsLayout } from "../../../sharedInterfaces/queryStudioResultsLayout";
import { MessagesView, ResultGridBlock } from "../QueryStudio/results";
import { QsResultsGridProvider, qsGridRowHeight } from "../QueryStudio/resultsGrid";

const GRID_HEADER_PX = 34;
const GRID_CHROME_PX = 20;
const GRID_CAPTION_PX = 30;

type PinnedTab = "results" | "messages" | "vector";

// VEC-11: the Vector Workbench stays a lazy chunk here too — a pinned tab
// without vector columns never loads it.
const LazyVectorTab = React.lazy(async () => ({
    default: (await import("../QueryStudio/vectorTab")).VectorWorkbenchTab,
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
    const [messages, setMessages] = useState<QsMessageRow[]>([]);
    const [maximizedGridId, setMaximizedGridId] = useState<string | undefined>(undefined);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [paneHeight, setPaneHeight] = useState<number | undefined>(undefined);

    // First-paint mark (C2D-8): the user-perceived end of a pin action;
    // pairs with pin.open.begin for the pin.toRender boundary metric.
    const renderedRef = useRef(false);
    useEffect(() => {
        if (!renderedRef.current && state && !state.expired) {
            renderedRef.current = true;
            perfMarkAfterNextPaint("mssql.queryResults.pin.rendered", {
                resultSets: state.resultSets.length,
                rows: state.totalRows,
            });
        }
    }, [state]);

    // Messages are frozen — fetch once when the tab first shows them.
    const wantMessages =
        activeTab === "messages" && state?.hasLocalMessages === true && messages.length === 0;
    useEffect(() => {
        if (!wantMessages) {
            return;
        }
        void rpc
            .sendRequest(QsGetMessagesRequest.type, { afterIndex: 0 })
            .then((result) => setMessages((result as { messages: QsMessageRow[] }).messages))
            .catch(() => undefined);
    }, [wantMessages, rpc]);

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
    }, [state?.expired]);

    const gridSummaries = useMemo(
        () => (state?.resultSets ?? []).filter((summary) => summary.isPlanResult !== true),
        [state?.resultSets],
    );
    const planSummaries = useMemo(
        () => (state?.resultSets ?? []).filter((summary) => summary.isPlanResult === true),
        [state?.resultSets],
    );
    // VEC-11 sniff: frozen summaries carry the same vector column facts.
    const vectorColumns = useMemo(
        () =>
            gridSummaries.flatMap(
                (summary) =>
                    summary.columns?.flatMap((column, ordinal) =>
                        column.vector
                            ? [
                                  {
                                      resultSetId: summary.resultSetId,
                                      columnOrdinal: ordinal,
                                      columnName: column.displayName || column.name,
                                      ...(column.vector.dimensions !== undefined
                                          ? { dimensions: column.vector.dimensions }
                                          : {}),
                                      transport: column.vector.transport,
                                  },
                              ]
                            : [],
                    ) ?? [],
            ),
        [gridSummaries],
    );
    const singleGrid = gridSummaries.length === 1 && planSummaries.length === 0;
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

    if (!state) {
        return <div className="qs-muted qs-pinned-loading">Loading pinned results…</div>;
    }
    if (state.expired) {
        return (
            <div className="qs-pinned-expired" role="alert">
                <span className="codicon codicon-pinned" aria-hidden="true" />
                <h3>These pinned results are no longer available</h3>
                <p className="qs-muted">
                    Pinned results live in memory for this window session. They are released when
                    the tab closes, when the window reloads, or when the retention limit or
                    time-to-live is reached. Re-run the query and pin the results again.
                </p>
            </div>
        );
    }

    const created = state.createdEpochMs ? new Date(state.createdEpochMs) : undefined;
    return (
        <div className="qs-root qs-pinned-root">
            <div className="qs-pinned-header">
                <span className="codicon codicon-pinned" aria-hidden="true" />
                <span className="qs-pinned-title">{state.sourceTitle ?? "Query results"}</span>
                <span className="qs-muted">
                    {state.totalRows.toLocaleString()} row{state.totalRows === 1 ? "" : "s"} ·{" "}
                    {state.resultSets.length} result set{state.resultSets.length === 1 ? "" : "s"}
                    {created ? ` · pinned ${created.toLocaleTimeString()}` : ""} · read-only
                </span>
            </div>
            <div className="qs-tabbar" role="tablist">
                {gridSummaries.length > 0 || planSummaries.length > 0 ? (
                    <button
                        role="tab"
                        aria-selected={activeTab === "results"}
                        className={`qs-tab ${activeTab === "results" ? "active" : ""}`}
                        onClick={() => setActiveTab("results")}>
                        Results
                        {state.totalRows > 0 ? ` (${state.totalRows.toLocaleString()})` : ""}
                    </button>
                ) : null}
                {vectorColumns.length > 0 ? (
                    <button
                        role="tab"
                        aria-selected={activeTab === "vector"}
                        className={`qs-tab ${activeTab === "vector" ? "active" : ""}`}
                        onClick={() => setActiveTab("vector")}>
                        Vector
                    </button>
                ) : null}
                {state.hasLocalMessages || state.messageCount > 0 ? (
                    <button
                        role="tab"
                        aria-selected={activeTab === "messages"}
                        className={`qs-tab ${activeTab === "messages" ? "active" : ""} ${state.errorCount > 0 ? "has-errors" : ""}`}
                        onClick={() => setActiveTab("messages")}>
                        Messages
                        {state.errorCount > 0 ? ` (${state.errorCount} ⚠)` : ""}
                    </button>
                ) : null}
            </div>
            <div
                className={`qs-results-body${singleGrid || maximizedGrid ? " qs-results-body-fill" : ""}`}
                ref={bodyRef}>
                {activeTab === "results" ? (
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
                                                  setMaximizedGridId(
                                                      isMaximized ? undefined : summary.resultSetId,
                                                  )
                                    }
                                />
                            );
                        })}
                        {planSummaries.map((summary, index) => (
                            <ResultGridBlock
                                key={summary.resultSetId}
                                rpc={rpc}
                                summary={summary}
                                displayOrdinal={gridSummaries.length + index + 1}
                                rowCount={summary.rowCount}
                                gridStyle={state.gridStyle}
                                sizing={{ kind: "height", bodyPx: 120 }}
                                runActive={false}
                            />
                        ))}
                    </QsResultsGridProvider>
                ) : activeTab === "vector" ? (
                    <React.Suspense
                        fallback={<div className="qs-muted">Loading Vector Workbench…</div>}>
                        <LazyVectorTab
                            rpc={rpc}
                            columns={vectorColumns}
                            runKey={`pinned:${state.createdEpochMs ?? 0}`}
                            live={false}
                        />
                    </React.Suspense>
                ) : (
                    <MessagesView rpc={rpc} messages={messages} />
                )}
            </div>
        </div>
    );
}
