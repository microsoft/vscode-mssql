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
            if (query.processes && !query.processes.includes(event.process)) return false;
            if (query.features && !query.features.includes(event.feature)) return false;
            if (query.kinds && !query.kinds.includes(event.kind)) return false;
            if (query.statuses && !query.statuses.includes(event.status)) return false;
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

    public enforceRetention(maxSessions: number, maxAgeDays: number): void {
        const sessions = this.listLocalSessions();
        const cutoff = Date.now() - maxAgeDays * 86_400_000;
        const doomed = sessions.filter(
            (s, index) =>
                s.manifest.status !== "active" &&
                (index >= maxSessions || Date.parse(s.manifest.createdUtc) < cutoff),
        );
        for (const session of doomed) {
            try {
                fs.rmSync(session.dir, { recursive: true, force: true });
            } catch {
                // best effort; surfaced by next listing
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
