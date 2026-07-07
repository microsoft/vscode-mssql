/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions page: enablement plus the console-hosted Inline Completion Debug
 * Live experience (forked from the standalone viewer; replay & sessions stay
 * in the standalone panel for now).
 *
 * Privacy split (deliberate): while the feature gate is OFF this page renders
 * substrate DiagEvents only — protocol metadata (trigger, stages, result,
 * latency), never prompt or document text. Once the gate is ON, the hosted
 * debug experience shows the same full-fidelity events (prompts, responses,
 * schema context) as the standalone viewer — this is the gated debug surface.
 */

import { useCallback, useEffect, useState } from "react";
import {
    CompletionsStatusInfo,
    DcCompletionsEnableRequest,
    DcCompletionsStatusRequest,
    DcOpenCompletionsViewerRequest,
    DcQueryEventsRequest,
    DiagEvent,
} from "../../../sharedInterfaces/debugConsole";
import { EmptyState, PageHeader, formatTime } from "./common";
import { ConsoleCompletionsDebugStateProvider } from "./completionsDebug/consoleStateProvider";
import { InlineCompletionDebugPage } from "./completionsDebug/LivePage";
import { useDc } from "./state";

function Pill({ on, labelOn, labelOff }: { on: boolean; labelOn: string; labelOff: string }) {
    return <span className={`dc-pill ${on ? "ok" : "blocked"}`}>{on ? labelOn : labelOff}</span>;
}

