/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic feature-trace serialization: a versioned JSON envelope over a
 * feature's captured events, with key-driven redaction and an oldest-first
 * size cap. Features supply their sensitive-key set (and any structural
 * special cases) — the walker and the envelope are shared.
 *
 * Two envelope generations exist (final plan WI-0.5):
 * - v1 (`version: 1`) — the legacy single-number envelope; still loadable
 *   and still what live persistence writes until the Phase-2 cutover.
 * - v2 (`schema: "mssql.featureTrace/2"`) — independent envelope/event/
 *   overrides schema ids, capture policy, truncation report, provenance.
 * Unknown major versions are REJECTED with an actionable error — never
 * coerced (imports are untrusted; addendum §3.6/§9.3).
 */

import {
    DEFAULT_FEATURE_TRACE_LIMITS,
    FEATURE_TRACE_SCHEMA_V2,
    FeatureTraceEnvelopeV2,
    FeatureTraceLimits,
    FeatureTraceProvenance,
    FeatureTraceTruncation,
    RichCapturePolicySnapshot,
} from "../../sharedInterfaces/featureTrace";

export interface FeatureTraceEnvelope<TEvent, TOverrides> {
    version: 1;
    exportedAt: number;
    _savedAt: string;
    _extensionVersion: string;
    _truncated?: boolean;
    overrides: TOverrides;
    recordWhenClosed: boolean;
    events: TEvent[];
    /** Set by the normalizer: which on-disk generation this trace came from. */
    _sourceSchema?: "v1" | typeof FEATURE_TRACE_SCHEMA_V2;
    /** v2-only envelope metadata, preserved through normalization. */
    _v2?: {
        featureId: string;
        hostSessionId?: string;
        captureSessionId: string;
        eventSchema: string;
        overridesSchema: string;
        capturePolicy?: RichCapturePolicySnapshot;
        truncation?: FeatureTraceTruncation;
        provenance?: FeatureTraceProvenance;
    };
}

export interface FeatureTraceMetadata<TOverrides> {
    exportedAt?: number;
    savedAt?: string;
    extensionVersion: string;
    overrides: TOverrides;
    recordWhenClosed: boolean;
    /** Feature-specific envelope extras (e.g. customPromptLastSavedAt) — spread into the file verbatim. */
    extra?: Record<string, unknown>;
}

export interface FeatureTraceRedaction {
    /** Any value under one of these keys (at any depth) is replaced. */
    redactedKeys: ReadonlySet<string>;
    /**
     * Structural special cases the key set can't express (e.g. redact
     * `content` inside every promptMessages[] entry). Return the replacement
     * value, or undefined to fall through to the default walk.
     */
    redactSpecial?: (key: string, value: unknown) => unknown | undefined;
    /** Replacement token; defaults to "[REDACTED]". */
    replacement?: string;
}

export interface SerializeFeatureTraceOptions {
    /** Apply the feature's redaction rules before writing. */
    redact?: boolean;
    redaction?: FeatureTraceRedaction;
    maxFileSizeMB?: number;
}

export const FEATURE_TRACE_REDACTED = "[REDACTED]";

export function serializeFeatureTrace<TEvent, TOverrides>(
    events: TEvent[],
    metadata: FeatureTraceMetadata<TOverrides>,
    options: SerializeFeatureTraceOptions = {},
): FeatureTraceEnvelope<TEvent, TOverrides> {
    const trace: FeatureTraceEnvelope<TEvent, TOverrides> = {
        version: 1,
        exportedAt: metadata.exportedAt ?? Date.now(),
        _savedAt: metadata.savedAt ?? new Date().toISOString(),
        _extensionVersion: metadata.extensionVersion,
        overrides: cloneJson(metadata.overrides),
        recordWhenClosed: metadata.recordWhenClosed,
        ...(metadata.extra ?? {}),
        events: cloneJson(events),
    };

    const redacted =
        options.redact && options.redaction
            ? (redactValue(trace, options.redaction) as FeatureTraceEnvelope<TEvent, TOverrides>)
            : trace;
    return truncateTraceToMaxSize(redacted, options.maxFileSizeMB);
}

