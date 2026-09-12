/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-harness run import: maps a perftest run directory (markers.jsonl,
 * result.json, sql-activity.jsonl) into diagnostic events so the Debug
 * Console renders harness runs with the same pages as live sessions.
 *
 * Imports are untrusted input. Marker attrs are contract-governed metadata
 * and import plain; SQL text from sql-activity.jsonl is REAL query text
 * whenever the harness ran with captureSqlText against a real server, so it
 * goes through the normal sql.text policy (digest — grouping survives,
 * plaintext never enters diagnostics). Files are read under a size cap and
 * every line under a UTF-8 byte cap before anything is parsed.
 */

import * as fs from "fs";
import * as path from "path";
import {
    DIAG_SCHEMA_VERSION,
    DiagEvent,
    DiagProcess,
    PerfMetricSample,
    PerfRunInfo,
} from "../sharedInterfaces/debugConsole";
import { CAPTURE_POLICIES, classify } from "./redaction";

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
/** Imports are untrusted: refuse absurd single lines outright (UTF-8 bytes). */
export const MAX_MARKER_LINE_BYTES = 512 * 1024;
/**
 * Whole-file cap. A soak rep accumulates every iteration's markers in one
 * file, and readFileSync above ~512 MB throws ERR_STRING_TOO_LONG on the
 * extension host; refuse honestly instead.
 */
export const MAX_JSONL_FILE_BYTES = 64 * 1024 * 1024;

export interface BoundedJsonl {
    /** Non-empty, trimmed lines within the per-line byte cap. */
    lines: string[];
    /** Lines refused for exceeding MAX_MARKER_LINE_BYTES. */
    refusedLines: number;
    /** Set when the whole file was refused; `lines` is then empty. */
    refusedReason?: string;
}

/**
 * Read a JSONL artifact with both bounds enforced BEFORE parsing: the file
 * size (never a soak-sized markers.jsonl into a string) and each line's
 * UTF-8 byte length (not UTF-16 code units).
 */
export function readJsonlBounded(file: string, maxFileBytes = MAX_JSONL_FILE_BYTES): BoundedJsonl {
    let size: number;
    try {
        size = fs.statSync(file).size;
    } catch {
        return { lines: [], refusedLines: 0, refusedReason: "unreadable" };
    }
    if (size > maxFileBytes) {
        return {
            lines: [],
            refusedLines: 0,
            refusedReason: `file is ${size} bytes, over the ${maxFileBytes}-byte import cap`,
        };
    }
    const lines: string[] = [];
    let refusedLines = 0;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (Buffer.byteLength(trimmed, "utf8") > MAX_MARKER_LINE_BYTES) {
            refusedLines++;
            continue;
        }
        lines.push(trimmed);
    }
    return { lines, refusedLines };
}

