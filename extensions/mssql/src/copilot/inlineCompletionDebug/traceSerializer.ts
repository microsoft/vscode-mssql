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

const REDACTED = "[REDACTED]";
const REDACTED_KEYS = new Set([
    "userPrompt",
    "systemPrompt",
    "customSystemPrompt",
    "rawResponse",
    "sanitizedResponse",
    "finalCompletionText",
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

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item));
    }

    if (!isRecord(value)) {
        return value;
    }

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
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

function truncateTraceToMaxSize(
    trace: InlineCompletionDebugExportData,
    maxFileSizeMB: number | undefined,
): InlineCompletionDebugExportData {
    if (!maxFileSizeMB || maxFileSizeMB <= 0) {
        return trace;
    }

    const maxBytes = Math.floor(maxFileSizeMB * 1024 * 1024);
    if (Buffer.byteLength(JSON.stringify(trace), "utf8") <= maxBytes) {
        return trace;
    }

    const truncatedTrace: InlineCompletionDebugExportData = {
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

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