export function redactValue(
    value: unknown,
    redaction: FeatureTraceRedaction,
    key?: string,
): unknown {
    const replacement = redaction.replacement ?? FEATURE_TRACE_REDACTED;
    if (key && redaction.redactedKeys.has(key)) {
        return replacement;
    }

    if (key && redaction.redactSpecial) {
        const special = redaction.redactSpecial(key, value);
        if (special !== undefined) {
            return special;
        }
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, redaction));
    }

    if (!isRecord(value)) {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        output[entryKey] = redactValue(entryValue, redaction, entryKey);
    }

    return output;
}

function truncateTraceToMaxSize<TEvent, TOverrides>(
    trace: FeatureTraceEnvelope<TEvent, TOverrides>,
    maxFileSizeMB: number | undefined,
): FeatureTraceEnvelope<TEvent, TOverrides> {
    if (!maxFileSizeMB || maxFileSizeMB <= 0) {
        return trace;
    }

    const maxBytes = Math.floor(maxFileSizeMB * 1024 * 1024);
    if (Buffer.byteLength(JSON.stringify(trace), "utf8") <= maxBytes) {
        return trace;
    }

    const truncatedTrace: FeatureTraceEnvelope<TEvent, TOverrides> = {
        ...trace,
        _truncated: true,
        events: [...trace.events],
    };

    while (
        truncatedTrace.events.length > 0 &&
        Buffer.byteLength(JSON.stringify(truncatedTrace), "utf8") > maxBytes
    ) {
        truncatedTrace.events.shift();
    }

    return truncatedTrace;
}

export interface NormalizeFeatureTraceOptions {
    featureLabel: string;
    normalizeExtra?: (raw: Record<string, unknown>) => Record<string, unknown>;
    /** Resource limits for untrusted files; DEFAULT_FEATURE_TRACE_LIMITS when omitted. */
    limits?: FeatureTraceLimits;
    /** When set, a v2 file whose featureId differs is rejected. */
    expectedFeatureId?: string;
}

/**
 * Strict, versioned normalization of a parsed trace file (WI-0.5):
 * - v1 (`version: 1`, or the pre-versioning legacy shape) loads as before;
 * - v2 (`schema: "mssql.featureTrace/2"`) validates its required envelope
 *   fields and is normalized to the in-memory v1 shape + `_v2` metadata;
 * - unknown major versions/schemas are rejected with an actionable error;
 * - resource limits are enforced (untrusted imports).
 * Feature-specific field coercions ride the `normalizeExtra` hook.
 */
export function normalizeFeatureTraceFile<TEvent, TOverrides>(
    value: unknown,
    source: string,
    options: NormalizeFeatureTraceOptions,
): FeatureTraceEnvelope<TEvent, TOverrides> {
    if (!isRecord(value) || !Array.isArray(value.events)) {
        throw new Error(`${source} is not a ${options.featureLabel} trace JSON file.`);
    }
    const raw = value as Record<string, unknown> & { events: unknown[] };

    const limits = options.limits ?? DEFAULT_FEATURE_TRACE_LIMITS;
    if (typeof value.schema === "string") {
        if (value.schema !== FEATURE_TRACE_SCHEMA_V2) {
            throw new Error(
                `${source} has unsupported trace schema "${value.schema}". This build supports ` +
                    `v1 traces and "${FEATURE_TRACE_SCHEMA_V2}" — re-export the trace or update the extension.`,
            );
        }
        assertFeatureTraceWithinLimits(raw, source, limits);
        return normalizeV2TraceFile(raw, source, options);
    }

    if (value.version !== undefined && value.version !== 1) {
        throw new Error(
            `${source} has unsupported trace version ${JSON.stringify(value.version)}. This build ` +
                `supports v1 traces and "${FEATURE_TRACE_SCHEMA_V2}" — re-export the trace or update the extension.`,
        );
    }

    assertFeatureTraceWithinLimits(raw, source, limits);
    const extra = options.normalizeExtra ? options.normalizeExtra(value) : {};
    return {
        version: 1,
        exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
        _savedAt:
            typeof value._savedAt === "string"
                ? value._savedAt
                : new Date(
                      typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
                  ).toISOString(),
        _extensionVersion:
            typeof value._extensionVersion === "string" ? value._extensionVersion : "unknown",
        _truncated: value._truncated === true ? true : undefined,
        overrides: isRecord(value.overrides) ? (value.overrides as never) : ({} as never),
        recordWhenClosed:
            typeof value.recordWhenClosed === "boolean" ? value.recordWhenClosed : false,
        ...extra,
        events: value.events as TEvent[],
        _sourceSchema: "v1",
    };
}

