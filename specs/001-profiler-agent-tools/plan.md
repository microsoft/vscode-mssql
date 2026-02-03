# Implementation Plan: Profiler Agent Tools

**Branch**: `1-profiler-agent-tools` | **Date**: February 2, 2026 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/1-profiler-agent-tools/spec.md`

## Summary

Add read-only GitHub Copilot Agent Tools to expose Profiler session data for natural-language queries. The implementation will add four tools (`mssql_profiler_list_sessions`, `mssql_profiler_get_session_summary`, `mssql_profiler_query_events`, `mssql_profiler_get_event_detail`) that query existing in-memory Profiler data via the `ProfilerSessionManager` and `FilteredBuffer` APIs.

## Technical Context

**Language/Version**: TypeScript with strict type checking (ES2024 target)  
**Primary Dependencies**: VS Code Extension API (`vscode.lm.registerTool`), existing `ProfilerSessionManager`, `FilteredBuffer`, `RingBuffer`  
**Storage**: In-memory ring buffer (no database)  
**Testing**: Unit tests via `yarn test` within `extensions/mssql/` directory  
**Target Platform**: VS Code 1.98.0+ with GitHub Copilot Agent mode  
**Project Type**: Monorepo extension (MSSQL extension)  
**Performance Goals**: <500ms response time for sessions with up to 10,000 events  
**Constraints**: Max 200 events per query, text fields truncated to 512-1024 chars, output under 4KB  
**Scale/Scope**: Querying existing in-memory data only, no server calls

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. TypeScript-First | ✅ PASS | All code will be TypeScript with strict typing |
| II. VS Code Extension Patterns | ✅ PASS | Using `vscode.lm.registerTool` pattern from existing tools |
| III. React Webview Standards | ⚪ N/A | No webview changes required |
| IV. Test-First (NON-NEGOTIABLE) | ✅ PASS | Unit tests will be written before implementation |
| V. Build Verification | ✅ PASS | Will verify with `yarn build`, `yarn lint src/ test/`, `yarn package` |
| VI. Code Quality Gates | ✅ PASS | ESLint, Prettier, copyright headers enforced |
| VII. Simplicity & YAGNI | ✅ PASS | Reusing existing APIs (FilteredBuffer, SessionManager), minimal new code |
| VIII. Extension Independence | ✅ PASS | All changes within `extensions/mssql/` |

## Project Structure

### Documentation (this feature)

```text
specs/1-profiler-agent-tools/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (tool interfaces)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
extensions/mssql/
├── package.json                      # REQUIRED: Add tool declarations to languageModelTools[]
├── src/
│   ├── constants/
│   │   └── constants.ts              # Add tool name constants
│   ├── constants/
│   │   └── locConstants.ts           # Add localized strings
│   ├── controllers/
│   │   └── mainController.ts         # Register new tools
│   ├── copilot/
│   │   └── tools/
│   │       ├── profilerListSessionsTool.ts      # NEW: List sessions tool
│   │       ├── profilerGetSessionSummaryTool.ts # NEW: Session summary tool
│   │       ├── profilerQueryEventsTool.ts       # NEW: Query events tool
│   │       └── profilerGetEventDetailTool.ts    # NEW: Event detail tool
│   ├── profiler/
│   │   ├── filteredBuffer.ts         # EXISTING: Reuse for filtering
│   │   ├── profilerSessionManager.ts # EXISTING: Access sessions
│   │   └── profilerTypes.ts          # EXISTING: Types (FilterClause, etc.)
│   └── sharedInterfaces/
│       └── telemetry.ts              # Add TelemetryViews.Profiler if needed
│
└── test/
    └── unit/
        └── copilot/
            └── tools/
                ├── profilerListSessionsTool.test.ts      # NEW
                ├── profilerGetSessionSummaryTool.test.ts # NEW
                ├── profilerQueryEventsTool.test.ts       # NEW
                └── profilerGetEventDetailTool.test.ts    # NEW
