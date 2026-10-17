/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions page: enablement plus the console-hosted Inline Completion Debug
 * experience — the COMPLETE shared app (Live | Sessions tabs, DetailPane,
 * ReplayTraceBuilder drawer, custom prompt dialog) via direct component reuse
 * over the typed thin transport (WI-1.4/1.5). The app chunk lazy-loads so the
 * console's initial bundle stays lean.
 *
 * Privacy split (deliberate): while the feature gate is OFF this page renders
 * substrate DiagEvents only — protocol metadata (trigger, stages, result,
 * latency), never prompt or document text. Once the gate is ON, the hosted
 * debug experience shows the same full-fidelity events (prompts, responses,
 * schema context) as the standalone viewer — this is the gated debug surface.
 */

import { locConstants } from "../../common/locConstants";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
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
import { useDc } from "./state";

const InlineCompletionDebugApp = lazy(() =>
    import("../InlineCompletionDebug/App").then((module) => ({
        default: module.InlineCompletionDebugApp,
    })),
);

function Pill({ on, labelOn, labelOff }: { on: boolean; labelOn: string; labelOff: string }) {
    return <span className={`dc-pill ${on ? "ok" : "blocked"}`}>{on ? labelOn : labelOff}</span>;
}

export function CompletionsPage() {
    const { rpc, activeSourceId, dataVersion, route } = useDc();
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
                            ? locConstants.inlineCompletionDebug
                                  .aICompletionsEnabledOpenAConnectedSql
                            : locConstants.inlineCompletionDebug.settingsSavedReloadTheVSCodeWindow
                        : locConstants.inlineCompletionDebug.aICompletionsDisabled,
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
                title={locConstants.inlineCompletionDebug.completions}
                sub="AI inline completions: enablement, live substrate activity, and the full debug viewer."
            />
            <div className="dc-card">
                <div className="dc-card-title">{locConstants.inlineCompletionDebug.enablement}</div>
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
                            {locConstants.inlineCompletionDebug.profile}
                            {status.schemaContextProfile} {locConstants.inlineCompletionDebug.model}{" "}
                            {status.modelFamily || "(default)"}{" "}
                            {locConstants.inlineCompletionDebug.vendors}{" "}
                            {status.modelVendors.join(", ") || "—"}{" "}
                            {locConstants.inlineCompletionDebug.diagnostics}{" "}
                            {status.includeSqlDiagnostics ? "included" : "off"}{" "}
                            {locConstants.inlineCompletionDebug.traceCapture}{" "}
                            {status.traceCaptureEnabled ? "on" : "off"}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            {status.featureEnabled ? (
                                <button
                                    className="dc-btn"
                                    disabled={busy}
                                    onClick={() => setEnabled(false)}>
                                    {locConstants.inlineCompletionDebug.disableAICompletions}
                                </button>
                            ) : (
                                <button
                                    className="dc-btn primary"
                                    disabled={busy}
                                    onClick={() => setEnabled(true)}>
                                    {locConstants.inlineCompletionDebug.enableAICompletions}
                                </button>
                            )}
                            <button
                                className="dc-btn"
                                disabled={!status.featureEnabled}
                                onClick={openViewer}
                                title={
                                    locConstants.inlineCompletionDebug
                                        .fullFidelityPromptsResponsesSchemaContextReplay
                                }>
                                {locConstants.inlineCompletionDebug.openInlineCompletionDebugViewer}
                            </button>
                        </div>
                        {message ? (
                            <div className="dc-mono dc-muted" style={{ marginTop: 8 }}>
                                {message}
                            </div>
                        ) : null}
                        <p className="dc-muted" style={{ marginBottom: 0 }}>
                            {locConstants.inlineCompletionDebug.enableWrites}{" "}
                            <span className="dc-mono">mssql.enableExperimentalFeatures</span>,{" "}
                            <span className="dc-mono">mssql.copilot.inlineCompletions.enabled</span>{" "}
                            {locConstants.inlineCompletionDebug.andQuietsGitHubCopilotForSQL}
                            <span className="dc-mono">
                                {locConstants.inlineCompletionDebug.githubCopilotEnableSqlFalse}
                            </span>
                            {
                                locConstants.inlineCompletionDebug
                                    .reloadIsRequiredAfterFirstEnablementCompletions
                            }
                        </p>
                    </>
                ) : (
                    <div className="dc-muted">{locConstants.inlineCompletionDebug.loading}</div>
                )}
            </div>
            {status?.featureEnabled ? (
                // The complete shared Inline Completion Debug app (Live |
                // Sessions | replay drawer) — direct component reuse, driven
                // over the typed thin transport by the console provider. The
                // page fills the content area; every pane scrolls internally.
                <div
                    className="dc-card"
                    style={{
                        flexGrow: 1,
                        minHeight: 480,
                        padding: 0,
                        overflow: "hidden",
                    }}>
                    <ConsoleCompletionsDebugStateProvider>
                        <Suspense
                            fallback={
                                <div className="dc-muted" style={{ padding: 12 }}>
                                    {locConstants.inlineCompletionDebug.loadingDebugTools}
                                </div>
                            }>
                            {/* WI-4.4 deep link: a History "Completions n"
                                chip routes here with the host session whose
                                stored captures should join the dataset. */}
                            <InlineCompletionDebugApp
                                layout="fill"
                                sessionsDatasetHint={route.completionsDatasetSession}
                            />
                        </Suspense>
                    </ConsoleCompletionsDebugStateProvider>
                </div>
            ) : (
                <div className="dc-card">
                    <div className="dc-card-title">
                        {locConstants.inlineCompletionDebug.liveActivitySubstrateRedacted}
                    </div>
                    {events.length === 0 ? (
                        <EmptyState
                            title={
                                locConstants.inlineCompletionDebug.noCompletionActivityInThisSource
                            }
                            body="Requests, stages, results and latency appear here as you type in a .sql editor. Prompt and response text never rides these events — use the debug viewer for full fidelity."
                        />
                    ) : (
                        <table className="dc-table">
                            <thead>
                                <tr>
                                    <th>{locConstants.inlineCompletionDebug.time}</th>
                                    <th>{locConstants.inlineCompletionDebug.type}</th>
                                    <th>{locConstants.inlineCompletionDebug.status}</th>
                                    <th>{locConstants.inlineCompletionDebug.triggerStage}</th>
                                    <th>{locConstants.inlineCompletionDebug.result}</th>
                                    <th>{locConstants.inlineCompletionDebug.latency}</th>
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
                                                    ? locConstants.inlineCompletionDebug.value0Ms(
                                                          String(Math.round(e.durationMs)),
                                                      )
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
