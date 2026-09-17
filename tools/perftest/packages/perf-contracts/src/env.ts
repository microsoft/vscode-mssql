/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-mode environment variable names (design §9). These are the entire
 * contract between the orchestrator and every instrumented process
 * (driver extension, vscode-mssql, STS, helpers). A process with
 * PERF_MODE unset must behave exactly as shipped.
 */
export const PerfEnv = {
    /** "1" enables perf mode everywhere. Absent ⇒ zero behavior change. */
    mode: "PERF_MODE",
    runId: "PERF_RUN_ID",
    repId: "PERF_REP_ID",
    scenarioId: "PERF_SCENARIO_ID",
    /** ws://127.0.0.1:<port>/control */
    controlUrl: "PERF_CONTROL_URL",
    /** Random 128-bit token; required on hello and marker POSTs. */
    controlToken: "PERF_CONTROL_TOKEN",
    /** http://127.0.0.1:<port>/v1/markers — direct marker ingestion. */
    markerUrl: "PERF_MARKER_URL",
    /** Absolute rep artifact directory. */
    artifactDir: "PERF_ARTIFACT_DIR",
    /** W3C traceparent of the rep root span. */
    traceparent: "PERF_TRACEPARENT",
    tracestate: "PERF_TRACESTATE",
    /** OTLP endpoint (diagnostic passes; seam preserved, consumer deferred). */
    otlpEndpoint: "PERF_OTLP_ENDPOINT",
    /** off | minimal | full (design §17.1). */
    otelMode: "PERF_OTEL_MODE",
    markersEnabled: "PERF_MARKERS_ENABLED",
    captureSqlText: "PERF_CAPTURE_SQL_TEXT",
    captureResultData: "PERF_CAPTURE_RESULT_DATA",
} as const;

export function isPerfMode(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[PerfEnv.mode] === "1";
}
