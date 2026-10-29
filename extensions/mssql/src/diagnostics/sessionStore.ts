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
import * as LocalizedConstants from "../constants/locConstants";
import { containedPath, isContainedPath } from "./containedPath";
import {
    OBSERVABILITY_BUNDLE_FILE,
    isObservabilityBundleShape,
} from "./sessionBundle/bundleSchemas";
import {
    DiagEvent,
    DebugSource,
    EventQuery,
    EventQueryResult,
    GapRecord,
    ProvenanceSummary,
    SessionManifest,
} from "../sharedInterfaces/debugConsole";

const MAX_QUERY_LIMIT = 2000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
/** Bounded read for boundary checks in validateStore (one event line fits comfortably). */
const VALIDATE_HEAD_BYTES = 64 * 1024;
/** Sidecar with per-session action aggregates so History never reloads whole journals. */
const HISTORY_SUMMARY_FILE = "history-summary.json";
const HISTORY_SUMMARY_SCHEMA = "mssql.diag.historySummary/1";

/** Per-session aggregate consumed by the History page (cheap to compute once, tiny to store). */
export interface SessionHistorySummary {
    schemaVersion: typeof HISTORY_SUMMARY_SCHEMA;
    events: number;
    errors: number;
    actions: Array<{
        label: string;
        feature: string;
        status: string;
        durationMs?: number;
    }>;
}

function readHead(file: string, bytes: number): string {
    const fd = fs.openSync(file, "r");
    try {
        const buffer = Buffer.alloc(bytes);
        const read = fs.readSync(fd, buffer, 0, bytes, 0);
        return buffer.toString("utf8", 0, read);
    } finally {
        fs.closeSync(fd);
    }
}

function readTail(file: string, size: number, bytes: number): string {
    const fd = fs.openSync(file, "r");
    try {
        const length = Math.min(bytes, size);
        const buffer = Buffer.alloc(length);
        const read = fs.readSync(fd, buffer, 0, length, size - length);
        return buffer.toString("utf8", 0, read);
    } finally {
        fs.closeSync(fd);
    }
}

export function isSessionManifest(value: unknown, directoryName: string): value is SessionManifest {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const manifest = value as Partial<SessionManifest>;
    return (
        manifest.schemaVersion === "mssql.diag.sessionManifest/1" &&
        manifest.sessionId === directoryName &&
        typeof manifest.createdUtc === "string" &&
        typeof manifest.updatedUtc === "string" &&
        (manifest.source === "live" || manifest.source === "perfRun") &&
        (manifest.captureMode === "off" ||
            manifest.captureMode === "redacted" ||
            manifest.captureMode === "digest" ||
            manifest.captureMode === "full") &&
        typeof manifest.policyId === "string" &&
        typeof manifest.eventCount === "number" &&
        typeof manifest.gapCount === "number" &&
        Array.isArray(manifest.segments) &&
        manifest.segments.every(
            (segment) =>
                typeof segment === "object" &&
                segment !== null &&
                typeof segment.file === "string" &&
                typeof segment.firstSeq === "number" &&
                typeof segment.lastSeq === "number" &&
                typeof segment.events === "number",
        ) &&
        typeof manifest.provenance === "object" &&
        manifest.provenance !== null &&
        (manifest.status === "active" ||
            manifest.status === "closed" ||
            manifest.status === "partial")
    );
}

function isClassifiedValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const field = value as Record<string, unknown>;
    return (
        typeof field.cls === "string" &&
        ["plain", "redacted", "digest", "tokenized", "truncated", "omitted"].includes(
            String(field.handling),
        ) &&
        (field.v === undefined ||
            field.v === null ||
            typeof field.v === "string" ||
            typeof field.v === "boolean" ||
            (typeof field.v === "number" && Number.isFinite(field.v))) &&
        (field.digest === undefined || typeof field.digest === "string") &&
        (field.len === undefined ||
            (typeof field.len === "number" && Number.isFinite(field.len) && field.len >= 0))
    );
}

