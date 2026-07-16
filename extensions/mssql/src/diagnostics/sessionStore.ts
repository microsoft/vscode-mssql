/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session Diag store access + source registry. The JSONL segment journal is
 * the source of truth; queries run over an in-memory index built at open
 * (v1 — the StoreQueryService shape is compatible with a SQLite index later).
 */

import * as fs from "fs";
import * as path from "path";
import {
    DiagEvent,
    DebugSource,
    EventQuery,
    EventQueryResult,
    GapRecord,
    ProvenanceSummary,
    SessionManifest,
} from "../sharedInterfaces/debugConsole";
import {
    OBSERVABILITY_BUNDLE_FILE,
    ObservabilityBundleV1,
    isObservabilityBundleShape,
    isSafeBundleRelativePath,
} from "./sessionBundle/bundleSchemas";

const MAX_QUERY_LIMIT = 2000;

export class SessionStore {
    private cache = new Map<string, DiagEvent[]>();
    private importedPerfRuns = new Map<string, { label: string; events: DiagEvent[] }>();

    constructor(public readonly storeRoot: string) {}

    // --- sources ---------------------------------------------------------------

    public listLocalSessions(): Array<{ manifest: SessionManifest; dir: string }> {
        const sessionsDir = path.join(this.storeRoot, "sessions");
        if (!fs.existsSync(sessionsDir)) {
            return [];
        }
        const sessions: Array<{ manifest: SessionManifest; dir: string }> = [];
        for (const name of fs.readdirSync(sessionsDir)) {
            const dir = path.join(sessionsDir, name);
            const manifestPath = path.join(dir, "manifest.json");
            try {
                const manifest = JSON.parse(
                    fs.readFileSync(manifestPath, "utf8"),
                ) as SessionManifest;
                sessions.push({ manifest, dir });
            } catch {
                // unreadable session: skip (never delete silently)
            }
        }
        return sessions.sort((a, b) => b.manifest.createdUtc.localeCompare(a.manifest.createdUtc));
    }

    public listSources(live: {
        sessionId: string;
        eventCount: number;
        captureMode: DebugSource["captureMode"];
        provenance: ProvenanceSummary;
    }): DebugSource[] {
        const sources: DebugSource[] = [
            {
                id: `live:${live.sessionId}`,
                kind: "liveSession",
                label: "Current VS Code Session",
                readonly: false,
                eventCount: live.eventCount,
                captureMode: live.captureMode,
                capabilities: [
                    "liveTail",
                    "historyQuery",
                    "waterfall",
                    "sqlActivity",
                    "exportable",
                ],
                provenance: live.provenance,
            },
        ];
        for (const { manifest } of this.listLocalSessions()) {
            if (manifest.sessionId === live.sessionId) {
                continue;
            }
            sources.push({
                id: `store:${manifest.sessionId}`,
                kind: "localSession",
                label: `Session ${formatSessionLabel(manifest.createdUtc)}`,
                readonly: true,
                createdUtc: manifest.createdUtc,
                eventCount: manifest.eventCount,
                unresolvedGapCount: manifest.gapCount,
                captureMode: manifest.captureMode,
                capabilities: ["historyQuery", "waterfall", "sqlActivity", "exportable"],
                provenance: manifest.provenance,
            });
        }
        for (const [id, run] of this.importedPerfRuns) {
            sources.push({
                id,
                kind: "perfRun",
                label: run.label,
                readonly: true,
                eventCount: run.events.length,
                capabilities: ["historyQuery", "waterfall", "sqlActivity", "perfMetrics"],
                provenance: {},
            });
        }
        return sources;
    }

    public registerPerfRun(id: string, label: string, events: DiagEvent[]): void {
        this.importedPerfRuns.set(id, { label, events });
    }

    // --- events ------------------------------------------------------------------

    public eventsForSource(sourceId: string, liveEvents?: DiagEvent[]): DiagEvent[] {
        if (sourceId.startsWith("live:")) {
            return liveEvents ?? [];
        }
        if (sourceId.startsWith("perfrun:")) {
            return this.importedPerfRuns.get(sourceId)?.events ?? [];
        }
        if (sourceId.startsWith("store:")) {
            const sessionId = sourceId.slice("store:".length);
            const cached = this.cache.get(sessionId);
            if (cached) {
                return cached;
            }
            const events = this.loadSessionEvents(sessionId);
            if (this.cache.size > 4) {
                const first = this.cache.keys().next().value;
                if (first !== undefined) {
                    this.cache.delete(first);
                }
            }
            this.cache.set(sessionId, events);
            return events;
        }
        return [];
    }