function normalizeV2TraceFile<TEvent, TOverrides>(
    value: Record<string, unknown> & { events: unknown[] },
    source: string,
    options: NormalizeFeatureTraceOptions,
): FeatureTraceEnvelope<TEvent, TOverrides> {
    const requireString = (field: string): string => {
        const raw = value[field];
        if (typeof raw !== "string" || raw.length === 0) {
            throw new Error(
                `${source} is not a valid "${FEATURE_TRACE_SCHEMA_V2}" trace: missing required field "${field}".`,
            );
        }
        return raw;
    };

    const featureId = requireString("featureId");
    if (options.expectedFeatureId && featureId !== options.expectedFeatureId) {
        throw new Error(
            `${source} is a "${featureId}" trace, not a ${options.featureLabel} trace ` +
                `(expected featureId "${options.expectedFeatureId}").`,
        );
    }

    const truncation = isRecord(value.truncation)
        ? (value.truncation as unknown as FeatureTraceTruncation)
        : undefined;
    const extra = options.normalizeExtra ? options.normalizeExtra(value) : {};
    return {
        version: 1,
        exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
        _savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
        _extensionVersion:
            typeof value.extensionVersion === "string" ? value.extensionVersion : "unknown",
        _truncated: truncation?.occurred === true ? true : undefined,
        overrides: isRecord(value.overrides) ? (value.overrides as never) : ({} as never),
        recordWhenClosed:
            typeof value.recordWhenClosed === "boolean" ? value.recordWhenClosed : false,
        ...extra,
        events: value.events as TEvent[],
        _sourceSchema: FEATURE_TRACE_SCHEMA_V2,
        _v2: {
            featureId,
            hostSessionId:
                typeof value.hostSessionId === "string" ? value.hostSessionId : undefined,
            captureSessionId: requireString("captureSessionId"),
            eventSchema: requireString("eventSchema"),
            overridesSchema: requireString("overridesSchema"),
            capturePolicy: isRecord(value.capturePolicy)
                ? (value.capturePolicy as unknown as RichCapturePolicySnapshot)
                : undefined,
            truncation,
            provenance: isRecord(value.provenance)
                ? (value.provenance as unknown as FeatureTraceProvenance)
                : undefined,
        },
    };
}

export interface SerializeFeatureTraceV2Metadata<TOverrides> {
    featureId: string;
    hostSessionId?: string;
    captureSessionId: string;
    eventSchema: string;
    overridesSchema: string;
    extensionVersion: string;
    overrides: TOverrides;
    exportedAt?: number;
    savedAt?: string;
    capturePolicy?: RichCapturePolicySnapshot;
    provenance?: FeatureTraceProvenance;
    /** Feature-specific envelope extras — spread into the file verbatim. */
    extra?: Record<string, unknown>;
}

/**
 * Serialize a v2 trace envelope. Live persistence keeps writing v1 until the
 * Phase-2 source-of-truth cutover; v2 serialization exists (and is tested)
 * from Phase 0 so the format is proven before it becomes the default.
 */