function isDiagEvent(value: unknown): value is DiagEvent {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const event = value as Partial<DiagEvent>;
    const classification = event.cls as Partial<DiagEvent["cls"]> | undefined;
    return (
        event.schemaVersion === "mssql.diag.event/1" &&
        typeof event.eventId === "string" &&
        typeof event.sessionId === "string" &&
        typeof event.seq === "number" &&
        Number.isFinite(event.seq) &&
        typeof event.epochMs === "number" &&
        Number.isFinite(event.epochMs) &&
        // monotonicNs feeds BigInt() in analysis; a non-digit string would throw
        // there and fail the whole waterfall, so refuse it at the boundary.
        (event.monotonicNs === undefined ||
            (typeof event.monotonicNs === "string" && /^\d+$/.test(event.monotonicNs))) &&
        typeof event.process === "string" &&
        typeof event.feature === "string" &&
        typeof event.kind === "string" &&
        typeof event.type === "string" &&
        typeof event.status === "string" &&
        classification !== undefined &&
        classification !== null &&
        typeof classification.max === "string" &&
        typeof classification.redactedFields === "number" &&
        typeof classification.policyId === "string" &&
        (event.payload === undefined ||
            (typeof event.payload === "object" &&
                event.payload !== null &&
                !Array.isArray(event.payload) &&
                Object.values(event.payload).every(isClassifiedValue))) &&
        (event.tags === undefined ||
            (Array.isArray(event.tags) && event.tags.every((tag) => typeof tag === "string")))
    );
}

export class SessionStore {
    private cache = new Map<string, DiagEvent[]>();
    private importedPerfRuns = new Map<string, { label: string; events: DiagEvent[] }>();

    constructor(public readonly storeRoot: string) {}

    // --- sources ---------------------------------------------------------------

