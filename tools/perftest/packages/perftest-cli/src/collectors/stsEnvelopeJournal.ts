/**
 * stsEnvelopeJournal collector (diagnostic pass only): harvests the sts2
 * envelope journal that SQL Tools Service writes when launched with
 * STS_ENABLE_STS2=1 (Karl's sts2 refactor: every RPC frame/effect/diagnostic
 * becomes a journaled envelope with gapless seq, ts, corr, cause).
 *
 * The harness builds on the journal as-is — no STS-side changes needed beyond
 * enabling the flag. After the rep exits, journal segments are copied into
 * the rep's artifacts and parsed into official:false RPC-latency metrics
 * (rpc.in.request → rpc.out.result/error matched by `corr`).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext } from "./types";

interface Envelope {
    seq?: number;
    ts?: string | number;
    kind?: string;
    type?: string;
    corr?: string | number;
    payload?: {
        status?: unknown;
        pagesSent?: unknown;
        stats?: Record<string, unknown>;
        [key: string]: unknown;
    };
}

export interface MultiplexerTransportSnapshot {
    schema: "sts2.transport.stats/1";
    legacy: Record<string, unknown>;
    sts2: Record<string, unknown>;
}

export interface RpcTransportSnapshot extends Record<string, unknown> {
    schema: "sts2.rpc.transport.stats/1";
}

const QUERY_PIPELINE_STAT_FIELDS = [
    "pages",
    "rows",
    "cellSlots",
    "nullCells",
    "encodedBytes",
    "eventPayloadBytes",
    "maxEventPayloadBytes",
    "readMsTotal",
    "creditWaitMsTotal",
    "encodeMsTotal",
    "rowsSerializeMsTotal",
    "utf8MeasureMsTotal",
    "nullBitmapMsTotal",
    "pageBodyBuildMsTotal",
    "eventBuildMsTotal",
    "postBuildMsTotal",
    "postMsTotal",
    "encodePrepAllocatedBytes",
    "eventBuildAllocatedBytes",
    "postBuildAllocatedBytes",
] as const;

const QUERY_COORDINATOR_STAT_FIELDS = [
    "pages",
    "captureCanonicalBytes",
    "queueWaitMsTotal",
    "captureMsTotal",
    "captureAllocatedBytes",
    "inputEnvelopeBuildMsTotal",
    "inputEnvelopeBuildAllocatedBytes",
    "inputJournalMsTotal",
    "coreMsTotal",
    "coreAllocatedBytes",
    "outputEncodeMsTotal",
    "outputEncodeAllocatedBytes",
    "outputEnvelopeBuildMsTotal",
    "outputEnvelopeBuildAllocatedBytes",
    "outputJournalMsTotal",
    "outputActionMsTotal",
    "outputActionAllocatedBytes",
    "outputSubstitutionMsTotal",
    "outputSubstitutionAllocatedBytes",
    "outputGatewayEmitMsTotal",
    "outputGatewayEmitAllocatedBytes",
] as const;

const MULTIPLEXER_TRANSPORT_STAT_FIELDS = [
    "readCalls",
    "maxBufferedBytes",
    "headerParseCalls",
    "headerParseMsTotal",
    "headerParseAllocatedBytes",
    "partialFrameWaits",
    "outboundFrames",
    "outboundFrameBytes",
    "maxOutboundFrameBytes",
    "largeObjectFrames",
    "pipeSegments",
    "singleSegmentFrames",
    "multiSegmentFrames",
    "directFrames",
    "directBytes",
    "materializedFrames",
    "materializedBytes",
    "materializeMsTotal",
    "materializeAllocatedBytes",
    "reusableFrames",
    "reusableBytes",
    "reusableBufferAllocations",
    "reusableBufferCapacityBytes",
    "pooledFrames",
    "pooledBytes",
    "pooledClearBytes",
    "pooledClearMsTotal",
    "bufferClearBytes",
    "bufferClearMsTotal",
    "inspectMsTotal",
    "inspectAllocatedBytes",
    "inspectParseFailures",
    "rewrittenFrames",
    "stdoutLockWaitMsTotal",
    "stdoutWriteCalls",
    "stdoutWriteBytes",
    "stdoutWriteMsTotal",
    "stdoutFlushCalls",
    "stdoutFlushMsTotal",
] as const;

const RPC_TRANSPORT_STAT_FIELDS = [
    "directPipeEndpoint",
    "messages",
    "bytes",
    "maxMessageBytes",
    "bufferRequests",
    "maxBufferSizeHint",
    "serializeMsTotal",
    "serializeAllocatedBytes",
    "serializationFailures",
    "writeCalls",
    "writeMsTotal",
    "writeAllocatedBytes",
    "framingCopyMsTotal",
    "framingCopyAllocatedBytes",
    "writeFailures",
    "flushCalls",
    "flushMsTotal",
    "flushFailures",
    "rowMessages",
    "rowBytes",
    "rowSerializeMsTotal",
    "rowSerializeAllocatedBytes",
    "rowWriteMsTotal",
    "rowWriteAllocatedBytes",
    "rowFramingCopyMsTotal",
    "rowFramingCopyAllocatedBytes",
    "rowFlushMsTotal",
] as const;

export class StsEnvelopeJournalCollector implements Collector {
    readonly name = "stsEnvelopeJournal";
    readonly cost = "low" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    // Journal capture is diagnostic-only until an overhead calibration approves it.
    readonly allowedPassTypes = ["diagnostic", "calibration"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private startedAtMs = 0;
    private collectedEnvelopes: Envelope[] = [];
    private collectedTransportStats: MultiplexerTransportSnapshot[] = [];
    private collectedRpcTransportStats: RpcTransportSnapshot[] = [];

    async postLaunch(): Promise<void> {
        this.startedAtMs = Date.now();
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        // sts2 journals land under the STS log directory: <log-dir>/sts2/<runId>/.
        // The extension points STS logs inside the rep's user-data dir, so scan
        // there for sts2 folders touched during this rep.
        const roots = [
            join(ctx.repDir, "vscode-user-data"),
            join(ctx.repDir, "..", "..", "profile", "vscode-user-data"), // warmed profile location
        ];
        const journalDirs: string[] = [];
        const multiplexerLogs: string[] = [];
        for (const root of roots) {
            if (existsSync(root)) {
                findSts2Dirs(root, journalDirs, 0);
                findMultiplexerLogs(root, multiplexerLogs, 0);
            }
        }
        const fresh = [...new Set(journalDirs)].filter((dir) => {
            try {
                return statSync(dir).mtimeMs >= this.startedAtMs - 5000;
            } catch {
                return false;
            }
        });
        if (fresh.length === 0) {
            ctx.logger.warn("stsEnvelopeJournal.noJournals", "no sts2 journal directories found", {
                searched: roots,
            });
        }

        const freshMultiplexerLogs = [...new Set(multiplexerLogs)].filter((path) => {
            try {
                // The mux file is created after VS Code launch and updated at each query
                // terminal. Unlike a journal directory, it needs no timestamp slack;
                // slack can accidentally pull the preceding warmed-profile process into
                // a fast next repetition and double every cumulative counter.
                return statSync(path).mtimeMs >= this.startedAtMs - 250;
            } catch {
                return false;
            }
        });

        const artifacts: ArtifactRef[] = [];
        const outRoot = join(ctx.artifactsDir, "sts2");
        mkdirSync(outRoot, { recursive: true });
        for (const dir of fresh) {
            const name = dir.split(/[\\/]/).slice(-1)[0] ?? "journal";
            const dest = join(outRoot, name);
            try {
                cpSync(dir, dest, { recursive: true });
                artifacts.push({
                    kind: "sts2Journal",
                    path: `artifacts/sts2/${name}`,
                    retention: "always",
                });
                for (const file of readdirSync(dest)) {
                    if (file.endsWith(".jsonl")) {
                        this.parseSegment(join(dest, file), ctx);
                    } else if (file === "sts2-rpc-transport.log") {
                        this.collectedRpcTransportStats.push(
                            ...parseRpcTransportStatsLog(readFileSync(join(dest, file), "utf8")),
                        );
                    }
                }
            } catch (error) {
                ctx.logger.warn("stsEnvelopeJournal.copyFailed", String(error), {
                    dir,
                });
            }
        }

        if (freshMultiplexerLogs.length > 0) {
            const muxOutRoot = join(ctx.artifactsDir, "sts2-multiplexer");
            mkdirSync(muxOutRoot, { recursive: true });
            for (const path of freshMultiplexerLogs) {
                const name = path.split(/[\\/]/).slice(-1)[0] ?? "sts2-mux.log";
                const dest = join(muxOutRoot, name);
                try {
                    cpSync(path, dest);
                    artifacts.push({
                        kind: "sts2MultiplexerLog",
                        path: `artifacts/sts2-multiplexer/${name}`,
                        retention: "always",
                    });
                    this.collectedTransportStats.push(
                        ...parseMultiplexerTransportStatsLog(readFileSync(dest, "utf8")),
                    );
                } catch (error) {
                    ctx.logger.warn("stsEnvelopeJournal.multiplexerCopyFailed", String(error), {
                        path,
                    });
                }
            }
        }
        ctx.logger.info("stsEnvelopeJournal.collected", undefined, {
            journalDirs: fresh.length,
            envelopes: this.collectedEnvelopes.length,
            multiplexerLogs: freshMultiplexerLogs.length,
            transportSnapshots: this.collectedTransportStats.length,
            rpcTransportSnapshots: this.collectedRpcTransportStats.length,
        });
        return artifacts;
    }

    private parseSegment(path: string, ctx: CollectorContext): void {
        try {
            for (const line of readFileSync(path, "utf8").split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    this.collectedEnvelopes.push(JSON.parse(trimmed) as Envelope);
                } catch {
                    // tolerate partial/corrupt trailing lines
                }
            }
        } catch (error) {
            ctx.logger.warn("stsEnvelopeJournal.parseFailed", String(error), {
                path,
            });
        }
    }

    async normalize(ctx: CollectorContext): Promise<Metric[]> {
        // Match rpc.in.request → rpc.out.result|rpc.out.error by corr id and
        // derive per-method handler latency from envelope timestamps.
        const requests = new Map<string, { type: string; tsMs: number }>();
        const durations = new Map<string, number[]>();
        let unmatched = 0;
        for (const envelope of this.collectedEnvelopes) {
            const tsMs = parseTs(envelope.ts);
            if (tsMs === undefined || envelope.corr === undefined) continue;
            const corr = String(envelope.corr);
            if (envelope.kind === "rpc.in.request") {
                requests.set(corr, { type: envelope.type ?? "unknown", tsMs });
            } else if (envelope.kind === "rpc.out.result" || envelope.kind === "rpc.out.error") {
                const request = requests.get(corr);
                if (request) {
                    const list = durations.get(request.type) ?? [];
                    list.push(tsMs - request.tsMs);
                    durations.set(request.type, list);
                    requests.delete(corr);
                } else {
                    unmatched++;
                }
            }
        }
        if (unmatched > 0) {
            ctx.logger.debug("stsEnvelopeJournal.unmatchedResponses", undefined, {
                unmatched,
            });
        }
        const metrics: Metric[] = [];
        for (const [method, values] of durations) {
            const sorted = [...values].sort((a, b) => a - b);
            const median =
                sorted.length % 2 === 1
                    ? sorted[(sorted.length - 1) / 2]!
                    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
            metrics.push({
                name: `sts.rpc.${method}.duration`,
                value: Number(median.toFixed(3)),
                unit: "ms",
                component: "sts",
                processRole: "sts",
                source: "otelSpan", // closest schema enum for span-derived server timing
                official: false,
                lowerIsBetter: true,
                tags: { samples: sorted.length, derivedFrom: "sts2EnvelopeJournal" },
            });
        }
        metrics.push(...normalizeQueryPipelineStats(this.collectedEnvelopes));
        metrics.push(...normalizeQueryCoordinatorStats(this.collectedEnvelopes));
        metrics.push(...normalizeMultiplexerTransportStats(this.collectedTransportStats));
        metrics.push(...normalizeRpcTransportStats(this.collectedRpcTransportStats));
        return metrics;
    }
}

/**
 * Flatten privacy-safe sts2.query.stats diagnostics into comparable metrics.
 * Additive fields sum across queries/batches; the maximum payload field keeps
 * its maximum. Opaque query/connection ids and status never become tags.
 */