/** Minimal JSONC reader for run-config.snapshot.jsonc (comments + trailing commas). */
export function parseJsonc(text: string): unknown {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            out += ch;
        } else if (ch === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
        } else if (ch === "/" && text[i + 1] === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
            i++;
        } else {
            out += ch;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Warmup reps are NOT flagged in result.json: the harness's own loader
 * derives them as `repId < config.warmupRepetitions` from the run's config
 * snapshot (perftest-cli runLoader.ts). Mirror that here so in-product
 * aggregates match `perftest history`.
 */
export function readWarmupRepetitions(runDir: string): number {
    try {
        const config = parseJsonc(
            fs.readFileSync(path.join(runDir, "run-config.snapshot.jsonc"), "utf8"),
        ) as { warmupRepetitions?: unknown } | undefined;
        const value = config?.warmupRepetitions;
        return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
    } catch {
        return 0;
    }
}

export function isWarmupRep(
    result: { warmup?: unknown },
    repId: number,
    warmupRepetitions: number,
): boolean {
    return result.warmup === true || repId < warmupRepetitions;
}

/** Rep id from result.json, else from the `rep-NN` directory name; undefined when neither parses. */
export function repIdFrom(repName: string, result: { repId?: unknown }): number | undefined {
    if (typeof result.repId === "number" && Number.isInteger(result.repId) && result.repId >= 0) {
        return result.repId;
    }
    const match = /^rep-(\d+)$/.exec(repName);
    return match ? Number(match[1]) : undefined;
}

/** The harness records failures in `errors[]`; `failureReason` is a courtesy alias. */
export function failureReasonOf(result: {
    failureReason?: unknown;
    errors?: unknown;
}): string | undefined {
    if (typeof result.failureReason === "string" && result.failureReason.length > 0) {
        return result.failureReason.slice(0, 200);
    }
    if (Array.isArray(result.errors)) {
        const first = result.errors.find(
            (e): e is { message: string } =>
                typeof e === "object" &&
                e !== null &&
                typeof (e as { message?: unknown }).message === "string",
        );
        if (first) {
            return first.message.slice(0, 200);
        }
    }
    return undefined;
}

export function importPerfRep(repDir: string, repLabel: string): DiagEvent[] {
    const events: DiagEvent[] = [];
    let seq = 0;
    const traceId = `perf_${repLabel.replace(/[^a-z0-9]/gi, "_")}`;

    const markersPath = path.join(repDir, "markers.jsonl");
    if (fs.existsSync(markersPath)) {
        const bounded = readJsonlBounded(markersPath);
        let skippedLines = bounded.refusedLines;
        for (const trimmed of bounded.lines) {
            try {
                const marker = JSON.parse(trimmed) as HarnessMarker;
                if (typeof marker.name !== "string" || typeof marker.timestampUnixNs !== "string") {
                    skippedLines++;
                    continue;
                }
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
                // Forwarded diagnostic spans (STS dispatcher/SqlCommand/SMO/
                // DacFx) travel as instant markers with a durationMs attr —
                // lift it so the waterfall renders them as bars, anchored at
                // start like live STS diag spans.
                if (
                    typeof marker.attrs?.["durationMs"] === "number" &&
                    marker.phase === "instant"
                ) {
                    event.durationMs = marker.attrs["durationMs"];
                    event.timingClass = "epochAlignedDiagnostic";
                    if (marker.name.startsWith("sts.")) {
                        event.tags!.push("stsDiag");
                    }
                }
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
                skippedLines++;
            }
        }
        // Import loss is visible: a synthetic event records exactly how many
        // lines (or the whole file) were refused so the trace never silently
        // under-reports.
        if (skippedLines > 0 || bounded.refusedReason) {
            seq++;
            events.push({
                schemaVersion: DIAG_SCHEMA_VERSION,
                eventId: `imp_${seq.toString(36).padStart(6, "0")}`,
                sessionId: traceId,
                seq,
                epochMs: events[0]?.epochMs ?? Date.now(),
                process: "system",
                feature: "harness",
                kind: "event",
                type: "import.linesSkipped",
                status: "warning",
                traceId,
                cls: {
                    max: "diagnostic.metadata",
                    redactedFields: 0,
                    policyId: "policy_perf_import",
                },
                tags: ["imported"],
                payload: {
                    skipped: { v: skippedLines, cls: "diagnostic.metadata", handling: "plain" },
                    reason: {
                        v: bounded.refusedReason
                            ? `markers.jsonl refused: ${bounded.refusedReason}`
                            : "malformed or oversized markers.jsonl lines refused during import",
                        cls: "diagnostic.metadata",
                        handling: "plain",
                    },
                },
            });
        }
    }

    const sqlPath = path.join(repDir, "artifacts", "sql", "sql-activity.jsonl");
    if (fs.existsSync(sqlPath)) {
        for (const trimmed of readJsonlBounded(sqlPath).lines) {
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
                // Never plain: the harness persists real SQL text when it ran
                // with captureSqlText, and a run can target any server. The
                // digest policy keeps grouping without the text.
                const textField = text
                    ? classify(text, "sql.text", CAPTURE_POLICIES.digest)
                    : { cls: "sql.text" as const, handling: "omitted" as const };
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
                        text: textField,
                    },
                    cls: {
                        max: "sql.text",
                        redactedFields: 1,
                        policyId: CAPTURE_POLICIES.digest.policyId,
                    },
                    tags: ["imported"],
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

function parseRunTimestamp(runName: string): string {
    // Run directories are named 2026-07-02T20-29-51Z_xxxx.
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(runName);
    return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z` : runName.slice(0, 20);
}

interface PerfMetricsImport {
    samples: PerfMetricSample[];
    runs: PerfRunInfo[];
}

/** Per-root memo keyed on a cheap fingerprint (run names + summary.json mtimes). */
const metricsCache = new Map<string, { fingerprint: string; value: PerfMetricsImport }>();

function metricsFingerprint(perfRunsRoot: string, runNames: string[]): string {
    return runNames
        .map((name) => {
            try {
                return `${name}:${fs.statSync(path.join(perfRunsRoot, name, "summary.json")).mtimeMs}`;
            } catch {
                return `${name}:-`;
            }
        })
        .join("|");
}

/** Read official metric samples from run summary/result JSON files (SQLite
 *  import needs a native dep — deferred). All runs are listed; only passed,
 *  non-warmup reps contribute metric samples. Memoized per root: a summary
 *  refresh re-parses result.json files only when a run appears or changes. */
export function importPerfMetrics(perfRunsRoot: string): PerfMetricsImport {
    const samples: PerfMetricSample[] = [];
    const runs: PerfRunInfo[] = [];
    if (!fs.existsSync(perfRunsRoot)) {
        return { samples, runs };
    }
    const runNames = fs.readdirSync(perfRunsRoot).sort();
    const fingerprint = metricsFingerprint(perfRunsRoot, runNames);
    const cached = metricsCache.get(perfRunsRoot);
    if (cached && cached.fingerprint === fingerprint) {
        return cached.value;
    }
    for (const runName of runNames) {
        const runDir = path.join(perfRunsRoot, runName);
        const scenariosDir = path.join(runDir, "scenarios");
        if (!fs.existsSync(scenariosDir)) continue;
        const createdUtc = parseRunTimestamp(runName);
        const warmupRepetitions = readWarmupRepetitions(runDir);
        let status = "unknown";
        let passType: string | undefined;
        let environmentHash: string | undefined;
        try {
            const summary = JSON.parse(
                fs.readFileSync(path.join(runDir, "summary.json"), "utf8"),
            ) as { status?: string; passType?: string; environmentHash?: string };
            status = summary.status ?? "unknown";
            passType = summary.passType;
            environmentHash = summary.environmentHash;
        } catch {
            // no summary: keep unknown status, still list the run
        }
        let scenarioCount = 0;
        for (const scenario of fs.readdirSync(scenariosDir)) {
            const repsDir = path.join(scenariosDir, scenario, "reps");
            if (!fs.existsSync(repsDir)) continue;
            scenarioCount++;
            for (const rep of fs.readdirSync(repsDir)) {
                try {
                    const parsed: unknown = JSON.parse(
                        fs.readFileSync(path.join(repsDir, rep, "result.json"), "utf8"),
                    );
                    if (typeof parsed !== "object" || parsed === null) continue;
                    const result = parsed as {
                        repId?: number;
                        status: string;
                        warmup?: boolean;
                        metrics?: Array<{
                            name: string;
                            value: number;
                            unit: string;
                            official: boolean;
                        }>;
                    };
                    const repId = repIdFrom(rep, result);
                    if (
                        result.status !== "passed" ||
                        repId === undefined ||
                        isWarmupRep(result, repId, warmupRepetitions)
                    ) {
                        continue;
                    }
                    for (const metric of result.metrics ?? []) {
                        if (typeof metric?.value !== "number") continue;
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
        runs.push({
            runId: runName,
            createdUtc,
            status,
            ...(passType !== undefined ? { passType } : {}),
            ...(environmentHash !== undefined ? { environmentHash } : {}),
            scenarioCount,
        });
    }
    const value = { samples, runs };
    metricsCache.set(perfRunsRoot, { fingerprint, value });
    return value;
}