```

**Structure Decision**: Following existing Copilot tools pattern (`extensions/mssql/src/copilot/tools/`). New tools extend `ToolBase` and are registered in `mainController.ts`.

## Complexity Tracking

> No violations identified. Design uses existing APIs with minimal new abstractions.

---

## Phase 0: Research

### Research Tasks

1. **Existing Tool Pattern Analysis**
   - [x] Reviewed `ToolBase` class structure (invoke/call pattern, telemetry integration)
   - [x] Reviewed existing tools (ListTablesTool, RunQueryTool) for parameter/response patterns
   - [x] Identified registration pattern in `mainController.ts`

2. **Profiler Data Access APIs**
   - [x] Reviewed `ProfilerSessionManager` API (getAllSessions, getSession, getRunningSessions)
   - [x] Reviewed `FilteredBuffer` API (getFilteredRows, getFilteredRange, setFilter, matches)
   - [x] Reviewed `FilterClause` schema (field, operator, value, typeHint)
   - [x] Reviewed `EventRow` fields available for filtering

3. **VS Code Language Model Tool API**
   - [x] Confirmed `vscode.lm.registerTool` API usage
   - [x] Confirmed `LanguageModelToolInvocationOptions` for parameters
   - [x] Confirmed `LanguageModelToolResult` for responses

### Research Findings

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Tool Base Class | Extend `ToolBase<T>` | Provides telemetry, error handling, and consistent response format |
| Session Access | Inject `ProfilerSessionManager` | SessionManager provides all needed session data and lookup methods |
| Filtering | Use `FilteredBuffer` with `FilterClause` | Proven filtering logic with rich operators (Equals, Contains, GreaterThan, etc.) |
| Response Format | JSON with success/data/metadata pattern | Consistent with existing tools like ListTablesTool |
| Text Truncation | Implement `truncateText(text, maxLength)` utility | Required for FR-007 compliance |
| Result Limits | Default 50, max 200 events | Balance between useful data and LLM context limits |

---

## Phase 1: Design

### Tool Interfaces (Contracts)

See [contracts/](contracts/) directory for detailed interface definitions.

#### Tool 1: `mssql_profiler_list_sessions`

```typescript
interface ListSessionsParams {
  // No parameters required
}

interface ListSessionsResult {
  success: boolean;
  message?: string;
  sessions: Array<{
    sessionId: string;
    sessionName: string;
    state: "running" | "paused" | "stopped" | "creating" | "failed";
    templateName: string;
    connectionLabel: string;
    eventCount: number;
    createdAt: string; // ISO timestamp
  }>;
}
```

#### Tool 2: `mssql_profiler_get_session_summary`

```typescript
interface GetSessionSummaryParams {
  sessionId: string;
}

interface GetSessionSummaryResult {
  success: boolean;
  message?: string;
  summary?: {
    sessionId: string;
    sessionName: string;
    state: string;
    totalEventCount: number;
    bufferCapacity: number;
    timeRange?: {
      earliest: string; // ISO timestamp
      latest: string;
    };
    topEventTypes: Array<{ eventClass: string; count: number }>;
    topDatabases: Array<{ databaseName: string; count: number }>;
    topApplications: Array<{ applicationName: string; count: number }>;
    eventsLostToOverflow: boolean;
  };
}
```

#### Tool 3: `mssql_profiler_query_events`

```typescript
interface QueryEventsParams {
  sessionId: string;
  filters?: FilterClause[]; // Reuse existing FilterClause schema
  limit?: number; // Default 50, max 200
  fields?: string[]; // Fields to include in response
}

interface QueryEventsResult {
  success: boolean;
  message?: string;
  events?: Array<{
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string; // Truncated to 512 chars
    databaseName: string;
    duration?: number;
    cpu?: number;
    reads?: number;
    writes?: number;
    // Additional fields based on `fields` param
  }>;
  metadata?: {
    totalMatching: number;
    returned: number;
    truncated: boolean;
    textTruncationLimit: number;
  };
}
```

#### Tool 4: `mssql_profiler_get_event_detail`

```typescript
interface GetEventDetailParams {
  sessionId: string;
  eventId: string;
}

