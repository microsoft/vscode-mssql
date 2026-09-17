/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical capability registry helpers (web addendum §3.3 / TSQ2 addendum
 * §3.2). The versioned `SqlCapabilitySet` is the source of truth; the legacy
 * boolean `SqlBackendCapabilities` struct is a derived projection so existing
 * bindings/consumers keep working during migration. The struct↔id mapping
 * lives ONLY here and is exhaustiveness-tested so the two views cannot drift.
 *
 * No vscode import — this module is part of the isomorphic domain core.
 */

import {
    CapabilityCheck,
    MissingCapability,
    SqlBackendCapabilities,
    SqlCapabilityFidelity,
    SqlCapabilityId,
    SqlCapabilityRequirement,
    SqlCapabilitySet,
    SqlCapabilitySupport,
    SqlCapabilityValue,
} from "./api";

// ---------------------------------------------------------------------------
// Struct ↔ id mapping
// ---------------------------------------------------------------------------

/**
 * Boolean-struct field → capability id. Every boolean field of
 * SqlBackendCapabilities MUST appear here (a unit test enforces coverage);
 * `protocolVersion` is identity metadata, not a capability, and is excluded.
 */
export const STRUCT_FIELD_TO_CAPABILITY: Readonly<
    Record<keyof Omit<SqlBackendCapabilities, "protocolVersion">, SqlCapabilityId>
> = {
    streamingRows: "exec.streamingRows",
    creditBackpressure: "exec.windowPages",
    cancel: "exec.cancel",
    dispose: "exec.dispose",
    oneActiveQueryPerSession: "exec.oneActiveQuery",
    multipleResultSets: "exec.multipleResultSets",
    serverMessagesVerbatim: "messages.verbatim",
    rowsAffectedStructured: "messages.rowsAffectedStructured",
    executionPlanXml: "plan.xmlResult",
    estimatedPlan: "plan.estimated",
    actualPlan: "plan.actual",
    typedCells: "types.typedCells",
    maxCellBytesHonored: "exec.maxCellBytes",
    pageRowsHonored: "exec.pageRows",
    pageBytesHonored: "exec.pageBytes",
    queryTimeoutHonored: "exec.queryTimeout",
    compactRows: "exec.compactRows",
    vectorBinaryV1: "types.vectorBinaryV1",
    spatialWkbV1: "types.spatialWkbV1",
    captureControl: "diag.captureControl",
    replayDescriptors: "diag.replayDescriptor",
    resumeAfterDisconnect: "diag.resumeAfterDisconnect",
    metadataEndpoints: "metadata.endpoints",
};

/** All capability ids (kept in one runtime list for exhaustive iteration). */
export const ALL_CAPABILITY_IDS: readonly SqlCapabilityId[] = [
    "auth.sqlLogin",
    "auth.entraToken",
    "auth.integrated",
    "auth.hostDelegated",
    "connect.tcp",
    "connect.routeAlias",
    "connect.localdb",
    "connect.tds8Strict",
    "exec.streamingRows",
    "exec.multipleResultSets",
    "exec.oneActiveQuery",
    "exec.cancel",
    "exec.dispose",
    "exec.queryTimeout",
    "exec.compactRows",
    "exec.maxCellBytes",
    "exec.pageRows",
    "exec.pageBytes",
    "exec.windowPages",
    "types.typedCells",
    "types.vectorBinaryV1",
    "types.spatialWkbV1",
    "types.decimalExact",
    "types.datetimeOffsetOriginal",
    "types.largeValueStreaming",
    "types.jsonNative",
    "messages.verbatim",
    "messages.rowsAffectedStructured",
    "plan.xmlResult",
    "plan.estimated",
    "plan.actual",
    "metadata.catalogSql",
    "metadata.endpoints",
    "diag.supportCapsule",
    "diag.captureControl",
    "diag.replayDescriptor",
    "diag.resumeAfterDisconnect",
];

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

export function capabilitySet(
    values: Partial<Record<SqlCapabilityId, SqlCapabilityValue>>,
): SqlCapabilitySet {
    return { schemaVersion: 1, values };
}

export function supported(
    source: SqlCapabilityValue["source"],
    fidelity: SqlCapabilityFidelity = "exact",
    extras?: Partial<SqlCapabilityValue>,
): SqlCapabilityValue {
    return { support: "supported", fidelity, source, ...extras };
}

export function unsupported(
    source: SqlCapabilityValue["source"],
    reasonCode: string,
): SqlCapabilityValue {
    return { support: "unsupported", source, reasonCode };
}

export function conditional(
    source: SqlCapabilityValue["source"],
    reasonCode: string,
): SqlCapabilityValue {
    return { support: "conditional", source, reasonCode };
}

/**
 * Overlay session/handshake facts onto a static statement. Later sources win
 * per id; the result keeps schemaVersion 1.
 */
export function mergeCapabilitySets(
    base: SqlCapabilitySet,
    ...overlays: readonly SqlCapabilitySet[]
): SqlCapabilitySet {
    const values: Partial<Record<SqlCapabilityId, SqlCapabilityValue>> = { ...base.values };
    for (const overlay of overlays) {
        for (const [id, value] of Object.entries(overlay.values)) {
            if (value) {
                values[id as SqlCapabilityId] = value;
            }
        }
    }
    return { schemaVersion: 1, values };
}

// ---------------------------------------------------------------------------
// Projections (compat bridges during migration)
// ---------------------------------------------------------------------------

