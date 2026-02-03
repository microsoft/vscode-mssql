# Data Model: Profiler Agent Tools

**Feature**: 1-profiler-agent-tools  
**Date**: February 2, 2026

## Overview

This document defines the data entities and their relationships for the Profiler Agent Tools feature. All entities are derived from existing Profiler data structures and transformed for safe, bounded LLM consumption.

---

## Entity Definitions

### 1. ProfilerSessionInfo

**Description**: A serializable representation of a profiler session for tool responses.

**Source**: `ProfilerSession` (internal class)

| Field | Type | Source Mapping | Notes |
|-------|------|----------------|-------|
| `sessionId` | `string` | `session.id` | Unique identifier |
| `sessionName` | `string` | `session.sessionName` | User-visible name |
| `state` | `SessionStateString` | `session.state` | Enum mapped to string |
| `templateName` | `string` | `session.templateName` | Profiler template used |
| `connectionLabel` | `string` | Derived from connection info | Server name or URI |
| `eventCount` | `number` | `session.events.size` | Current buffer count |
| `bufferCapacity` | `number` | `session.events.capacity` | Max buffer size |
| `createdAt` | `string` | `new Date(session.createdAt).toISOString()` | ISO 8601 timestamp |

**Type Definition**:
```typescript
type SessionStateString = "running" | "paused" | "stopped" | "creating" | "failed" | "notStarted";

interface ProfilerSessionInfo {
    sessionId: string;
    sessionName: string;
    state: SessionStateString;
    templateName: string;
    connectionLabel: string;
    eventCount: number;
    bufferCapacity: number;
    createdAt: string;
}
```

---

### 2. SessionSummary

**Description**: Aggregated statistics for a profiler session.

**Source**: Computed from `ProfilerSession.events` (RingBuffer)

| Field | Type | Computation | Notes |
|-------|------|-------------|-------|
| `sessionId` | `string` | Direct | Session identifier |
| `sessionName` | `string` | Direct | Session name |
| `state` | `SessionStateString` | Direct | Current state |
| `totalEventCount` | `number` | `events.size` | Events in buffer |
| `bufferCapacity` | `number` | `events.capacity` | Max capacity |
| `timeRange` | `TimeRange \| undefined` | Min/max timestamps | Undefined if no events |
| `topEventTypes` | `CountedItem[]` | Group by `eventClass`, count | Top 10 |
| `topDatabases` | `CountedItem[]` | Group by `databaseName`, count | Top 10 |
| `topApplications` | `CountedItem[]` | Group by `additionalData.applicationName`, count | Top 10 |
| `eventsLostToOverflow` | `boolean` | `events.size === events.capacity` | Approximate indicator |

**Type Definitions**:
```typescript
interface TimeRange {
    earliest: string; // ISO 8601
    latest: string;   // ISO 8601
}

interface CountedItem {
    name: string;
    count: number;
}

interface SessionSummary {
    sessionId: string;
    sessionName: string;
    state: SessionStateString;
    totalEventCount: number;
    bufferCapacity: number;
    timeRange?: TimeRange;
    topEventTypes: CountedItem[];
    topDatabases: CountedItem[];
    topApplications: CountedItem[];
    eventsLostToOverflow: boolean;
}
```

---

### 3. EventSummary

**Description**: A truncated event representation for list/query responses.

**Source**: `EventRow` (internal type)

| Field | Type | Source Mapping | Truncation |
|-------|------|----------------|------------|
| `eventId` | `string` | `event.id` | None |
| `eventNumber` | `number` | `event.eventNumber` | None |
| `timestamp` | `string` | `event.timestamp.toISOString()` | None |
| `eventClass` | `string` | `event.eventClass` | None |
| `textData` | `string` | `event.textData` | 512 chars |
| `databaseName` | `string` | `event.databaseName` | None |
| `duration` | `number \| undefined` | `event.duration` | None |
| `cpu` | `number \| undefined` | `event.cpu` | None |
| `reads` | `number \| undefined` | `event.reads` | None |
| `writes` | `number \| undefined` | `event.writes` | None |

**Type Definition**:
```typescript
interface EventSummary {
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string;
    databaseName: string;
    duration?: number;
    cpu?: number;
    reads?: number;
    writes?: number;
}
```

---

### 4. EventDetail

**Description**: Full event representation for single-event inspection.

**Source**: `EventRow` (internal type)