    private loadSessionEvents(sessionId: string): DiagEvent[] {
        const eventsDir = path.join(this.storeRoot, "sessions", sessionId, "events");
        if (!fs.existsSync(eventsDir)) {
            return [];
        }
        const events: DiagEvent[] = [];
        for (const file of fs.readdirSync(eventsDir).sort()) {
            if (!file.endsWith(".jsonl")) {
                continue;
            }
            try {
                for (const line of fs
                    .readFileSync(path.join(eventsDir, file), "utf8")
                    .split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        continue;
                    }
                    try {
                        events.push(JSON.parse(trimmed) as DiagEvent);
                    } catch {
                        // tolerate torn tail line
                    }
                }
            } catch {
                // unreadable segment: keep what we have (honest partial)
            }
        }
        return events.sort((a, b) => a.seq - b.seq);
    }

    public query(events: DiagEvent[], query: EventQuery, gaps: GapRecord[]): EventQueryResult {
        const limit = Math.min(query.limit ?? 500, MAX_QUERY_LIMIT);
        const text = query.text?.toLowerCase();
        const filtered = events.filter((event) => {
            if (!query.includeViewerInternal && event.tags?.includes("viewerInternal")) {
                return false;
            }
            if (query.processes && !query.processes.includes(event.process)) {
                // RPC boundary spans are emitted by the extension host but
                // represent STS work — the "STS" process filter includes them
                // (they render as "STS rpc" in the UI).
                const rpcUnderSts =
                    event.feature === "rpc" && query.processes.includes("sqlToolsService");
                if (!rpcUnderSts) return false;
            }
            if (query.features && !query.features.includes(event.feature)) return false;
            if (query.kinds && !query.kinds.includes(event.kind)) return false;
            if (query.statuses && !query.statuses.includes(event.status)) return false;
            if (
                query.minDurationMs !== undefined &&
                (event.durationMs === undefined || event.durationMs < query.minDurationMs)
            )
                return false;
            if (
                query.maxDurationMs !== undefined &&
                (event.durationMs === undefined || event.durationMs > query.maxDurationMs)
            )
                return false;
            if (query.traceId && event.traceId !== query.traceId) return false;
            if (query.fromSeq !== undefined && event.seq < query.fromSeq) return false;
            if (query.beforeSeq !== undefined && event.seq >= query.beforeSeq) return false;
            if (text) {
                const haystack =
                    `${event.type} ${event.feature} ${event.traceId ?? ""} ${event.eventId} ${searchableDigests(event)}`.toLowerCase();
                if (!haystack.includes(text)) return false;
            }
            return true;
        });
        // Tail page by default (newest window), preserving order.
        const page = filtered.slice(Math.max(0, filtered.length - limit));
        // Interleave gap rows at their sequence positions within the page window.
        const rows: Array<DiagEvent | GapRecord> = [...page];
        const firstSeq = page.length > 0 ? page[0].seq : 0;
        for (const gap of gaps) {
            if (gap.throughSeq >= firstSeq) {
                rows.push(gap);
            }
        }
        rows.sort(
            (a, b) =>
                (a.kind === "gap" ? (a as GapRecord).fromSeq : (a as DiagEvent).seq) -
                (b.kind === "gap" ? (b as GapRecord).fromSeq : (b as DiagEvent).seq),
        );
        return { rows, totalMatching: filtered.length, totalInSource: events.length };
    }

    // --- retention -----------------------------------------------------------------

    public enforceRetention(maxSessions: number, maxAgeDays: number, maxTotalBytes?: number): void {
        const sessions = this.listLocalSessions();
        const cutoff = Date.now() - maxAgeDays * 86_400_000;
        const doomed = new Set(
            sessions.filter(
                (s, index) =>
                    s.manifest.status !== "active" &&
                    (index >= maxSessions || Date.parse(s.manifest.createdUtc) < cutoff),
            ),
        );
        // Size budget: evict oldest closed sessions until the store fits.
        // The JSONL journal must never become a disk dragon under the desk.
        if (maxTotalBytes !== undefined && maxTotalBytes > 0) {
            let total = sessions
                .filter((s) => !doomed.has(s))
                .reduce((sum, s) => sum + this.sessionSizeBytes(s), 0);
            for (let i = sessions.length - 1; i >= 0 && total > maxTotalBytes; i--) {
                const session = sessions[i];
                if (doomed.has(session) || session.manifest.status === "active") {
                    continue;
                }
                total -= this.sessionSizeBytes(session);
                doomed.add(session);
            }
        }
        for (const session of doomed) {
            try {
                fs.rmSync(session.dir, { recursive: true, force: true });
            } catch {
                // best effort; surfaced by next listing
            }
        }
    }

    private sessionSizeBytes(session: { manifest: SessionManifest; dir: string }): number {
        // Bundle totals are authoritative when a catalog exists: they include
        // rich/replay child bytes, which count toward the size budget too
        // (WI-2.3). The du-style fallback stays for legacy sessions only.
        const bundleBytes = this.bundleTotalBytes(session.dir);
        if (bundleBytes !== undefined) {
            return bundleBytes;
        }
        if (typeof session.manifest.sizeBytes === "number") {
            return session.manifest.sizeBytes;
        }
        // Older manifests: measure the events directory once.
        let total = 0;
        try {
            const eventsDir = path.join(session.dir, "events");
            for (const file of fs.readdirSync(eventsDir)) {
                total += fs.statSync(path.join(eventsDir, file)).size;
            }
        } catch {
            // unreadable: treat as zero (age/count rules still apply)
        }
        return total;
    }

    /** Total bytes from the session's bundle catalog; undefined for legacy/corrupt. */
    private bundleTotalBytes(dir: string): number | undefined {
        const bundle = readBundleFile(dir);
        return bundle && typeof bundle.totals.bytes === "number" ? bundle.totals.bytes : undefined;
    }

    /**
     * Store integrity check: every persisted session's manifest must agree
     * with what is actually on disk. Findings are strings a user can act on;
     * an empty list means the store is clean.
     */
    public validateStore(): { sessions: number; totalBytes: number; issues: string[] } {
        const issues: string[] = [];
        const sessions = this.listLocalSessions();
        let totalBytes = 0;
        for (const { manifest, dir } of sessions) {
            const label = manifest.sessionId;
            totalBytes += this.sessionSizeBytes({ manifest, dir });
            for (const segment of manifest.segments) {
                const file = path.join(dir, "events", segment.file);
                if (!fs.existsSync(file)) {
                    if (segment.events > 0) {
                        issues.push(
                            `${label}: segment ${segment.file} missing (${segment.events} events)`,
                        );
                    }
                    continue;
                }
                try {
                    const content = fs.readFileSync(file, "utf8");
                    if (content.length > 0 && !content.endsWith("\n")) {
                        issues.push(
                            `${label}: ${segment.file} has a partial trailing line (interrupted write)`,
                        );
                    }
                    const lines = content.split("\n").filter((l) => l.length > 0);
                    if (lines.length !== segment.events) {
                        issues.push(
                            `${label}: ${segment.file} has ${lines.length} line(s), manifest says ${segment.events}`,
                        );
                    }
                    // Seq sanity on the boundaries (full parse stays lazy).
                    try {
                        const first = JSON.parse(lines[0] ?? "{}") as { seq?: number };
                        if (segment.firstSeq > 0 && first.seq !== segment.firstSeq) {
                            issues.push(
                                `${label}: ${segment.file} first seq ${first.seq} != manifest ${segment.firstSeq}`,
                            );
                        }
                    } catch {
                        issues.push(`${label}: ${segment.file} first line is not valid JSON`);
                    }
                } catch {
                    issues.push(`${label}: ${segment.file} unreadable`);
                }
            }
            if (manifest.droppedRanges && manifest.droppedRanges.length > 0) {
                const dropped = manifest.droppedRanges.reduce(
                    (sum, r) => sum + (r.throughSeq - r.fromSeq + 1),
                    0,
                );
                issues.push(
                    `${label}: ${dropped} event(s) lost to store-buffer overflow (${manifest.droppedRanges.length} exact range(s) in manifest)`,
                );
            }
            this.validateBundle(dir, label, issues);
        }
        return { sessions: sessions.length, totalBytes, issues };
    }

    /**
     * Bundle catalog consistency (WI-2.3): bundle.json parseable, every
     * descriptor's child manifest present, totals agreeing with the child
     * manifests. Active artifacts are skipped — the catalog is debounced and
     * may honestly lag a live writer. Issues are reported, never fatal.
     */
    private validateBundle(dir: string, label: string, issues: string[]): void {
        const bundlePath = path.join(dir, OBSERVABILITY_BUNDLE_FILE);
        if (!fs.existsSync(bundlePath)) {
            return; // legacy session: no catalog is a valid state
        }
        let bundle: ObservabilityBundleV1;
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
            if (!isObservabilityBundleShape(parsed)) {
                issues.push(`${label}: bundle.json is not a valid bundle catalog (rebuildable)`);
                return;
            }
            bundle = parsed;
        } catch {
            issues.push(`${label}: bundle.json unreadable or corrupt (rebuildable)`);
            return;
        }
        for (const artifact of bundle.artifacts) {
            if (artifact.relativeManifest === undefined) {
                continue; // external refs carry no local manifest
            }
            if (!isSafeBundleRelativePath(artifact.relativeManifest)) {
                issues.push(
                    `${label}: bundle artifact ${artifact.artifactId} has an unsafe manifest path (${artifact.relativeManifest})`,
                );
                continue;
            }
            const manifestFile = path.join(dir, artifact.relativeManifest);
            if (!fs.existsSync(manifestFile)) {
                if (artifact.status !== "missing") {
                    issues.push(
                        `${label}: bundle artifact ${artifact.artifactId} manifest missing (${artifact.relativeManifest})`,
                    );
                }
                continue;
            }
            if (artifact.status === "active") {
                continue; // live writer: debounced totals may lag, tolerated
            }
            try {
                const child = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
                    eventCount?: number;
                    sizeBytes?: number;
                    totals?: { events?: number; bytes?: number };
                };
                const childEvents =
                    artifact.kind === "diagStream" ? child.eventCount : child.totals?.events;
                const childBytes =
                    artifact.kind === "diagStream" ? child.sizeBytes : child.totals?.bytes;
                if (
                    typeof childEvents === "number" &&
                    artifact.events !== undefined &&
                    childEvents !== artifact.events
                ) {
                    issues.push(
                        `${label}: bundle artifact ${artifact.artifactId} events ${artifact.events} != child manifest ${childEvents}`,
                    );
                }
                if (typeof childBytes === "number" && childBytes !== artifact.bytes) {
                    issues.push(
                        `${label}: bundle artifact ${artifact.artifactId} bytes ${artifact.bytes} != child manifest ${childBytes}`,
                    );
                }
            } catch {
                issues.push(
                    `${label}: bundle artifact ${artifact.artifactId} child manifest unreadable`,
                );
            }
        }
    }

    public clearAll(exceptSessionId?: string): { removed: number } {
        let removed = 0;
        for (const session of this.listLocalSessions()) {
            if (exceptSessionId && session.manifest.sessionId === exceptSessionId) {
                continue;
            }
            try {
                fs.rmSync(session.dir, { recursive: true, force: true });
                removed++;
            } catch {
                // keep going
            }
        }
        this.cache.clear();
        return { removed };
    }
}

/** Parse a session's bundle catalog; undefined for legacy/corrupt (fallback applies). */
function readBundleFile(dir: string): ObservabilityBundleV1 | undefined {
    try {
        const parsed: unknown = JSON.parse(
            fs.readFileSync(path.join(dir, OBSERVABILITY_BUNDLE_FILE), "utf8"),
        );
        return isObservabilityBundleShape(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** Search covers digests (grouping keys) but never redacted plaintext. */
function searchableDigests(event: DiagEvent): string {
    if (!event.payload) {
        return "";
    }
    const parts: string[] = [];
    for (const value of Object.values(event.payload)) {
        if (value.digest) {
            parts.push(value.digest);
        }
        if (value.handling === "plain" && typeof value.v === "string") {
            parts.push(value.v);
        }
    }
    return parts.join(" ");
}

function formatSessionLabel(createdUtc: string): string {
    try {
        const date = new Date(createdUtc);
        return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
    } catch {
        return createdUtc;
    }
}
