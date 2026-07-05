/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic feature-trace serialization: a versioned JSON envelope over a
 * feature's captured events, with key-driven redaction and an oldest-first
 * size cap. Features supply their sensitive-key set (and any structural
 * special cases) — the walker and the envelope are shared.
 */

export interface FeatureTraceEnvelope<TEvent, TOverrides> {
    version: 1;
    exportedAt: number;
    _savedAt: string;
    _extensionVersion: string;
    _truncated?: boolean;
    overrides: TOverrides;
    recordWhenClosed: boolean;
    events: TEvent[];
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

/**
 * Defensive normalization of a parsed trace file: tolerant of missing
 * metadata, strict about the events array. Feature-specific field coercions
 * ride the `normalizeExtra` hook.
 */
export function normalizeFeatureTraceFile<TEvent, TOverrides>(
    value: unknown,
    source: string,
    options: {
        featureLabel: string;
        normalizeExtra?: (raw: Record<string, unknown>) => Record<string, unknown>;
    },
): FeatureTraceEnvelope<TEvent, TOverrides> {
    if (!isRecord(value) || !Array.isArray(value.events)) {
        throw new Error(`${source} is not a ${options.featureLabel} trace JSON file.`);
    }

    const extra = options.normalizeExtra ? options.normalizeExtra(value) : {};
    return {
        version: value.version === 1 ? 1 : 1,
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
    };
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
