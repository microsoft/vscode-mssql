/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";

/**
 * Telemetry property keys for profiler events.
 */
export const ProfilerTelemetryProperties = {
    SessionName: "sessionName",
    SessionId: "sessionId",
    TemplateName: "templateName",
    EventCount: "eventCount",
    FilterType: "filterType",
    FilterColumn: "filterColumn",
    AutoScrollEnabled: "autoScrollEnabled",
    FilePath: "filePath",
    FileSize: "fileSize",
    ExportTrigger: "exportTrigger",
    DurationMs: "durationMs",
    WasPreviouslyStopped: "wasPreviouslyStopped",
} as const;

/**
 * Telemetry measurement keys for profiler events.
 */
export const ProfilerTelemetryMeasurements = {
    EventCount: "eventCount",
    DurationMs: "durationMs",
    FileSize: "fileSize",
    RowCount: "rowCount",
} as const;

/**
 * Centralized telemetry service for SQL Profiler.
 * Provides static methods to send telemetry events for all profiler actions.
 */
export class ProfilerTelemetry {
    /**
     * Send telemetry when a new profiler session is created.
     * @param sessionName - The name of the created session
     * @param templateName - The template used to create the session
     */
    public static sendSessionCreated(sessionName: string, templateName: string): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionCreated,
            {
                [ProfilerTelemetryProperties.SessionName]: sessionName,
                [ProfilerTelemetryProperties.TemplateName]: templateName,
            },
        );
    }

    /**
     * Send telemetry when a profiler session is started.
     * @param sessionName - The name of the session being started
     * @param sessionId - The unique ID of the session
     */
    public static sendSessionStarted(sessionName: string, sessionId: string): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionStarted,
            {
                [ProfilerTelemetryProperties.SessionName]: sessionName,
                [ProfilerTelemetryProperties.SessionId]: sessionId,
            },
        );
    }

    /**
     * Send telemetry when a profiler session is paused.
     * @param sessionId - The unique ID of the session
     * @param eventCount - The number of events captured at pause time
     */
    public static sendSessionPaused(sessionId: string, eventCount: number): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionPaused,
            {
                [ProfilerTelemetryProperties.SessionId]: sessionId,
            },
            {
                [ProfilerTelemetryMeasurements.EventCount]: eventCount,
            },
        );
    }

    /**
     * Send telemetry when a profiler session is resumed.
     * @param sessionId - The unique ID of the session
     */
    public static sendSessionResumed(sessionId: string): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionResumed,
            {
                [ProfilerTelemetryProperties.SessionId]: sessionId,
            },
        );
    }

    /**
     * Send telemetry when a profiler session is stopped.
     * @param sessionId - The unique ID of the session
     * @param eventCount - The total number of events captured
     * @param durationMs - The duration of the session in milliseconds
     */
    public static sendSessionStopped(
        sessionId: string,
        eventCount: number,
        durationMs?: number,
    ): void {
        const measurements: Record<string, number> = {
            [ProfilerTelemetryMeasurements.EventCount]: eventCount,
        };

        if (durationMs !== undefined) {
            measurements[ProfilerTelemetryMeasurements.DurationMs] = durationMs;
        }

        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionStopped,
            {
                [ProfilerTelemetryProperties.SessionId]: sessionId,
            },
            measurements,
        );
    }

    /**
     * Send telemetry when switching between profiler sessions.
     * @param fromSessionId - The ID of the previous session (or undefined if none)
     * @param toSessionId - The ID of the new session
     */
    public static sendSessionSwitched(
        fromSessionId: string | undefined,
        toSessionId: string,
    ): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionSwitched,
            {
                [ProfilerTelemetryProperties.SessionId]: toSessionId,
                ...(fromSessionId && { fromSessionId }),
            },
        );
    }

    /**
     * Send telemetry when a profiler session is closed.
     * @param sessionId - The unique ID of the session (if available)
     * @param eventCount - The number of events at close time
     * @param wasPreviouslyStopped - Whether the session was stopped before closing
     */
    public static sendSessionClosed(
        sessionId: string | undefined,
        eventCount: number,
        wasPreviouslyStopped: boolean,
    ): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerSessionClosed,
            {
                ...(sessionId && { [ProfilerTelemetryProperties.SessionId]: sessionId }),
                [ProfilerTelemetryProperties.WasPreviouslyStopped]:
                    wasPreviouslyStopped.toString(),
            },
            {
                [ProfilerTelemetryMeasurements.EventCount]: eventCount,
            },
        );
    }

    /**
     * Send telemetry when profiler data is cleared.
     * @param eventCountBeforeClear - The number of events before clearing
     */
    public static sendClearData(eventCountBeforeClear: number): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerClearData,
            {},
            {
                [ProfilerTelemetryMeasurements.EventCount]: eventCountBeforeClear,
            },
        );
    }

    /**
     * Send telemetry when a filter is applied.
     * @param filterColumn - The column being filtered
     * @param filterType - The type of filter (e.g., "contains", "equals")
     */
    public static sendFilterApplied(filterColumn: string, filterType: string): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerFilterApplied,
            {
                [ProfilerTelemetryProperties.FilterColumn]: filterColumn,
                [ProfilerTelemetryProperties.FilterType]: filterType,
            },
        );
    }

    /**
     * Send telemetry when a filter is cleared.
     */
    public static sendFilterCleared(): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerFilterCleared,
        );
    }

    /**
     * Send telemetry when auto-scroll is toggled.
     * @param enabled - Whether auto-scroll is now enabled
     */
    public static sendAutoScrollToggled(enabled: boolean): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerAutoScrollToggled,
            {
                [ProfilerTelemetryProperties.AutoScrollEnabled]: enabled.toString(),
            },
        );
    }

    /**
     * Send telemetry when an XEL file is opened.
     * @param fileSize - The size of the file in bytes (optional)
     */
    public static sendXelFileOpened(fileSize?: number): void {
        const measurements: Record<string, number> = {};

        if (fileSize !== undefined) {
            measurements[ProfilerTelemetryMeasurements.FileSize] = fileSize;
        }

        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerXelFileOpened,
            {},
            measurements,
        );
    }

    /**
     * Send telemetry when profiler data is exported to CSV.
     * @param rowCount - The number of rows exported
     * @param trigger - What triggered the export ("manual" or "closePrompt")
     */
    public static sendExportCsv(rowCount: number, trigger: "manual" | "closePrompt"): void {
        sendActionEvent(
            TelemetryViews.Profiler,
            TelemetryActions.ProfilerExportCsv,
            {
                [ProfilerTelemetryProperties.ExportTrigger]: trigger,
            },
            {
                [ProfilerTelemetryMeasurements.RowCount]: rowCount,
            },
        );
    }

    /**
     * Send error telemetry for profiler operations.
     * @param action - The action that failed
     * @param error - The error that occurred
     * @param includeErrorMessage - Whether to include the error message
     */
    public static sendError(
        action: TelemetryActions,
        error: Error,
        includeErrorMessage: boolean = true,
    ): void {
        sendErrorEvent(
            TelemetryViews.Profiler,
            action,
            error,
            includeErrorMessage,
        );
    }
}