interface GetEventDetailResult {
  success: boolean;
  message?: string;
  event?: {
    eventId: string;
    eventNumber: number;
    timestamp: string;
    eventClass: string;
    textData: string; // Full text, truncated at 4096 chars with indicator
    textTruncated: boolean;
    databaseName: string;
    applicationName?: string;
    spid?: number;
    duration?: number;
    cpu?: number;
    reads?: number;
    writes?: number;
    additionalData: Record<string, string>;
  };
}
```

### Data Model

See [data-model.md](data-model.md) for entity relationships.

Key mappings:
- `ProfilerSession` → Tool responses use subset of fields (no internal implementation details)
- `EventRow` → Transformed to tool-safe format (timestamps as ISO strings, text truncated)
- `FilterClause` → Passed directly to `FilteredBuffer.setFilter()`

### Error Handling

| Error Condition | Response |
|-----------------|----------|
| Session not found | `{ success: false, message: "Profiler session '{sessionId}' not found. Use mssql_profiler_list_sessions to see available sessions." }` |
| No events in buffer | `{ success: false, message: "No events captured in session '{sessionName}'. The session may be newly started or paused." }` |
| Invalid filter | `{ success: false, message: "Invalid filter: field '{field}' is not a valid event field. Valid fields: eventClass, databaseName, duration, ..." }` |
| Event not found | `{ success: false, message: "Event '{eventId}' not found in session. It may have been removed due to buffer overflow." }` |

---

## Phase 2: Tasks

*Generated by `/speckit.tasks` command - not included in `/speckit.plan` output*

---

## Implementation Learnings *(added post-implementation)*

### Critical: Dual Registration Required

Copilot tools require registration in **two places**:

1. **`package.json`** - Under `contributes.languageModelTools[]`:
   ```json
   {
     "name": "mssql_profiler_list_sessions",
     "modelDescription": "List all active SQL Server XEvent profiler sessions...",
     "tags": ["databases", "mssql", "profiler", "xevent"],
     "inputSchema": { ... },
     "canBeReferencedInPrompt": true,
     "displayName": "List XEvent Profiler Sessions",
     "toolReferenceName": "mssql_profiler_list_sessions"
   }
   ```

2. **`mainController.ts`** - Code registration:
   ```typescript
   vscode.lm.registerTool(
     Constants.copilotProfilerListSessionsToolName,
     new ProfilerListSessionsTool(this.profilerController.sessionManager),
   );
   ```

**Without the package.json declaration, Copilot will NOT discover the tool.**

### Terminology: Use "XEvent" for Discoverability

The LLM may confuse "profiler sessions" with "database connections". Use explicit terminology:

- ✅ "XEvent profiler sessions" / "Extended Events sessions"
- ✅ Tags: `xevent`, `extended-events`, `tracing`
- ✅ Clarify: "These are trace sessions, not database connections"
- ❌ Just "profiler sessions" alone

### User-Friendly Confirmations

Show **session name** instead of session ID in confirmation dialogs:

```typescript
async prepareInvocation(options, _token) {
  const { sessionId } = options.input;
  
  // Look up session to get the friendly name
  const session = this._sessionManager.getSession(sessionId);
  const displayName = session ? session.sessionName : sessionId;
  
  return {
    invocationMessage: loc.getSessionSummaryToolInvocationMessage(displayName),
    // ...
  };
}
```

### Tool Description Best Practices

Include in `modelDescription`:
- Clear purpose: "List all active SQL Server XEvent profiler sessions"
- Usage guidance: "Use this tool first to discover available sessions"
- Dependencies: "Requires sessionId from mssql_profiler_list_sessions"
- Data details: "Duration is in microseconds"
- Disambiguation: "This is different from database connections"

---

## Next Steps

1. Run `/speckit.tasks` to generate implementation task breakdown
2. Create feature branch `1-profiler-agent-tools` if not already on it
3. Begin implementation following test-first approach per Constitution
