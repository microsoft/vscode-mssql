/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType } from "vscode-jsonrpc";
import { ProfilerEvent } from "../models/contracts/profiler";
import { SessionState } from "../profiler/profilerTypes";

// Re-export ProfilerEvent for convenience
export type { ProfilerEvent };

// Re-export SessionState as the unified session state enum
export { SessionState };

/**
 * Maximum length for session names
 */
export const SESSION_NAME_MAX_LENGTH = 50;

/**
 * Column definition for the profiler grid (shared between extension and webview)
 */
export interface ProfilerColumnDef {
    /** Field name from event data */
    field: string;
    /** Display header */
    header: string;
    /** Column width in pixels */
    width?: number;
    /** Whether the column is sortable */
    sortable?: boolean;
    /** Whether the column is filterable */
    filterable?: boolean;
}

/**
 * View configuration for the profiler grid
 */
export interface ProfilerViewConfig {
    /** View identifier */
    id: string;
    /** View display name */
    name: string;
    /** View description */
    description?: string;
    /** Column definitions */
    columns: ProfilerColumnDef[];
}

/**
 * Template configuration for profiler sessions
 */
export interface ProfilerTemplateConfig {
    /** Template identifier */
    id: string;
    /** Template display name */
    name: string;
    /** Template description */
    description?: string;
    /** Default view ID */
    defaultView: string;
}

/**
 * A row of data formatted for display in the grid
 */
export interface ProfilerGridRow {
    /** Unique row identifier (UUID for synchronization) */
    id: string;
    /** Display event number for tracking/debugging */
    eventNumber: number;
    /** Dynamic fields based on view columns */
    [field: string]: string | number | null;
}

/**
 * State for the profiler webview
 */
export interface ProfilerWebviewState {
    /** Total number of events in the buffer (for display purposes) */
    totalRowCount: number;
    /** Generation counter incremented on each clear to synchronize state */
    clearGeneration: number;
    /** Current session state */
    sessionState: SessionState;
    /** Whether auto-scroll is enabled */
    autoScroll: boolean;
    /** Session name if connected */
    sessionName?: string;
    /** Current template ID */
    templateId?: string;
    /** Current view ID */
    viewId?: string;
    /** Current view configuration */
    viewConfig?: ProfilerViewConfig;
    /** Available views for the current session */
    availableViews?: ProfilerViewConfig[];
    /** Available templates */
    availableTemplates?: ProfilerTemplateConfig[];
    /** Available sessions for selection */
    availableSessions?: { id: string; name: string }[];
    /** Currently selected session ID (for starting) */
    selectedSessionId?: string;
    /** ID of the session currently associated with this webview (for state management) */
    currentSessionId?: string;
    /** Whether a session is being created (show spinner) */
    isCreatingSession?: boolean;
    /** Whether this is a read-only file-based session */
    isReadOnly?: boolean;
    /** File path if this is a file-based session */
    xelFilePath?: string;
    /** File name for display if this is a file-based session */
    xelFileName?: string;
}

/**
 * Reducers for updating the profiler webview state
 */
export interface ProfilerReducers {
    /** Pause or resume the profiler session */
    pauseResume: Record<string, never>;
    /** Stop the profiler session */
    stop: Record<string, never>;
    /** Create a new profiler session */
    createSession: {
        templateId: string;
        sessionName: string;
    };
    /** Start a profiler session */
    startSession: {
        sessionId: string;
    };
    /** Select a session (update selectedSessionId) */
    selectSession: {
        sessionId: string;
    };
    /** Clear events up to localRowCount (the rows currently shown in the grid) */
    clearEvents: {
        localRowCount: number;
    };
    /** Change the current view */
    changeView: {
        viewId: string;
    };
    /** Toggle auto-scroll */
    toggleAutoScroll: Record<string, never>;
    /** Fetch rows from the buffer (pull model) */
    fetchRows: {
        startIndex: number;
        count: number;
    };
}

/**
 * Response payload for fetchRows request
 */
export interface FetchRowsResponse {
    /** The fetched rows */
    rows: ProfilerGridRow[];
    /** Starting index of the returned rows */
    startIndex: number;
    /** Total count of rows in buffer */
    totalCount: number;
}

/**
 * Payload for new events available notification
 */
export interface NewEventsAvailableParams {
    /** Number of new events added */
    newCount: number;
    /** Total count of events in buffer */
    totalCount: number;
}

/**
 * Payload for rows removed notification
 */
export interface RowsRemovedParams {
    /** Array of row IDs (UUIDs) that were removed from the buffer */
    removedRowIds: string[];
}

/**
 * Notification types for profiler webview communication
 */
export namespace ProfilerNotifications {
    /** Notification sent when rows are available after a fetch request */
    export const RowsAvailable = new NotificationType<FetchRowsResponse>("rowsAvailable");

    /** Notification sent when new events are available in the buffer */
    export const NewEventsAvailable = new NotificationType<NewEventsAvailableParams>(
        "newEventsAvailable",
    );

    /** Notification sent when rows are removed from the ring buffer */
    export const RowsRemoved = new NotificationType<RowsRemovedParams>("rowsRemoved");

    /** Notification sent when the grid should be cleared */
    export const ClearGrid = new NotificationType<Record<string, never>>("clearGrid");
}