export function normalizeQueryPipelineStats(envelopes: readonly Envelope[]): Metric[] {
    const aggregates = new Map<string, number>();
    let samples = 0;
    for (const envelope of envelopes) {
        if (envelope.kind !== "diag" || envelope.type !== "sts2.query.stats") continue;
        const stats = envelope.payload?.stats;
        if (!stats) continue;
        samples++;
        const pagesSent = numeric(envelope.payload?.pagesSent);
        if (pagesSent !== undefined) {
            aggregates.set("pagesSent", (aggregates.get("pagesSent") ?? 0) + pagesSent);
        }
        for (const field of QUERY_PIPELINE_STAT_FIELDS) {
            const value = numeric(stats[field]);
            if (value === undefined) continue;
            if (field === "maxEventPayloadBytes") {
                aggregates.set(field, Math.max(aggregates.get(field) ?? 0, value));
            } else {
                aggregates.set(field, (aggregates.get(field) ?? 0) + value);
            }
        }
    }

    return [...aggregates.entries()].map(([field, value]) => ({
        name: `sts2.query.pipeline.${field}`,
        value: Number(value.toFixed(field.endsWith("MsTotal") ? 3 : 0)),
        unit: field.endsWith("MsTotal") ? "ms" : field.endsWith("Bytes") ? "bytes" : "count",
        component: "sts",
        processRole: "sts",
        source: "otelSpan",
        official: false,
        lowerIsBetter:
            field.endsWith("MsTotal") ||
            field.endsWith("Bytes") ||
            field === "maxEventPayloadBytes",
        tags: { samples, derivedFrom: "sts2.query.stats" },
    }));
}

