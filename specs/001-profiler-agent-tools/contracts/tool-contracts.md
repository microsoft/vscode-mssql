# Tool Contracts: Profiler Agent Tools

**Feature**: 1-profiler-agent-tools  
**Date**: February 2, 2026

## Overview

This document defines the input/output contracts for each Profiler Agent Tool. These contracts serve as the specification for implementation and testing.

---

## Tool 1: `mssql_profiler_list_sessions`

### Description
Lists all available Profiler sessions with their basic metadata.

### Input Parameters
```typescript
interface ListSessionsParams {
    // No parameters required
}
```

### Output Contract
```typescript
interface ListSessionsResult {
    success: boolean;
    message?: string;
    sessions: ProfilerSessionInfo[];
}

interface ProfilerSessionInfo {
    sessionId: string;
    sessionName: string;
    state: "running" | "paused" | "stopped" | "creating" | "failed" | "notStarted";
    templateName: string;
    connectionLabel: string;
    eventCount: number;
    bufferCapacity: number;
    createdAt: string; // ISO 8601
}
```

### Example Response (Success)
```json
{
    "success": true,
    "sessions": [
        {
            "sessionId": "abc123",
            "sessionName": "Performance Trace",
            "state": "running",
            "templateName": "Standard",
            "connectionLabel": "localhost",
            "eventCount": 1542,
            "bufferCapacity": 10000,
            "createdAt": "2026-02-02T10:30:00.000Z"
        }
    ]
}
```

### Example Response (No Sessions)
```json
{
    "success": true,
    "sessions": [],
    "message": "No profiler sessions are currently available. Start a profiler session from the Object Explorer context menu."
}
```

---

## Tool 2: `mssql_profiler_get_session_summary`

### Description
Returns a statistical summary of a profiler session including event counts, time range, and top event types/databases.

### Input Parameters
```typescript
interface GetSessionSummaryParams {
    sessionId: string; // Required
}
```

### Output Contract
```typescript
interface GetSessionSummaryResult {
    success: boolean;
    message?: string;
    summary?: SessionSummary;
}

interface SessionSummary {
    sessionId: string;
    sessionName: string;
    state: string;
    totalEventCount: number;
    bufferCapacity: number;
    timeRange?: {
        earliest: string; // ISO 8601
        latest: string;
    };
    topEventTypes: Array<{ name: string; count: number }>;
    topDatabases: Array<{ name: string; count: number }>;
    topApplications: Array<{ name: string; count: number }>;
    eventsLostToOverflow: boolean;
}
```

### Example Response (Success)
```json
{
    "success": true,
    "summary": {
        "sessionId": "abc123",
        "sessionName": "Performance Trace",
        "state": "running",
        "totalEventCount": 1542,
        "bufferCapacity": 10000,
        "timeRange": {
            "earliest": "2026-02-02T10:30:00.000Z",
            "latest": "2026-02-02T11:45:30.000Z"
        },
        "topEventTypes": [
            { "name": "sql_batch_completed", "count": 892 },
            { "name": "rpc_completed", "count": 450 },
            { "name": "sql_statement_completed", "count": 200 }
        ],
        "topDatabases": [
            { "name": "AdventureWorks", "count": 1200 },
            { "name": "master", "count": 342 }
        ],
        "topApplications": [
            { "name": "Microsoft SQL Server Management Studio", "count": 800 },
            { "name": "MyApp", "count": 742 }
        ],
        "eventsLostToOverflow": false
    }
}
```

### Example Response (Session Not Found)
```json
{
    "success": false,
    "message": "Profiler session 'xyz789' not found. Use mssql_profiler_list_sessions to see available sessions."
}
```

### Example Response (No Events)
```json
{
    "success": true,
    "summary": {
        "sessionId": "abc123",
        "sessionName": "Performance Trace",
        "state": "running",
        "totalEventCount": 0,
        "bufferCapacity": 10000,
        "topEventTypes": [],
        "topDatabases": [],
        "topApplications": [],
        "eventsLostToOverflow": false
    },
    "message": "Session is active but has not captured any events yet."
}
```

---

## Tool 3: `mssql_profiler_query_events`

### Description
Queries events from a profiler session with optional filtering. Results are paginated and text fields are truncated.

### Input Parameters
```typescript
interface QueryEventsParams {
    sessionId: string;                    // Required
    filters?: FilterClause[];             // Optional, AND logic
    limit?: number;                       // Optional, default 50, max 200
    sortBy?: "timestamp" | "duration";    // Optional, default "timestamp"
    sortOrder?: "asc" | "desc";           // Optional, default "desc" (newest first)
}

interface FilterClause {
    field: string;
    operator: "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | 
              "greaterThanOrEqual" | "lessThanOrEqual" | "isNull" | "isNotNull" |
              "startsWith" | "notContains" | "notStartsWith";
    value?: string | number | boolean | null;
    typeHint?: "string" | "number" | "date" | "datetime" | "boolean";
}
```

### Output Contract
```typescript
interface QueryEventsResult {
    success: boolean;
    message?: string;
    events?: EventSummary[];
    metadata?: QueryMetadata;
}

interface EventSummary {
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string;        // Truncated to 512 chars
    databaseName: string;
    duration?: number;       // Microseconds
    cpu?: number;           // Milliseconds
    reads?: number;
    writes?: number;
}

interface QueryMetadata {
    totalMatching: number;
    returned: number;
    truncated: boolean;
    textTruncationLimit: number;
}
```

