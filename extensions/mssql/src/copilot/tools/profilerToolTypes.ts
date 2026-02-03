/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FilterClause as ProfilerFilterClause } from "../../profiler/profilerTypes";

/**
 * Session state as a string for serialization
 */
export type SessionStateString =
    | "running"
    | "paused"
    | "stopped"
    | "creating"
    | "failed"
    | "notStarted";

/**
 * A serializable representation of a profiler session for tool responses.
 */
export interface ProfilerSessionInfo {
    /** Unique session identifier */
    sessionId: string;
    /** User-visible session name */
    sessionName: string;
    /** Current session state */
    state: SessionStateString;
    /** Profiler template used */
    templateName: string;
    /** Server name or connection label */
    connectionLabel: string;
    /** Number of events currently in buffer */
    eventCount: number;
    /** Maximum buffer capacity */
    bufferCapacity: number;
    /** Session creation timestamp (ISO 8601) */
    createdAt: string;
}

/**
 * Time range for events in a session
 */
export interface TimeRange {
    /** Earliest event timestamp (ISO 8601) */
    earliest: string;
    /** Latest event timestamp (ISO 8601) */
    latest: string;
}

/**
 * Item with a name and count for aggregations
 */
export interface CountedItem {
    /** The name/value being counted */
    name: string;
    /** Number of occurrences */
    count: number;
}

/**
 * Aggregated statistics for a profiler session
 */
export interface SessionSummary {
    /** Session identifier */
    sessionId: string;
    /** Session name */
    sessionName: string;
    /** Current state */
    state: SessionStateString;
    /** Total events in buffer */
    totalEvents: number;
    /** Maximum buffer capacity */
    bufferCapacity: number;
    /** Time range of events, undefined if no events */
    timeRange?: {
        start: string;
        end: string;
    };
    /** Top event types by count (up to 5) */
    topEventTypes: { eventType: string; count: number }[];
    /** Top databases by event count (up to 5) */
    topDatabases: { database: string; count: number }[];
    /** Top applications by event count (up to 5) */
    topApplications: { application: string; count: number }[];
    /** True if buffer is at capacity (events may have been lost) */
    eventsLostToOverflow: boolean;
}

/**
 * Truncated event representation for list/query responses
 */
export interface EventSummary {
    /** Unique event identifier */
    eventId: string;
    /** Event sequence number */
    eventNumber: number;
    /** Event timestamp (ISO 8601) */
    timestamp: string;
    /** Event type/class */
    eventClass: string;
    /** SQL text (truncated to 512 chars) */
    textData: string;
    /** Database name */
    databaseName: string;
    /** Duration in microseconds */
    duration?: number;
    /** CPU time in milliseconds */
    cpu?: number;
    /** Logical reads */
    reads?: number;
    /** Logical writes */
    writes?: number;
}

/**
 * Full event representation for single-event inspection
 */
export interface EventDetail extends EventSummary {
    /** Whether textData was truncated */
    textTruncated: boolean;
    /** Application name */
    applicationName?: string;
    /** Server Process ID */
    spid?: number;
    /** Additional event-specific data */
    additionalData: Record<string, string>;
}

/**
 * Metadata about query results
 */
export interface QueryMetadata {
    /** Total events matching the filter */
    totalMatching: number;
    /** Number of events returned */
    returned: number;
    /** Whether results were truncated due to limit */
    truncated: boolean;
    /** Text truncation limit applied */
    textTruncationLimit: number;
}

// Re-export FilterClause for use in tool contracts
export type FilterClause = ProfilerFilterClause;

/**
 * Result type for list sessions tool
 */
export interface ListSessionsResult {
    success: boolean;
    message?: string;
    sessions: ProfilerSessionInfo[];
}

/**
 * Parameters for get session summary tool
 */
export interface GetSessionSummaryParams {
    sessionId: string;
}

/**
 * Result type for get session summary tool
 */
export interface GetSessionSummaryResult {
    success: boolean;
    message?: string;
    error?: string;
    summary?: SessionSummary;
}

/**
 * Alias for GetSessionSummaryResult
 */
export type SessionSummaryResult = GetSessionSummaryResult;

/**
 * Parameters for query events tool
 */
export interface QueryEventsParams {
    sessionId: string;
    filters?: FilterClause[];
    limit?: number;
    sortBy?: "timestamp" | "duration";
    sortOrder?: "asc" | "desc";
}

/**
 * Result type for query events tool
 */
export interface QueryEventsResult {
    success: boolean;
    message?: string;
    events?: EventSummary[];
    metadata?: QueryMetadata;
}

/**
 * Parameters for get event detail tool
 */
export interface GetEventDetailParams {
    sessionId: string;
    eventId: string;
}

/**
 * Result type for get event detail tool
 */
export interface GetEventDetailResult {
    success: boolean;
    message?: string;
    event?: EventDetail;
}
