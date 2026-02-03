# Feature Specification: Profiler Agent Tools

**Feature Branch**: `1-profiler-agent-tools`  
**Created**: February 2, 2026  
**Status**: Draft  
**Input**: User description: "Profiler Agent Tools – SPKT for S-DD: Adding read-only Agent Tools to expose Profiler session data to GitHub Copilot Agent mode"

## Clarifications

### Session 2026-02-02

- Q: Should the Agent Tool define a new filter schema or reuse the existing FilteredBuffer FilterClause schema? → A: Reuse the existing FilterClause schema (field, operator, value, typeHint) from FilteredBuffer

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover Active Profiler Sessions (Priority: P1)

A user working with SQL Server wants to use GitHub Copilot to help analyze their profiler data. Before asking performance questions, they need Copilot to know what profiler sessions are currently available to query.

**Why this priority**: Session discovery is the foundational capability that all other features depend on. Without knowing what sessions exist, Copilot cannot perform any analysis.

**Independent Test**: Can be fully tested by starting a Profiler session, then asking Copilot "What profiler sessions are running?" and verifying the session appears in the response.

**Acceptance Scenarios**:

1. **Given** a user has one or more active Profiler sessions, **When** they ask Copilot "What profiler sessions are running?", **Then** Copilot lists all available sessions with their names, states, and connection information.
2. **Given** a user has no active Profiler sessions, **When** they ask Copilot about profiler sessions, **Then** Copilot responds that no sessions are currently available.
3. **Given** a user has sessions in different states (running, paused, stopped), **When** they ask about sessions, **Then** the response correctly reflects each session's current state.

---

### User Story 2 - Get Session Summary and Overview (Priority: P1)

A user wants to quickly understand what's happening in their profiler session without manually scrolling through events. They ask Copilot for a high-level summary of the session activity.

**Why this priority**: Session summaries provide immediate value by giving users actionable insights without deep diving. This is the most common initial question users will ask.

**Independent Test**: Can be tested by running a profiler session with various events, then asking Copilot "Summarize what's happening in my current profiler session" and verifying the summary includes event counts, time range, and dominant event types.

**Acceptance Scenarios**:

1. **Given** a user has an active Profiler session with captured events, **When** they ask Copilot to summarize the session, **Then** Copilot returns a summary including total event count, time range (earliest to latest event), and top event types by frequency.
2. **Given** a Profiler session with events from multiple databases, **When** the user asks for a summary, **Then** the summary includes which databases are generating the most activity.
3. **Given** a Profiler session with no events yet, **When** the user asks for a summary, **Then** Copilot indicates the session is active but has not captured any events yet.

---

### User Story 3 - Identify Slow Queries (Priority: P1)

A user is investigating performance issues and wants Copilot to help identify the slowest queries captured by the profiler. This is the most common performance investigation task.

**Why this priority**: Finding slow queries is the primary use case for SQL Server profiling. This directly addresses the user's need to diagnose performance problems.

**Independent Test**: Can be tested by running queries with varying durations against a profiled server, then asking Copilot "What are the slowest queries in this session?" and verifying the response lists queries ordered by duration.

**Acceptance Scenarios**:

1. **Given** a Profiler session with multiple query events, **When** the user asks "What are the top 5 slowest queries?", **Then** Copilot returns the queries with the highest duration values, including the query text and duration metrics.
2. **Given** a Profiler session with queries, **When** the user asks about slow queries, **Then** Copilot provides context like database name, application name, and execution metrics (CPU, reads, writes) alongside duration.
3. **Given** a Profiler session with no query completion events, **When** the user asks about slow queries, **Then** Copilot explains that no completed queries are available and suggests what event types might be missing.

---

### User Story 4 - Query Events with Filters (Priority: P2)

A user wants to focus their investigation on specific types of events, such as queries from a particular database, application, or time window. They need to filter the profiler data to narrow down their analysis.

**Why this priority**: While discovering and summarizing sessions provides broad insights, filtering enables targeted investigation. This is essential for debugging specific issues but requires the foundational tools first.

**Independent Test**: Can be tested by asking Copilot "Show me queries from the AdventureWorks database" and verifying only events matching that database are returned.

**Acceptance Scenarios**:

