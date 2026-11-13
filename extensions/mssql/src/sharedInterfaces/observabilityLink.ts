/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cross-plane identity: the versioned link block stamped on rich
 * feature-capture events (Plane B) so they can be walked to and from the
 * classified diagnostics substrate (Plane A). Plane-A events may carry the
 * reverse ID fields; they never carry rich content.
 *
 * Pure JSON-serializable contract — no imports, webview-safe.
 */

export const OBSERVABILITY_LINK_SCHEMA = "mssql.observabilityLink/1";

/** Editor surface a captured feature event originated from. */
export type ObservabilityEditorSurface = "classic" | "queryStudio" | "other";

export interface ObservabilityLinkV1 {
    schema: typeof OBSERVABILITY_LINK_SCHEMA;
    /** Feature-capture tenant, e.g. "completions" | "queryStudio". */
    featureId: string;
    /** One extension-host activation (the diag substrate's sessionId). */
    hostSessionId: string;
    /** One continuous rich-capture epoch for the feature (globally unique). */
    captureSessionId: string;
    /**
     * One logical rich feature event across its pending, finalized, and
     * acceptance records (globally unique; survives ring eviction).
     */
    captureEventId: string;
    /** Plane-A causal trace this event belongs to, when one was active. */
    traceId?: string;
    /** Plane-A eventId of the causing event, when known. */
    causeEventId?: string;
    editorSurface?: ObservabilityEditorSurface;
}

/**
 * Reverse-link attribute names Plane-A events use to point at a rich record.
 * All values are opaque IDs classified as diagnostic metadata — never content.
 */
export const OBSERVABILITY_REVERSE_LINK_ATTRS = {
    captureFeatureId: "captureFeatureId",
    captureSessionId: "captureSessionId",
    captureEventId: "captureEventId",
    replayRunId: "replayRunId",
    replayItemId: "replayItemId",
    matrixCellId: "matrixCellId",
} as const;
