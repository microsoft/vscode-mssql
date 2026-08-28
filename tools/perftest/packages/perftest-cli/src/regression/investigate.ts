/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Investigation diff (Phase-2 M11): turn before/after into "what changed",
 * spanning official AND diagnostic signals — while gating stays driven only
 * by the official comparison. The headline is the SQL-activity delta:
 * commands added/removed and per-command duration/reads/row deltas.
 *
 * Everything here is explicitly non-gating investigation context.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PerfStore } from "../store/sqliteStore";
import type { HarnessLogger } from "../telemetry/logger";

export interface SqlCommandGroup {
    key: string;
    count: number;
    durationMs: number;
    logicalReads: number;
    rows: number;
}

export interface SqlActivityDelta {
    scenarioId: string;
    baselineCommands: number;
    candidateCommands: number;
    added: SqlCommandGroup[];
    removed: SqlCommandGroup[];
    changed: Array<{
        key: string;
        baseline: SqlCommandGroup;
        candidate: SqlCommandGroup;
        countDelta: number;
        durationDeltaMs: number;
        readsDelta: number;
    }>;
    note?: string;
}

export interface MetricDelta {
    scenarioId: string;
    name: string;
    component: string;
    unit: string;
    official: boolean;
    baseline: number;
    candidate: number;
    deltaAbs: number;
    deltaPct?: number;
}

export interface Investigation {
    baselineRunId: string;
    candidateRunId: string;
    git: {
        baseline: Array<{ repo: string; sha: string; branch?: string; dirty: boolean }>;
        candidate: Array<{ repo: string; sha: string; branch?: string; dirty: boolean }>;
    };
    sqlActivity: SqlActivityDelta[];
    metricDeltas: MetricDelta[];
    notes: string[];
}

