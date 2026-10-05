/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone run index.html (Phase-3 M14.4): one self-contained page per run
 * — KPIs, cross-process waterfall, metric plots, SQL activity, soak analysis,
 * validations, environment, artifacts. Regenerable from stored artifacts via
 * `perftest report <runId>`; zero external fetches.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Marker, PerfResult } from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";
import {
    analyzeSoak,
    extractIterations,
    linearFit,
    memorySeriesFromMarkers,
    type IterationRecord,
} from "../regression/soakAnalysis";
import {
    histogram,
    horizontalBars,
    trendChart,
    waterfall,
    TOKENS,
    type WaterfallLane,
} from "./charts";
import {
    chartCard,
    dataTable,
    esc,
    kpiRow,
    pageShell,
    pill,
    section,
    type Kpi,
    type PillKind,
} from "./htmlShell";

interface RepData {
    scenarioId: string;
    repId: number;
    repDirRel: string;
    result: PerfResult;
    markers: Marker[];
    sqlActivity: SqlEvent[] | undefined;
    iterations: IterationRecord[];
}

interface SqlEvent {
    event_name: string;
    ts_utc: string;
    duration_us: number | null;
    cpu_time_us: number | null;
    logical_reads: number | null;
    row_count: number | null;
    object_name: string | null;
    statement_text?: string | null;
    batch_text?: string | null;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function readJson<T>(path: string): T | undefined {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
        return undefined;
    }
}

function readJsonl<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    const items: T[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            items.push(JSON.parse(trimmed) as T);
        } catch {
            // tolerate partial lines
        }
    }
    return items;
}

function loadReps(runDir: string): RepData[] {
    const reps: RepData[] = [];
    const scenariosDir = join(runDir, "scenarios");
    if (!existsSync(scenariosDir)) return reps;
    for (const scenarioId of readdirSync(scenariosDir)) {
        const repsDir = join(scenariosDir, scenarioId, "reps");
        if (!existsSync(repsDir)) continue;
        for (const repName of readdirSync(repsDir)) {
            const repDir = join(repsDir, repName);
            const result = readJson<PerfResult>(join(repDir, "result.json"));
            if (!result) continue;
            const markers = readJsonl<Marker>(join(repDir, "markers.jsonl"));
            reps.push({
                scenarioId,
                repId: result.repId,
                repDirRel: `scenarios/${scenarioId}/reps/${repName}`,
                result,
                markers,
                sqlActivity: existsSync(join(repDir, "artifacts", "sql", "sql-activity.jsonl"))
                    ? readJsonl<SqlEvent>(join(repDir, "artifacts", "sql", "sql-activity.jsonl"))
                    : undefined,
                iterations: extractIterations(markers),
            });
        }
    }
    return reps.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.repId - b.repId);
}

// ---------------------------------------------------------------------------
// Waterfall construction (M14.2)
// ---------------------------------------------------------------------------

const IRREGULAR_PAIRS: Array<{ begin: string; end: string; name: string }> = [
    { begin: "scenario.start", end: "scenario.end", name: "scenario" },
    { begin: "mssql.connection.begin", end: "mssql.connection.ready", name: "connection" },
    { begin: "mssql.query.submit", end: "mssql.query.complete", name: "query" },
];

function nsToMs(ns: string): number {
    return Number(BigInt(ns)) / 1e6;
}

function laneLabelFor(marker: Marker): string {
    switch (marker.process.role) {
        case "extensionHost":
            return marker.process.name === "mssql-perf-driver"
                ? "driver (exthost)"
                : "vscode-mssql (exthost)";
        case "webview":
            return "webview (renderer)";
        case "sts":
            return "SQL Tools Service";
        default:
            return `${marker.process.role}`;
    }
}

