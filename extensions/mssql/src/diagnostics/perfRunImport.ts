/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-harness run import: maps a perftest run directory (markers.jsonl,
 * result.json, sql-activity.jsonl) into diagnostic events so the Debug
 * Console renders harness runs with the same pages as live sessions.
 * Harness data is synthetic by contract, so text fields import as plain.
 */

import * as fs from "fs";
import * as path from "path";
import {
    DIAG_SCHEMA_VERSION,
    DiagEvent,
    DiagProcess,
    PerfMetricSample,
} from "../sharedInterfaces/debugConsole";

interface HarnessMarker {
    runId: string;
    name: string;
    phase: string;
    correlationId?: string;
    timestampUnixNs: string;
    monotonicNs: string;
    process: { role: string; pid: number; name: string };
    attrs?: Record<string, string | number | boolean | null>;
}

function processFor(role: string): DiagProcess {
    switch (role) {
        case "extensionHost":
            return "extensionHost";
        case "webview":
            return "webview";
        case "sts":
            return "sqlToolsService";
        default:
            return "harness";
    }
}

function featureFor(name: string): string {
    if (name.startsWith("mssql.connection") || name.startsWith("mssql.sts")) return "connection";
    if (name.startsWith("mssql.query")) return "query";
    if (name.startsWith("mssql.resultsGrid")) return "resultsGrid";
    if (name.startsWith("mssql.oe")) return "objectExplorer";
    if (name.startsWith("scenario") || name.startsWith("driver") || name.startsWith("iteration"))
        return "harness";
    if (name.startsWith("exthost.")) return "system";
    return "system";
}

/**
 * Import one rep directory. Returns unified events sorted by time; traceId is
 * the scenario correlation (all markers of one rep share the rep trace).
 */
export function importPerfRep(repDir: string, repLabel: string): DiagEvent[] {
    const events: DiagEvent[] = [];
    let seq = 0;
    const traceId = `perf_${repLabel.replace(/[^a-z0-9]/gi, "_")}`;

    const markersPath = path.join(repDir, "markers.jsonl");
    if (fs.existsSync(markersPath)) {
        for (const line of fs.readFileSync(markersPath, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const marker = JSON.parse(trimmed) as HarnessMarker;
                const epochMs = Number(BigInt(marker.timestampUnixNs) / 1000000n);
                seq++;
                const event: DiagEvent = {
                    schemaVersion: DIAG_SCHEMA_VERSION,
                    eventId: `imp_${seq.toString(36).padStart(6, "0")}`,
                    sessionId: traceId,
                    seq,
                    epochMs,
                    monotonicNs: marker.monotonicNs,
                    process: processFor(marker.process.role),
                    pid: marker.process.pid,
                    feature: featureFor(marker.name),
                    kind: marker.phase === "counter" ? "metric" : "event",
                    type: marker.name,
                    status: marker.attrs?.["error"] === true ? "error" : "ok",
                    traceId,
                    cls: {
                        max: "diagnostic.metadata",
                        redactedFields: 0,
                        policyId: "policy_perf_import",
                    },
                    tags: ["imported", `phase:${marker.phase}`],
                };
                if (marker.attrs) {
                    event.payload = {};
                    for (const [key, value] of Object.entries(marker.attrs)) {
                        event.payload[key] = {
                            v: value,
                            cls: "diagnostic.metadata",
                            handling: "plain",
                        };
                    }
                }
                events.push(event);
            } catch {
                // skip malformed line
            }
        }
    }

    const sqlPath = path.join(repDir, "artifacts", "sql", "sql-activity.jsonl");
    if (fs.existsSync(sqlPath)) {
        for (const line of fs.readFileSync(sqlPath, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const row = JSON.parse(trimmed) as {
                    event_name: string;
                    ts_utc: string;
                    duration_us: number | null;
                    cpu_time_us: number | null;
                    logical_reads: number | null;
                    row_count: number | null;
                    batch_text?: string | null;
                    statement_text?: string | null;
                };
                const epochMs = Date.parse(row.ts_utc);
                if (!Number.isFinite(epochMs)) continue;
                seq++;
                const durationMs =
                    row.duration_us !== null
                        ? Number((row.duration_us / 1000).toFixed(2))
                        : undefined;
                const text = row.batch_text ?? row.statement_text;
                events.push({
                    schemaVersion: DIAG_SCHEMA_VERSION,
                    eventId: `imp_${seq.toString(36).padStart(6, "0")}`,
                    sessionId: traceId,
                    seq,
                    epochMs,
                    process: "sqlServer",
                    feature: "query",
                    kind: "sqlActivity",
                    type: `sql.${row.event_name}`,
                    status: "ok",
                    traceId,
                    ...(durationMs !== undefined ? { durationMs } : {}),
                    timingClass: "collectorDiagnostic",
                    payload: {
                        ...(durationMs !== undefined
                            ? {
                                  durationMs: {
                                      v: durationMs,
                                      cls: "diagnostic.metadata" as const,
                                      handling: "plain" as const,
                                  },
                              }
                            : {}),
                        ...(row.cpu_time_us !== null
                            ? {
                                  cpuMs: {
                                      v: Number((row.cpu_time_us / 1000).toFixed(2)),
                                      cls: "diagnostic.metadata" as const,
                                      handling: "plain" as const,
                                  },
                              }
                            : {}),
                        ...(row.logical_reads !== null
                            ? {
                                  logicalReads: {
                                      v: row.logical_reads,
                                      cls: "diagnostic.metadata" as const,
                                      handling: "plain" as const,
                                  },
                              }
                            : {}),
                        ...(row.row_count !== null
                            ? {
                                  rowCount: {
                                      v: row.row_count,
                                      cls: "diagnostic.metadata" as const,
                                      handling: "plain" as const,
                                  },
                              }
                            : {}),
                        text: text
                            ? // Synthetic harness DB: plain by contract, truncated for sanity.
                              {
                                  v: text.slice(0, 500),
                                  cls: "sql.text" as const,
                                  handling:
                                      text.length > 500
                                          ? ("truncated" as const)
                                          : ("plain" as const),
                                  len: text.length,
                              }
                            : { cls: "sql.text" as const, handling: "omitted" as const },
                    },
                    cls: { max: "sql.text", redactedFields: 0, policyId: "policy_perf_import" },
                    tags: ["imported", "synthetic"],
                });
            } catch {
                // skip malformed line
            }
        }
    }
    return events
        .sort((a, b) => a.epochMs - b.epochMs)
        .map((event, index) => ({ ...event, seq: index + 1 }));
}

