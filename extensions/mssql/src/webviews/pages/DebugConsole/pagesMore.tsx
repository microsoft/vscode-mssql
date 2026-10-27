/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Session exports and diagnostics settings. */

import { useState } from "react";
import {
    DcExportRequest,
    DcGetHealthRequest,
    DiagHealthSnapshot,
} from "../../../sharedInterfaces/debugConsole";
import { describeError, PageHeader, RpcError, useRpcQuery } from "./common";
import { useDc } from "./state";

export function ExportsPage() {
    const { rpc, activeSourceId } = useDc();
    const [last, setLast] = useState<string | undefined>(undefined);
    return (
        <>
            <PageHeader
                title="Exports"
                sub="Redacted, local evidence for bug reports and agents."
            />
            <div className="dc-card">
                <div className="dc-card-title">Export current source</div>
                <p className="dc-muted" style={{ marginTop: 0 }}>
                    Exports the selected source's events as redacted JSONL. Redaction is applied at
                    capture time — raw sensitive values are never present in the export. Bundle
                    export (zip + manifest + privacy report + validation) lands in the next
                    iteration.
                </p>
                <button
                    className="dc-btn primary"
                    onClick={() => {
                        rpc.sendRequest(DcExportRequest.type, { sourceId: activeSourceId }).then(
                            (result) => {
                                setLast(
                                    result.error
                                        ? `Export ${result.error}`
                                        : `Exported ${result.events} events (${result.redactions} redactions) → ${result.path}`,
                                );
                            },
                            (error: unknown) => setLast(`Export failed: ${describeError(error)}`),
                        );
                    }}>
                    ⇩ Export events (redacted JSONL)
                </button>
                {last ? (
                    <div className="dc-mono dc-muted" style={{ marginTop: 8 }}>
                        {last}
                    </div>
                ) : null}
            </div>
        </>
    );
}

/** Sink + store health: a sink may degrade, but never silently (Chunk 2). */
function DiagHealthCard() {
    const { rpc } = useDc();
    const {
        data: health,
        error: healthError,
        refresh,
    } = useRpcQuery<DiagHealthSnapshot>(() => rpc.sendRequest(DcGetHealthRequest.type), [rpc]);
    return (
        <div className="dc-card">
            <div className="dc-card-title">
                Diagnostics health
                <span className="right">
                    <button className="dc-btn" onClick={refresh}>
                        ⟳ Refresh
                    </button>
                </span>
            </div>
            {healthError ? (
                <RpcError error={healthError} retry={refresh} />
            ) : !health ? (
                <span className="dc-muted">Loading…</span>
            ) : (
                <>
                    <table className="dc-table ph-dense">
                        <thead>
                            <tr>
                                <th>Sink</th>
                                <th>Status</th>
                                <th>Detail</th>
                                <th>Counters</th>
                            </tr>
                        </thead>
                        <tbody>
                            {health.sinks.map((sink) => (
                                <tr key={sink.id}>
                                    <td className="dc-mono">{sink.id}</td>
                                    <td>
                                        <span
                                            className={`dc-pill ${sink.healthy ? "ok" : "error"}`}>
                                            {sink.healthy ? "healthy" : "degraded"}
                                        </span>
                                    </td>
                                    <td>{sink.detail}</td>
                                    <td className="dc-mono dc-muted" style={{ fontSize: 10.5 }}>
                                        {Object.entries(sink.counters)
                                            .map(([k, v]) => `${k}=${v.toLocaleString()}`)
                                            .join(" · ")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="dc-kv" style={{ marginTop: 8 }}>
                        <span className="k">Store</span>
                        <span className="v">
                            {health.store.enabled ? "capturing" : "off"} · {health.store.sessions}{" "}
                            session(s) · {(health.store.totalBytes / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <span className="k">Integrity</span>
                        <span className="v">
                            {health.store.issues.length === 0 ? (
                                <span className="dc-pill ok">clean</span>
                            ) : (
                                `${health.store.issues.length} issue(s)`
                            )}
                        </span>
                    </div>
                    {health.store.issues.length > 0 ? (
                        <ul className="dc-muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                            {health.store.issues.slice(0, 12).map((issue, index) => (
                                <li key={index} style={{ fontSize: 11.5 }}>
                                    {issue}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </>
            )}
        </div>
    );
}

export function SettingsPage() {
    const { captureMode, setCaptureMode, state } = useDc();
    return (
        <>
            <PageHeader title="Settings" sub="Capture, retention, storage, privacy." />
            <div className="dc-card">
                <div className="dc-card-title">Session Diag capture</div>
                <div className="dc-kv" style={{ marginBottom: 10 }}>
                    <span className="k">Current mode</span>
                    <span className="v">{captureMode}</span>
                    <span className="k">Storage</span>
                    <span className="v">local only · never uploaded</span>
                    <span className="k">Hard rule</span>
                    <span className="v">secrets/connection strings never persisted</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="dc-btn" onClick={() => setCaptureMode("redacted")}>
                        Enable (redacted)
                    </button>
                    <button className="dc-btn" onClick={() => setCaptureMode("digest")}>
                        Enable (digest)
                    </button>
                    <button className="dc-btn" onClick={() => setCaptureMode("off")}>
                        Disable
                    </button>
                </div>
            </div>
            <DiagHealthCard />
            <div className="dc-card">
                <div className="dc-card-title">Retention &amp; storage</div>
                <p className="dc-muted" style={{ margin: 0 }}>
                    Retention caps live in VS Code settings:{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxSessions</span> (default 10) and{" "}
                    <span className="dc-mono">mssql.sessionDiag.maxAgeDays</span> (default 14), and
                    <span className="dc-mono"> mssql.sessionDiag.maxTotalMB</span> (default 512).
                    Clear all local diagnostics via the command palette:{" "}
                    <span className="dc-mono">MS SQL: Session Diagnostics: Clear Local Data</span>.
                </p>
            </div>
            {state?.fixtureMode ? (
                <div className="dc-card">
                    <div className="dc-card-title">Fixture mode</div>
                    <span className="dc-pill ok">on</span>
                </div>
            ) : null}
        </>
    );
}