/** Derive the legacy boolean struct from a capability set. */
export function booleanProjection(
    set: SqlCapabilitySet,
    protocolVersion?: string,
): SqlBackendCapabilities {
    const has = (id: SqlCapabilityId): boolean => set.values[id]?.support === "supported";
    const projected: SqlBackendCapabilities = {
        streamingRows: has("exec.streamingRows"),
        creditBackpressure: has("exec.windowPages"),
        cancel: has("exec.cancel"),
        dispose: has("exec.dispose"),
        oneActiveQueryPerSession: has("exec.oneActiveQuery"),
        multipleResultSets: has("exec.multipleResultSets"),
        serverMessagesVerbatim: has("messages.verbatim"),
        rowsAffectedStructured: has("messages.rowsAffectedStructured"),
        executionPlanXml: has("plan.xmlResult"),
        estimatedPlan: has("plan.estimated"),
        actualPlan: has("plan.actual"),
        typedCells: has("types.typedCells"),
        maxCellBytesHonored: has("exec.maxCellBytes"),
        pageRowsHonored: has("exec.pageRows"),
        pageBytesHonored: has("exec.pageBytes"),
        queryTimeoutHonored: has("exec.queryTimeout"),
        compactRows: has("exec.compactRows"),
        vectorBinaryV1: has("types.vectorBinaryV1"),
        spatialWkbV1: has("types.spatialWkbV1"),
        captureControl: has("diag.captureControl"),
        replayDescriptors: has("diag.replayDescriptor"),
        resumeAfterDisconnect: has("diag.resumeAfterDisconnect"),
        metadataEndpoints: has("metadata.endpoints"),
    };
    if (protocolVersion !== undefined) {
        projected.protocolVersion = protocolVersion;
    }
    return projected;
}

/**
 * Lift a negotiated boolean struct into a capability set (bridge for the STS2
 * and fake bindings until they produce sets natively). Boolean true maps to
 * supported; false maps to unsupported with a generic negotiation reason.
 */
export function setFromNegotiated(
    caps: SqlBackendCapabilities,
    source: SqlCapabilityValue["source"] = "handshake",
): SqlCapabilitySet {
    const values: Partial<Record<SqlCapabilityId, SqlCapabilityValue>> = {};
    for (const [field, id] of Object.entries(STRUCT_FIELD_TO_CAPABILITY)) {
        const raw = caps[field as keyof SqlBackendCapabilities];
        if (raw === undefined) {
            continue; // optional struct fields (metadataEndpoints) stay unknown
        }
        values[id] =
            raw === true
                ? { support: "supported", source }
                : { support: "unsupported", source, reasonCode: "negotiation.notAdvertised" };
    }
    return { schemaVersion: 1, values };
}

// ---------------------------------------------------------------------------
// Requirement evaluation (canOpen; runs BEFORE credential resolution)
// ---------------------------------------------------------------------------

const FIDELITY_RANK: Record<SqlCapabilityFidelity, number> = {
    lossy: 0,
    normalized: 1,
    exact: 2,
    notApplicable: 2, // n/a never blocks a fidelity floor
};

function meets(value: SqlCapabilityValue | undefined, req: SqlCapabilityRequirement): boolean {
    if (!value) {
        return false; // unknown never satisfies a hard requirement
    }
    if ("require" in req) {
        return value.support === "supported";
    }
    if ("fidelityAtLeast" in req) {
        if (value.support !== "supported") {
            return false;
        }
        const actual = value.fidelity ?? "exact";
        return FIDELITY_RANK[actual] >= FIDELITY_RANK[req.fidelityAtLeast];
    }
    return value.support === "supported" && (value.limit ?? 0) >= req.minimum;
}

/** Evaluate requirements against one capability set. Pure; no side effects. */
export function evaluateRequirements(
    set: SqlCapabilitySet,
    requirements: readonly SqlCapabilityRequirement[] | undefined,
): CapabilityCheck {
    if (!requirements || requirements.length === 0) {
        return { ok: true };
    }
    const missing: string[] = [];
    const missingDetail: MissingCapability[] = [];
    for (const req of requirements) {
        const value = set.values[req.id];
        if (!meets(value, req)) {
            missing.push(req.id);
            missingDetail.push({
                id: req.id,
                ...(value !== undefined ? { actual: value } : {}),
                ...(value?.reasonCode !== undefined ? { reasonCode: value.reasonCode } : {}),
            });
        }
    }
    if (missing.length === 0) {
        return { ok: true };
    }
    return {
        ok: false,
        missing,
        missingDetail,
        reason: `missing capabilities: ${missing.join(", ")}`,
    };
}

// ---------------------------------------------------------------------------
// Oracle answers
// ---------------------------------------------------------------------------

export interface CapabilityAnswer {
    /** "unknown" when a static statement defers to session negotiation. */
    readonly supported: boolean | "unknown";
    readonly value?: SqlCapabilityValue;
    readonly reason?: { code: string; support: SqlCapabilitySupport } | undefined;
    /** Backend kinds whose static statement answers supported/conditional. */
    readonly alternatives?: readonly string[];
    /** True when support additionally requires per-execute opt-in (vector/spatial). */
    readonly requiresOptIn?: boolean;
}

const OPT_IN_CAPABILITIES: ReadonlySet<SqlCapabilityId> = new Set([
    "types.vectorBinaryV1",
    "types.spatialWkbV1",
]);

export function answerFromSet(set: SqlCapabilitySet, id: SqlCapabilityId): CapabilityAnswer {
    const value = set.values[id];
    if (!value) {
        return { supported: "unknown" };
    }
    const supportedAnswer =
        value.support === "supported" ? true : value.support === "conditional" ? "unknown" : false;
    return {
        supported: supportedAnswer,
        value,
        ...(value.support !== "supported"
            ? { reason: { code: value.reasonCode ?? value.support, support: value.support } }
            : {}),
        ...(OPT_IN_CAPABILITIES.has(id) ? { requiresOptIn: true } : {}),
    };
}
