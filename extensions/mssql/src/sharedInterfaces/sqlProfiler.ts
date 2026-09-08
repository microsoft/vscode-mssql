/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State and reducers shared between the profiler webview and its controller.
 *
 * Rows carry only the fields the grid shows. The full field set for one event is fetched on
 * selection instead, so a busy capture does not push every field of every event across the wire
 * four times a second.
 */

export type ProfilerViewMode = "live" | "topQueries";

export type ProfilerCaptureStatus =
    | "idle"
    | "starting"
    | "streaming"
    | "reconnecting"
    | "stopped"
    | "failed";

/** One row in the live grid. */
export interface ProfilerRow {
    /** Sequence number where the session collects one; otherwise a local counter. */
    id: number;
    name: string;
    timestamp: string;
    /** Only the columns the current view shows. */
    values: Record<string, string>;
}

/** Every field of one event, shown in the details pane when a row is selected. */
export interface ProfilerEventDetail {
    id: number;
    name: string;
    timestamp: string;
    fields: [string, string][];
}

/** A break in the capture, rendered inline so a gap never reads as an idle server. */
export interface ProfilerGapMarker {
    id: number;
    fromSequence: number;
    toSequence: number;
    count: number;
    reason: "bufferOverflow" | "streamInterrupted" | "cellTruncated";
    durationMs?: number;
}

/** One row of the top-queries view. */
export interface ProfilerTopQueryRow {
    key: string;
    text: string;
    count: number;
    totalDurationUs: number;
    avgDurationUs: number;
    maxDurationUs: number;
    totalCpuUs: number;
    totalLogicalReads: number;
    lastSeen: string;
}

export interface ProfilerSessionOption {
    name: string;
    /** Friendly label, since a generated session name is not something to read. */
    label: string;
    isRunning: boolean;
    ownedByThisClient: boolean;
    /** True when the owning client is gone, so this session is a leak worth cleaning up. */
    isOrphan: boolean;
}

export interface ProfilerTemplateOption {
    id: string;
    title: string;
    description: string;
}

/**
 * Throughput and loss, so a user can tell a healthy capture from one that is falling behind.
 * A profiler that hides this leaves people trusting an incomplete picture.
 */
export interface ProfilerHealth {
    /** Events per second over the last few seconds. */
    eventsPerSecond: number;
    /** How long the current capture has been running. */
    elapsedMs: number;
    /** Events waiting to be added to the window, which grows when the viewer falls behind. */
    queuedCount: number;
    /** Events dropped from the retained window to stay within its size. */
    discardedCount: number;
}

/** One line of the filter syntax help, sourced from the grammar that implements it. */
export interface FilterExample {
    syntax: string;
    meaning: string;
}

export interface SqlProfilerState {
    status: ProfilerCaptureStatus;
    /** Present while reconnecting or after a failure, saying what happened. */
    statusDetail?: string;
    viewMode: ProfilerViewMode;

    sessionName?: string;
    /** Friendly label for the running session. */
    sessionLabel?: string;
    /** Sessions on the server, for choosing one or cleaning up leftovers. */
    sessions: ProfilerSessionOption[];
    /** Set when sessions from an earlier run are still running. */
    orphanCount: number;
    /** Built-in sessions offered for this server; empty where Extended Events do not exist. */
    templates: ProfilerTemplateOption[];

    /** Newest events, bounded for rendering. */
    rows: ProfilerRow[];
    gaps: ProfilerGapMarker[];
    topQueries: ProfilerTopQueryRow[];

    /** Column names to show in the live grid, in order. */
    columns: string[];

    /** Total captured, retained in the window, and rendered right now. */
    capturedCount: number;
    retainedCount: number;
    renderedCount: number;
    /** Events the server produced that never arrived. */
    lostCount: number;
    health: ProfilerHealth;

    /**
     * True when the grid is frozen. Capture keeps running underneath either way: only the rows
     * on screen are held, so what someone scrolled up to read is not evicted under them.
     */
    isPaused: boolean;
    /**
     * True when the freeze was asked for with the Pause button rather than caused by scrolling.
     * Scrolling back to the newest row lifts its own hold, but never someone's explicit pause.
     */
    pausedByUser: boolean;
    /** Events that arrived while the grid was frozen. */
    pausedBacklog: number;

    /** Filter expression applied across the whole retained window, not just what is rendered. */
    filterText: string;
    /** Syntax help, shipped from the package so the examples cannot drift from the parser. */
    filterExamples: FilterExample[];
    /** Set when the live view is narrowed to one query from the top-queries view. */
    queryFilterText?: string;

    selectedRowId?: number;
    selectedEvent?: ProfilerEventDetail;

    /** True when viewing a saved capture or an .xel file: no capture controls apply. */
    isReadOnly: boolean;
    /** Name of the opened file, when read-only. */
    sourceName?: string;

    /** Deletion state is scoped to the named server session, separate from capture status. */
    sessionDeletion?: { sessionName: string; busy: boolean; error?: string; completed?: boolean };
    errorMessage?: string;
    /** Keeps the newest row in view. Separate from pausing: capture is unaffected either way. */
    autoScroll: boolean;
}

