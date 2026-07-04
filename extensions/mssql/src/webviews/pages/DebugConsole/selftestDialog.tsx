/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Self-test run dialog.
 *
 * Configure: pick scenarios, choose how SQL connectivity is provided (active
 * editor connection, saved profile, env-var connection string, or none), set
 * reps/options.
 *
 * Run: the config collapses to a summary and the dialog becomes a status
 * console — on-air indicator, scenario/rep counters, elapsed clock, progress
 * bar, and full-width data tabs (Log | Reps | Scenarios) in the style of the
 * Perf Test History tables. Results attach as a console source when done.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    DcListSelfTestScenariosRequest,
    SelfTestCatalog,
    SelfTestConnectionMode,
    SelfTestProgress,
} from "../../../sharedInterfaces/debugConsole";
import { formatDuration } from "./common";
import { useDc } from "./state";

// ---------------------------------------------------------------------------
// Derived views over the progress stream
// ---------------------------------------------------------------------------

interface RepRow {
    scenarioId: string;
    repId: number;
    warmup: boolean;
    status: string;
    wallclockMs?: number;
    reason?: string;
}

interface ScenarioRow {
    scenarioId: string;
    title: string;
    state: "running" | "done" | "skipped";
    passed: number;
    failed: number;
    reason?: string;
}

function useRunDerived(events: SelfTestProgress[]) {
    return useMemo(() => {
        const start = events.find((e) => e.phase === "runStart");
        const reps: RepRow[] = [];
        const scenarios = new Map<string, ScenarioRow>();
        let currentScenario: { id: string; title: string; index: number } | undefined;
        for (const event of events) {
            switch (event.phase) {
                case "scenarioStart":
                    currentScenario = {
                        id: event.scenarioId ?? "",
                        title: event.title ?? event.scenarioId ?? "",
                        index: event.index ?? 0,
                    };
                    scenarios.set(event.scenarioId ?? "", {
                        scenarioId: event.scenarioId ?? "",
                        title: event.title ?? event.scenarioId ?? "",
                        state: "running",
                        passed: 0,
                        failed: 0,
                    });
                    break;
                case "scenarioSkipped":
                    scenarios.set(event.scenarioId ?? "", {
                        scenarioId: event.scenarioId ?? "",
                        title: event.title ?? event.scenarioId ?? "",
                        state: "skipped",
                        passed: 0,
                        failed: 0,
                        ...(event.reason ? { reason: event.reason } : {}),
                    });
                    break;
                case "repEnd":
                    reps.push({
                        scenarioId: event.scenarioId ?? "",
                        repId: event.repId ?? 0,
                        warmup: event.warmup === true,
                        status: event.status ?? "unknown",
                        ...(event.metrics?.find((m) => m.name === "scenario.wallclock")
                            ? {
                                  wallclockMs: event.metrics.find(
                                      (m) => m.name === "scenario.wallclock",
                                  )!.value,
                              }
                            : {}),
                        ...(event.reason ? { reason: event.reason } : {}),
                    });
                    break;
                case "scenarioEnd": {
                    const row = scenarios.get(event.scenarioId ?? "");
                    if (row) {
                        row.state = event.status === "skipped" ? "skipped" : "done";
                        row.passed = event.passed ?? 0;
                        row.failed = event.failed ?? 0;
                        if (event.reason) {
                            row.reason = event.reason;
                        }
                    }
                    break;
                }
                default:
                    break;
            }
        }
        return {
            totalReps: start?.totalReps ?? 0,
            scenarioCount: start?.scenarioCount ?? 0,
            reps,
            scenarios: [...scenarios.values()],
            currentScenario,
        };
    }, [events]);
}

