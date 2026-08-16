/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from "react";
import { DcQueryEventsRequest, DiagEvent } from "../../../sharedInterfaces/debugConsole";
import { sqlDashboardLoc as loc } from "../SqlDashboard/locConstants";
import {
    EmptyState,
    formatDuration,
    formatTime,
    Kpi,
    PageHeader,
    ProcessPill,
    StatusPill,
} from "./common";
import { useDc } from "./state";

function payloadValue(event: DiagEvent, key: string): string | undefined {
    const value = event.payload?.[key];
    if (!value || value.handling !== "plain" || value.v === undefined) {
        return undefined;
    }
    return String(value.v);
}

export function DashboardDiagnosticsPage() {
    const { rpc, activeSourceId, dataVersion, navigate } = useDc();
    const [events, setEvents] = useState<DiagEvent[] | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        void rpc
            .sendRequest(DcQueryEventsRequest.type, {
                sourceId: activeSourceId,
                features: ["sqlDashboard", "webview.sqlDashboard"],
                limit: 500,
            })
            .then((result) => {
                if (!cancelled) {
                    setEvents(
                        result.rows
                            .filter((row): row is DiagEvent => row.kind !== "gap")
                            .sort((left, right) => right.seq - left.seq),
                    );
                }
            });
        return () => {
            cancelled = true;
        };
    }, [rpc, activeSourceId, dataVersion]);

    const facts = useMemo(() => {
        const rows = events ?? [];
        const failures = rows.filter(
            (event) => event.status === "error" || event.status === "blocked",
        ).length;
        const renders = rows.filter((event) =>
            event.type.includes("dashboard.route.renderComplete"),
        );
        const latestRoute = rows
            .map((event) => payloadValue(event, "route"))
            .find((value) => value !== undefined);
        return { failures, renders: renders.length, latestRoute };
    }, [events]);

    if (!events) {
        return (
            <>
                <PageHeader title={loc.title} sub={loc.diagnosticsSubtitle} />
                <EmptyState title={loc.loadingDiagnostics} body={loc.readingDiagnostics} />
            </>
        );
    }

    return (
        <>
            <PageHeader title={loc.title} sub={loc.diagnosticsSubtitle} />
            <div className="dc-kpis">
                <Kpi label={loc.events} value={events.length} />
                <Kpi
                    label={loc.failures}
                    value={facts.failures}
                    tone={facts.failures > 0 ? "warn" : "ok"}
                />
                <Kpi label={loc.renderedRoutes} value={facts.renders} />
                <Kpi label={loc.latestRoute} value={facts.latestRoute ?? loc.notObserved} />
            </div>

            {events.length === 0 ? (
                <EmptyState title={loc.noDiagnosticEvents} body={loc.noDiagnosticEventsBody} />
            ) : (
                <div className="dc-table-wrap" style={{ marginTop: 16 }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>{loc.time}</th>
                                <th>{loc.process}</th>
                                <th>{loc.event}</th>
                                <th>{loc.route}</th>
                                <th>{loc.duration}</th>
                                <th>{loc.status}</th>
                                <th>{loc.trace}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.slice(0, 200).map((event) => (
                                <tr key={event.eventId}>
                                    <td className="dc-mono">{formatTime(event.epochMs)}</td>
                                    <td>
                                        <ProcessPill process={event.process} />
                                    </td>
                                    <td className="dc-mono">{event.type}</td>
                                    <td className="dc-mono">
                                        {payloadValue(event, "route") ?? ""}
                                    </td>
                                    <td className="dc-mono">{formatDuration(event.durationMs)}</td>
                                    <td>
                                        <StatusPill status={event.status} />
                                    </td>
                                    <td>
                                        {event.traceId ? (
                                            <button
                                                className="dc-link"
                                                onClick={() =>
                                                    navigate({
                                                        page: "waterfall",
                                                        traceId: event.traceId,
                                                    })
                                                }>
                                                {event.traceId.slice(0, 12)}
                                            </button>
                                        ) : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
