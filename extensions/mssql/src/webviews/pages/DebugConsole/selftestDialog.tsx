/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Self-test run dialog: pick scenarios, set reps/options, launch a perftest run
 * in THIS VS Code instance, and watch the activity stream live. Results persist
 * to the perf-runs directory so the Perf & History pages pick them up.
 */

import { useEffect, useMemo, useState } from "react";
import {
    DcListSelfTestScenariosRequest,
    SelfTestCatalog,
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
                    </span>
                    <span className="rl-muted">
                        {wall ? `${wall.value.toFixed(0)}ms` : ""}
                        {event.reason ? ` — ${event.reason}` : ""}
                    </span>
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
                    <span className="rl-fail">✗ {event.message}</span>
                </div>
            );
        case "log":
            return (
                <div className="dc-run-line">
                    <span className="rl-muted">{event.message}</span>
                </div>
            );
        default:
            return null;
    }
}

export function SelfTestDialog({ onClose }: { onClose: () => void }) {
    const { rpc, selfTest, runSelfTest, cancelSelfTest } = useDc();
    const [catalog, setCatalog] = useState<SelfTestCatalog | undefined>(undefined);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [reps, setReps] = useState(3);
    const [warmup, setWarmup] = useState(1);
    const [elevate, setElevate] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        void rpc.sendRequest(DcListSelfTestScenariosRequest.type).then((result) => {
            setCatalog(result);
            // Default selection: everything that can run without a connection,
            // plus SQL scenarios only when a connection is available.
            setSelected(
                new Set(
                    result.scenarios
                        .filter((s) => !s.needsSql || result.connectionAvailable)
                        .map((s) => s.id),
                ),
            );
        });
    }, [rpc]);

    const running = selfTest?.active ?? false;
    const events = selfTest?.events ?? [];
    const summary = selfTest?.summary;

    const progress = useMemo(() => {
        // Rough completion fraction from rep-end vs total-reps.
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

    const launch = () => {
        setError(undefined);
        const scenarioIds = [...selected];
        if (scenarioIds.length === 0) {
            setError("Select at least one scenario.");
            return;
        }
        void runSelfTest({
            scenarioIds,
            repetitions: reps,
            warmupRepetitions: warmup,
            elevateCapture: elevate,
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
                            into the consolidated trace and waterfall live; results land in Perf &
                            History.
                        </div>
                    </div>
                    <button className="dc-modal-close" onClick={onClose} title="Close">
                        ×
                    </button>
                </div>

                <div className="dc-modal-body">
                    <div>
                        <div
                            style={{
                                fontSize: 11.5,
                                color: "var(--dc-muted)",
                                marginBottom: 8,
                            }}>
                            {catalog?.connectionAvailable ? (
                                <>
                                    Connection:{" "}
                                    <span className="dc-mono">{catalog.connectionLabel}</span> — SQL
                                    scenarios enabled.
                                </>
                            ) : (
                                <>
                                    No active connection detected. SQL scenarios are disabled — open
                                    a SQL editor, connect, then reopen this dialog to include them.
                                </>
                            )}
                        </div>
                        <div className="dc-scenario-list">
                            {catalog?.scenarios.map((scenario) => {
                                const disabled = scenario.needsSql && !catalog.connectionAvailable;
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
                                                {scenario.needsSql ? (
                                                    <span className="dc-badge sql">needs SQL</span>
                                                ) : null}
                                                <span className="dc-badge">
                                                    ~{Math.round(scenario.estMs)}ms
                                                </span>
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
                        <div className="dc-field">
                            <label>Measured repetitions (per scenario)</label>
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
                            <label>Warmup repetitions (not scored)</label>
                            <input
                                type="number"
                                min={0}
                                max={5}
                                value={warmup}
                                disabled={running}
                                onChange={(e) => setWarmup(Number(e.target.value))}
                            />
                        </div>
                        <label className="dc-check-row" style={{ marginBottom: 12 }}>
                            <input
                                type="checkbox"
                                checked={elevate}
                                disabled={running}
                                onChange={(e) => setElevate(e.target.checked)}
                            />
                            <span>
                                Elevate capture to <b>full</b> for this run (richer waterfall;
                                auto-reverts). Off by default — the run works at the current capture
                                mode.
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
                                }}>
                                Saved to{" "}
                                <span className="dc-mono">
                                    {summary.perfRunsRoot || "(default)"}
                                </span>
                                . Open <b>Perf &amp; Sessions</b> to compare against baselines.
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
                        Local only · no data leaves this machine · SQL text and rows are never
                        persisted.
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
