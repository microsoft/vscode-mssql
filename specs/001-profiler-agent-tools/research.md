# Research: Profiler Agent Tools

**Feature**: 1-profiler-agent-tools  
**Date**: February 2, 2026  
**Status**: Complete

## Research Summary

This document captures the technical research conducted for implementing Profiler Agent Tools.

---

## 1. Existing Agent Tool Patterns

### Decision: Extend `ToolBase<T>`
**Rationale**: Provides consistent telemetry, error handling, and response formatting across all Copilot tools.

**Alternatives Considered**:
- Implement `vscode.LanguageModelTool<T>` directly → Rejected: Would miss telemetry integration and error handling patterns

### Key Patterns Identified

```typescript
// From toolBase.ts - invoke() method wraps call() with telemetry
abstract class ToolBase<T> implements vscode.LanguageModelTool<T> {
    async invoke(options, token) {
        const telemetryActivity = startActivity(TelemetryViews.MssqlCopilot, TelemetryActions.CopilotAgentModeToolCall);
        try {
            const response = await this.call(options, token);
            telemetryActivity.end(ActivityStatus.Succeeded);
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(response)]);
        } catch (error) {
            telemetryActivity.endFailed(error);
            return JSON.stringify({ isError: true, message: error.message });
        }
    }
    abstract call(options, token): Promise<string>;
}
```

**Tool Registration Pattern** (from mainController.ts):
```typescript
this._context.subscriptions.push(
    vscode.lm.registerTool(
        Constants.copilotToolName,
        new ToolClass(dependencies...),
    ),
);
```

---

## 2. Profiler Data Access APIs

### Decision: Use `ProfilerSessionManager` for session access
**Rationale**: Provides all needed methods (`getAllSessions()`, `getSession()`, `getRunningSessions()`) without needing to access internal state.

### Available APIs

| Method | Returns | Use Case |
|--------|---------|----------|
| `getAllSessions()` | `ProfilerSession[]` | List all sessions |
| `getSession(id)` | `ProfilerSession \| undefined` | Get specific session |
| `getRunningSessions()` | `ProfilerSession[]` | Get active sessions only |

### ProfilerSession Properties

| Property | Type | Notes |
|----------|------|-------|
| `id` | `string` | Unique session identifier |
| `sessionName` | `string` | User-facing name |
| `state` | `SessionState` | running/paused/stopped/creating/failed |
| `templateName` | `string` | Template used |
| `ownerUri` | `string` | Connection URI |
| `events` | `RingBuffer<EventRow>` | In-memory event buffer |
| `createdAt` | `number` | Creation timestamp |
| `eventCount` | `number` | Current event count |

---

## 3. Filtering with FilteredBuffer

### Decision: Reuse `FilteredBuffer` with `FilterClause` schema
**Rationale**: Proven filtering logic supporting rich operators. Avoids reinventing client-side filtering.

### FilterClause Schema

```typescript
interface FilterClause {
    field: string;           // Column name (e.g., "databaseName", "duration")
    operator: FilterOperator; // Comparison operator
    value?: string | number | boolean | null;
    typeHint?: FilterTypeHint; // "string" | "number" | "date" | "datetime" | "boolean"
}
```

### Available Operators

| Operator | Use Case |
|----------|----------|
| `Equals` | Exact match (database = "AdventureWorks") |
| `NotEquals` | Exclusion filter |
| `Contains` | Text search (textData contains "SELECT") |
| `GreaterThan` | Threshold (duration > 1000000) |
| `LessThan` | Upper bound filter |
| `IsNull` / `IsNotNull` | Null checks |
| `StartsWith` | Prefix match |

### FilteredBuffer Methods

| Method | Returns | Use Case |
|--------|---------|----------|
| `setFilter(clauses)` | `void` | Apply filters |
| `clearFilter()` | `void` | Remove filters |
| `getFilteredRows()` | `T[]` | Get all matching rows |
| `getFilteredRange(start, count)` | `T[]` | Paginated results |
| `filteredCount` | `number` | Count of matches |
| `totalCount` | `number` | Total unfiltered count |