export function serializeFeatureTraceV2<TEvent, TOverrides>(
    events: TEvent[],
    metadata: SerializeFeatureTraceV2Metadata<TOverrides>,
    options: SerializeFeatureTraceOptions = {},
): FeatureTraceEnvelopeV2<TEvent, TOverrides> {
    const cloned = cloneJson(events);
    const redacted =
        options.redact && options.redaction
            ? (redactValue(cloned, options.redaction) as TEvent[])
            : cloned;

    const envelope: FeatureTraceEnvelopeV2<TEvent, TOverrides> = {
        schema: FEATURE_TRACE_SCHEMA_V2,
        featureId: metadata.featureId,
        ...(metadata.hostSessionId ? { hostSessionId: metadata.hostSessionId } : {}),
        captureSessionId: metadata.captureSessionId,
        eventSchema: metadata.eventSchema,
        overridesSchema: metadata.overridesSchema,
        exportedAt: metadata.exportedAt ?? Date.now(),
        savedAt: metadata.savedAt ?? new Date().toISOString(),
        extensionVersion: metadata.extensionVersion,
        events: redacted,
        overrides: cloneJson(metadata.overrides),
        ...(metadata.capturePolicy ? { capturePolicy: metadata.capturePolicy } : {}),
        ...(metadata.provenance ? { provenance: metadata.provenance } : {}),
        ...(metadata.extra ?? {}),
    };

    return truncateTraceV2ToMaxSize(envelope, options.maxFileSizeMB);
}

function truncateTraceV2ToMaxSize<TEvent, TOverrides>(
    trace: FeatureTraceEnvelopeV2<TEvent, TOverrides>,
    maxFileSizeMB: number | undefined,
): FeatureTraceEnvelopeV2<TEvent, TOverrides> {
    if (!maxFileSizeMB || maxFileSizeMB <= 0) {
        return trace;
    }

    const maxBytes = Math.floor(maxFileSizeMB * 1024 * 1024);
    if (Buffer.byteLength(JSON.stringify(trace), "utf8") <= maxBytes) {
        return trace;
    }

    const truncated: FeatureTraceEnvelopeV2<TEvent, TOverrides> = {
        ...trace,
        events: [...trace.events],
    };
    let omitted = 0;
    while (
        truncated.events.length > 0 &&
        Buffer.byteLength(JSON.stringify(truncated), "utf8") > maxBytes
    ) {
        truncated.events.shift();
        omitted++;
        truncated.truncation = {
            occurred: true,
            omittedEvents: omitted,
            firstRetainedAt: (truncated.events[0] as { timestamp?: number } | undefined)?.timestamp,
        };
    }

    return truncated;
}

/**
 * Enforce untrusted-import resource limits (event count, string length,
 * nesting depth). File byte caps are enforced at read time by the loader.
 */
export function assertFeatureTraceWithinLimits(
    value: Record<string, unknown> & { events: unknown[] },
    source: string,
    limits: FeatureTraceLimits,
): void {
    if (value.events.length > limits.maxEvents) {
        throw new Error(
            `${source} has ${value.events.length} events — over the ${limits.maxEvents}-event import limit.`,
        );
    }

    assertValueWithinLimits(value, source, limits, 0);
}

function assertValueWithinLimits(
    value: unknown,
    source: string,
    limits: FeatureTraceLimits,
    depth: number,
): void {
    if (depth > limits.maxDepth) {
        throw new Error(
            `${source} nests objects deeper than the ${limits.maxDepth}-level import limit.`,
        );
    }

    if (typeof value === "string") {
        if (value.length > limits.maxStringLength) {
            throw new Error(
                `${source} contains a ${value.length}-character string — over the ` +
                    `${limits.maxStringLength}-character import limit.`,
            );
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            assertValueWithinLimits(item, source, limits, depth + 1);
        }
        return;
    }

    if (isRecord(value)) {
        for (const entry of Object.values(value)) {
            assertValueWithinLimits(entry, source, limits, depth + 1);
        }
    }
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