export function buildWaterfall(rep: RepData): {
    lanes: WaterfallLane[];
    jitterMs?: number;
    note?: string;
} {
    const start = rep.markers.find((m) => m.name === "scenario.start");
    if (!start) return { lanes: [] };
    const originMs = nsToMs(start.timestampUnixNs);
    const lanes = new Map<string, WaterfallLane>();
    const laneOf = (label: string): WaterfallLane => {
        let lane = lanes.get(label);
        if (!lane) {
            lane = { label, bars: [] };
            lanes.set(label, lane);
        }
        return lane;
    };
    const colorFor = (name: string): string => {
        if (name.startsWith("scenario")) return TOKENS.muted;
        if (name.includes("connection")) return TOKENS.series[1]!;
        if (name.includes("query")) return TOKENS.series[0]!;
        if (name.includes("activate")) return TOKENS.series[3]!;
        if (name.includes("sts")) return TOKENS.series[4]!;
        if (name.includes("iteration")) return TOKENS.series[2]!;
        return TOKENS.info;
    };

    const used = new Set<number>();
    const addPair = (begin: Marker, end: Marker, name: string): void => {
        const samePlane =
            begin.process.pid === end.process.pid && begin.monotonicNs && end.monotonicNs;
        const startMs = nsToMs(begin.timestampUnixNs) - originMs;
        const durationMs = samePlane
            ? Number(BigInt(end.monotonicNs as string) - BigInt(begin.monotonicNs as string)) / 1e6
            : nsToMs(end.timestampUnixNs) - originMs - startMs;
        laneOf(laneLabelFor(begin)).bars.push({
            startMs,
            endMs: startMs + Math.max(0, durationMs),
            name,
            plane: samePlane ? "monotonic" : "epoch",
            color: colorFor(name),
        });
    };

    // Irregular pairs + generic X.begin→X.end pairing.
    for (const pairSpec of IRREGULAR_PAIRS) {
        const begin = rep.markers.find((m, i) => m.name === pairSpec.begin && !used.has(i));
        const end = rep.markers.find((m, i) => m.name === pairSpec.end && !used.has(i));
        if (begin && end) addPair(begin, end, pairSpec.name);
    }
    const beginStack = new Map<string, Marker>();
    rep.markers.forEach((marker) => {
        if (marker.phase === "begin" && marker.name.endsWith(".begin")) {
            beginStack.set(marker.name.slice(0, -6), marker);
        } else if (marker.phase === "end" && marker.name.endsWith(".end")) {
            const stem = marker.name.slice(0, -4);
            const begin = beginStack.get(stem);
            if (begin) {
                addPair(begin, marker, stem.replace(/^mssql\./, ""));
                beginStack.delete(stem);
            }
        }
    });

    // Iteration bars (soak): cap for readability.
    const ITER_CAP = 30;
    const iterations = rep.iterations.slice(0, ITER_CAP);
    for (const iteration of iterations) {
        laneOf("iterations (driver)").bars.push({
            startMs: nsToMs(iteration.startUnixNs) - originMs,
            endMs: nsToMs(iteration.endUnixNs) - originMs,
            name: `#${iteration.index}${iteration.status === "failed" ? " FAILED" : ""}`,
            plane: "monotonic",
            color: iteration.status === "failed" ? TOKENS.fail : TOKENS.series[2]!,
        });
    }

    // Webview render-complete instants as thin ticks.
    for (const marker of rep.markers
        .filter((m) => m.name === "mssql.resultsGrid.renderComplete")
        .slice(0, 50)) {
        const at = nsToMs(marker.timestampUnixNs) - originMs;
        laneOf("webview (renderer)").bars.push({
            startMs: at,
            endMs: at + 0.5,
            name: "renderComplete",
            plane: "epoch",
            color: TOKENS.series[5]!,
            detail: `rowCount=${String(marker.attrs?.["rowCount"] ?? "?")}`,
        });
    }

    // SQL commands (server clock — its own domain; labeled as such).
    if (rep.sqlActivity) {
        const top = rep.sqlActivity
            .filter(
                (e) => e.event_name === "rpc_completed" || e.event_name === "sql_batch_completed",
            )
            .sort((a, b) => (b.duration_us ?? 0) - (a.duration_us ?? 0))
            .slice(0, 40);
        for (const event of top) {
            const endMs = Date.parse(event.ts_utc) - originMs;
            const durMs = (event.duration_us ?? 0) / 1000;
            if (!Number.isFinite(endMs)) continue;
            laneOf("SQL Server (server clock)").bars.push({
                startMs: endMs - durMs,
                endMs,
                name: event.object_name ?? event.event_name,
                plane: "epoch",
                color: TOKENS.series[6]!,
                detail: `${event.logical_reads ?? 0} reads, ${event.row_count ?? 0} rows`,
            });
        }
    }

    const calibration = rep.result.validations.find((v) => v.name === "clockCalibration");
    const roundTripNs = (calibration?.details as { roundTripNs?: string } | undefined)?.roundTripNs;
    const order = [
        "scenario",
        "driver (exthost)",
        "iterations (driver)",
        "vscode-mssql (exthost)",
        "webview (renderer)",
        "SQL Tools Service",
        "SQL Server (server clock)",
    ];
    const sorted = [...lanes.values()]
        .filter((l) => l.bars.length > 0)
        .sort((a, b) => {
            const ai = order.findIndex((o) => a.label.startsWith(o.split(" ")[0]!));
            const bi = order.findIndex((o) => b.label.startsWith(o.split(" ")[0]!));
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        });
    return {
        lanes: sorted,
        ...(roundTripNs !== undefined ? { jitterMs: Number(BigInt(roundTripNs)) / 1e6 } : {}),
        ...(rep.iterations.length > ITER_CAP
            ? { note: `first ${ITER_CAP} of ${rep.iterations.length} iterations shown` }
            : {}),
    };
}