/** Find the most marker-rich rep of a run directory. */
export function importPerfRun(runDir: string): { label: string; events: DiagEvent[] } | undefined {
    const scenariosDir = path.join(runDir, "scenarios");
    if (!fs.existsSync(scenariosDir)) {
        return undefined;
    }
    let best: { repDir: string; label: string; size: number } | undefined;
    for (const scenario of fs.readdirSync(scenariosDir)) {
        const repsDir = path.join(scenariosDir, scenario, "reps");
        if (!fs.existsSync(repsDir)) continue;
        for (const rep of fs.readdirSync(repsDir)) {
            const markers = path.join(repsDir, rep, "markers.jsonl");
            if (fs.existsSync(markers)) {
                const size = fs.statSync(markers).size;
                if (!best || size > best.size) {
                    best = {
                        repDir: path.join(repsDir, rep),
                        label: `${scenario}/${rep}`,
                        size,
                    };
                }
            }
        }
    }
    if (!best) {
        return undefined;
    }
    const runLabel = `Perf run: ${path.basename(runDir)} (${best.label})`;
    return {
        label: runLabel,
        events: importPerfRep(best.repDir, `${path.basename(runDir)}_${best.label}`),
    };
}

/** Read official metric samples from a perftest SQLite db is out of scope for
 *  v1 (no native dep); trend data imports from run summary/result JSON files. */
export function importPerfMetrics(perfRunsRoot: string): PerfMetricSample[] {
    const samples: PerfMetricSample[] = [];
    if (!fs.existsSync(perfRunsRoot)) {
        return samples;
    }
    for (const runName of fs.readdirSync(perfRunsRoot).sort()) {
        const runDir = path.join(perfRunsRoot, runName);
        const scenariosDir = path.join(runDir, "scenarios");
        if (!fs.existsSync(scenariosDir)) continue;
        let createdUtc = "";
        try {
            const summary = JSON.parse(
                fs.readFileSync(path.join(runDir, "summary.json"), "utf8"),
            ) as { runId: string; status: string };
            if (summary.status !== "passed") continue;
            createdUtc = runName.slice(0, 20);
        } catch {
            continue;
        }
        for (const scenario of fs.readdirSync(scenariosDir)) {
            const repsDir = path.join(scenariosDir, scenario, "reps");
            if (!fs.existsSync(repsDir)) continue;
            for (const rep of fs.readdirSync(repsDir)) {
                try {
                    const result = JSON.parse(
                        fs.readFileSync(path.join(repsDir, rep, "result.json"), "utf8"),
                    ) as {
                        status: string;
                        warmup?: boolean;
                        metrics: Array<{
                            name: string;
                            value: number;
                            unit: string;
                            official: boolean;
                        }>;
                    };
                    if (result.status !== "passed" || result.warmup) continue;
                    for (const metric of result.metrics) {
                        samples.push({
                            runId: runName,
                            createdUtc,
                            scenarioId: scenario,
                            metricName: metric.name,
                            unit: metric.unit,
                            value: metric.value,
                            official: metric.official,
                        });
                    }
                } catch {
                    // skip rep
                }
            }
        }
    }
    return samples;
}
