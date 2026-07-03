/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Self-test run dialog: pick scenarios, choose how SQL connectivity is
 * provided (active editor connection, saved profile, env-var connection
 * string, or none), set reps/options, launch a perftest run in THIS VS Code
 * instance, and watch the activity stream live. Results persist to the
 * perf-runs directory and the completed run attaches as a console source for
 * trace/waterfall drill-in.
 */

import { useEffect, useMemo, useState } from "react";
import {
    DcListSelfTestScenariosRequest,
    SelfTestCatalog,
    SelfTestConnectionMode,
    SelfTestProgress,
} from "../../../sharedInterfaces/debugConsole";
import { useDc } from "./state";

function ProgressLine({ event }: { event: SelfTestProgress }) {
    switch (event.phase) {
        case "runStart":
            return (
                <div className="dc-run-line">
                    <span className="rl-muted">
                        ▸ run started · {event.scenarioCount} scenario(s) · {event.totalReps} rep(s)
                    </span>
                </div>
            );
        case "scenarioStart":
            return (
                <div className="dc-run-line">
                    <span>
                        ▸ [{(event.index ?? 0) + 1}/{event.total}]
                    </span>
                    <span>{event.title ?? event.scenarioId}</span>
                </div>
            );
        case "scenarioSkipped":
            return (
                <div className="dc-run-line">
                    <span className="rl-skip">⊘ skipped {event.title ?? event.scenarioId}</span>
                    <span className="rl-muted">— {event.reason}</span>
                </div>
            );
        case "repStart":
            return (
                <div className="dc-run-line">
                    <span className="rl-muted">
                        {"    "}rep {event.repId}
                        {event.warmup ? " (warmup)" : ""} …
                    </span>
                </div>
            );
        case "repEnd": {
            const wall = event.metrics?.find((m) => m.name === "scenario.wallclock");
            const cls =
                event.status === "passed"
                    ? "rl-ok"
                    : event.status === "failed"
                      ? "rl-fail"
                      : "rl-skip";
            const mark = event.status === "passed" ? "✓" : event.status === "failed" ? "✗" : "⊘";
            return (
                <div className="dc-run-line">
                    <span className={cls}>
                        {"    "}
                        {mark} rep {event.repId}
                        {event.warmup ? " (warmup)" : ""}
                        {wall ? ` · ${wall.value.toFixed(0)}ms` : ""}
                    </span>
                    {event.reason ? (
                        <span className="rl-fail" style={{ whiteSpace: "normal" }}>
                            — {event.reason}
                        </span>
                    ) : null}
                </div>
            );
        }
        case "scenarioEnd":
            return (
                <div className="dc-run-line">
                    <span className="rl-muted">
                        {"  "}done: {event.passed ?? 0} passed
                        {event.failed ? `, ${event.failed} failed` : ""}
                    </span>
                </div>
            );
        case "runEnd":
            return (
                <div className="dc-run-line">
                    <span className={event.runStatus === "failed" ? "rl-fail" : "rl-ok"}>
                        ■ run {event.runStatus} · {event.passed ?? 0} passed
                        {event.failed ? `, ${event.failed} failed` : ""}
                        {event.skipped ? `, ${event.skipped} skipped` : ""}
                    </span>
                </div>
            );
        case "error":
            return (
                <div className="dc-run-line">
                    <span className="rl-fail" style={{ whiteSpace: "normal" }}>
                        ✗ {event.message}
                    </span>
                </div>
            );
        case "log":
            return (
                <div className="dc-run-line">
                    <span className="rl-muted" style={{ whiteSpace: "normal" }}>
                        {event.message}
                    </span>
                </div>
            );
        default:
            return null;
    }
}