export function investigate(
    store: PerfStore,
    baselineRunId: string,
    candidateRunId: string,
    logger: HarnessLogger,
): Investigation {
    const span = logger.span("investigate", { baselineRunId, candidateRunId });
    const notes: string[] = [];

    const baseline = store.getRun(baselineRunId);
    const candidate = store.getRun(candidateRunId);
    if (!baseline || !candidate) {
        throw new Error("Both runs must exist in the store for an investigation diff");
    }

    // --- Metric deltas across official + diagnostic ---------------------------
    const baseMetrics = store.metricMedians(baselineRunId);
    const candMetrics = store.metricMedians(candidateRunId);
    const keyOf = (m: {
        scenarioId: string;
        name: string;
        component: string;
        unit: string;
    }): string => `${m.scenarioId}|${m.name}|${m.component}|${m.unit}`;
    const baseByKey = new Map(baseMetrics.map((m) => [keyOf(m), m]));
    const metricDeltas: MetricDelta[] = [];
    for (const cand of candMetrics) {
        const base = baseByKey.get(keyOf(cand));
        if (!base) continue;
        const deltaAbs = cand.median - base.median;
        metricDeltas.push({
            scenarioId: cand.scenarioId,
            name: cand.name,
            component: cand.component,
            unit: cand.unit,
            official: cand.official,
            baseline: Number(base.median.toFixed(3)),
            candidate: Number(cand.median.toFixed(3)),
            deltaAbs: Number(deltaAbs.toFixed(3)),
            ...(base.median !== 0
                ? { deltaPct: Number(((deltaAbs / base.median) * 100).toFixed(1)) }
                : {}),
        });
    }
    metricDeltas.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));

    // --- SQL activity delta (the headline) -------------------------------------
    const sqlActivity: SqlActivityDelta[] = [];
    const scenarios = new Set<string>([
        ...baseMetrics.map((m) => m.scenarioId),
        ...candMetrics.map((m) => m.scenarioId),
    ]);
    for (const scenarioId of scenarios) {
        const baseGroups = loadSqlActivityGroups(baseline.outputDir, scenarioId);
        const candGroups = loadSqlActivityGroups(candidate.outputDir, scenarioId);
        if (!baseGroups && !candGroups) continue;
        if (!baseGroups || !candGroups) {
            sqlActivity.push({
                scenarioId,
                baselineCommands: baseGroups ? sumCount(baseGroups) : 0,
                candidateCommands: candGroups ? sumCount(candGroups) : 0,
                added: [],
                removed: [],
                changed: [],
                note: `sql-activity captured only in the ${baseGroups ? "baseline" : "candidate"} run — enable sqlServerXEvents in both for a command-level diff`,
            });
            continue;
        }
        const added: SqlCommandGroup[] = [];
        const removed: SqlCommandGroup[] = [];
        const changed: SqlActivityDelta["changed"] = [];
        for (const [key, cand] of candGroups) {
            const base = baseGroups.get(key);
            if (!base) {
                added.push(cand);
            } else if (
                base.count !== cand.count ||
                Math.abs(cand.durationMs - base.durationMs) > Math.max(5, base.durationMs * 0.25) ||
                Math.abs(cand.logicalReads - base.logicalReads) >
                    Math.max(50, base.logicalReads * 0.25)
            ) {
                changed.push({
                    key,
                    baseline: base,
                    candidate: cand,
                    countDelta: cand.count - base.count,
                    durationDeltaMs: Number((cand.durationMs - base.durationMs).toFixed(2)),
                    readsDelta: cand.logicalReads - base.logicalReads,
                });
            }
        }
        for (const [key, base] of baseGroups) {
            if (!candGroups.has(key)) removed.push(base);
        }
        changed.sort((a, b) => Math.abs(b.durationDeltaMs) - Math.abs(a.durationDeltaMs));
        sqlActivity.push({
            scenarioId,
            baselineCommands: sumCount(baseGroups),
            candidateCommands: sumCount(candGroups),
            added: added.sort((a, b) => b.durationMs - a.durationMs),
            removed: removed.sort((a, b) => b.durationMs - a.durationMs),
            changed,
        });
    }
    if (sqlActivity.length === 0) {
        notes.push(
            "no sql-activity.jsonl in either run — run both with diagnostics.sqlServerXEvents for the command-level diff",
        );
    }

    const investigation: Investigation = {
        baselineRunId,
        candidateRunId,
        git: {
            baseline: store.gitContext(baselineRunId),
            candidate: store.gitContext(candidateRunId),
        },
        sqlActivity,
        metricDeltas,
        notes,
    };
    span.end({
        scenarios: sqlActivity.length,
        metricDeltas: metricDeltas.length,
    });
    return investigation;
}

function sumCount(groups: Map<string, SqlCommandGroup>): number {
    let total = 0;
    for (const group of groups.values()) total += group.count;
    return total;
}

/**
 * Load and group a scenario's SQL activity from the latest rep that captured
 * it. Grouping key: object name when present, else the normalized first 100
 * chars of the statement/batch text (whitespace collapsed, numbers
 * parameterized) — stable across runs of the same workload.
 */
