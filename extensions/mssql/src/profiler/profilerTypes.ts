/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Base interface for rows that can be indexed in the RingBuffer
 */
export interface IndexedRow {
    /** Unique identifier for synchronization (UUID from SQL Tools Service) */
    id: string;
}

/**
 * Represents a profiler event row captured from SQL Server
 */
export interface EventRow extends IndexedRow {
    /** Event sequence number from SQL Tools Service */
    eventNumber: number;
    /** Timestamp when the event occurred */
    timestamp: Date;
    /** The type/class of the event (e.g., "SQL:BatchCompleted", "RPC:Completed") */
    eventClass: string;
    /** The SQL text or command text */
    textData: string;
    /** Name of the database where the event occurred */
    databaseName: string;
    /** Server Process ID */
    spid: number | undefined;
    /** Duration in microseconds */
    duration: number | undefined;
    /** CPU time in milliseconds */
    cpu: number | undefined;
    /** Logical reads */
    reads: number | undefined;
    /** Logical writes */
    writes: number | undefined;
    /** Additional event-specific data */
    additionalData: Record<string, string>;
}

/**
 * Filter comparison operators
 */
export enum FilterKind {
    Equal = "equal",
    NotEqual = "notEqual",
    GreaterThan = "greaterThan",
    GreaterThanOrEqual = "greaterThanOrEqual",
    LessThan = "lessThan",
    LessThanOrEqual = "lessThanOrEqual",
    Contains = "contains",
    NotContains = "notContains",
    StartsWith = "startsWith",
    EndsWith = "endsWith",
    IsNull = "isNull",
    IsNotNull = "isNotNull",
}

/**
 * A single filter condition
 */
export interface FilterType {
    /** The comparison operator */
    kind: FilterKind;
    /** The field/column to filter on */
    field: string;
    /** The value to compare against */
    value: string | number | boolean | null;
}

/**
 * Filter configuration for querying events
 */
export interface Filter {
    /** Array of filter conditions (ANDed together) */
    filters: FilterType[];
    /** Optional time range filter */
    timeRange?: {
        from: number;
        to: number;
    };
    /** Maximum number of results to return */
    limit?: number;
    /** Number of results to skip */
    offset?: number;
}

/**
 * Result of a query operation
 */
export interface QueryResult<T> {
    /** The matching rows */
    rows: T[];
    /** Total count of matching rows (before limit/offset) */
    totalCount: number;
    /** Whether more results exist beyond the limit */
    hasMore: boolean;
}

/**
 * Session type - file-based or live connection
 */
export enum SessionType {
    /** Reading from an XEL file */
    File = "file",
    /** Live profiling session connected to server */
    Live = "live",
}

/**
 * Session state
 */
export enum SessionState {
    /** Session is running and receiving events */
    Running = "running",
    /** Session is paused (not receiving events) */
    Paused = "paused",
    /** Session is stopped */
    Stopped = "stopped",
    /** Session has not been started yet */
    NotStarted = "notStarted",
    /** Session is being created on the server */
    Creating = "creating",
    /** Session creation or operation failed */
    Failed = "failed",
}

/**
 * Engine type for profiler session templates
 */
export enum EngineType {
    /** On-premises SQL Server (Standalone) */
    Standalone = "Standalone",
    /** Azure SQL Database */
    AzureSQLDB = "AzureSQLDB",
}

/**
 * View template configuration for displaying events
 */
export interface ViewTemplate {
    /** Unique identifier for the view */
    id: string;
    /** Name of the view template */
    name: string;
    /** Description of the view */
    description?: string;
    /** Columns to display */
    columns: ViewColumn[];
}

/**
 * Column configuration in a view template
 */
export interface ViewColumn {
    /** Field name used as the column key */
    field: string;
    /** Display header */
    header: string;
    /** Column width in pixels */
    width?: number;
    /** Whether the column is visible */
    visible?: boolean;
    /** Whether the column is sortable */
    sortable?: boolean;
    /** Whether the column is filterable */
    filterable?: boolean;
    /**
     * Array of XEvent field names that map to this column.
     * When converting an event row, the first matching field will be used.
     */
    eventsMapped: string[];
}

/**
 * Profiler session template with view association
 */
export interface ProfilerTemplate {
    /** Unique identifier for the template */
    id: string;
    /** Template name */
    name: string;
    /** Description of the template */
    description?: string;
    /** Engine type this template is for */
    engineType: EngineType;
    /** Default view ID to use with this template */
    defaultView: string;
    /** T-SQL CREATE EVENT SESSION statement (use {sessionName} as placeholder) */
    createStatement: string;
    /** List of XEvent names captured by this template */
    eventsCaptured: string[];
}

/**
 * Configuration structure for profiler templates and views
 */
export interface ProfilerConfig {
    /** Available view templates keyed by ID */
    views: Record<string, ViewTemplate>;
    /** Available session templates keyed by ID */
    templates: Record<string, ProfilerTemplate>;
    /** Maps view IDs to compatible session template IDs */
    viewToSessionMap: Record<string, string[]>;
    /** Maps session template IDs to compatible view IDs */
    sessionToViewMap: Record<string, string[]>;
}

/**
 * A row formatted for display in a specific view
 */
export interface ViewRow {
    /** Unique row identifier */
    id: string;
    /** Dynamic fields based on view columns */
    [field: string]: string | number | null;
}

/**
 * Information about a file-based profiler session
 */
export interface XelFileInfo {
    /** Full file path */
    filePath: string;
    /** File name without path */
    fileName: string;
    /** File size in bytes */
    fileSize?: number;
}
