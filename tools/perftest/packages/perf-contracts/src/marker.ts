/**
 * TypeScript mirror of schemas/marker.schema.json (design §10).
 * Markers are append-only semantic events — the lowest-overhead, most durable
 * measurement signal. `scenario.start` and `scenario.end` are required for
 * every valid rep.
 */

export type MarkerPhase = "instant" | "begin" | "end" | "counter";

/**
 * Well-known process roles (design §15). The schema keeps `role` an open
 * string so new roles never break validation; use these values when possible.
 */
export type ProcessRole =
    | "orchestrator"
    | "vscodeMain"
    | "renderer"
    | "extensionHost"
    | "webview"
    | "sts"
    | "sqlserver"
    | "mcp"
    | "languageServer"
    | "debugAdapter"
    | "child";

export interface MarkerProcess {
    /** Process role; see ProcessRole for well-known values. */
    role: string;
    pid: number;
    name: string;
}

export interface MarkerThread {
    id?: string | number;
    name?: string;
}

export type AttrValue = string | number | boolean | null;

export interface Marker {
    schemaVersion: 1;
    runId: string;
    repId: number;
    scenarioId: string;
    name: string;
    phase: MarkerPhase;
    /** Pairs begin/end markers of the same name into one duration. */
    correlationId?: string;
    /** Epoch nanoseconds as decimal string (cross-process ordering plane). */
    timestampUnixNs: string;
    /** Process-local monotonic nanoseconds as decimal string (exact intervals). */
    monotonicNs?: string;
    /** W3C trace id (32 lowercase hex chars) when available. */
    traceId?: string;
    /** W3C span id (16 lowercase hex chars) when available. */
    spanId?: string;
    process: MarkerProcess;
    thread?: MarkerThread;
    attrs?: Record<string, AttrValue>;
}

/** Marker names required for a rep to be valid (design §10 rules). */
export const REQUIRED_SCENARIO_MARKERS = ["scenario.start", "scenario.end"] as const;

/** Well-known marker names emitted by the harness and driver. */
export const MarkerNames = {
    scenarioStart: "scenario.start",
    scenarioEnd: "scenario.end",
    automationReady: "automation.ready",
} as const;
