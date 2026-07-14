/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane page (TSQ2 §9): a live, passive view of the provider registry
 * and its running backends — the "what is this component doing right now"
 * surface. It answers the questions a ts-native dogfooder asks: which backend
 * is default, is it available, how many sessions are open, what capabilities
 * did each backend declare, and — for ts-native — what does the engine's own
 * snapshot say (driver, active overrides, live sessions and in-flight queries).
 *
 * Everything here is protocol metadata; the host builds it from the registry's
 * passive statusSummary() plus ts-native aggregate counters. No SQL text, row
 * values, server names, or credentials cross this boundary.
 */

import { useCallback, useEffect, useState } from "react";
import {
    DcGetSqlDataPlaneStatusRequest,
    DcSqlDataPlaneStatus,
} from "../../../sharedInterfaces/debugConsole";
import { EmptyState, Kpi, PageHeader, StatusPill } from "./common";
import { useDc } from "./state";

export function SqlDataPlanePage() {
    const { rpc, dataVersion } = useDc();
    const [status, setStatus] = useState<DcSqlDataPlaneStatus | undefined>(undefined);
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        let cancelled = false;
        void rpc.sendRequest(DcGetSqlDataPlaneStatusRequest.type).then((result) => {
            if (!cancelled) {
                setStatus(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [rpc, dataVersion, refresh]);

    const reload = useCallback(() => setRefresh((n) => n + 1), []);

    if (!status) {
        return (
            <>
                <PageHeader
                    title="SQL Data Plane"
                    sub="Live provider registry and backend status"
                />
                <EmptyState
                    title="Loading…"
                    body="Reading the passive registry snapshot. If this persists, the SQL Data Plane service has not initialized yet."
                />
            </>
        );
    }

    const obs = status.tsNativeObservability;
    const availabilityTone =
        status.availability.state === "available"
            ? "ok"
            : status.availability.state === "unavailable"
              ? "error"
              : undefined;

    return (
        <>
            <PageHeader title="SQL Data Plane" sub="Live provider registry and backend status" />

            <div className="dc-kpis">
                <Kpi
                    label="Feature"
                    value={status.enabled ? "enabled" : "disabled"}
                    tone={status.enabled ? "ok" : "warn"}
                />
                <Kpi
                    label="Default backend"
                    value={status.normalizedBackend}
                    note={
                        status.backend !== status.normalizedBackend
                            ? `configured: ${status.backend}`
                            : undefined
                    }
                    tone={status.normalizedBackend.startsWith("INVALID") ? "error" : undefined}
                />
                <Kpi
                    label="Availability"
                    value={status.availability.state}
                    note={status.availability.reason}
                    tone={availabilityTone}
                />
                <Kpi label="Active sessions" value={status.activeSessions} />
                {obs ? (
                    <Kpi
                        label="ts-native terminals"
                        value={obs.terminals}
                        note={
                            obs.invariantViolations > 0
                                ? `${obs.invariantViolations} invariant violation(s)`
                                : "no invariant violations"
                        }
                        tone={obs.invariantViolations > 0 ? "error" : "ok"}
                    />
                ) : null}
                {obs && obs.droppedAfterTerminal > 0 ? (
                    <Kpi
                        label="Post-terminal drops"
                        value={obs.droppedAfterTerminal}
                        note="events after a query terminal (dispose mid-stream)"
                        tone="warn"
                    />
                ) : null}
            </div>

            <div className="dc-card-title" style={{ marginTop: 16 }}>
                Registered backends
            </div>
            <div className="dc-table-wrap">
                <table className="dc-table">
                    <thead>
                        <tr>
                            <th>Kind</th>
                            <th>Name</th>
                            <th>State</th>
                            <th>Realm</th>
                            <th>Sessions</th>
                            <th>Config</th>
                            <th>Last error</th>
                        </tr>
                    </thead>
                    <tbody>
                        {status.entries.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="dc-muted">
                                    No backends registered yet.
                                </td>
                            </tr>
                        ) : (
                            status.entries.map((entry) => (
                                <tr key={entry.kind}>
                                    <td className="dc-mono">{entry.kind}</td>
                                    <td>{entry.displayName}</td>
                                    <td>
                                        <StatusPill
                                            status={
                                                entry.state === "ready"
                                                    ? "ok"
                                                    : entry.lastError
                                                      ? "error"
                                                      : entry.state
                                            }
                                        />
                                    </td>
                                    <td className="dc-mono">{entry.realmClass}</td>
                                    <td className="dc-mono">{entry.activeSessionCount}</td>
                                    <td>
                                        {entry.staleConfig ? (
                                            <span className="dc-pill warning">stale</span>
                                        ) : (
                                            <span className="dc-muted">current</span>
                                        )}
                                    </td>
                                    <td className="dc-mono dc-muted">
                                        {entry.lastError
                                            ? `${entry.lastError.code}${
                                                  entry.lastError.serverErrorNumber !== undefined
                                                      ? ` (Msg ${entry.lastError.serverErrorNumber})`
                                                      : ""
                                              }${entry.lastError.retryable ? " · retryable" : ""}`
                                            : ""}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div
                className="dc-card-title"
                style={{ marginTop: 16, display: "flex", justifyContent: "space-between" }}>
                <span>Backend internals</span>
                <button className="dc-btn" onClick={reload}>
                    Refresh
                </button>
            </div>
            <div className="dc-muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
                Each running backend's own diagnostic snapshot. For ts-native this is the driver,
                any active debug overrides, and every live session with its in-flight query state —
                metadata only. Captured {new Date(status.capturedEpochMs).toLocaleTimeString()}.
            </div>
            <pre
                className="dc-mono"
                style={{
                    background: "var(--dc-panel)",
                    border: "1px solid var(--dc-border)",
                    borderRadius: 6,
                    padding: 12,
                    overflow: "auto",
                    maxHeight: "45vh",
                    whiteSpace: "pre",
                }}>
                {JSON.stringify(status.details, null, 2)}
            </pre>
        </>
    );
}