export function SelfTestDialog({ onClose }: { onClose: () => void }) {
    const {
        rpc,
        selfTest,
        runSelfTest,
        cancelSelfTest,
        setActiveSourceId,
        setIsLive,
        navigate,
        refreshSources,
    } = useDc();
    const [catalog, setCatalog] = useState<SelfTestCatalog | undefined>(undefined);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [connectionId, setConnectionId] = useState<string>("none");
    const [envVarName, setEnvVarName] = useState<string>("MSSQL_PERFTEST_CONNECTION_STRING");
    const [reps, setReps] = useState(3);
    const [warmup, setWarmup] = useState(1);
    const [elevate, setElevate] = useState(false);
    const [collectRich, setCollectRich] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        void rpc.sendRequest(DcListSelfTestScenariosRequest.type).then((result) => {
            setCatalog(result);
            // Default connection: the first available active connection, else none.
            const active = result.connections.find((c) => c.mode === "active" && c.available);
            setConnectionId(active?.id ?? "none");
            // Default selection: runnable scenarios; SQL ones only when a
            // connection is preselected.
            setSelected(
                new Set(
                    result.scenarios
                        .filter((s) => !s.cliOnly && (!s.needsSql || active !== undefined))
                        .map((s) => s.id),
                ),
            );
        });
    }, [rpc]);

    const running = selfTest?.active ?? false;
    const events = selfTest?.events ?? [];
    const summary = selfTest?.summary;
    const attachedSourceId = useMemo(
        () => events.find((e) => e.phase === "runEnd")?.attachedSourceId,
        [events],
    );

    const selectedConnection = catalog?.connections.find((c) => c.id === connectionId);
    const sqlEnabled =
        selectedConnection !== undefined &&
        selectedConnection.mode !== "none" &&
        (selectedConnection.available || selectedConnection.mode === "env");

    const progress = useMemo(() => {
        const start = events.find((e) => e.phase === "runStart");
        const total = start?.totalReps ?? 0;
        const done = events.filter((e) => e.phase === "repEnd").length;
        return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : running ? 5 : 0;
    }, [events, running]);

    const toggle = (id: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const openAttached = (page: "trace" | "waterfall") => {
        if (!attachedSourceId) {
            return;
        }
        refreshSources();
        setActiveSourceId(attachedSourceId);
        setIsLive(false);
        navigate({ page });
        onClose();
    };

    const launch = () => {
        setError(undefined);
        const scenarioIds = [...selected];
        if (scenarioIds.length === 0) {
            setError("Select at least one scenario.");
            return;
        }
        const mode: SelfTestConnectionMode = selectedConnection?.mode ?? "none";
        void runSelfTest({
            scenarioIds,
            repetitions: reps,
            warmupRepetitions: warmup,
            elevateCapture: elevate,
            collectRich,
            connection: {
                mode,
                ...(mode !== "none" && mode !== "env" ? { optionId: connectionId } : {}),
                ...(mode === "env" ? { envVarName } : {}),
            },
        }).then((started) => {
            if (!started.accepted) {
                setError(started.reason ?? "run rejected");
            }
        });
    };

    return (
        <div className="dc-modal-overlay" onClick={onClose}>
            <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
                <div className="dc-modal-header">
                    <div>
                        <h2>Run self-test</h2>
                        <div className="sub">
                            Runs perftest scenarios in this VS Code instance. Every event streams
                            into the consolidated trace and waterfall live; results land in the perf
                            history and attach as a source when done.
                        </div>
                    </div>
                    <button className="dc-modal-close" onClick={onClose} title="Close">
                        ×
                    </button>
                </div>

                <div className="dc-modal-body">
                    <div>
                        <div className="dc-field">
                            <label>SQL connection for this run</label>
                            <select
                                value={connectionId}
                                disabled={running}
                                onChange={(e) => setConnectionId(e.target.value)}>
                                {(catalog?.connections ?? []).map((option) => (
                                    <option
                                        key={option.id}
                                        value={option.id}
                                        disabled={!option.available && option.mode !== "env"}>
                                        {option.label}
                                        {option.available ? "" : " (unavailable)"}
                                    </option>
                                ))}
                            </select>
                            {selectedConnection ? (
                                <span className="dc-muted" style={{ fontSize: 11 }}>
                                    {selectedConnection.detail}
                                    {!selectedConnection.available && selectedConnection.reason
                                        ? ` — ${selectedConnection.reason}`
                                        : ""}
                                </span>
                            ) : null}
                            {selectedConnection?.mode === "env" ? (
                                <input
                                    type="text"
                                    value={envVarName}
                                    disabled={running}
                                    spellCheck={false}
                                    style={{
                                        height: 26,
                                        background: "var(--dc-input-bg)",
                                        border: "1px solid var(--dc-input-border)",
                                        borderRadius: 5,
                                        color: "var(--dc-text)",
                                        padding: "0 8px",
                                        fontFamily: "var(--dc-mono)",
                                        fontSize: 11.5,
                                    }}
                                    onChange={(e) => setEnvVarName(e.target.value)}
                                    placeholder="MSSQL_PERFTEST_CONNECTION_STRING"
                                    title="Environment variable holding a SQL connection string. The value is parsed in the extension host and never displayed, logged, or persisted."
                                />
                            ) : null}
                        </div>
                        <div className="dc-scenario-list">
                            {catalog?.scenarios.map((scenario) => {
                                const disabled =
                                    scenario.cliOnly === true || (scenario.needsSql && !sqlEnabled);
                                const checked = selected.has(scenario.id) && !disabled;
                                return (
                                    <label
                                        key={scenario.id}
                                        className={`dc-scenario-row${checked ? " checked" : ""}${
                                            disabled ? " disabled" : ""
                                        }`}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={disabled || running}
                                            onChange={() => toggle(scenario.id)}
                                        />
                                        <div className="dc-scenario-meta">
                                            <div className="title">{scenario.title}</div>
                                            <div className="desc">{scenario.description}</div>
                                            <div className="dc-scenario-badges">
                                                {scenario.cliOnly ? (
                                                    <span className="dc-badge">CLI only</span>
                                                ) : null}
                                                {scenario.needsSql ? (
                                                    <span className="dc-badge sql">needs SQL</span>
                                                ) : null}
                                                {!scenario.cliOnly ? (
                                                    <span className="dc-badge">
                                                        ~{Math.round(scenario.estMs)}ms
                                                    </span>
                                                ) : null}
                                                {scenario.tags.slice(0, 3).map((tag) => (
                                                    <span className="dc-badge" key={tag}>
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <div style={{ display: "flex", gap: 16 }}>
                            <div className="dc-field">
                                <label>Measured reps</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={25}
                                    value={reps}
                                    disabled={running}
                                    onChange={(e) => setReps(Number(e.target.value))}
                                />
                            </div>
                            <div className="dc-field">
                                <label>Warmup reps</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={5}
                                    value={warmup}
                                    disabled={running}
                                    onChange={(e) => setWarmup(Number(e.target.value))}
                                />
                            </div>
                        </div>
                        <label className="dc-check-row" style={{ marginBottom: 8 }}>
                            <input
                                type="checkbox"
                                checked={elevate}
                                disabled={running}
                                onChange={(e) => setElevate(e.target.checked)}
                            />
                            <span>
                                Elevate capture to <b>full</b> for this run (richer payloads;
                                auto-reverts).
                            </span>
                        </label>
                        <label className="dc-check-row" style={{ marginBottom: 12 }}>
                            <input
                                type="checkbox"
                                checked={collectRich}
                                disabled={running}
                                onChange={(e) => setCollectRich(e.target.checked)}
                            />
                            <span>
                                Collect <b>rich diagnostics</b> (CPU, memory, event-loop lag
                                counters) during the run; auto-reverts.
                            </span>
                        </label>

                        {running || events.length > 0 ? (
                            <>
                                <div className="dc-progress-track">
                                    <div
                                        className="dc-progress-fill"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <div className="dc-run-log">
                                    {events.map((event, index) => (
                                        <ProgressLine key={index} event={event} />
                                    ))}
                                    {events.length === 0 ? (
                                        <span className="rl-muted">starting…</span>
                                    ) : null}
                                </div>
                            </>
                        ) : (
                            <div
                                style={{
                                    fontSize: 11.5,
                                    color: "var(--dc-muted)",
                                    border: "1px dashed var(--dc-border)",
                                    borderRadius: 6,
                                    padding: "10px 12px",
                                }}>
                                {selected.size} scenario(s) selected ·{" "}
                                {selected.size * (reps + warmup)} total rep(s). Press <b>Run</b> to
                                start — activity appears here and in the trace/waterfall live.
                            </div>
                        )}

                        {summary ? (
                            <div
                                style={{
                                    marginTop: 10,
                                    fontSize: 11.5,
                                    color: "var(--dc-muted)",
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                    alignItems: "center",
                                }}>
                                <span>
                                    Saved to{" "}
                                    <span className="dc-mono">
                                        {summary.perfRunsRoot || "(default)"}
                                    </span>
                                </span>
                                {attachedSourceId ? (
                                    <>
                                        <button
                                            className="dc-btn"
                                            onClick={() => openAttached("waterfall")}>
                                            Open waterfall
                                        </button>
                                        <button
                                            className="dc-btn"
                                            onClick={() => openAttached("trace")}>
                                            Open trace
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        ) : null}
                        {error ? (
                            <div style={{ marginTop: 8, fontSize: 12, color: "var(--dc-error)" }}>
                                {error}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="dc-modal-footer">
                    <span className="dc-muted" style={{ fontSize: 11.5 }}>
                        Local only · connection strings and passwords are never shown, logged, or
                        persisted · SQL text and rows are never captured.
                    </span>
                    <span className="spacer" />
                    {running ? (
                        <button className="dc-btn warn-chip" onClick={cancelSelfTest}>
                            Cancel run
                        </button>
                    ) : null}
                    <button className="dc-btn" onClick={onClose}>
                        Close
                    </button>
                    <button className="dc-btn primary" onClick={launch} disabled={running}>
                        {running ? "Running…" : "Run"}
                    </button>
                </div>
            </div>
        </div>
    );
}