function loadSqlActivityGroups(
    outputDir: string,
    scenarioId: string,
): Map<string, SqlCommandGroup> | undefined {
    const repsDir = join(outputDir, "scenarios", scenarioId, "reps");
    if (!existsSync(repsDir)) return undefined;
    const reps = readdirSync(repsDir).sort().reverse();
    for (const rep of reps) {
        const path = join(repsDir, rep, "artifacts", "sql", "sql-activity.jsonl");
        if (!existsSync(path)) continue;
        const groups = new Map<string, SqlCommandGroup>();
        for (const line of readFileSync(path, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: {
                event_name?: string;
                object_name?: string | null;
                statement_text?: string | null;
                batch_text?: string | null;
                duration_us?: number | null;
                logical_reads?: number | null;
                row_count?: number | null;
            };
            try {
                event = JSON.parse(trimmed) as typeof event;
            } catch {
                continue;
            }
            // Top-level commands only (statement events double-count their parents).
            if (
                event.event_name !== "rpc_completed" &&
                event.event_name !== "sql_batch_completed"
            ) {
                continue;
            }
            const key = commandKey(event);
            const group = groups.get(key) ?? {
                key,
                count: 0,
                durationMs: 0,
                logicalReads: 0,
                rows: 0,
            };
            group.count += 1;
            group.durationMs += (event.duration_us ?? 0) / 1000;
            group.logicalReads += event.logical_reads ?? 0;
            group.rows += event.row_count ?? 0;
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            group.durationMs = Number(group.durationMs.toFixed(2));
        }
        return groups;
    }
    return undefined;
}

function commandKey(event: {
    object_name?: string | null;
    statement_text?: string | null;
    batch_text?: string | null;
}): string {
    const text = event.statement_text ?? event.batch_text;
    if (text) {
        return text
            .replace(/\s+/g, " ")
            .replace(/'[^']*'/g, "'?'")
            .replace(/\b\d+\b/g, "?")
            .trim()
            .slice(0, 100);
    }
    return event.object_name ?? "(unknown)";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderInvestigationConsole(inv: Investigation): string {
    const lines: string[] = [];
    lines.push("");
    lines.push("=== INVESTIGATION (non-gating) ===");
    lines.push(
        `Code: baseline ${fmtGit(inv.git.baseline)} → candidate ${fmtGit(inv.git.candidate)}`,
    );
    for (const activity of inv.sqlActivity) {
        lines.push("");
        lines.push(
            `SQL activity — ${activity.scenarioId}: ${activity.baselineCommands} → ${activity.candidateCommands} commands`,
        );
        if (activity.note) {
            lines.push(`  note: ${activity.note}`);
        }
        for (const added of activity.added.slice(0, 10)) {
            lines.push(
                `  + ADDED   ${added.count}x ${added.key.slice(0, 70)} (${added.durationMs}ms, ${added.logicalReads} reads)`,
            );
        }
        for (const removed of activity.removed.slice(0, 10)) {
            lines.push(`  - REMOVED ${removed.count}x ${removed.key.slice(0, 70)}`);
        }
        for (const change of activity.changed.slice(0, 10)) {
            const parts: string[] = [];
            if (change.countDelta !== 0)
                parts.push(`${change.countDelta > 0 ? "+" : ""}${change.countDelta} round-trip(s)`);
            if (Math.abs(change.durationDeltaMs) > 1)
                parts.push(`${change.durationDeltaMs > 0 ? "+" : ""}${change.durationDeltaMs}ms`);
            if (change.readsDelta !== 0)
                parts.push(`${change.readsDelta > 0 ? "+" : ""}${change.readsDelta} reads`);
            lines.push(`  ~ CHANGED ${change.key.slice(0, 60)}: ${parts.join(", ")}`);
        }
        if (
            activity.added.length === 0 &&
            activity.removed.length === 0 &&
            activity.changed.length === 0 &&
            !activity.note
        ) {
            lines.push("  no command-level differences");
        }
    }
    const interesting = inv.metricDeltas.filter(
        (d) => Math.abs(d.deltaPct ?? 0) >= 5 && Math.abs(d.deltaAbs) >= 1,
    );
    if (interesting.length > 0) {
        lines.push("");
        lines.push("Metric deltas (official + diagnostic, |Δ| ≥ 5% and ≥ 1 unit):");
        for (const delta of interesting.slice(0, 20)) {
            lines.push(
                `  ${delta.official ? "[official]  " : "[diagnostic]"} ${delta.scenarioId}/${delta.name}: ${delta.baseline} → ${delta.candidate} ${delta.unit} (${(delta.deltaPct ?? 0) > 0 ? "+" : ""}${delta.deltaPct}%)`,
            );
        }
    }
    for (const note of inv.notes) {
        lines.push(`note: ${note}`);
    }
    return lines.join("\n");
}

function fmtGit(repos: Array<{ repo: string; sha: string; dirty: boolean }>): string {
    return (
        repos
            .filter((r) => r.repo !== "perftest")
            .map((r) => `${r.repo}@${r.sha.slice(0, 8)}${r.dirty ? "+dirty" : ""}`)
            .join(",") || "unknown"
    );
}
