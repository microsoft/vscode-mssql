/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stored-session provider for the completions Sessions dataset (WI-2.5 — the
 * M3 "journal-backed history side-by-side" stage).
 *
 * Enumerates `<storeRoot>/sessions/<hostSessionId>/rich/completions/
 * <captureSessionId>/manifest.json` and turns each stream into a dataset
 * index entry. Design decisions (documented):
 *
 * - enumeration is INDEPENDENT of SessionStore.listLocalSessions: it walks
 *   the fixed rich/completions layout directly, so bundle-only session
 *   directories (no diag manifest.json) are naturally admitted — the
 *   store-level listLocalSessions gap is fixed separately in sessionStore.ts
 *   so retention/clear/validate also cover such sessions;
 * - the index is built from the child MANIFEST ONLY — no segment is opened
 *   during a scan (§14 "manifest-only scan"). Facets the manifest cannot
 *   provide (profile, schema mode, date range) stay undefined rather than
 *   triggering a segment parse;
 * - the CURRENT capture epoch's stream(s) are EXCLUDED from the index: that
 *   data is the live ring's — listing it would double-count events between
 *   the Live tab and the Sessions dataset. Exclusion matches on the
 *   manifest's stream.captureSessionId, which covers policy-phase sibling
 *   directories (`<epoch>--2`) too;
 * - new entries default to NOT included: loading a stored session parses its
 *   segments, and that stays an explicit user gesture (dataset opt-in);
 * - stored-session entries are read-only in this stage — retention owns
 *   deletion (no delete affordance, WI-2.5).
 *
 * Loading an included entry = journal reader → lifecycle reducer →
 * `projectJournalToCompletionEvents`, wrapped as a v1 export envelope so the
 * Sessions tab consumes it exactly like a file trace. The overrides object is
 * not recorded by the journal (arrives with the §5.4 effective-config work),
 * so loaded stored sessions carry default overrides.
 */

import {
    JOURNAL_MANIFEST_FILE,
    JournalFsLike,
    NodeJournalFs,
    joinPath,
} from "../../diagnostics/featureCapture/journal/journalWriter";
import { readFeatureCaptureJournal } from "../../diagnostics/featureCapture/journal/journalReader";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FeatureCaptureManifestV1,
} from "../../diagnostics/featureCapture/journal/journalSchemas";
import {
    InlineCompletionDebugExportData,
    InlineCompletionDebugTraceIndexEntry,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { inlineCompletionDebugDefaultOverrides } from "./inlineCompletionDebugStore";
import { projectJournalToCompletionEvents } from "./completionsJournalProjection";

export const STORED_SESSION_FILE_KEY_PREFIX = "storedSession:";

export interface CompletionsStoredSessionLocator {
    /** The session-diag store root (DiagnosticsManager's SessionStore root). */
    storeRoot: string;
    /** True for the LIVE epoch — its stream(s) are the ring's data. */
    isCurrentEpoch(captureSessionId: string): boolean;
    fs?: JournalFsLike;
}

let locator: CompletionsStoredSessionLocator | undefined;

/** Wired by the completions journal initialization; undefined = provider off. */
export function configureCompletionsStoredSessions(
    next: CompletionsStoredSessionLocator | undefined,
): void {
    locator = next;
}

export function completionsStoredSessionsConfigured(): boolean {
    return locator !== undefined;
}

export interface ListStoredSessionOptions {
    /** fileKeys the user already included (survives refresh). */
    includedFileKeys?: ReadonlySet<string>;
    loadedFileKeys?: ReadonlySet<string>;
    /** When false (first scan), stored sessions default to NOT included. */
    hadExistingIndex?: boolean;
}

/**
 * Manifest-only enumeration of stored completions capture sessions. Never
 * throws; unreadable directories/manifests are skipped (the store may be
 * mid-write — the live catalog is honest about that elsewhere).
 */
export async function listStoredCompletionSessionEntries(
    options: ListStoredSessionOptions = {},
): Promise<InlineCompletionDebugTraceIndexEntry[]> {
    const active = locator;
    if (!active) {
        return [];
    }
    const fs = active.fs ?? new NodeJournalFs();
    const includedFileKeys = options.includedFileKeys ?? new Set<string>();
    const loadedFileKeys = options.loadedFileKeys ?? new Set<string>();
    const entries: InlineCompletionDebugTraceIndexEntry[] = [];
    const sessionsDir = joinPath(active.storeRoot, "sessions");
    for (const hostSessionId of await fs.readdir(sessionsDir)) {
        const streamsDir = joinPath(sessionsDir, `${hostSessionId}/rich/completions`);
        for (const streamDirName of await fs.readdir(streamsDir)) {
            const streamDir = joinPath(streamsDir, streamDirName);
            let manifest: FeatureCaptureManifestV1;
            try {
                const raw = await fs.readFile(joinPath(streamDir, JOURNAL_MANIFEST_FILE));
                const parsed = JSON.parse(raw) as FeatureCaptureManifestV1;
                if (parsed?.schema !== FEATURE_CAPTURE_MANIFEST_SCHEMA) {
                    continue;
                }
                manifest = parsed;
            } catch {
                // No checkpoint yet (or torn manifest): not listable evidence.
                continue;
            }
            const captureSessionId = manifest.stream?.captureSessionId ?? streamDirName;
            if (active.isCurrentEpoch(captureSessionId)) {
                continue; // the live ring's data — never double-listed
            }
            const fileKey = `${STORED_SESSION_FILE_KEY_PREFIX}${hostSessionId}/${streamDirName}`;
            const savedAt = manifest.closedUtc ?? manifest.updatedUtc ?? manifest.createdUtc;
            entries.push({
                fileKey,
                filename: formatStoredSessionLabel(manifest, streamDirName),
                path: streamDir,
                savedAt,
                sessionId: captureSessionId,
                eventCount: manifest.totals?.events ?? 0,
                fileSizeBytes: manifest.totals?.bytes ?? 0,
                // No event timestamps in the manifest — undefined, no parse.
                dateRange: undefined,
                included: options.hadExistingIndex === true ? includedFileKeys.has(fileKey) : false,
                loaded: loadedFileKeys.has(fileKey),
                imported: false,
                sourceKind: "storedSession",
                capturePolicyId: manifest.stream?.capturePolicyId,
                recordCount: manifest.totals?.records,
            });
        }
    }
    return entries;
}

/**
 * Load one stored session: journal reader → lifecycle reducer →
 * compatibility projection, wrapped as the v1 export envelope the Sessions
 * dataset already consumes.
 */
export async function loadStoredCompletionSessionTrace(
    entry: Pick<InlineCompletionDebugTraceIndexEntry, "path" | "savedAt">,
): Promise<InlineCompletionDebugExportData> {
    const fs = locator?.fs ?? new NodeJournalFs();
    const result = await readFeatureCaptureJournal(entry.path, { fs });
    const events = projectJournalToCompletionEvents(result.state);
    const savedAt = entry.savedAt ?? new Date().toISOString();
    return {
        version: 1,
        exportedAt: Date.parse(savedAt) || Date.now(),
        _savedAt: savedAt,
        _extensionVersion: "storedSession",
        overrides: { ...inlineCompletionDebugDefaultOverrides },
        recordWhenClosed: false,
        events,
    };
}

function formatStoredSessionLabel(
    manifest: FeatureCaptureManifestV1,
    streamDirName: string,
): string {
    let stamp = manifest.createdUtc;
    try {
        const date = new Date(manifest.createdUtc);
        stamp = `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
    } catch {
        // keep the raw string
    }
    return `session ${stamp} · ${streamDirName.slice(0, 11)}`;
}