export function CompletionsPage() {
    const { rpc, activeSourceId, dataVersion } = useDc();
    const [status, setStatus] = useState<CompletionsStatusInfo | undefined>(undefined);
    const [events, setEvents] = useState<DiagEvent[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | undefined>(undefined);

    const refreshStatus = useCallback(() => {
        void rpc.sendRequest(DcCompletionsStatusRequest.type, undefined).then(setStatus);
    }, [rpc]);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    useEffect(() => {
        void rpc
            .sendRequest(DcQueryEventsRequest.type, {
                sourceId: activeSourceId,
                features: ["completions"],
                limit: 200,
            })
            .then((result) => {
                const rows = result.rows.filter(
                    (e): e is DiagEvent => (e as DiagEvent).eventId !== undefined,
                );
                setEvents(rows.slice(-100).reverse());
            });
    }, [rpc, activeSourceId, dataVersion]);

    const setEnabled = (enable: boolean) => {
        setBusy(true);
        setMessage(undefined);
        void rpc
            .sendRequest(DcCompletionsEnableRequest.type, { enable })
            .then((result) => {
                setStatus(result);
                setMessage(
                    enable
                        ? result.featureEnabled
                            ? "AI completions enabled — open a connected .sql editor and start typing."
                            : "Settings written, but the feature gate still reports disabled."
                        : "AI completions disabled.",
                );
            })
            .finally(() => setBusy(false));
    };

    const openViewer = () => {
        void rpc.sendRequest(DcOpenCompletionsViewerRequest.type, undefined).then((result) => {
            if (!result.ok) {
                setMessage(result.error ?? "Could not open the debug viewer.");
            }
        });
    };

    const field = (e: DiagEvent, name: string): string => {
        const value = e.payload?.[name]?.v;
        return value === undefined || value === null ? "" : String(value);
    };

    return (
        <>
            <PageHeader
                title="Completions"
                sub="AI inline completions: enablement, live substrate activity, and the full debug viewer."
            />
            <div className="dc-card">
                <div className="dc-card-title">Enablement</div>
                {status ? (
                    <>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                            <Pill
                                on={status.featureEnabled}
                                labelOn="feature enabled"
                                labelOff="feature disabled"
                            />
                            <Pill
                                on={status.experimentalEnabled}
                                labelOn="experimental features on"
                                labelOff="mssql.enableExperimentalFeatures off"
                            />
                            <Pill
                                on={status.useSchemaContext}
                                labelOn="schema context on"
                                labelOff="useSchemaContext off"
                            />
                            <Pill
                                on={status.copilotSqlDisabled}
                                labelOn="GitHub Copilot quiet for SQL"
                                labelOff="GitHub Copilot still active for SQL"
                            />
                        </div>
                        <div className="dc-mono dc-muted" style={{ marginBottom: 8 }}>
                            profile {status.schemaContextProfile} · model{" "}
                            {status.modelFamily || "(default)"} · vendors{" "}
                            {status.modelVendors.join(", ") || "—"} · diagnostics{" "}
                            {status.includeSqlDiagnostics ? "included" : "off"} · trace capture{" "}
                            {status.traceCaptureEnabled ? "on" : "off"}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            {status.featureEnabled ? (
                                <button
                                    className="dc-btn"
                                    disabled={busy}
                                    onClick={() => setEnabled(false)}>
                                    Disable AI completions
                                </button>
                            ) : (
                                <button
                                    className="dc-btn primary"
                                    disabled={busy}
                                    onClick={() => setEnabled(true)}>
                                    ✦ Enable AI completions
                                </button>
                            )}
                            <button
                                className="dc-btn"
                                disabled={!status.featureEnabled}
                                onClick={openViewer}
                                title="Full fidelity: prompts, responses, schema context, replay">
                                Open Inline Completion Debug viewer
                            </button>
                        </div>
                        {message ? (
                            <div className="dc-mono dc-muted" style={{ marginTop: 8 }}>
                                {message}
                            </div>
                        ) : null}
                        <p className="dc-muted" style={{ marginBottom: 0 }}>
                            Enable writes{" "}
                            <span className="dc-mono">mssql.enableExperimentalFeatures</span>,{" "}
                            <span className="dc-mono">
                                mssql.copilot.inlineCompletions.useSchemaContext
                            </span>{" "}
                            and quiets GitHub Copilot for SQL (
                            <span className="dc-mono">github.copilot.enable.sql = false</span>).
                            Completions also need a language model (GitHub Copilot Chat, or an SDK
                            provider + API key via the &quot;Set … API Key&quot; commands) and a
                            connected .sql editor for schema context.
                        </p>
                    </>
                ) : (
                    <div className="dc-muted">loading…</div>
                )}
            </div>
            {status?.featureEnabled ? (
                // Console-hosted fork of the standalone viewer's Live tab: full
                // fidelity (prompts, responses, schema context) straight from the
                // shared capture store. Replay & sessions still open the
                // standalone viewer (button above).
                <div
                    className="dc-card"
                    style={{
                        flexGrow: 1,
                        minHeight: 480,
                        padding: 0,
                        overflow: "hidden",
                    }}>
                    <ConsoleCompletionsDebugStateProvider>
                        <InlineCompletionDebugPage />
                    </ConsoleCompletionsDebugStateProvider>
                </div>
            ) : (
                <div className="dc-card">
                    <div className="dc-card-title">Live activity (substrate, redacted)</div>
                    {events.length === 0 ? (
                        <EmptyState
                            title="No completion activity in this source"
                            body="Requests, stages, results and latency appear here as you type in a .sql editor. Prompt and response text never rides these events — use the debug viewer for full fidelity."
                        />
                    ) : (
                        <table className="dc-table">
                            <thead>
                                <tr>
                                    <th>time</th>
                                    <th>type</th>
                                    <th>status</th>
                                    <th>trigger/stage</th>
                                    <th>result</th>
                                    <th>latency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((e) => (
                                    <tr key={e.eventId}>
                                        <td className="dc-mono">{formatTime(e.epochMs)}</td>
                                        <td className="dc-mono">{e.type}</td>
                                        <td>{e.status}</td>
                                        <td className="dc-mono">
                                            {field(e, "trigger") || field(e, "stage")}
                                        </td>
                                        <td className="dc-mono">{field(e, "result")}</td>
                                        <td className="dc-mono">
                                            {field(e, "latencyMs") ||
                                                (e.durationMs !== undefined
                                                    ? `${Math.round(e.durationMs)}ms`
                                                    : "")}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </>
    );
}
