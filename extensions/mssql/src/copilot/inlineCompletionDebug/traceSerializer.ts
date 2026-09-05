/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugExportData,
    InlineCompletionDebugOverrides,
} from "../../sharedInterfaces/inlineCompletionDebug";

export interface InlineCompletionTraceMetadata {
    exportedAt?: number;
    savedAt?: string;
    extensionVersion: string;
    overrides: InlineCompletionDebugOverrides;
    recordWhenClosed: boolean;
    customPromptLastSavedAt?: number;
}

export interface SerializeSessionTraceOptions {
    redactPrompts?: boolean;
    maxFileSizeMB?: number;
}

/**
 * Hard ceiling for a persisted trace file. Saving clamps the configured maximum to this value
 * and loading refuses anything larger, so every trace the extension writes can be read back.
 */
export const MAX_TRACE_FILE_SIZE_MB = 64;
export const MAX_TRACE_FILE_BYTES = MAX_TRACE_FILE_SIZE_MB * 1024 * 1024;

/**
 * Produces the exact text written to a trace file. Size limits are measured against this
 * representation so a truncated trace cannot grow past the limit once it is pretty-printed.
 */
export function serializeTraceFile(trace: InlineCompletionDebugExportData): string {
    return JSON.stringify(trace, undefined, 2);
}

const REDACTED = "[REDACTED]";
const REDACTED_KEYS = new Set([
    "userPrompt",
    "systemPrompt",
    "customSystemPrompt",
    "rawResponse",
    "sanitizedResponse",
    "finalCompletionText",
    "documentUri",
    "documentFileName",
]);

export function serializeSessionTrace(
    events: InlineCompletionDebugEvent[],
    metadata: InlineCompletionTraceMetadata,
    options: SerializeSessionTraceOptions = {},
): InlineCompletionDebugExportData {
    const trace: InlineCompletionDebugExportData = {
        version: 1,
        exportedAt: metadata.exportedAt ?? Date.now(),
        _savedAt: metadata.savedAt ?? new Date().toISOString(),
        _extensionVersion: metadata.extensionVersion,
        overrides: cloneJson(metadata.overrides),
        recordWhenClosed: metadata.recordWhenClosed,
        customPromptLastSavedAt: metadata.customPromptLastSavedAt,
        events: cloneJson(events),
    };

    const redacted = options.redactPrompts ? redactTrace(trace) : trace;
    return truncateTraceToMaxSize(redacted, options.maxFileSizeMB);
}

function redactTrace(trace: InlineCompletionDebugExportData): InlineCompletionDebugExportData {
    return redactValue(trace) as InlineCompletionDebugExportData;
}

function redactValue(value: unknown, key?: string): unknown {
    if (key && REDACTED_KEYS.has(key)) {
        return REDACTED;
    }
    if (key === "locals") {
        return redactLocalStrings(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, key));
    }

    if (!isRecord(value)) {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
        if (entryKey === "error" && isRecord(entryValue)) {
            output[entryKey] = {
                message: REDACTED,
                ...(typeof entryValue.name === "string" ? { name: entryValue.name } : {}),
            };
            continue;
        }

        if (entryKey === "promptMessages" && Array.isArray(entryValue)) {
            output[entryKey] = entryValue.map((message) =>
                isRecord(message) ? { ...message, content: REDACTED } : message,
            );
            continue;
        }

        if (entryKey === "schemaContextFormatted") {
            output[entryKey] = REDACTED;
            continue;
        }

        output[entryKey] = redactValue(entryValue, entryKey);
    }

    return output;
}

function redactLocalStrings(value: unknown): unknown {
    if (typeof value === "string") {
        return REDACTED;
    }
    if (Array.isArray(value)) {
        return value.map(redactLocalStrings);
    }
    if (!isRecord(value)) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, redactLocalStrings(entry)]),
    );
}

function truncateTraceToMaxSize(
    trace: InlineCompletionDebugExportData,
    maxFileSizeMB: number | undefined,
): InlineCompletionDebugExportData {
    if (!maxFileSizeMB || maxFileSizeMB <= 0) {
        return trace;
    }

    const maxBytes = Math.min(Math.floor(maxFileSizeMB * 1024 * 1024), MAX_TRACE_FILE_BYTES);
    if (Buffer.byteLength(serializeTraceFile(trace), "utf8") <= maxBytes) {
        return trace;
    }

    const truncatedTrace: InlineCompletionDebugExportData = {
        ...trace,
        _truncated: true,
        events: [...trace.events],
    };

    while (
        truncatedTrace.events.length > 0 &&
        Buffer.byteLength(serializeTraceFile(truncatedTrace), "utf8") > maxBytes
    ) {
        truncatedTrace.events.shift();
    }

    return truncatedTrace;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
