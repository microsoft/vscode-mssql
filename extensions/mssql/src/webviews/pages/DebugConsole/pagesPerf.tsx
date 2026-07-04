/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Session History — cross-session trace aggregates from the Session Diag
 *  store. Harness/self-test run history lives in the Perf Test History page
 *  (pagesPerfHistory.tsx). */

import { useEffect, useState } from "react";
import { DcGetHistoryRequest, HistorySummary } from "../../../sharedInterfaces/debugConsole";
import { TrendChart } from "./charts";
import { EmptyState, formatDuration, Kpi, PageHeader } from "./common";
import { useDc } from "./state";

// ---------------------------------------------------------------------------
// History — cross-session trace aggregates
// ---------------------------------------------------------------------------

export function HistoryPage() {
    const {
        rpc,
        dataVersion,
        setActiveSourceId,

        navigate,
        captureMode,
        setCaptureMode,
    } = useDc();
    const [history, setHistory] = useState<HistorySummary | undefined>(undefined);

    useEffect(() => {
        void rpc.sendRequest(DcGetHistoryRequest.type).then(setHistory);
    }, [rpc, dataVersion]);

    if (!history) {
        return <PageHeader title="History" sub="Loading…" />;
    }
    if (history.sessions.length <= 1 && captureMode === "off") {
        return (
            <>
                <PageHeader title="History" />
                <EmptyState
                    title="No saved sessions yet"
                    body="Enable Session Diag capture and traces auto-save locally across VS Code sessions — then this page shows aggregates and per-action latency trends over time.">
                    <button className="dc-btn primary" onClick={() => setCaptureMode("redacted")}>
                        Enable redacted capture
                    </button>
                </EmptyState>
            </>
        );
    }
    const totalErrors = history.sessions.reduce((sum, session) => sum + session.errors, 0);
    return (
        <>
            <PageHeader
                title="History"
                sub="Aggregates and trends across locally stored sessions. Sessions auto-save while capture is on."
            />
            <div className="dc-kpis">
                <Kpi label="Sessions" value={history.sessions.length} />
                <Kpi label="Events (all)" value={history.totalEvents.toLocaleString()} />
                <Kpi label="User actions" value={history.totalActions.toLocaleString()} />
                <Kpi
                    label="Errors (all)"
                    value={totalErrors}
                    tone={totalErrors > 0 ? "error" : undefined}
                />
            </div>

            {history.trends.length > 0 ? (
                <div className="dc-chart-grid">
                    {history.trends.map((trend) => (
                        <div className="dc-card" style={{ margin: 0 }} key={trend.label}>
                            <div className="dc-card-title">
                                {trend.label}
                                <span className="right">median per session · {trend.feature}</span>
                            </div>
                            <TrendChart
                                height={150}
                                points={trend.points.map((point, index) => ({
                                    x: index,
                                    y: point.medianMs,
                                    label: `${point.sessionLabel}\n${formatDuration(point.medianMs)} median · ${point.count} occurrence(s)${point.errors > 0 ? ` · ${point.errors} error(s)` : ""}`,
                                }))}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="dc-card dc-muted">
                    No repeated user actions across sessions yet — use MSSQL features with capture
                    on and trends appear here.
                </div>
            )}

            <div className="dc-card" style={{ marginTop: 12 }}>
                <div className="dc-card-title">Stored sessions</div>
                <div className="dc-table-wrap" style={{ border: "none" }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>Session</th>
                                <th>Created (UTC)</th>
                                <th className="num">Events</th>
                                <th className="num">Actions</th>
                                <th className="num">Errors</th>
                                <th className="num">Gaps</th>
                                <th>Capture</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...history.sessions].reverse().map((session) => (
                                <tr
                                    key={session.sourceId}
                                    onClick={() => {
                                        setActiveSourceId(session.sourceId);

                                        navigate({ page: "trace" });
                                    }}>
                                    <td>
                                        {session.live ? (
                                            <span
                                                className="dc-live-dot"
                                                style={{ display: "inline-block", marginRight: 6 }}
                                            />
                                        ) : null}
                                        {session.label}
                                    </td>
                                    <td className="dc-mono dc-muted">
                                        {session.createdUtc.slice(0, 16).replace("T", " ")}
                                    </td>
                                    <td className="num dc-mono">
                                        {session.events.toLocaleString()}
                                    </td>
                                    <td className="num dc-mono">{session.actionCount}</td>
                                    <td className="num dc-mono">{session.errors}</td>
                                    <td className="num dc-mono">{session.gaps}</td>
                                    <td>
                                        <span className="dc-pill diag">{session.captureMode}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