function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function LogLine({ event }: { event: SelfTestProgress }) {
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
                    <span className="rl-muted" style={{ whiteSpace: "normal" }}>
                        — {event.reason}
                    </span>
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

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

type StatusTab = "log" | "reps" | "scenarios";

export function SelfTestDialog({ onClose }: { onClose: () => void }) {
    const {
        rpc,
        selfTest,
        runSelfTest,
        cancelSelfTest,
        setActiveSourceId,

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
    const [statusTab, setStatusTab] = useState<StatusTab>("log");
    const [cancelRequested, setCancelRequested] = useState(false);
    const [configMode, setConfigMode] = useState(true);

    const running = selfTest?.active ?? false;
    const events = useMemo(() => selfTest?.events ?? [], [selfTest?.events]);
    const summary = selfTest?.summary;
    const derived = useRunDerived(events);
    const attachedSourceId = useMemo(
        () => events.find((e) => e.phase === "runEnd")?.attachedSourceId,
        [events],
    );

    // Elapsed clock: ticks while running.
    const startedAtRef = useRef<number | undefined>(undefined);
    const [elapsedMs, setElapsedMs] = useState(0);
    useEffect(() => {
        if (running && startedAtRef.current === undefined) {
            startedAtRef.current = Date.now();
        }
        if (!running) {
            startedAtRef.current = undefined;
            setCancelRequested(false);
            return;
        }
        const timer = setInterval(() => {
            if (startedAtRef.current !== undefined) {
                setElapsedMs(Date.now() - startedAtRef.current);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [running]);

    // Show the status console whenever a run is active or has produced output.
    useEffect(() => {
        if (running || events.length > 0) {
            setConfigMode(false);
        }
    }, [running, events.length]);

    useEffect(() => {
        void rpc.sendRequest(DcListSelfTestScenariosRequest.type).then((result) => {
            setCatalog(result);
            const active = result.connections.find((c) => c.mode === "active" && c.available);
            setConnectionId(active?.id ?? "none");
            setSelected(
                new Set(
                    result.scenarios
                        .filter((s) => !s.cliOnly && (!s.needsSql || active !== undefined))
                        .map((s) => s.id),
                ),
            );
        });
    }, [rpc]);

    const selectedConnection = catalog?.connections.find((c) => c.id === connectionId);
    const sqlEnabled =
        selectedConnection !== undefined &&
        selectedConnection.mode !== "none" &&
        (selectedConnection.available || selectedConnection.mode === "env");

    const doneReps = derived.reps.length;
    const progressPct =
        derived.totalReps > 0
            ? Math.min(100, Math.round((doneReps / derived.totalReps) * 100))
            : running
              ? 4
              : 0;

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
        setStatusTab("log");
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
                setConfigMode(true);
            }
        });
    };

    const requestCancel = () => {
        setCancelRequested(true);
        cancelSelfTest();
    };

    const runState = running
        ? cancelRequested
            ? "cancelling"
            : "running"
        : summary
          ? summary.runStatus === "failed"
              ? "failed"
              : "done"
          : events.some((e) => e.phase === "error")
            ? "failed"
            : "idle";

    return (
        <div className="dc-modal-overlay" onClick={onClose}>
            <div className="dc-modal st-wide" onClick={(e) => e.stopPropagation()}>
                <div className="dc-modal-header">
                    <div>
                        <h2>Run self-test</h2>
                        <div className="sub">
                            Runs perftest scenarios in this VS Code instance. Events stream into the
                            trace and waterfall live; results land in the perf history and attach as
                            a source when done.
                        </div>
                    </div>
                    <button className="dc-modal-close" onClick={onClose} title="Close">
                        ×
                    </button>
                </div>

                {configMode ? (
                    // ------------------------- CONFIG -------------------------
                    <div className="dc-modal-body">
                        <div>
                            {catalog?.unavailableReason ? (
                                <div className="ph-callout" style={{ marginBottom: 10 }}>
                                    <span className="ph-callout-icon">⚠</span>
                                    <span>{catalog.unavailableReason}</span>
                                </div>
                            ) : null}
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
                                        className="st-env-input"
                                        onChange={(e) => setEnvVarName(e.target.value)}
                                        placeholder="MSSQL_PERFTEST_CONNECTION_STRING"
                                        title="Environment variable holding a SQL connection string. The value is parsed in the extension host and never displayed, logged, or persisted."
                                    />
                                ) : null}
                            </div>
                            <div className="dc-scenario-list">
                                {catalog?.scenarios.map((scenario) => {
                                    const disabled =
                                        scenario.cliOnly === true ||
                                        (scenario.needsSql && !sqlEnabled);
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
                                                        <span className="dc-badge sql">
                                                            needs SQL
                                                        </span>
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
                                start — the dialog becomes a live status console, a status-bar
                                indicator shows progress even when editors cover this window, and
                                the console returns to the foreground when the run finishes.
                            </div>
                            {events.length > 0 ? (
                                <button
                                    className="dc-btn"
                                    style={{ marginTop: 10 }}
                                    onClick={() => setConfigMode(false)}>
                                    ← Back to last run status
                                </button>
                            ) : null}
                            {error ? (
                                <div
                                    style={{
                                        marginTop: 8,
                                        fontSize: 12,
                                        color: "var(--dc-error)",
                                    }}>
                                    {error}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    // ---------------------- STATUS CONSOLE ----------------------
                    <div className="st-status">
                        <div className="st-statusbar">
                            <span
                                className={`st-onair ${
                                    runState === "running"
                                        ? "live"
                                        : runState === "cancelling"
                                          ? "warn"
                                          : runState === "failed"
                                            ? "fail"
                                            : "ok"
                                }`}
                            />
                            <b className="st-state">
                                {runState === "running"
                                    ? "RUNNING"
                                    : runState === "cancelling"
                                      ? "CANCELLING…"
                                      : runState === "failed"
                                        ? "FAILED"
                                        : summary
                                          ? summary.runStatus.toUpperCase()
                                          : "DONE"}
                            </b>
                            {derived.currentScenario && running ? (
                                <span className="dc-mono st-current">
                                    [{derived.currentScenario.index + 1}/{derived.scenarioCount}]{" "}
                                    {derived.currentScenario.title}
                                </span>
                            ) : null}
                            <span style={{ flex: 1 }} />
                            <span className="dc-mono st-counters">
                                reps {doneReps}/{derived.totalReps || "?"} · elapsed{" "}
                                {formatElapsed(elapsedMs)}
                            </span>
                        </div>
                        <div className="dc-progress-track" style={{ margin: "0 0 6px" }}>
                            <div
                                className="dc-progress-fill"
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>

                        <div className="ph-bottom-tabs" style={{ marginBottom: 6 }}>
                            {(
                                [
                                    ["log", `Log ${events.length}`],
                                    ["reps", `Reps ${derived.reps.length}`],
                                    ["scenarios", `Scenarios ${derived.scenarios.length}`],
                                ] as Array<[StatusTab, string]>
                            ).map(([id, label]) => (
                                <button
                                    key={id}
                                    className={`ph-tab ${statusTab === id ? "active" : ""}`}
                                    onClick={() => setStatusTab(id)}>
                                    {label}
                                </button>
                            ))}
                            <span style={{ flex: 1 }} />
                            {summary ? (
                                <span className="dc-muted" style={{ fontSize: 11 }}>
                                    saved to{" "}
                                    <span className="dc-mono">
                                        {summary.perfRunsRoot || "(default)"}
                                    </span>
                                </span>
                            ) : null}
                        </div>

                        <div className="st-tab-body">
                            {statusTab === "log" ? (
                                <LogView events={events} />
                            ) : statusTab === "reps" ? (
                                <RepsTable reps={derived.reps} />
                            ) : (
                                <ScenariosTable scenarios={derived.scenarios} />
                            )}
                        </div>
                    </div>
                )}

                <div className="dc-modal-footer">
                    <span className="dc-muted" style={{ fontSize: 11.5 }}>
                        Local only · connection strings and passwords are never shown, logged, or
                        persisted · SQL text and rows are never captured.
                    </span>
                    <span className="spacer" />
                    {attachedSourceId && !running ? (
                        <>
                            <button className="dc-btn" onClick={() => openAttached("waterfall")}>
                                Open waterfall
                            </button>
                            <button className="dc-btn" onClick={() => openAttached("trace")}>
                                Open trace
                            </button>
                        </>
                    ) : null}
                    {!configMode && !running ? (
                        <button className="dc-btn" onClick={() => setConfigMode(true)}>
                            New run…
                        </button>
                    ) : null}
                    {running ? (
                        <button
                            className="dc-btn warn-chip"
                            disabled={cancelRequested}
                            onClick={requestCancel}>
                            {cancelRequested ? "Cancelling…" : "Cancel run"}
                        </button>
                    ) : null}
                    <button className="dc-btn" onClick={onClose}>
                        Close
                    </button>
                    {configMode ? (
                        <button className="dc-btn primary" onClick={launch} disabled={running}>
                            Run
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Status tabs
// ---------------------------------------------------------------------------

function LogView({ events }: { events: SelfTestProgress[] }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) {
            return;
        }
        // Stick to the bottom only when the user is already there — never yank
        // them back down while they're reading earlier output.
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
        if (nearBottom) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events.length]);
    return (
        <div className="dc-run-log st-fill" ref={wrapRef}>
            {events.map((event, index) => (
                <LogLine key={index} event={event} />
            ))}
            {events.length === 0 ? <span className="rl-muted">starting…</span> : null}
        </div>
    );
}

function RepsTable({ reps }: { reps: RepRow[] }) {
    if (reps.length === 0) {
        return <span className="dc-muted">No reps finished yet.</span>;
    }
    return (
        <div className="dc-table-wrap st-fill">
            <table className="dc-table ph-dense">
                <thead>
                    <tr>
                        <th>Scenario</th>
                        <th className="num">Rep</th>
                        <th>Warmup</th>
                        <th>Status</th>
                        <th className="num">Wallclock</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                    {reps.map((rep, index) => (
                        <tr key={index}>
                            <td className="dc-mono">{rep.scenarioId}</td>
                            <td className="num dc-mono">{rep.repId}</td>
                            <td className="dc-muted">{rep.warmup ? "warmup" : ""}</td>
                            <td>
                                <span
                                    className={`dc-pill ${
                                        rep.status === "passed"
                                            ? "ok"
                                            : rep.status === "failed"
                                              ? "error"
                                              : "warning"
                                    }`}>
                                    {rep.status}
                                </span>
                            </td>
                            <td className="num dc-mono">
                                {rep.wallclockMs !== undefined
                                    ? formatDuration(rep.wallclockMs)
                                    : "—"}
                            </td>
                            <td
                                className="dc-muted"
                                style={{ whiteSpace: "normal", maxWidth: 420 }}>
                                {rep.reason ?? ""}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ScenariosTable({ scenarios }: { scenarios: ScenarioRow[] }) {
    if (scenarios.length === 0) {
        return <span className="dc-muted">No scenarios started yet.</span>;
    }
    return (
        <div className="dc-table-wrap st-fill">
            <table className="dc-table ph-dense">
                <thead>
                    <tr>
                        <th>Scenario</th>
                        <th>State</th>
                        <th className="num">Passed</th>
                        <th className="num">Failed</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    {scenarios.map((scenario) => (
                        <tr key={scenario.scenarioId}>
                            <td>
                                <div>{scenario.title}</div>
                                <div className="dc-mono dc-muted" style={{ fontSize: 10.5 }}>
                                    {scenario.scenarioId}
                                </div>
                            </td>
                            <td>
                                <span
                                    className={`dc-pill ${
                                        scenario.state === "running"
                                            ? "info"
                                            : scenario.state === "skipped"
                                              ? "warning"
                                              : scenario.failed > 0
                                                ? "error"
                                                : "ok"
                                    }`}>
                                    {scenario.state === "done"
                                        ? scenario.failed > 0
                                            ? "failed"
                                            : "passed"
                                        : scenario.state}
                                </span>
                            </td>
                            <td className="num dc-mono">{scenario.passed}</td>
                            <td className="num dc-mono">{scenario.failed}</td>
                            <td
                                className="dc-muted"
                                style={{ whiteSpace: "normal", maxWidth: 460 }}>
                                {scenario.reason ?? ""}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