1. **Given** a Profiler session with events from multiple databases, **When** the user asks to see events from a specific database, **Then** Copilot returns only events matching that database name.
2. **Given** a Profiler session with events, **When** the user asks for "queries longer than 1 second", **Then** Copilot returns only events where duration exceeds the specified threshold.
3. **Given** a Profiler session, **When** the user asks for events "containing SELECT FROM Users", **Then** Copilot returns only events where the query text contains that pattern.
4. **Given** a filter query that matches no events, **When** the user applies the filter, **Then** Copilot indicates no matching events were found and suggests adjusting the filter criteria.

---

### User Story 5 - Inspect Single Event Detail (Priority: P2)

A user has identified a problematic query and wants to see its full details, including the complete query text and all captured metrics. They need to drill down into a specific event for deeper analysis.

**Why this priority**: Detailed event inspection is the final step in an investigation workflow. Users need summary and filtering capabilities first before drilling into specific events.

**Independent Test**: Can be tested by asking Copilot about a specific event identified from a previous query and verifying the full event payload is returned.

**Acceptance Scenarios**:

1. **Given** a user has identified an event of interest, **When** they ask Copilot to show details for that event, **Then** Copilot returns the full event payload including complete TextData and all available metrics.
2. **Given** an event with a very long query text, **When** the user requests full details, **Then** the response includes the complete text (or indicates if truncation occurred due to size limits).
3. **Given** a request for an event that doesn't exist in the buffer, **When** the user asks for details, **Then** Copilot responds that the event was not found (may have been removed from buffer due to overflow).

---

### User Story 6 - Analyze Load Distribution (Priority: P3)

A user wants to understand which databases or applications are generating the most load on their SQL Server. This helps identify unexpected sources of database activity.

**Why this priority**: Load analysis is valuable for capacity planning and identifying rogue applications, but it's a more advanced use case that builds on the core querying capabilities.

**Independent Test**: Can be tested by running queries from different applications/databases, then asking Copilot "Which databases are generating the most load?" and verifying an aggregated breakdown is provided.

**Acceptance Scenarios**:

1. **Given** a Profiler session with events from multiple databases, **When** the user asks which databases are busiest, **Then** Copilot returns a ranking of databases by event count, total CPU, or total duration.
2. **Given** a Profiler session with application name data, **When** the user asks which applications are making the most queries, **Then** Copilot returns a breakdown by application name.
3. **Given** events with SPID information, **When** the user asks about session distribution, **Then** Copilot can identify which database sessions are most active.

---

### Edge Cases

- What happens when the ring buffer has overflowed and events have been dropped? Copilot should indicate that the buffer has a limited capacity and older events may not be available.
- What happens when a session is paused? Copilot should be able to query paused sessions and indicate the session state in responses.
- What happens when a user asks about a session that was stopped and disposed? Copilot should indicate the session is no longer available.
- What happens when TextData contains very large query text (e.g., 50KB)? The tool should truncate appropriately and indicate truncation occurred.
- What happens when multiple profiler sessions exist for the same server? Copilot should clearly distinguish between sessions and allow the user to specify which one to query.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a tool to list all available Profiler sessions with their identifiers, names, states, and connection labels.
- **FR-002**: The system MUST provide a tool to retrieve a summary of a Profiler session including event count, time range, and event type distribution.
- **FR-003**: The system MUST provide a tool to query events from a Profiler session using the existing `FilterClause` schema (field, operator, value, typeHint) from `FilteredBuffer`, supporting operators such as Equals, Contains, GreaterThan, LessThan for filtering by event type, database name, application name, duration thresholds, and text patterns.
- **FR-004**: The system MUST provide a tool to retrieve complete details for a single event by its identifier.
- **FR-005**: All tools MUST be read-only and MUST NOT modify Profiler session state, server configuration, or execute SQL queries against the server.
- **FR-006**: The system MUST enforce a maximum limit on the number of events returned per query (default of 50, maximum of 200 events).
- **FR-007**: The system MUST truncate large text fields by default (512-1024 characters) and indicate when truncation has occurred.
- **FR-008**: Tool responses MUST include metadata indicating whether results are partial, truncated, or if events may have been lost due to buffer overflow.
- **FR-009**: The system MUST operate only on in-memory ring buffer data and MUST NOT make additional server calls.
- **FR-010**: All tools MUST follow existing MSSQL Copilot Agent Tools conventions for naming, parameters, error handling, and confirmation patterns.
- **FR-011**: Tool errors MUST be actionable (e.g., "session not found", "no events available", "invalid filter parameter").
- **FR-012**: Tool outputs MUST NOT include sensitive credentials or connection authentication details.