---

## 4. EventRow Fields

### Decision: Expose standard fields with optional additional data
**Rationale**: Core fields are always available; additional XEvent-specific fields vary by template.

### Core Fields (Always Available)

| Field | Type | Example |
|-------|------|---------|
| `id` | `string` | UUID from STS |
| `eventNumber` | `number` | Sequence number |
| `timestamp` | `Date` | Event time |
| `eventClass` | `string` | "sql_batch_completed" |
| `textData` | `string` | SQL text |
| `databaseName` | `string` | "AdventureWorks" |
| `spid` | `number \| undefined` | Session ID |
| `duration` | `number \| undefined` | Microseconds |
| `cpu` | `number \| undefined` | CPU time |
| `reads` | `number \| undefined` | Logical reads |
| `writes` | `number \| undefined` | Logical writes |

### Additional Data
`additionalData: Record<string, string>` contains template-specific fields like `applicationName`, `loginName`, `hostName`, etc.

---

## 5. Text Truncation Strategy

### Decision: Implement per-tool truncation limits
**Rationale**: Different tools have different needs - list views need shorter text, detail views can show more.

| Tool | Default Truncation | Max Truncation |
|------|-------------------|----------------|
| `query_events` | 512 chars | 1024 chars |
| `get_event_detail` | 4096 chars | 8192 chars |

### Truncation Implementation

```typescript
function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
    if (text.length <= maxLength) {
        return { text, truncated: false };
    }
    return {
        text: text.substring(0, maxLength) + "... [truncated]",
        truncated: true
    };
}
```

---

## 6. Response Size Management

### Decision: Enforce strict limits for LLM consumption
**Rationale**: Large responses degrade LLM performance and may exceed context limits.

| Constraint | Value | Enforcement |
|------------|-------|-------------|
| Max events per query | 200 | Hard limit in tool |
| Default events per query | 50 | Default parameter value |
| Max response size | ~4KB | Text truncation + event limits |
| Text field truncation | 512-4096 chars | Per-field truncation |

---

## 7. Tool Name Convention

### Decision: Follow existing `mssql_*` naming pattern
**Rationale**: Consistency with existing tools (`mssql_list_tables`, `mssql_run_query`).

| Tool Name | Purpose |
|-----------|---------|
| `mssql_profiler_list_sessions` | Discover sessions |
| `mssql_profiler_get_session_summary` | Session overview |
| `mssql_profiler_query_events` | Filtered event query |
| `mssql_profiler_get_event_detail` | Single event detail |

---

## 8. Dependency Injection

### Decision: Inject `ProfilerSessionManager` at tool registration
**Rationale**: Allows testability via mock injection; follows existing tool patterns.

```typescript
// Registration pattern
new ProfilerListSessionsTool(profilerSessionManager)

// Tool constructor
constructor(private _sessionManager: ProfilerSessionManager) { super(); }
```

---

## Open Questions Resolved

| Question | Resolution |
|----------|------------|
| Filter schema | Reuse existing `FilterClause` from `profilerTypes.ts` |
| Aggregation in-tool vs Copilot | Let Copilot aggregate; tools return raw data with limits |
| Telemetry | Use existing `TelemetryViews.MssqlCopilot` with tool-specific action properties |
| Connection label format | Extract server name from `ownerUri` pattern `profiler://{guid}` - will need session's original connection info |

---

## References

- [toolBase.ts](../../extensions/mssql/src/copilot/tools/toolBase.ts) - Base class for tools
- [listTablesTool.ts](../../extensions/mssql/src/copilot/tools/listTablesTool.ts) - Example tool implementation
- [profilerSessionManager.ts](../../extensions/mssql/src/profiler/profilerSessionManager.ts) - Session management
- [filteredBuffer.ts](../../extensions/mssql/src/profiler/filteredBuffer.ts) - Filtering API
- [profilerTypes.ts](../../extensions/mssql/src/profiler/profilerTypes.ts) - Type definitions
