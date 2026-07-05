/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions trace serialization over the generic trace codec (B7): the
 * envelope, redaction walker, and size cap are shared; this file owns the
 * completions redaction surface (prompt/response keys, promptMessages
 * content, formatted schema context).
 */

import {
    FEATURE_TRACE_REDACTED,
    FeatureTraceRedaction,
    serializeFeatureTrace,
} from "../../diagnostics/featureCapture/traceCodec";
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

export const inlineCompletionTraceRedaction: FeatureTraceRedaction = {
    redactedKeys: new Set([
        "userPrompt",
        "systemPrompt",
        "customSystemPrompt",
        "rawResponse",
        "sanitizedResponse",
        "finalCompletionText",
    ]),
    redactSpecial: (key, value) => {
        if (key === "promptMessages" && Array.isArray(value)) {
            return value.map((message) =>
                typeof message === "object" && message !== null
                    ? { ...message, content: FEATURE_TRACE_REDACTED }
                    : message,
            );
        }

        if (key === "schemaContextFormatted") {
            return FEATURE_TRACE_REDACTED;
        }

        return undefined;
    },
};

export function serializeSessionTrace(
    events: InlineCompletionDebugEvent[],
    metadata: InlineCompletionTraceMetadata,
    options: SerializeSessionTraceOptions = {},
): InlineCompletionDebugExportData {
    return serializeFeatureTrace(
        events,
        {
            exportedAt: metadata.exportedAt,
            savedAt: metadata.savedAt,
            extensionVersion: metadata.extensionVersion,
            overrides: metadata.overrides,
            recordWhenClosed: metadata.recordWhenClosed,
            extra: { customPromptLastSavedAt: metadata.customPromptLastSavedAt },
        },
        {
            redact: options.redactPrompts,
            redaction: inlineCompletionTraceRedaction,
            maxFileSizeMB: options.maxFileSizeMB,
        },
    ) as InlineCompletionDebugExportData;
}