### Example Request (Find Slow Queries)
```json
{
    "sessionId": "abc123",
    "filters": [
        { "field": "duration", "operator": "greaterThan", "value": 1000000, "typeHint": "number" }
    ],
    "limit": 10,
    "sortBy": "duration",
    "sortOrder": "desc"
}
```

### Example Response (Success)
```json
{
    "success": true,
    "events": [
        {
            "eventId": "evt-001",
            "eventNumber": 1523,
            "timestamp": "2026-02-02T11:42:30.000Z",
            "eventClass": "sql_batch_completed",
            "textData": "SELECT * FROM LargeTable WHERE column1 = 'value' AND column2 IN (SELECT... [truncated]",
            "databaseName": "AdventureWorks",
            "duration": 5234567,
            "cpu": 2100,
            "reads": 45000,
            "writes": 0
        }
    ],
    "metadata": {
        "totalMatching": 45,
        "returned": 10,
        "truncated": true,
        "textTruncationLimit": 512
    }
}
```

### Example Response (No Matches)
```json
{
    "success": true,
    "events": [],
    "metadata": {
        "totalMatching": 0,
        "returned": 0,
        "truncated": false,
        "textTruncationLimit": 512
    },
    "message": "No events match the specified filters. Try adjusting the filter criteria."
}
```

### Valid Filter Fields
| Field | Type | Description |
|-------|------|-------------|
| `eventClass` | string | Event type (e.g., "sql_batch_completed") |
| `databaseName` | string | Database name |
| `textData` | string | SQL text (use Contains operator) |
| `duration` | number | Duration in microseconds |
| `cpu` | number | CPU time in milliseconds |
| `reads` | number | Logical reads |
| `writes` | number | Logical writes |
| `spid` | number | Server process ID |
| `applicationName` | string | Client application name |

---

## Tool 4: `mssql_profiler_get_event_detail`

### Description
Returns the complete details for a single event, including full query text (with truncation for very large queries).

### Input Parameters
```typescript
interface GetEventDetailParams {
    sessionId: string;  // Required
    eventId: string;    // Required
}
```

### Output Contract
```typescript
interface GetEventDetailResult {
    success: boolean;
    message?: string;
    event?: EventDetail;
}

interface EventDetail {
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string;           // Up to 4096 chars
    textTruncated: boolean;
    databaseName: string;
    applicationName?: string;
    hostName?: string;
    loginName?: string;
    spid?: number;
    duration?: number;
    cpu?: number;
    reads?: number;
    writes?: number;
    rowCounts?: number;
    additionalData: Record<string, string>;
}
```

### Example Response (Success)
```json
{
    "success": true,
    "event": {
        "eventId": "evt-001",
        "eventNumber": 1523,
        "timestamp": "2026-02-02T11:42:30.000Z",
        "eventClass": "sql_batch_completed",
        "textData": "SELECT p.ProductID, p.Name, p.ListPrice, c.Name AS Category FROM Production.Product p INNER JOIN Production.ProductCategory c ON p.ProductCategoryID = c.ProductCategoryID WHERE p.ListPrice > 100 ORDER BY p.ListPrice DESC",
        "textTruncated": false,
        "databaseName": "AdventureWorks",
        "applicationName": "Microsoft SQL Server Management Studio",
        "hostName": "WORKSTATION1",
        "loginName": "sa",
        "spid": 55,
        "duration": 5234567,
        "cpu": 2100,
        "reads": 45000,
        "writes": 0,
        "rowCounts": 250,
        "additionalData": {
            "client_app_name": "Microsoft SQL Server Management Studio",
            "client_hostname": "WORKSTATION1"
        }
    }
}
```

### Example Response (Event Not Found)
```json
{
    "success": false,
    "message": "Event 'evt-999' not found in session 'abc123'. The event may have been removed from the buffer due to overflow."
}
```

### Example Response (Truncated Text)
```json
{
    "success": true,
    "event": {
        "eventId": "evt-002",
        "eventNumber": 1524,
        "timestamp": "2026-02-02T11:43:00.000Z",
        "eventClass": "sql_batch_completed",
        "textData": "-- Very long stored procedure...\nCREATE PROCEDURE dbo.ComplexProc ... [truncated after 4096 characters]",
        "textTruncated": true,
        "databaseName": "AdventureWorks",
        "duration": 123456,
        "additionalData": {}
    }
}
```

---

## Error Response Contract

All tools use a consistent error response format:

```typescript
interface ErrorResponse {
    success: false;
    message: string;
    errorCode?: string;
}
```

### Standard Error Codes

| Code | Message Template |
|------|------------------|
| `SESSION_NOT_FOUND` | "Profiler session '{sessionId}' not found. Use mssql_profiler_list_sessions to see available sessions." |
| `EVENT_NOT_FOUND` | "Event '{eventId}' not found in session. It may have been removed due to buffer overflow." |
| `INVALID_FILTER` | "Invalid filter: field '{field}' is not a valid event field." |
| `INVALID_OPERATOR` | "Invalid operator '{operator}' for field type '{type}'." |
| `LIMIT_EXCEEDED` | "Requested limit {requested} exceeds maximum of {max}. Using maximum limit." |