### Key Entities

- **Profiler Session**: Represents an active or loaded profiler session. Key attributes: session ID, session name, state (running/paused/stopped), template name, connection label, creation time.
- **Profiler Event**: A captured event from the profiler. Key attributes: event ID, event number, timestamp, event class/type, text data, database name, application name, SPID, duration, CPU time, reads, writes, additional metrics.
- **Session Summary**: An aggregated view of a profiler session. Key attributes: total event count, earliest event time, latest event time, event type counts, database distribution, application distribution.
- **Filter Criteria**: Parameters for querying events using the existing `FilterClause` schema. Key attributes: field (column to filter), operator (Equals, NotEquals, Contains, GreaterThan, LessThan, etc.), value (filter value), typeHint (string, number, date), plus result limit for pagination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Copilot correctly identifies and lists all active Profiler sessions 100% of the time when sessions exist.
- **SC-002**: Users can obtain a meaningful session summary within 2 seconds of asking Copilot.
- **SC-003**: Users can identify the top slow queries from a session in a single conversational turn (no multi-step prompting required).
- **SC-004**: Tool responses complete within 500ms for typical sessions (up to 10,000 events in the ring buffer).
- **SC-005**: 90% of users can successfully answer their profiler-related questions using Copilot without needing to manually inspect the Profiler UI.
- **SC-006**: Tool outputs are consistently under 4KB to ensure efficient LLM processing and avoid context window issues.
- **SC-007**: No user credentials, passwords, or sensitive authentication details appear in any tool output.
- **SC-008**: The existing Profiler feature experiences no performance degradation (event processing, UI responsiveness) when Agent Tools are active.

## Assumptions

- The existing Profiler SessionManager and filtered buffer APIs provide sufficient access to session data for the Agent Tools to query.
- Event data in the filtered buffer includes standard XEvent fields like duration, CPU, reads, writes, TextData, DatabaseName, and ApplicationName.
- GitHub Copilot Agent mode tool infrastructure is already integrated with the MSSQL extension.
- The extension already has established patterns for Agent Tool registration, parameter handling, and error responses that this feature will follow.

## Implementation Notes *(added post-implementation)*

### Tool Registration Requirements

Tools must be declared in **two places** for Copilot to discover and use them:

1. **package.json** - Add tool metadata under `contributes.languageModelTools[]`:
   - `name`: Tool identifier (e.g., `mssql_profiler_list_sessions`)
   - `modelDescription`: Detailed description that helps the LLM understand when to use the tool
   - `tags`: Keywords for tool discovery
   - `inputSchema`: JSON Schema for tool parameters
   - `displayName`, `userDescription`: User-facing names
   
2. **mainController.ts** - Register the tool implementation via `vscode.lm.registerTool()`

**Critical**: Without the `package.json` declaration, Copilot will not discover the tool even if it's registered in code.

### Terminology for Discoverability

Use **"XEvent" (Extended Events)** terminology in tool descriptions to differentiate from database connections:
- "XEvent profiler sessions" vs just "profiler sessions"
- "Extended Events" in tags and descriptions
- Clarify that these are **trace sessions, not database connections**

This helps the LLM correctly identify when to use profiler tools vs connection tools.

### User-Friendly Confirmation Messages

Confirmation prompts should display the **session name** (e.g., "Standard", "Performance Trace") rather than the internal session ID (UUID). This requires:
- Looking up the session in `prepareInvocation()` before showing the confirmation
- Falling back to session ID if the session is not found

### Tool Description Best Practices

Include in `modelDescription`:
- Clear statement of what the tool does
- When to use it (e.g., "Use this tool first to discover available sessions")
- What it requires (e.g., "Requires a sessionId from mssql_profiler_list_sessions")
- Important details about return values (e.g., "Duration is in microseconds")

## Dependencies

- Existing Profiler SessionManager and filtered buffer implementation
- Existing MSSQL Copilot Agent Tools framework and conventions
- GitHub Copilot Agent mode support in VS Code
