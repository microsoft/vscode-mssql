/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbooks page: what the Runbook Studio extension layer AND the Hobbes
 * runtime are doing, from the same substrate feed as every other feature page
 * (feature === "runbookStudio"). Rows are diag events — open/parse, run
 * lifecycle, gates, runtime launch/health/exit — newest first, bounded.
 * Payload fidelity follows the capture policy (RedactedField), like the
 * Completions substrate table this page mirrors.
 */

import { Fragment, useEffect, useState } from "react";
import {
    DcOpenRunbookRuntimeLogRequest,
    DcQueryEventsRequest,
    DiagEvent,
} from "../../../sharedInterfaces/debugConsole";
import {
    EmptyState,
    formatDuration,
    formatTime,
    PageHeader,
    RedactedField,
    StatusPill,
} from "./common";
import { GatedPage } from "./pagesMore";
import { useDc } from "./state";

/** Bounded view: the newest window of runbook events (host clamps too). */
const RUNBOOK_EVENT_LIMIT = 500;

export function RunbooksPage() {
    const { rpc, activeSourceId, dataVersion, state, navigate } = useDc();
    const [events, setEvents] = useState<DiagEvent[]>([]);
    const [expandedEventId, setExpandedEventId] = useState<string | undefined>(undefined);
    const [message, setMessage] = useState<string | undefined>(undefined);
    const enabled = state?.runbookStudioEnabled === true;

    useEffect(() => {
        if (!enabled) {
            return;
        }
        void rpc
            .sendRequest(DcQueryEventsRequest.type, {
                sourceId: activeSourceId,
                features: ["runbookStudio"],
                limit: RUNBOOK_EVENT_LIMIT,
            })
            .then((result) => {
                const rows = result.rows.filter((row): row is DiagEvent => row.kind !== "gap");
                // Query returns the tail window ascending — newest first here.
                setEvents(rows.slice(-RUNBOOK_EVENT_LIMIT).reverse());
            });
    }, [rpc, activeSourceId, dataVersion, enabled]);

    if (!enabled) {
        return (
            <GatedPage
                title="Runbooks"
                body="Runbook Studio is off in this session. Enable mssql.runbookStudio.enabled to capture runbook and Hobbes runtime diagnostics here."
            />
        );
    }

    const errors = events.filter((event) => event.status === "error").length;

    const openRuntimeLog = () => {
        setMessage(undefined);
        void rpc.sendRequest(DcOpenRunbookRuntimeLogRequest.type, undefined).then((result) => {
            if (!result.ok) {
                setMessage(result.error ?? "Could not open the runtime log.");
            }
        });
    };

    return (
        <>
            <PageHeader
                title="Runbooks"
                sub="Runbook Studio extension-layer events and Hobbes runtime activity for the selected source — run lifecycle, gates, runtime launch/health/exit."
            />
            <div className="dc-toolbar">
                <button
                    className="dc-btn"
                    onClick={openRuntimeLog}
                    title="Open the most recently written Hobbes runtime session log (runtime-session-*.log)">
                    ⇱ Open runtime log
                </button>
                {message ? <span className="dc-mono dc-muted">{message}</span> : null}
                <span className="dc-muted" style={{ marginLeft: "auto" }}>
                    {events.length} event{events.length === 1 ? "" : "s"} shown (last{" "}
                    {RUNBOOK_EVENT_LIMIT}) · {errors} error{errors === 1 ? "" : "s"}
                </span>
            </div>
            {events.length === 0 ? (
                <EmptyState
                    title="No runbook activity in this source"
                    body="Open a runbook or start a run — extension-layer events (open, run lifecycle, gates) and Hobbes runtime activity (launch, health, exit) appear here as they happen."
                />
            ) : (
                <div className="dc-table-wrap" style={{ maxHeight: "calc(100vh - 220px)" }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Trace</th>
                                <th className="num">Dur</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event) => (
                                <Fragment key={event.eventId}>
                                    <tr
                                        className={[
                                            event.status === "error" ? "dc-row-error" : "",
                                            expandedEventId === event.eventId ? "selected" : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                        onClick={() =>
                                            setExpandedEventId((current) =>
                                                current === event.eventId
                                                    ? undefined
                                                    : event.eventId,
                                            )
                                        }>
                                        <td className="dc-mono">{formatTime(event.epochMs)}</td>
                                        <td className="dc-mono">{event.type}</td>
                                        <td>
                                            <StatusPill status={event.status} />
                                        </td>
                                        <td className="dc-mono dc-muted">
                                            {event.traceId ? `${event.traceId.slice(0, 14)}…` : "—"}
                                        </td>
                                        <td className="num dc-mono">
                                            {formatDuration(event.durationMs)}
                                        </td>
                                    </tr>
                                    {expandedEventId === event.eventId ? (
                                        <tr className="dc-expand-row">
                                            <td colSpan={5}>
                                                <div className="dc-kv">
                                                    <span className="k">Event ID</span>
                                                    <span className="v dc-mono">
                                                        {event.eventId}
                                                    </span>
                                                    <span className="k">Seq</span>
                                                    <span className="v dc-mono">{event.seq}</span>
                                                    <span className="k">Process</span>
                                                    <span className="v">{event.process}</span>
                                                    <span className="k">Kind</span>
                                                    <span className="v">{event.kind}</span>
                                                    {event.traceId ? (
                                                        <>
                                                            <span className="k">Trace</span>
                                                            <span className="v">
                                                                <a
                                                                    className="dc-mono"
                                                                    style={{
                                                                        color: "var(--dc-link)",
                                                                        cursor: "pointer",
                                                                    }}
                                                                    title="Open this trace in the Waterfall page"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigate({
                                                                            page: "waterfall",
                                                                            traceId: event.traceId,
                                                                        });
                                                                    }}>
                                                                    {event.traceId}
                                                                </a>
                                                            </span>
                                                        </>
                                                    ) : null}
                                                    {event.durationMs !== undefined ? (
                                                        <>
                                                            <span className="k">Duration</span>
                                                            <span className="v">
                                                                {formatDuration(event.durationMs)}
                                                            </span>
                                                        </>
                                                    ) : null}
                                                    {Object.entries(event.payload ?? {}).map(
                                                        ([key, value]) => (
                                                            <div
                                                                style={{ display: "contents" }}
                                                                key={key}>
                                                                <span className="k">{key}</span>
                                                                <span className="v">
                                                                    <RedactedField value={value} />
                                                                </span>
                                                            </div>
                                                        ),
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
