/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType } from "vscode-jsonrpc";
import { ProfilerEvent } from "../models/contracts/profiler";
import {
    SessionState,
    FilterClause,
    FilterState,
    FilterOperator,
    FilterType,
    FilterTypeHint,
    ColumnDataType,
    SortDirection,
    SortState,
} from "../profiler/profilerTypes";

// Re-export ProfilerEvent for convenience
export type { ProfilerEvent };

// Re-export types for convenience
export { SessionState, FilterOperator, FilterType, FilterTypeHint, ColumnDataType, SortDirection };
export type { FilterClause, FilterState, SortState };

/**
 * Maximum length for session names
 */
export const SESSION_NAME_MAX_LENGTH = 50;

/**
 * Data type for a column - determines filtering behavior.
 * Uses the same values as ColumnDataType enum.
 */
export type ColumnType = `${ColumnDataType}`;

/**
 * Column definition for the profiler grid (shared between extension and webview)
 */
export interface ProfilerColumnDef {
    /** Field name from event data */
    field: string;
    /** Display header */
    header: string;
    /** Data type for the column (defaults to string) */
    type?: ColumnType;
    /** Column width in pixels */
    width?: number;
    /** Whether the column is sortable */
    sortable?: boolean;
    /** Whether the column is filterable */
    filterable?: boolean;
    /**
     * Filter type for the column: determines the filter UI and available operators.
     * - "categorical": show a searchable checkbox list of distinct values (e.g., EventClass, DatabaseName)
     * - "text": show text operator input (contains/starts with/ends with) for long text (e.g., TextData)
     * - "numeric": show numeric operator input for number columns
     * - "date": show date/time operator input for datetime columns
     * Defaults to "text" if not specified.
     */
    filterType?: FilterType;
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
    [field: string]: string | number | undefined;
}

/**
 * State for the profiler webview
 */
export interface ProfilerWebviewState {
    /** Total number of events in the buffer (for display purposes) */
    totalRowCount: number;
    /** Number of events matching the current filter (equals totalRowCount when no filter) */
    filteredRowCount: number;
    /** Generation counter incremented on each clear to synchronize state */
    clearGeneration: number;
    /** Current session state */
    sessionState: SessionState;
    /** Whether auto-scroll is enabled */
    autoScroll: boolean;
    /** Current filter state (per session) */
    filterState: FilterState;
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
    /** Apply filter clauses (client-side only) */
    applyFilter: {
        clauses: FilterClause[];
    };
    /** Clear all filter clauses and quick filter */
    clearFilter: Record<string, never>;
    /** Set quick filter term (cross-column search) */
    setQuickFilter: {
        term: string;
    };
    /** Get distinct values for a column from the unfiltered ring buffer */
    getDistinctValues: {
        field: string;
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

    /** Notification sent when filter state changes (for UI updates) */
    export const FilterStateChanged = new NotificationType<FilterStateChangedParams>(
        "filterStateChanged",
    );

    /** Notification sent with distinct values for a column (from unfiltered buffer) */
    export const DistinctValuesAvailable = new NotificationType<DistinctValuesResponse>(
        "distinctValuesAvailable",
    );
}

/**
 * Response payload for getDistinctValues request
 */
export interface DistinctValuesResponse {
    /** The field for which distinct values were requested */
    field: string;
    /** Sorted array of distinct string values from the unfiltered buffer */
    values: string[];
}

/**
 * Payload for filter state changed notification
 */
export interface FilterStateChangedParams {
    /** Whether filtering is currently active */
    isFilterActive: boolean;
    /** Number of filter clauses */
    clauseCount: number;
    /** Total count of events in buffer (unfiltered) */
    totalCount: number;
    /** Count of events matching the filter */
    filteredCount: number;
}

/**
 * Comparator for sorting profiler grid rows by a specific field.
 * Handles string, number, and undefined comparisons.
 *
 * Undefined/empty values are always pushed to the end
 * regardless of sort direction.
 *
 * @param a - First row
 * @param b - Second row
 * @param sortField - The field name to sort by
 * @param sortDir - The sort direction (ASC or DESC)
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function profilerSortComparator(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    sortField: string,
    sortDir: SortDirection,
): number {
    const valA = a[sortField];
    const valB = b[sortField];

    // Handle undefined/empty — push them to the end regardless of direction
    const aIsEmpty = valA === undefined || valA === "";
    const bIsEmpty = valB === undefined || valB === "";
    if (aIsEmpty && bIsEmpty) {
        return 0;
    }
    if (aIsEmpty) {
        return 1;
    }
    if (bIsEmpty) {
        return -1;
    }

    let result: number;
    if (typeof valA === "number" && typeof valB === "number") {
        result = valA - valB;
    } else {
        // String comparison (case-insensitive with numeric awareness)
        result = String(valA).localeCompare(String(valB), undefined, {
            sensitivity: "base",
            numeric: true,
        });
    }

    return sortDir === SortDirection.ASC ? result : -result;
}

/**
 * Creates a DataView sort function for the given sort state.
 * If sort is undefined, returns a comparator that restores natural
 * insertion order (by eventNumber ascending).
 *
 * @param sort - The current sort state, or undefined for natural order
 * @returns A comparator function suitable for DataView.sort()
 */
export function createDataViewSortFn(
    sort: SortState | undefined,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
    if (!sort) {
        // Restore natural insertion order
        return (a, b) => {
            const numA = a["eventNumber"] as number;
            const numB = b["eventNumber"] as number;
            return numA - numB;
        };
    }

    return (a, b) => profilerSortComparator(a, b, sort.field, sort.direction);
}

/**
 * Computes the next sort state when a column header is clicked.
 * Implements the cycle: unsorted → ASC → DESC → unsorted.
 * Only one column can be sorted at a time.
 *
 * @param currentSort - The current sort state (undefined if no sort active)
 * @param clickedField - The field of the column that was clicked
 * @returns The new sort state, or undefined if sort should be cleared
 */
export function getNextSortState(
    currentSort: SortState | undefined,
    clickedField: string,
): SortState | undefined {
    if (!currentSort || currentSort.field !== clickedField) {
        // Different column or no sort — start ascending
        return { field: clickedField, direction: SortDirection.ASC };
    }

    if (currentSort.direction === SortDirection.ASC) {
        // Same column, was ASC → switch to DESC
        return { field: clickedField, direction: SortDirection.DESC };
    }

    // Same column, was DESC → clear sort
    return undefined;
}
