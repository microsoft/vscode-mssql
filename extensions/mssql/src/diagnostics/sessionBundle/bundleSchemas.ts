/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observability session-bundle contracts (final plan WI-2.3 / addendum §3.1
 * Amendment A, Appendix A — normative).
 *
 * The bundle is the ONE session-level catalog: `bundle.json` under
 * `<storeRoot>/sessions/<hostSessionId>/`, written exclusively by the
 * `ObservabilityBundleManager`. Every child artifact (diag stream, rich
 * feature capture, replay run, external refs) keeps owning its own manifest
 * wherever it lives; the bundle records safe metadata and RELATIVE child
 * manifest paths only — it never duplicates child segment lists or rich
 * payload metadata, and no two writers ever co-edit one file.
 *
 * Kept webview-safe (pure JSON types, no Node imports) so central preview
 * and Session History can consume descriptors directly.
 */

/** Frozen parent schema id (final plan §1.4). */
export const OBSERVABILITY_BUNDLE_SCHEMA = "mssql.observability.bundle/1";

/** The catalog file name inside a session directory. */
export const OBSERVABILITY_BUNDLE_FILE = "bundle.json";

export type ObservabilityArtifactKind =
    | "diagStream"
    | "featureCapture"
    | "replayRun"
    | "perfRunRef"
    | "sts2RunRef"
    | "externalImportRef";

export type ObservabilityArtifactStatus = "active" | "closed" | "partial" | "invalid" | "missing";

export type ObservabilityBundleStatus = "active" | "closed" | "partial";

/**
 * Per-artifact classification summary — enough for central preview to refuse
 * a whole artifact WITHOUT opening its payload segments (addendum §9.5).
 */
export interface ObservabilityArtifactClassificationV1 {
    containsRichPayload: boolean;
    /** Highest payload class the artifact may contain (e.g. "model.prompt"). */
    maximumClass: string;
    policyId: string;
    replayPayloadAvailable?: boolean;
}

/** One cataloged child artifact (Appendix A, normative). */
export interface ObservabilityArtifactDescriptorV1 {
    artifactId: string;
    kind: ObservabilityArtifactKind;
    featureId?: string;
    /** Schema id of the child's own manifest/journal, e.g. "mssql.diag.sessionManifest/1". */
    schema: string;
    /** Child manifest path relative to the SESSION directory (never absolute, never "..'d"). */
    relativeManifest?: string;
    /** External artifact reference (perf run dir, STS2 export, imported file). */
    externalRef?: string;
    createdUtc: string;
    updatedUtc: string;
    status: ObservabilityArtifactStatus;
    records?: number;
    events?: number;
    bytes: number;
    gaps: number;
    truncations: number;
    classification: ObservabilityArtifactClassificationV1;
    manifestDigest?: string;
}

export interface ObservabilityBundleTotalsV1 {
    artifacts: number;
    events?: number;
    records?: number;
    bytes: number;
    gaps: number;
    truncations: number;
}

/**
 * Bundle-level classification rollup (§3.1 "classification summary"):
 * central preview can refuse the whole bundle — or count what it refuses —
 * from this block alone. Additive to the Appendix A contract; absent on
 * bundles written before it existed.
 */
export interface ObservabilityBundleClassificationSummaryV1 {
    containsRichPayload: boolean;
    /** Highest maximumClass across artifacts ("diagnostic.metadata" when none). */
    maximumClass: string;
    richArtifactCount: number;
    replayPayloadAvailable: boolean;
}

/** The session-level catalog (Appendix A, normative). */
export interface ObservabilityBundleV1 {
    schema: typeof OBSERVABILITY_BUNDLE_SCHEMA;
    bundleId: string;
    hostSessionId: string;
    createdUtc: string;
    updatedUtc: string;
    closedUtc?: string;
    status: ObservabilityBundleStatus;
    provenance: {
        extensionVersion?: string;
        extensionCommit?: string;
        vscodeVersion?: string;
        platform?: string;
    };
    artifacts: ObservabilityArtifactDescriptorV1[];
    totals: ObservabilityBundleTotalsV1;
    classificationSummary?: ObservabilityBundleClassificationSummaryV1;
}