/**
 * Flatten replay-ignored, privacy-safe post-driver coordinator metrics. Every
 * field is additive across query pages/queries; opaque ids and status stay out
 * of metric tags.
 */
export function normalizeQueryCoordinatorStats(envelopes: readonly Envelope[]): Metric[] {
    const aggregates = new Map<string, number>();
    let samples = 0;
    for (const envelope of envelopes) {
        if (
            envelope.kind !== "metric" ||
            envelope.type !== "sts2.query.coordinator.stats" ||
            !envelope.payload
        ) {
            continue;
        }
        samples++;
        for (const field of QUERY_COORDINATOR_STAT_FIELDS) {
            const value = numeric(envelope.payload[field]);
            if (value !== undefined) {
                aggregates.set(field, (aggregates.get(field) ?? 0) + value);
            }
        }
    }

    return [...aggregates.entries()].map(([field, value]) => ({
        name: `sts2.query.coordinator.${field}`,
        value: Number(value.toFixed(field.endsWith("MsTotal") ? 3 : 0)),
        unit: field.endsWith("MsTotal") ? "ms" : field.endsWith("Bytes") ? "bytes" : "count",
        component: "sts",
        processRole: "sts",
        source: "otelSpan",
        official: false,
        lowerIsBetter: field.endsWith("MsTotal") || field.endsWith("Bytes"),
        tags: { samples, derivedFrom: "sts2.query.coordinator.stats" },
    }));
}