export interface SqlProfilerReducers {
    start: { sessionName: string };
    stop: Record<string, never>;
    clear: Record<string, never>;
    setViewMode: { mode: ProfilerViewMode };
    setAutoScroll: { enabled: boolean };
    /** Freezes or resumes the grid. Capture continues either way. */
    setPaused: { paused: boolean; byUser?: boolean };
    /** Narrows the retained window by free text. */
    setFilter: { text: string };
    /** Loads every field of one event into the details pane. */
    selectRow: { rowId?: number };
    refreshSessions: Record<string, never>;
    /** Creates a session from a built-in template and starts capturing from it. */
    createSession: { templateId: string };
    /** Drops sessions left behind by an earlier run. */
    cleanUpOrphans: Record<string, never>;
    dropSession: { sessionName: string };
    saveCapture: Record<string, never>;
    exportCsv: Record<string, never>;
    /** Opens the execution plan for the query in a row, if one can be found. */
    showPlan: { rowId: number };
    /** Narrows the live grid to one query from the top-queries view. */
    filterToQuery: { key: string };
}

/** Human wording for why events were lost, for the gap marker. */
export const GAP_REASONS: Record<ProfilerGapMarker["reason"], string> = {
    bufferOverflow: "events were dropped by the server",
    streamInterrupted: "the connection dropped",
    cellTruncated: "a buffer was too large to transfer",
};

export function describeGap(gap: ProfilerGapMarker): string {
    const why = GAP_REASONS[gap.reason];
    if (gap.count > 0) {
        return `${gap.count.toLocaleString()} events not captured — ${why}`;
    }
    if (gap.durationMs !== undefined) {
        return `Capture interrupted for ${(gap.durationMs / 1000).toFixed(1)}s — ${why}`;
    }
    return `Events not captured — ${why}`;
}

/**
 * Renders a microsecond duration. Extended Events reports durations in microseconds, which is
 * easy to misread by a factor of 1000, so the unit is always shown.
 */
export function formatDuration(microseconds: number): string {
    if (!Number.isFinite(microseconds)) {
        return "";
    }
    if (microseconds < 1000) {
        return `${Math.round(microseconds)} µs`;
    }
    if (microseconds < 1_000_000) {
        return `${(microseconds / 1000).toFixed(1)} ms`;
    }
    return `${(microseconds / 1_000_000).toFixed(2)} s`;
}

/**
 * Clock time with milliseconds. A busy server puts thousands of events in one second, so a
 * second-resolution stamp makes them all look simultaneous.
 */
export function formatEventTime(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return timestamp;
    }
    const time = date.toLocaleTimeString(undefined, { hour12: false });
    return `${time}.${date.getMilliseconds().toString().padStart(3, "0")}`;
}

/** Elapsed capture time, for the status area. */
export function formatElapsed(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return "";
    }
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const mm = minutes.toString().padStart(2, "0");
    const ss = seconds.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Display names for the fields and events the grid shows.
 *
 * Extended Events names are engine identifiers. Showing them raw makes the tool read as a dump
 * of internals rather than something built for the person reading it.
 */
export const FIELD_LABELS: Record<string, string> = {
    batch_text: "Statement",
    statement: "Statement",
    sql_text: "Statement",
    duration: "Duration",
    cpu_time: "CPU",
    logical_reads: "Logical reads",
    physical_reads: "Physical reads",
    page_server_reads: "Page server reads",
    writes: "Writes",
    spills: "Spills",
    row_count: "Rows",
    result: "Result",
    database_name: "Database",
    client_app_name: "Client application",
    client_hostname: "Client host",
    session_id: "Session",
    username: "User",
    server_principal_name: "Login",
    query_hash: "Query hash",
    error_number: "Error",
    severity: "Severity",
    message: "Message",
};

export function fieldLabel(field: string): string {
    return FIELD_LABELS[field] ?? humanize(field);
}

/** Display names for event types, e.g. `sql_batch_completed` reads as "SQL batch completed". */
export function eventLabel(name: string): string {
    const spaced = humanize(name);
    return spaced.replace(/^Sql\b/, "SQL").replace(/^Rpc\b/, "RPC");
}

function humanize(identifier: string): string {
    const words = identifier.replace(/_/g, " ").trim();
    return words.length === 0 ? identifier : words[0].toUpperCase() + words.slice(1);
}

/**
 * Explains the relationship between rendered, retained and captured counts.
 *
 * "10,000 shown of 144,186 captured" invites the reader to assume the rest is retrievable. It
 * is not: the window is bounded and older events are gone.
 */
export function describeCounts(
    rendered: number,
    retained: number,
    captured: number,
    filtered: boolean,
): string {
    const parts = [`${rendered.toLocaleString()} shown`];
    if (retained > rendered) {
        parts.push(`${retained.toLocaleString()} ${filtered ? "matching" : "in buffer"}`);
    }
    if (captured > retained) {
        parts.push(`${captured.toLocaleString()} captured`);
    }
    return parts.join(" · ");
}
