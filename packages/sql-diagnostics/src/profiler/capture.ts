/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventGap } from "./liveStream";
import { ProfilerEvent } from "./xelParser";

/**
 * A saved profiler capture.
 *
 * CSV export loses the field fidelity that makes a trace worth keeping and cannot be reopened.
 * This format keeps every field, the session it came from, and — importantly — the gaps, so
 * whoever opens it later can tell a quiet server from a capture that dropped events.
 */

export const CAPTURE_FORMAT = "mssql-profiler-capture";
export const CAPTURE_VERSION = 1;

export interface CaptureFile {
    readonly format: typeof CAPTURE_FORMAT;
    readonly version: number;
    readonly savedAt: string;
    readonly session: CaptureSessionInfo;
    /** Losses recorded during capture. Absent gaps mean none were detected, not none occurred. */
    readonly gaps: readonly EventGap[];
    readonly events: readonly ProfilerEvent[];
}

export interface CaptureSessionInfo {
    readonly sessionName: string;
    readonly serverName?: string;
    readonly database?: string;
    readonly platform?: string;
    /** ISO 8601 bounds of the capture, from the first and last event. */
    readonly startedAt?: string;
    readonly endedAt?: string;
    /** Which template the session was created from, when it came from one. */
    readonly template?: string;
    /**
     * True when the events are a bounded window rather than the whole session, which is the
     * normal case: the profiler retains a fixed number of recent events.
     */
    readonly windowed: boolean;
}

export function buildCapture(
    session: Omit<CaptureSessionInfo, "startedAt" | "endedAt">,
    events: readonly ProfilerEvent[],
    gaps: readonly EventGap[] = [],
): CaptureFile {
    return {
        format: CAPTURE_FORMAT,
        version: CAPTURE_VERSION,
        savedAt: new Date().toISOString(),
        session: {
            ...session,
            startedAt: events[0]?.timestamp,
            endedAt: events[events.length - 1]?.timestamp,
        },
        gaps,
        events,
    };
}

export function serializeCapture(capture: CaptureFile): string {
    return JSON.stringify(capture, null, 2);
}

/**
 * Reads a saved capture, rejecting anything that is not one rather than half-loading it.
 */
export function parseCapture(text: string): CaptureFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("This file is not a profiler capture: it is not valid JSON.");
    }

    const candidate = parsed as Partial<CaptureFile>;
    if (candidate.format !== CAPTURE_FORMAT) {
        throw new Error("This file is not a profiler capture.");
    }
    if (typeof candidate.version !== "number" || candidate.version > CAPTURE_VERSION) {
        throw new Error(
            `This capture was written by a newer version of the extension (format ${candidate.version}). Update to open it.`,
        );
    }
    if (!Array.isArray(candidate.events)) {
        throw new Error("This capture is missing its events.");
    }

    return {
        format: CAPTURE_FORMAT,
        version: candidate.version,
        savedAt: candidate.savedAt ?? "",
        session: candidate.session ?? { sessionName: "(unknown)", windowed: true },
        gaps: Array.isArray(candidate.gaps) ? candidate.gaps : [],
        events: candidate.events,
    };
}

/** Escapes a value for CSV: quote anything containing a delimiter, double embedded quotes. */
function csvCell(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Renders events as CSV for spreadsheet use. Columns are the union of every field present, so
 * nothing is silently dropped because it was absent from the first event.
 */
export function eventsToCsv(events: readonly ProfilerEvent[]): string {
    const fields = new Set<string>();
    for (const event of events) {
        for (const key of Object.keys(event.values)) {
            fields.add(key);
        }
    }

    const columns = ["name", "timestamp", "eventSequence", ...[...fields].sort()];
    const header = columns.join(",");
    const rows = events.map((event) =>
        columns
            .map((column) => {
                if (column === "name") return csvCell(event.name);
                if (column === "timestamp") return csvCell(event.timestamp);
                if (column === "eventSequence") return csvCell(event.eventSequence);
                return csvCell(event.values[column]);
            })
            .join(","),
    );

    return [header, ...rows].join("\n");
}