/** Flatten aggregate, content-free multiplexer shutdown snapshots by virtual channel. */
export function normalizeMultiplexerTransportStats(
    snapshots: readonly MultiplexerTransportSnapshot[],
): Metric[] {
    const metrics: Metric[] = [];
    for (const channel of ["sts2", "legacy"] as const) {
        const aggregates = new Map<string, number>();
        let samples = 0;
        for (const snapshot of snapshots) {
            const stats = snapshot[channel];
            samples++;
            for (const field of MULTIPLEXER_TRANSPORT_STAT_FIELDS) {
                const value = numeric(stats[field]);
                if (value === undefined) continue;
                if (field === "maxBufferedBytes" || field === "maxOutboundFrameBytes") {
                    aggregates.set(field, Math.max(aggregates.get(field) ?? 0, value));
                } else {
                    aggregates.set(field, (aggregates.get(field) ?? 0) + value);
                }
            }
        }

        for (const [field, value] of aggregates) {
            const isMilliseconds = field.endsWith("MsTotal");
            const isBytes = field.endsWith("Bytes");
            metrics.push({
                name: `sts2.transport.${channel}.${field}`,
                value: Number(value.toFixed(isMilliseconds ? 3 : 0)),
                unit: isMilliseconds ? "ms" : isBytes ? "bytes" : "count",
                component: "sts",
                processRole: "sts",
                source: "otelSpan",
                official: false,
                lowerIsBetter:
                    isMilliseconds ||
                    field.includes("AllocatedBytes") ||
                    field.startsWith("materialized") ||
                    field === "partialFrameWaits" ||
                    field === "inspectParseFailures",
                tags: { samples, derivedFrom: "sts2MultiplexerLog" },
            });
        }
    }
    return metrics;
}