    public listLocalSessions(): Array<{ manifest: SessionManifest; dir: string }> {
        const sessionsDir = path.join(this.storeRoot, "sessions");
        if (!isContainedPath(this.storeRoot, sessionsDir) || !fs.existsSync(sessionsDir)) {
            return [];
        }
        const sessions: Array<{ manifest: SessionManifest; dir: string }> = [];
        for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) {
                continue;
            }
            const dir = path.join(sessionsDir, entry.name);
            const manifestPath = path.join(dir, "manifest.json");
            try {
                const parsed: unknown = JSON.parse(
                    fs.readFileSync(containedPath(this.storeRoot, manifestPath), "utf8"),
                );
                if (!isSessionManifest(parsed, entry.name)) {
                    continue;
                }
                const manifest = parsed;
                sessions.push({ manifest, dir });
            } catch (error) {
                // Rich-capture-only sessions have a bundle catalog but no diagnostic
                // manifest. Keep them visible to retention without admitting a bad
                // manifest or following links outside the store.
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    const manifest = this.bundleSessionManifest(dir, entry.name);
                    if (manifest) {
                        sessions.push({ manifest, dir });
                    }
                }
            }
        }
        return sessions.sort((a, b) => b.manifest.createdUtc.localeCompare(a.manifest.createdUtc));
    }

    private bundleSessionManifest(dir: string, sessionId: string): SessionManifest | undefined {
        try {
            const bundle: unknown = JSON.parse(
                fs.readFileSync(
                    containedPath(this.storeRoot, path.join(dir, OBSERVABILITY_BUNDLE_FILE)),
                    "utf8",
                ),
            );
            if (
                !isObservabilityBundleShape(bundle) ||
                bundle.hostSessionId !== sessionId ||
                typeof bundle.createdUtc !== "string" ||
                !Number.isFinite(Date.parse(bundle.createdUtc)) ||
                typeof bundle.updatedUtc !== "string" ||
                !Number.isFinite(Date.parse(bundle.updatedUtc)) ||
                !["active", "closed", "partial"].includes(bundle.status) ||
                !Number.isSafeInteger(bundle.totals.bytes) ||
                bundle.totals.bytes < 0 ||
                !Number.isSafeInteger(bundle.totals.gaps) ||
                bundle.totals.gaps < 0 ||
                typeof bundle.provenance !== "object" ||
                bundle.provenance === null ||
                Array.isArray(bundle.provenance)
            ) {
                return undefined;
            }
            return {
                schemaVersion: "mssql.diag.sessionManifest/1",
                sessionId,
                createdUtc: bundle.createdUtc,
                updatedUtc: bundle.updatedUtc,
                source: "bundle",
                captureMode: "off",
                policyId: "none",
                eventCount: 0,
                gapCount: bundle.totals.gaps,
                segments: [],
                sizeBytes: bundle.totals.bytes,
                provenance: bundle.provenance,
                status: bundle.status,
            };
        } catch {
            return undefined;
        }
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
            // A manifest that is still "active" but is not the current session
            // was never closed (crash, kill, OS shutdown): say so.
            const interrupted = manifest.status === "active";
            sources.push({
                id: `store:${manifest.sessionId}`,
                kind: "localSession",
                label: `Session ${formatSessionLabel(manifest.createdUtc)}${interrupted ? " (interrupted)" : ""}`,
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

    /** Force the next stored-session query to reread its JSONL segments. */
    public invalidateSession(sessionId: string): void {
        if (SESSION_ID_PATTERN.test(sessionId)) {
            this.cache.delete(sessionId);
        }
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
            if (!SESSION_ID_PATTERN.test(sessionId)) {
                return [];
            }
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
        if (!isContainedPath(this.storeRoot, eventsDir) || !fs.existsSync(eventsDir)) {
            return [];
        }
        const events: DiagEvent[] = [];
        let loadedBytes = 0;
        for (const entry of fs
            .readdirSync(eventsDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
                continue;
            }
            const file = containedPath(this.storeRoot, path.join(eventsDir, entry.name));
            loadedBytes += fs.statSync(file).size;
            if (loadedBytes > 8 * 1024 * 1024 || events.length > 20_000) {
                throw new Error(LocalizedConstants.debugConsoleSessionTooLarge);
            }
            try {
                for (const line of fs
                    .readFileSync(
                        containedPath(this.storeRoot, path.join(eventsDir, entry.name)),
                        "utf8",
                    )
                    .split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        continue;
                    }
                    try {
                        const parsed: unknown = JSON.parse(trimmed);
                        if (isDiagEvent(parsed)) {
                            events.push(parsed);
                        }
                    } catch {
                        // tolerate torn tail line
                    }
                }
            } catch {
                // unreadable segment: keep what we have (honest partial)
            }
        }
        if (events.length > 20_000) {
            throw new Error(LocalizedConstants.debugConsoleSessionTooLarge);
        }
        return events.sort((a, b) => a.seq - b.seq);
    }

    public query(events: DiagEvent[], query: EventQuery, gaps: GapRecord[]): EventQueryResult {
        const limit = Math.min(query.limit ?? 500, MAX_QUERY_LIMIT);
        const textTerms = [query.text ?? "", ...(query.textTerms ?? [])]
            .map((term) => term.toLowerCase())
            .filter(Boolean);
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
                (event.durationMs === undefined ||
                    (query.minDurationExclusive
                        ? event.durationMs <= query.minDurationMs
                        : event.durationMs < query.minDurationMs))
            )
                return false;
            if (
                query.maxDurationMs !== undefined &&
                (event.durationMs === undefined ||
                    (query.maxDurationExclusive
                        ? event.durationMs >= query.maxDurationMs
                        : event.durationMs > query.maxDurationMs))
            )
                return false;
            if (query.traceId && event.traceId !== query.traceId) return false;
            if (query.fromSeq !== undefined && event.seq < query.fromSeq) return false;
            if (query.beforeSeq !== undefined && event.seq >= query.beforeSeq) return false;
            if (textTerms.length > 0) {
                const haystack =
                    `${event.type} ${event.feature} ${event.traceId ?? ""} ${event.eventId} ${searchableDigests(event)}`.toLowerCase();
                if (!textTerms.every((term) => haystack.includes(term))) return false;
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

    /**
     * Retention. Only the CURRENT session (`currentSessionId`) is protected:
     * a manifest left "active" by a crash, kill, or OS shutdown (only close()
     * ever writes "closed") counts against the budget like any other, so the
     * store's count/age/size bounds hold for interrupted sessions too.
     */
    public enforceRetention(
        maxSessions: number,
        maxAgeDays: number,
        maxTotalBytes?: number,
        currentSessionId?: string,
    ): void {
        const sessions = this.listLocalSessions();
        const cutoff = Date.now() - maxAgeDays * 86_400_000;
        const protectedSession = (s: { manifest: SessionManifest }) =>
            currentSessionId !== undefined && s.manifest.sessionId === currentSessionId;
        const doomed = new Set(
            sessions.filter(
                (s, index) =>
                    !protectedSession(s) &&
                    (index >= maxSessions || Date.parse(s.manifest.createdUtc) < cutoff),
            ),
        );
        // Size budget: evict oldest sessions until the store fits.
        // The JSONL journal must never become a disk dragon under the desk.
        if (maxTotalBytes !== undefined && maxTotalBytes > 0) {
            let total = sessions
                .filter((s) => !doomed.has(s))
                .reduce((sum, s) => sum + this.sessionSizeBytes(s), 0);
            for (let i = sessions.length - 1; i >= 0 && total > maxTotalBytes; i--) {
                const session = sessions[i];
                if (doomed.has(session) || protectedSession(session)) {
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
        if (typeof session.manifest.sizeBytes === "number") {
            return session.manifest.sizeBytes;
        }
        // Older manifests: measure the events directory once.
        let total = 0;
        try {
            const eventsDir = path.join(session.dir, "events");
            for (const file of fs.readdirSync(containedPath(this.storeRoot, eventsDir))) {
                total += fs.lstatSync(
                    containedPath(this.storeRoot, path.join(eventsDir, file)),
                ).size;
            }
        } catch {
            // unreadable: treat as zero (age/count rules still apply)
        }
        return total;
    }

    /**
     * Store integrity check: every persisted session's manifest must agree
     * with what is actually on disk. Findings are strings a user can act on;
     * an empty list means the store is clean.
     *
     * Bounded: this runs on the extension-host thread on every Health page
     * open, so it never reads whole journals. Every segment is checked by
     * size and by bounded reads of its first and last bytes (the boundary
     * seq and the trailing newline); only the LAST segment of a session —
     * the one an interrupted write can leave torn — gets a full line count,
     * and that file is capped by SEGMENT_MAX_EVENTS at write time.
     */
    public validateStore(): { sessions: number; totalBytes: number; issues: string[] } {
        const issues: string[] = [];
        const sessions = this.listLocalSessions();
        let totalBytes = 0;
        for (const { manifest, dir } of sessions) {
            const label = manifest.sessionId;
            totalBytes += this.sessionSizeBytes({ manifest, dir });
            for (const [index, segment] of manifest.segments.entries()) {
                if (
                    typeof segment.file !== "string" ||
                    path.basename(segment.file) !== segment.file ||
                    !segment.file.endsWith(".jsonl")
                ) {
                    issues.push(`${label}: invalid segment path in manifest`);
                    continue;
                }
                const file = path.join(dir, "events", segment.file);
                if (!isContainedPath(this.storeRoot, file)) {
                    issues.push(`${label}: unsafe segment path in manifest`);
                    continue;
                }
                if (!fs.existsSync(file)) {
                    if (segment.events > 0) {
                        issues.push(
                            `${label}: segment ${segment.file} missing (${segment.events} events)`,
                        );
                    }
                    continue;
                }
                try {
                    const size = fs.statSync(file).size;
                    if (size === 0 && segment.events > 0) {
                        issues.push(
                            `${label}: ${segment.file} is empty, manifest says ${segment.events} event(s)`,
                        );
                        continue;
                    }
                    if (size > 0 && readTail(file, size, 1) !== "\n") {
                        issues.push(
                            `${label}: ${segment.file} has a partial trailing line (interrupted write)`,
                        );
                    }
                    const trailing = index === manifest.segments.length - 1;
                    if (trailing) {
                        const content = fs.readFileSync(file, "utf8");
                        const lines = content.split("\n").filter((l) => l.length > 0);
                        if (lines.length !== segment.events) {
                            issues.push(
                                `${label}: ${segment.file} has ${lines.length} line(s), manifest says ${segment.events}`,
                            );
                        }
                    }
                    // Seq sanity on the first line (bounded read, never the whole file).
                    try {
                        const head = readHead(file, VALIDATE_HEAD_BYTES);
                        const firstLine = head.split("\n")[0] ?? "";
                        if (firstLine.length > 0 && firstLine.length < VALIDATE_HEAD_BYTES) {
                            const first = JSON.parse(firstLine) as { seq?: number };
                            if (segment.firstSeq > 0 && first.seq !== segment.firstSeq) {
                                issues.push(
                                    `${label}: ${segment.file} first seq ${first.seq} != manifest ${segment.firstSeq}`,
                                );
                            }
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
        }
        return { sessions: sessions.length, totalBytes, issues };
    }

    /**
     * History aggregate for a stored session. Computed from the journal once
     * and persisted as a sidecar next to the manifest (closed sessions only —
     * an interrupted-but-final session is also stable, only the CURRENT
     * session keeps changing and is never cached). The journal itself is not
     * retained in memory: History no longer pays the full-session load.
     */
    public historySummaryFor(
        sessionId: string,
        compute: (events: DiagEvent[]) => SessionHistorySummary,
        options?: { cacheable: boolean },
    ): SessionHistorySummary {
        if (!SESSION_ID_PATTERN.test(sessionId)) {
            return { schemaVersion: HISTORY_SUMMARY_SCHEMA, events: 0, errors: 0, actions: [] };
        }
        const sessionDir = path.join(this.storeRoot, "sessions", sessionId);
        const sidecar = path.join(sessionDir, HISTORY_SUMMARY_FILE);
        const cacheable = options?.cacheable ?? true;
        if (cacheable) {
            try {
                const parsed: unknown = JSON.parse(
                    fs.readFileSync(containedPath(this.storeRoot, sidecar), "utf8"),
                );
                if (isHistorySummary(parsed)) {
                    return parsed;
                }
            } catch {
                // no sidecar yet (or unreadable): compute below
            }
        }
        // Use the cache only if the session is already loaded; otherwise read
        // the journal transiently without evicting the query cache.
        const events = this.cache.get(sessionId) ?? this.loadSessionEvents(sessionId);
        const summary = compute(events);
        if (cacheable) {
            try {
                fs.writeFileSync(
                    containedPath(this.storeRoot, sidecar),
                    JSON.stringify(summary),
                    "utf8",
                );
            } catch {
                // sidecar is an optimization; the summary is still returned
            }
        }
        return summary;
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

function isHistorySummary(value: unknown): value is SessionHistorySummary {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const summary = value as Partial<SessionHistorySummary>;
    return (
        summary.schemaVersion === HISTORY_SUMMARY_SCHEMA &&
        typeof summary.events === "number" &&
        typeof summary.errors === "number" &&
        Array.isArray(summary.actions) &&
        summary.actions.every(
            (action) =>
                typeof action === "object" &&
                action !== null &&
                typeof action.label === "string" &&
                typeof action.feature === "string" &&
                typeof action.status === "string" &&
                (action.durationMs === undefined || typeof action.durationMs === "number"),
        )
    );
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