| Field | Type | Source Mapping | Truncation |
|-------|------|----------------|------------|
| `eventId` | `string` | `event.id` | None |
| `eventNumber` | `number` | `event.eventNumber` | None |
| `timestamp` | `string` | `event.timestamp.toISOString()` | None |
| `eventClass` | `string` | `event.eventClass` | None |
| `textData` | `string` | `event.textData` | 4096 chars |
| `textTruncated` | `boolean` | Computed | Indicates truncation |
| `databaseName` | `string` | `event.databaseName` | None |
| `applicationName` | `string \| undefined` | `event.additionalData.applicationName` | None |
| `spid` | `number \| undefined` | `event.spid` | None |
| `duration` | `number \| undefined` | `event.duration` | None |
| `cpu` | `number \| undefined` | `event.cpu` | None |
| `reads` | `number \| undefined` | `event.reads` | None |
| `writes` | `number \| undefined` | `event.writes` | None |
| `additionalData` | `Record<string, string>` | `event.additionalData` | None |

**Type Definition**:
```typescript
interface EventDetail {
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string;
    textTruncated: boolean;
    databaseName: string;
    applicationName?: string;
    spid?: number;
    duration?: number;
    cpu?: number;
    reads?: number;
    writes?: number;
    additionalData: Record<string, string>;
}
```

---

### 5. FilterClause (Existing)

**Description**: Reused from existing profiler filtering system.

**Source**: `profilerTypes.ts`

```typescript
interface FilterClause {
    field: string;
    operator: FilterOperator;
    value?: string | number | boolean | null;
    typeHint?: FilterTypeHint;
}

enum FilterOperator {
    Equals = "equals",
    NotEquals = "notEquals",
    LessThan = "lessThan",
    LessThanOrEqual = "lessThanOrEqual",
    GreaterThan = "greaterThan",
    GreaterThanOrEqual = "greaterThanOrEqual",
    IsNull = "isNull",
    IsNotNull = "isNotNull",
    Contains = "contains",
    NotContains = "notContains",
    StartsWith = "startsWith",
    NotStartsWith = "notStartsWith",
}

type FilterTypeHint = "string" | "number" | "date" | "datetime" | "boolean";
```

---

### 6. QueryMetadata

**Description**: Response metadata for paginated/filtered queries.

| Field | Type | Description |
|-------|------|-------------|
| `totalMatching` | `number` | Total events matching filter |
| `returned` | `number` | Events returned in response |
| `truncated` | `boolean` | True if results were limited |
| `textTruncationLimit` | `number` | Character limit applied to textData |

**Type Definition**:
```typescript
interface QueryMetadata {
    totalMatching: number;
    returned: number;
    truncated: boolean;
    textTruncationLimit: number;
}
```

---

## Entity Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                    ProfilerSessionManager                        │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ ProfilerSession  │    │ ProfilerSession  │   ...             │
│  │                  │    │                  │                   │
│  │  ┌────────────┐  │    │  ┌────────────┐  │                   │
│  │  │ RingBuffer │  │    │  │ RingBuffer │  │                   │
│  │  │ <EventRow> │  │    │  │ <EventRow> │  │                   │
│  │  └────────────┘  │    │  └────────────┘  │                   │
│  └──────────────────┘    └──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                │
                │ Tool transforms to
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Tool Response Entities                      │
│                                                                  │
│  ProfilerSessionInfo[]  ←── mssql_profiler_list_sessions        │
│                                                                  │
│  SessionSummary         ←── mssql_profiler_get_session_summary  │
│                                                                  │
│  EventSummary[]         ←── mssql_profiler_query_events         │
│  + QueryMetadata                                                │
│                                                                  │
│  EventDetail            ←── mssql_profiler_get_event_detail     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Transformation Rules

### SessionState Mapping

| Internal State | Tool Response |
|---------------|---------------|
| `SessionState.Running` | `"running"` |
| `SessionState.Paused` | `"paused"` |
| `SessionState.Stopped` | `"stopped"` |
| `SessionState.Creating` | `"creating"` |
| `SessionState.Failed` | `"failed"` |
| `SessionState.NotStarted` | `"notStarted"` |

### Timestamp Formatting

All `Date` objects are converted to ISO 8601 strings:
```typescript
const isoString = date.toISOString(); // "2026-02-02T14:30:00.000Z"
```

### Text Truncation

```typescript
function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
    if (!text || text.length <= maxLength) {
        return { text: text ?? "", truncated: false };
    }
    return {
        text: text.substring(0, maxLength - 15) + "... [truncated]",
        truncated: true
    };
}
```

### Numeric Field Handling

Duration, CPU, reads, writes may be `undefined`. Tools pass through undefined values (JSON serializes as absent key):
```typescript
const summary: EventSummary = {
    // ...
    duration: event.duration, // undefined becomes absent in JSON
};
```