/** Parse only the stable aggregate diagnostic; all other mux diagnostics are ignored. */
export function parseMultiplexerTransportStatsLog(text: string): MultiplexerTransportSnapshot[] {
    let latest: MultiplexerTransportSnapshot | undefined;
    for (const line of text.split("\n")) {
        const marker = "[transportStats] ";
        const index = line.indexOf(marker);
        if (index < 0) continue;
        try {
            const parsed = JSON.parse(line.slice(index + marker.length).trim()) as Record<
                string,
                unknown
            >;
            if (
                parsed["schema"] === "sts2.transport.stats/1" &&
                isRecord(parsed["legacy"]) &&
                isRecord(parsed["sts2"])
            ) {
                // Snapshots are cumulative. Keep only the latest checkpoint from one
                // process log so repeated queries and final shutdown cannot overcount.
                latest = parsed as unknown as MultiplexerTransportSnapshot;
            }
        } catch {
            // A truncated trailing diagnostic must not invalidate the repetition.
        }
    }
    return latest ? [latest] : [];
}

/** Flatten cumulative, content-free StreamJsonRpc formatter/copy/flush snapshots. */
export function normalizeRpcTransportStats(snapshots: readonly RpcTransportSnapshot[]): Metric[] {
    const aggregates = new Map<string, number>();
    for (const snapshot of snapshots) {
        for (const field of RPC_TRANSPORT_STAT_FIELDS) {
            const value = numeric(snapshot[field]);
            if (value === undefined) continue;
            if (field === "maxMessageBytes" || field === "maxBufferSizeHint") {
                aggregates.set(field, Math.max(aggregates.get(field) ?? 0, value));
            } else {
                aggregates.set(field, (aggregates.get(field) ?? 0) + value);
            }
        }
    }

    return [...aggregates.entries()].map(([field, value]) => {
        const isMilliseconds = field.endsWith("MsTotal");
        const isBytes = field.toLowerCase().includes("bytes") || field === "maxBufferSizeHint";
        return {
            name: `sts2.rpcTransport.${field}`,
            value: Number(value.toFixed(isMilliseconds ? 3 : 0)),
            unit: isMilliseconds ? "ms" : isBytes ? "bytes" : "count",
            component: "sts",
            processRole: "sts",
            source: "otelSpan",
            official: false,
            lowerIsBetter:
                isMilliseconds ||
                field.includes("AllocatedBytes") ||
                field.endsWith("Failures") ||
                field === "bufferRequests",
            tags: { samples: snapshots.length, derivedFrom: "sts2RpcTransportLog" },
        } satisfies Metric;
    });
}

/** Parse only the latest cumulative checkpoint from one RPC transport log. */
export function parseRpcTransportStatsLog(text: string): RpcTransportSnapshot[] {
    let latest: RpcTransportSnapshot | undefined;
    for (const line of text.split("\n")) {
        const marker = "[rpcTransportStats] ";
        const index = line.indexOf(marker);
        if (index < 0) continue;
        try {
            const parsed = JSON.parse(line.slice(index + marker.length).trim()) as Record<
                string,
                unknown
            >;
            if (parsed["schema"] === "sts2.rpc.transport.stats/1") {
                // Snapshots are cumulative; repeated query terminals must not be summed.
                latest = parsed as RpcTransportSnapshot;
            }
        } catch {
            // A truncated trailing diagnostic must not invalidate the repetition.
        }
    }
    return latest ? [latest] : [];
}

function numeric(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSts2Dirs(root: string, results: string[], depth: number): void {
    if (depth > 6) return;
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = join(root, entry.name);
        if (entry.name === "sts2") {
            // children are per-run journal dirs
            try {
                for (const child of readdirSync(full, { withFileTypes: true })) {
                    if (child.isDirectory()) {
                        results.push(join(full, child.name));
                    }
                }
            } catch {
                // ignore
            }
        } else {
            findSts2Dirs(full, results, depth + 1);
        }
    }
}

function findMultiplexerLogs(root: string, results: string[], depth: number): void {
    if (depth > 8) return;
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
            findMultiplexerLogs(full, results, depth + 1);
        } else if (entry.isFile() && /^sts2-mux-\d+\.log$/u.test(entry.name)) {
            results.push(full);
        }
    }
}

function parseTs(ts: string | number | undefined): number | undefined {
    if (ts === undefined) return undefined;
    if (typeof ts === "number") {
        // Heuristic: ns > 1e15, µs > 1e12, ms > 1e9... journal uses one unit;
        // normalize to ms.
        if (ts > 1e17) return ts / 1e6;
        if (ts > 1e14) return ts / 1e3;
        return ts;
    }
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? undefined : parsed;
}