// ---------------------------------------------------------------------------
// Shape guards (bundles read back from disk are untrusted input)
// ---------------------------------------------------------------------------

export function isObservabilityBundleShape(value: unknown): value is ObservabilityBundleV1 {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const bundle = value as Record<string, unknown>;
    return (
        bundle.schema === OBSERVABILITY_BUNDLE_SCHEMA &&
        typeof bundle.bundleId === "string" &&
        typeof bundle.hostSessionId === "string" &&
        typeof bundle.status === "string" &&
        Array.isArray(bundle.artifacts) &&
        typeof bundle.totals === "object" &&
        bundle.totals !== null
    );
}

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/**
 * A descriptor path may only point INSIDE the session directory: relative,
 * no drive/root anchor, no "." or ".." segments. Anything else is refused —
 * deletion and validation never follow a path out of the session dir.
 */
export function isSafeBundleRelativePath(relativePath: unknown): relativePath is string {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
        return false;
    }
    if (relativePath.includes("\0")) {
        return false;
    }
    if (/^[/\\]/.test(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
        return false;
    }
    const segments = relativePath.split(/[/\\]/);
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** First path segment of a safe relative path ("rich", "replay", ...). */
export function bundlePathTopSegment(relativePath: string): string {
    return relativePath.split(/[/\\]/)[0];
}

// ---------------------------------------------------------------------------
// Aggregation (pure — the manager recomputes these on every write)
// ---------------------------------------------------------------------------

/**
 * Ascending sensitivity rank for known payload classes. Unknown classes rank
 * ABOVE everything known — conservative: central preview refuses what it
 * cannot classify.
 */
const PAYLOAD_CLASS_RANK: readonly string[] = [
    "diagnostic.metadata",
    "metric",
    "source.path",
    "user.text",
    "sql.text",
    "row.data",
    "model.prompt",
    "model.response",
];

function payloadClassRank(cls: string): number {
    const rank = PAYLOAD_CLASS_RANK.indexOf(cls);
    return rank === -1 ? PAYLOAD_CLASS_RANK.length : rank;
}

/** The more sensitive of two payload classes. */
export function maxPayloadClass(a: string, b: string): string {
    return payloadClassRank(b) > payloadClassRank(a) ? b : a;
}

export function computeBundleTotals(
    artifacts: readonly ObservabilityArtifactDescriptorV1[],
): ObservabilityBundleTotalsV1 {
    const totals: Required<ObservabilityBundleTotalsV1> = {
        artifacts: artifacts.length,
        events: 0,
        records: 0,
        bytes: 0,
        gaps: 0,
        truncations: 0,
    };
    for (const artifact of artifacts) {
        totals.events += artifact.events ?? 0;
        totals.records += artifact.records ?? 0;
        totals.bytes += artifact.bytes;
        totals.gaps += artifact.gaps;
        totals.truncations += artifact.truncations;
    }
    return totals;
}

export function computeBundleClassificationSummary(
    artifacts: readonly ObservabilityArtifactDescriptorV1[],
): ObservabilityBundleClassificationSummaryV1 {
    const summary: ObservabilityBundleClassificationSummaryV1 = {
        containsRichPayload: false,
        maximumClass: "diagnostic.metadata",
        richArtifactCount: 0,
        replayPayloadAvailable: false,
    };
    for (const artifact of artifacts) {
        if (artifact.classification.containsRichPayload) {
            summary.containsRichPayload = true;
            summary.richArtifactCount++;
        }
        if (artifact.classification.replayPayloadAvailable === true) {
            summary.replayPayloadAvailable = true;
        }
        summary.maximumClass = maxPayloadClass(
            summary.maximumClass,
            artifact.classification.maximumClass,
        );
    }
    return summary;
}
