/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { FilterClause } from "./profilerTypes";

/**
 * Categories of profiler errors for telemetry classification.
 * Used to bucket errors without sending PII.
 */
export enum ProfilerErrorCategory {
    PermissionDenied = "PermissionDenied",
    AzureUnsupported = "AzureUnsupported",
    BufferConfigError = "BufferConfigError",
    XelFileError = "XelFileError",
    Unknown = "Unknown",
}

/**
 * User actions when the close-with-unsaved-events warning is shown.
 */
export enum CloseWarningUserAction {
    Saved = "Saved",
    Discarded = "Discarded",
    Cancelled = "Cancelled",
}

// ── keyword lists for error categorisation ──────────────────────────
const PERMISSION_KEYWORDS = ["permission", "denied", "unauthorized", "access"];
const AZURE_UNSUPPORTED_KEYWORDS = ["not supported", "azure", "unsupported", "not available"];
const BUFFER_CONFIG_KEYWORDS = ["buffer", "memory", "config", "capacity", "ring_buffer"];
const XEL_KEYWORDS = ["xel", "file", "xevent", "extended event"];

/**
 * Inspects an error message and returns a coarse category.
 * Never records the raw message itself (no PII).
 *
 * @param errorMessage - The error text to classify.
 * @param engineType   - Optional engine type to disambiguate Azure-specific errors.
 * @returns A {@link ProfilerErrorCategory}.
 */
export function categorizeError(errorMessage: string, engineType?: string): ProfilerErrorCategory {
    const lower = errorMessage.toLowerCase();

    if (PERMISSION_KEYWORDS.some((kw) => lower.includes(kw))) {
        return ProfilerErrorCategory.PermissionDenied;
    }

    if (AZURE_UNSUPPORTED_KEYWORDS.some((kw) => lower.includes(kw))) {
        return ProfilerErrorCategory.AzureUnsupported;
    }

    if (
        engineType?.toLowerCase().includes("azure") &&
        AZURE_UNSUPPORTED_KEYWORDS.some((kw) => lower.includes(kw))
    ) {
        return ProfilerErrorCategory.AzureUnsupported;
    }

    if (BUFFER_CONFIG_KEYWORDS.some((kw) => lower.includes(kw))) {
        return ProfilerErrorCategory.BufferConfigError;
    }

    if (XEL_KEYWORDS.some((kw) => lower.includes(kw))) {
        return ProfilerErrorCategory.XelFileError;
    }

    return ProfilerErrorCategory.Unknown;
}

/**
 * Static helper that emits profiler telemetry events.
 *
 * **Design rules**
 * - Every method is best-effort (`try / catch` → silent).
 * - No PII is ever sent (no query text, no user names, no file paths).
 * - The session GUID produced by `Utils.generateGuid()` is used as the
 *   correlation ID – there is no separate telemetry GUID.
 */
export class ProfilerTelemetry {
    /** A profiling session was successfully started. */
    static sendSessionStarted(
        sessionId: string,
        engineType: string,
        templateName: string,
        isFromFile: boolean,
    ): void {
        try {
            sendActionEvent(TelemetryViews.Profiler, TelemetryActions.ProfilerSessionStarted, {
                sessionId,
                engineType,
                templateName,
                isFromFile: String(isFromFile),
            });
        } catch {
            // best-effort – never block the feature
        }
    }

    /** A profiling session failed to start or encountered a fatal error. */
    static sendSessionFailed(
        sessionId: string,
        engineType: string,
        errorCategory: ProfilerErrorCategory,
    ): void {
        try {
            sendActionEvent(TelemetryViews.Profiler, TelemetryActions.ProfilerSessionFailed, {
                sessionId,
                engineType,
                errorCategory,
            });
        } catch {
            // best-effort
        }
    }

    /** A profiling session was stopped (either by the user or the server). */
    static sendSessionStopped(
        sessionId: string,
        durationMs: number,
        eventsCapturedCount: number,
        wasExported: boolean,
    ): void {
        try {
            sendActionEvent(
                TelemetryViews.Profiler,
                TelemetryActions.ProfilerSessionStopped,
                {
                    sessionId,
                    wasExported: String(wasExported),
                },
                {
                    durationMs,
                    eventsCapturedCount,
                },
            );
        } catch {
            // best-effort
        }
    }

    /** Events were exported to a file (CSV, etc.). */
    static sendExportDone(
        sessionId: string,
        exportFormat: string,
        eventsExportedCount: number,
    ): void {
        try {
            sendActionEvent(
                TelemetryViews.Profiler,
                TelemetryActions.ProfilerExportDone,
                {
                    sessionId,
                    exportFormat,
                },
                {
                    eventsExportedCount,
                },
            );
        } catch {
            // best-effort
        }
    }

    /** The close-with-unsaved-events warning was shown. */
    static sendCloseWarningShown(
        sessionId: string,
        unsavedEventsCount: number,
        userAction: CloseWarningUserAction,
    ): void {
        try {
            sendActionEvent(
                TelemetryViews.Profiler,
                TelemetryActions.ProfilerCloseWarningShown,
                {
                    sessionId,
                    userAction,
                },
                {
                    unsavedEventsCount,
                },
            );
        } catch {
            // best-effort
        }
    }

    /**
     * A column filter was applied.
     * Only sends `column:operator` pairs – **never** the filter values.
     */
    static sendFilterApplied(sessionId: string, filterFields: FilterClause[]): void {
        try {
            const pairs = filterFields.map((f) => `${f.field}:${f.operator}`);
            sendActionEvent(TelemetryViews.Profiler, TelemetryActions.ProfilerFilterApplied, {
                sessionId,
                filters: pairs.join(","),
            });
        } catch {
            // best-effort
        }
    }

    /** A profiling session failed to stop. */
    static sendSessionStopFailed(sessionId: string, errorCategory: ProfilerErrorCategory): void {
        try {
            sendActionEvent(TelemetryViews.Profiler, TelemetryActions.ProfilerSessionStopFailed, {
                sessionId,
                errorCategory,
            });
        } catch {
            // best-effort
        }
    }

    /** The ring buffer overflowed and events were evicted. */
    static sendBufferOverflow(
        sessionId: string,
        bufferCapacity: number,
        evictedCount: number,
    ): void {
        try {
            sendActionEvent(
                TelemetryViews.Profiler,
                TelemetryActions.ProfilerBufferOverflow,
                {
                    sessionId,
                },
                {
                    bufferCapacity,
                    evictedCount,
                },
            );
        } catch {
            // best-effort
        }
    }
}
