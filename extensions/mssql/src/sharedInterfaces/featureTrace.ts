/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Versioned feature-trace export contracts (final plan WI-0.5 / addendum
 * §3.6). Schema versions are independent: the export envelope, the event
 * schema, and the overrides schema each answer their own compatibility
 * question. Pure JSON-serializable — webview-safe.
 */

export const FEATURE_TRACE_SCHEMA_V2 = "mssql.featureTrace/2";
export const RICH_CAPTURE_POLICY_SCHEMA = "mssql.richCapturePolicy/1";

/**
 * The effective rich-capture policy at capture time (addendum Appendix B).
 * Capture-time policy sets the maximum fidelity ever stored; export can only
 * reduce it further.
 */
export interface RichCapturePolicySnapshot {
    schema: typeof RICH_CAPTURE_POLICY_SCHEMA;
    policyId: string;
    featureId: string;
    fidelity: "fullLocal" | "contentRedacted" | "digestOnly";
    persistence: "memoryOnly" | "localJournal";
    source: "viewerLease" | "recordWhenClosed" | "developerPreset" | "test";
    activatedAt: number;
    expiresAt?: number;
    replayPayloadAvailable: boolean;
}

export interface FeatureTraceProvenance {
    extensionVersion?: string;
    extensionCommit?: string;
    vscodeVersion?: string;
    platform?: string;
    origin?: "localProduct" | "externalImport" | "generatedFixture";
}

export interface FeatureTraceTruncation {
    occurred: boolean;
    omittedEvents: number;
    firstRetainedAt?: number;
}

/** The v2 exported trace envelope (addendum §3.6). */
export interface FeatureTraceEnvelopeV2<TEvent, TOverrides> {
    schema: typeof FEATURE_TRACE_SCHEMA_V2;
    featureId: string;
    hostSessionId?: string;
    captureSessionId: string;
    /** Schema id of the event records, e.g. "mssql.inlineCompletionDebugEvent/1". */
    eventSchema: string;
    /** Schema id of the overrides object, e.g. "mssql.inlineCompletionDebugOverrides/1". */
    overridesSchema: string;
    exportedAt: number;
    savedAt: string;
    extensionVersion: string;
    events: TEvent[];
    overrides: TOverrides;
    capturePolicy?: RichCapturePolicySnapshot;
    truncation?: FeatureTraceTruncation;
    provenance?: FeatureTraceProvenance;
    /** Feature-specific envelope extras survive round-trips when safe. */
    [key: string]: unknown;
}

/** Resource limits enforced on parsed trace files (untrusted imports). */
export interface FeatureTraceLimits {
    maxFileBytes: number;
    maxEvents: number;
    maxStringLength: number;
    maxDepth: number;
}

export const DEFAULT_FEATURE_TRACE_LIMITS: FeatureTraceLimits = {
    maxFileBytes: 256 * 1024 * 1024,
    maxEvents: 200_000,
    maxStringLength: 4_000_000,
    maxDepth: 64,
};