// ---------------------------------------------------------------------------
// Page composition
// ---------------------------------------------------------------------------

export function writeRunIndex(runDir: string, logger: HarnessLogger): string | undefined {
    const span = logger.span("report.runIndex", { runDir });
    try {
        const summary = readJson<{
            runId: string;
            passType: string;
            status: string;
            environmentHash: string;
        }>(join(runDir, "summary.json"));
        const environment = readJson<Record<string, unknown>>(join(runDir, "environment.json"));
        const reps = loadReps(runDir);
        if (!summary || reps.length === 0) {
            span.fail("missing summary or reps");
            return undefined;
        }
        const comparison = readJson<{
            status: string;
            baselineRunId: string;
            metrics: Array<{
                key: { scenarioId: string; name: string; unit: string };
                verdict: string;
                deltaPct?: number;
                reason: string;
            }>;
        }>(join(runDir, "comparison.json"));

        const statusKind: PillKind =
            summary.status === "passed" ? "ok" : summary.status === "failed" ? "fail" : "warn";
        const passed = reps.filter((r) => r.result.status === "passed").length;

        const kpis: Kpi[] = [
            { label: "Run status", value: summary.status.toUpperCase(), kind: statusKind },
            { label: "Pass type", value: summary.passType },
            {
                label: "Reps passed",
                value: `${passed}/${reps.length}`,
                kind: passed === reps.length ? "ok" : "warn",
            },
        ];
        for (const scenarioId of [...new Set(reps.map((r) => r.scenarioId))]) {
            const wallclocks = reps
                .filter((r) => r.scenarioId === scenarioId && r.result.status === "passed")
                .map((r) => r.result.metrics.find((m) => m.name === "scenario.wallclock")?.value)
                .filter((v): v is number => v !== undefined)
                .sort((a, b) => a - b);
            if (wallclocks.length > 0) {
                const median = wallclocks[Math.floor((wallclocks.length - 1) / 2)]!;
                kpis.push({
                    label: `${scenarioId} median`,
                    value: median >= 10000 ? (median / 1000).toFixed(1) : median.toFixed(1),
                    unit: median >= 10000 ? "s" : "ms",
                });
            }
        }

        const sections: string[] = [kpiRow(kpis)];

        // Comparison section
        if (comparison) {
            const rows = comparison.metrics.map((m) => [
                esc(m.key.scenarioId),
                `<span class="mono">${esc(m.key.name)}</span>`,
                m.deltaPct !== undefined
                    ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct.toFixed(1)}%`
                    : "—",
                pill(
                    m.verdict,
                    m.verdict === "regressed"
                        ? "fail"
                        : m.verdict === "improved"
                          ? "ok"
                          : m.verdict === "inconclusive"
                            ? "warn"
                            : "info",
                ),
                `<span class="muted">${esc(m.reason)}</span>`,
            ]);
            sections.push(
                section(
                    "Baseline comparison",
                    `vs ${comparison.baselineRunId}`,
                    dataTable(
                        [
                            { label: "Scenario" },
                            { label: "Metric" },
                            { label: "Δ", numeric: true },
                            { label: "Verdict" },
                            { label: "Why" },
                        ],
                        rows,
                    ),
                    {
                        pills: [
                            pill(
                                comparison.status.toUpperCase(),
                                comparison.status === "regressed"
                                    ? "fail"
                                    : comparison.status === "improved"
                                      ? "ok"
                                      : "info",
                            ),
                        ],
                    },
                ),
            );
        }

        // Per-scenario sections
        for (const scenarioId of [...new Set(reps.map((r) => r.scenarioId))]) {
            const scenarioReps = reps.filter((r) => r.scenarioId === scenarioId);
            const parts: string[] = [];

            // Waterfall from the most marker-rich passed rep (else first).
            const focus = [...scenarioReps].sort(
                (a, b) =>
                    (b.result.status === "passed" ? 1 : 0) -
                        (a.result.status === "passed" ? 1 : 0) ||
                    b.markers.length - a.markers.length,
            )[0]!;
            const wf = buildWaterfall(focus);
            if (wf.lanes.length > 0) {
                parts.push(
                    chartCard(
                        `Cross-process waterfall — rep ${focus.repId}`,
                        waterfall(wf.lanes, {
                            title: `waterfall ${scenarioId}`,
                            ...(wf.jitterMs !== undefined
                                ? { calibrationJitterMs: wf.jitterMs }
                                : {}),
                        }),
                        `Solid bars: official same-process monotonic intervals. Dashed: epoch-aligned diagnostic intervals (cross-clock; SQL Server lane uses the server's own clock). ${wf.note ?? ""}`,
                    ),
                );
            }

            const chartCards: string[] = [];
            const wallclocks = scenarioReps
                .filter((r) => r.result.status === "passed")
                .map((r) => r.result.metrics.find((m) => m.name === "scenario.wallclock")?.value)
                .filter((v): v is number => v !== undefined);
            if (wallclocks.length >= 3) {
                chartCards.push(
                    chartCard(
                        "Wallclock distribution",
                        histogram(wallclocks, { title: "wallclock", unit: "ms" }),
                    ),
                );
            }

            // Soak charts
            const soakRep = scenarioReps.find((r) => r.iterations.length > 0);
            if (soakRep) {
                const steady = soakRep.iterations.filter((i) => !i.warmup && i.status === "passed");
                const latencyFit = linearFit(steady.map((i) => ({ x: i.index, y: i.durationMs })));
                chartCards.push(
                    chartCard(
                        "Iteration latency",
                        trendChart(
                            steady.map((i) => ({
                                x: i.index,
                                y: i.durationMs,
                                label: `#${i.index}: ${i.durationMs.toFixed(1)}ms`,
                            })),
                            {
                                title: "latency trend",
                                xLabel: "iteration",
                                yLabel: "ms",
                                ...(latencyFit ? { fit: latencyFit } : {}),
                            },
                        ),
                    ),
                );
                const memory = memorySeriesFromMarkers(soakRep.markers, soakRep.iterations);
                const steadyMemory = memory.filter(
                    (p) => !soakRep.iterations.find((i) => i.index === p.iteration)?.warmup,
                );
                const memoryFit = linearFit(
                    steadyMemory.map((p) => ({ x: p.iteration, y: p.bytes / 1024 / 1024 })),
                );
                if (steadyMemory.length > 0) {
                    const analysis = analyzeSoak(soakRep.iterations, memory);
                    chartCards.push(
                        chartCard(
                            `Exthost RSS vs iteration${analysis.memory ? ` — verdict: ${analysis.memory.verdict}` : ""}`,
                            trendChart(
                                steadyMemory.map((p) => ({
                                    x: p.iteration,
                                    y: p.bytes / 1024 / 1024,
                                })),
                                {
                                    title: "rss trend",
                                    xLabel: "iteration",
                                    yLabel: "MB",
                                    ...(memoryFit ? { fit: memoryFit } : {}),
                                },
                            ),
                            analysis.memory?.reason,
                        ),
                    );
                }
            }

            // SQL top-N
            const sqlRep = scenarioReps.find((r) => r.sqlActivity && r.sqlActivity.length > 0);
            if (sqlRep?.sqlActivity) {
                const groups = new Map<
                    string,
                    { duration: number; reads: number; count: number }
                >();
                for (const event of sqlRep.sqlActivity.filter(
                    (e) =>
                        e.event_name === "rpc_completed" || e.event_name === "sql_batch_completed",
                )) {
                    const key =
                        event.object_name ??
                        (event.batch_text ?? event.statement_text ?? event.event_name)
                            .replace(/\s+/g, " ")
                            .slice(0, 60);
                    const group = groups.get(key) ?? { duration: 0, reads: 0, count: 0 };
                    group.duration += (event.duration_us ?? 0) / 1000;
                    group.reads += event.logical_reads ?? 0;
                    group.count += 1;
                    groups.set(key, group);
                }
                const top = [...groups.entries()]
                    .sort((a, b) => b[1].duration - a[1].duration)
                    .slice(0, 12);
                chartCards.push(
                    chartCard(
                        "SQL commands by total duration",
                        horizontalBars(
                            top.map(([label, g]) => ({
                                label: `${g.count}x ${label}`,
                                value: Number(g.duration.toFixed(1)),
                                detail: `${g.reads} logical reads`,
                            })),
                            { title: "sql top", unit: "ms" },
                        ),
                    ),
                );
            }
            if (chartCards.length > 0) {
                parts.push(
                    `<div class="spacer"></div><div class="chart-grid">${chartCards.join("")}</div>`,
                );
            }

            // Rep table
            parts.push('<div class="spacer"></div>');
            parts.push(
                dataTable(
                    [
                        { label: "Rep" },
                        { label: "Status" },
                        { label: "wallclock (ms)", numeric: true },
                        { label: "Official" },
                        { label: "Component metrics" },
                        { label: "Artifacts" },
                    ],
                    scenarioReps.map((rep) => {
                        const wallclock = rep.result.metrics.find(
                            (m) => m.name === "scenario.wallclock",
                        );
                        const others = rep.result.metrics
                            .filter((m) => m.name !== "scenario.wallclock" && m.unit === "ms")
                            .slice(0, 6)
                            .map(
                                (m) =>
                                    `<span class="mono">${esc(m.name)}</span>: ${m.value.toFixed(1)}`,
                            )
                            .join("<br>");
                        return [
                            String(rep.repId),
                            pill(
                                rep.result.status,
                                rep.result.status === "passed"
                                    ? "ok"
                                    : rep.result.status === "failed"
                                      ? "fail"
                                      : "warn",
                            ),
                            wallclock ? wallclock.value.toFixed(1) : "—",
                            wallclock?.official ? "yes" : "no",
                            others || "—",
                            `<a href="${rep.repDirRel}/result.json">result</a> · <a href="${rep.repDirRel}/markers.jsonl">markers</a>`,
                        ];
                    }),
                ),
            );

            // Validation issues
            const issues = scenarioReps.flatMap((rep) =>
                rep.result.validations
                    .filter((v) => v.status === "failed" || v.status === "warning")
                    .map(
                        (v) =>
                            `<li>rep ${rep.repId}: ${pill(v.status, v.status === "failed" ? "fail" : "warn")} <span class="mono">${esc(v.name)}</span>${v.message ? ` — ${esc(v.message)}` : ""}</li>`,
                    ),
            );
            if (issues.length > 0) {
                parts.push(
                    `<div class="spacer"></div><h3>Validation notes</h3><ul>${issues.join("")}</ul>`,
                );
            }

            const scenarioStatus = scenarioReps.every((r) => r.result.status === "passed")
                ? "ok"
                : scenarioReps.some((r) => r.result.status === "failed")
                  ? "fail"
                  : "warn";
            sections.push(
                section(scenarioId, `${scenarioReps.length} rep(s)`, parts.join(""), {
                    pills: [
                        pill(
                            scenarioStatus === "ok" ? "all passed" : "issues",
                            scenarioStatus as PillKind,
                        ),
                    ],
                }),
            );
        }

        // Environment + artifacts
        sections.push(
            section(
                "Environment",
                summary.environmentHash.slice(0, 24) + "…",
                `<pre class="mono" style="margin:0;white-space:pre-wrap;">${esc(JSON.stringify(environment ?? {}, null, 2))}</pre>`,
                { open: false },
            ),
        );
        sections.push(
            section(
                "Run artifacts",
                "",
                `<ul>` +
                    `<li><a href="report.md">report.md</a> · <a href="summary.json">summary.json</a> · <a href="harness-log.jsonl">harness-log.jsonl</a> · <a href="run-config.snapshot.jsonc">config snapshot</a>${existsSync(join(runDir, "comparison.json")) ? ' · <a href="comparison.json">comparison.json</a>' : ""}${existsSync(join(runDir, "investigation.json")) ? ' · <a href="investigation.json">investigation.json</a>' : ""}</li>` +
                    reps
                        .flatMap((rep) =>
                            rep.result.artifacts.map(
                                (a) =>
                                    `<li class="mono">${esc(rep.scenarioId)} rep ${rep.repId}: <a href="${rep.repDirRel}/${esc(a.path)}">${esc(a.kind)}</a></li>`,
                            ),
                        )
                        .join("") +
                    `</ul>`,
                { open: false },
            ),
        );

        const html = pageShell({
            title: "perftest run",
            subtitle: `${summary.runId} · ${summary.passType} pass · env ${summary.environmentHash.slice(0, 18)}…`,
            statusPill: { label: summary.status.toUpperCase(), kind: statusKind },
            body: sections.join("\n"),
        });
        const outPath = join(runDir, "index.html");
        writeFileSync(outPath, html, "utf8");
        span.end({ reps: reps.length, bytes: html.length });
        return outPath;
    } catch (error) {
        span.fail(error);
        return undefined;
    }
}
