# Tasks: Profiler Agent Tools

**Input**: Design documents from `/specs/1-profiler-agent-tools/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/tool-contracts.md ✅

**Tests**: Tests are REQUIRED. This feature follows test-first development per Constitution IV.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, etc.)
- All paths relative to `extensions/mssql/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add constants, types, and shared utilities needed by all tools

- [x] T001 Add tool name constants in src/constants/constants.ts
- [x] T002 [P] Add localized error strings in src/constants/locConstants.ts
- [x] T003 [P] Create text truncation utility in src/copilot/tools/profilerToolUtils.ts
- [x] T004 [P] Add ProfilerSessionInfo and related types in src/copilot/tools/profilerToolTypes.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ensure ProfilerSessionManager is accessible to tools

**⚠️ CRITICAL**: All tools depend on accessing the ProfilerSessionManager instance

- [x] T005 Verify ProfilerSessionManager is accessible from mainController.ts (may need to expose getter or pass instance)
- [x] T006 Add unit test helper for mocking ProfilerSessionManager in test/unit/copilot/tools/profilerTestUtils.ts

**Checkpoint**: Foundation ready - tool implementation can begin

---

## Phase 3: User Story 1 - Discover Active Profiler Sessions (Priority: P1) 🎯 MVP

**Goal**: Users can ask Copilot "What profiler sessions are running?" and get a list of available sessions

**Independent Test**: Start a Profiler session → Ask Copilot about sessions → Verify session appears in response

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T007 [P] [US1] Unit test: returns empty array when no sessions in test/unit/copilot/tools/profilerListSessionsTool.test.ts
- [x] T008 [P] [US1] Unit test: returns session list with correct fields in test/unit/copilot/tools/profilerListSessionsTool.test.ts
- [x] T009 [P] [US1] Unit test: correctly maps all session states (running/paused/stopped/failed) in test/unit/copilot/tools/profilerListSessionsTool.test.ts
- [x] T009a [P] [US1] Unit test: handles disposed session gracefully (edge case) in test/unit/copilot/tools/profilerListSessionsTool.test.ts

### Implementation for User Story 1

- [x] T010 [US1] Create ProfilerListSessionsTool class in src/copilot/tools/profilerListSessionsTool.ts
- [x] T011 [US1] Implement session-to-response mapping (ProfilerSession → ProfilerSessionInfo)
- [x] T012 [US1] Register tool in mainController.ts registerLanguageModelTools() method

**Checkpoint**: User Story 1 complete - `mssql_profiler_list_sessions` tool functional ✅

---

## Phase 4: User Story 2 - Get Session Summary (Priority: P1)

**Goal**: Users can ask Copilot to summarize a session and get event counts, time range, and top event types

**Independent Test**: Run profiler with events → Ask Copilot for summary → Verify counts and distributions

### Tests for User Story 2 ⚠️

- [x] T013 [P] [US2] Unit test: returns error when session not found in test/unit/profiler/profilerGetSessionSummaryTool.test.ts
- [x] T014 [P] [US2] Unit test: returns summary with correct event count and time range in test/unit/profiler/profilerGetSessionSummaryTool.test.ts
- [x] T015 [P] [US2] Unit test: calculates top event types correctly in test/unit/profiler/profilerGetSessionSummaryTool.test.ts
- [x] T016 [P] [US2] Unit test: handles empty session (no events) gracefully in test/unit/profiler/profilerGetSessionSummaryTool.test.ts
- [x] T016a [P] [US2] Unit test: sets eventsLostToOverflow=true when buffer is at capacity (FR-008) in test/unit/profiler/profilerGetSessionSummaryTool.test.ts

### Implementation for User Story 2

- [x] T017 [US2] Create ProfilerGetSessionSummaryTool class in src/copilot/tools/profilerGetSessionSummaryTool.ts
- [x] T018 [US2] Implement aggregation logic (top event types, databases, applications)
- [x] T019 [US2] Implement time range calculation (min/max timestamps)
- [x] T020 [US2] Register tool in mainController.ts

**Checkpoint**: User Story 2 complete - `mssql_profiler_get_session_summary` tool functional ✅

---

## Phase 5: User Story 3 - Identify Slow Queries (Priority: P1)

**Goal**: Users can ask Copilot for slow queries and get events sorted by duration

**Note**: This story uses the Query Events tool (US4) with duration filtering. Implementing as combined US3+US4.

**Independent Test**: Run queries with varying durations → Ask for slowest → Verify ordered by duration desc

### Tests for User Story 3 & 4 (Query Events) ⚠️

- [x] T021 [P] [US3] Unit test: returns error when session not found in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T022 [P] [US3] Unit test: returns events sorted by duration desc by default in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T023 [P] [US3] Unit test: respects limit parameter (default 50, max 200) in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T024 [P] [US3] Unit test: truncates textData to 512 chars in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T025 [P] [US4] Unit test: applies FilterClause filters correctly (Equals, Contains, GreaterThan) in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T026 [P] [US4] Unit test: returns empty array with message when no matches in test/unit/copilot/tools/profilerQueryEventsTool.test.ts
- [x] T027 [P] [US4] Unit test: includes metadata (totalMatching, returned, truncated) in test/unit/copilot/tools/profilerQueryEventsTool.test.ts

### Implementation for User Story 3 & 4

- [x] T028 [US3] Create ProfilerQueryEventsTool class in src/copilot/tools/profilerQueryEventsTool.ts
- [x] T029 [US3] Implement FilteredBuffer integration for filtering events
- [x] T030 [US3] Implement sorting by timestamp or duration
- [x] T031 [US3] Implement event-to-summary transformation with text truncation
- [x] T032 [US3] Implement result limiting and metadata generation
- [x] T033 [US3] Register tool in mainController.ts

**Checkpoint**: User Stories 3 & 4 complete - `mssql_profiler_query_events` tool functional ✅

---

## Phase 6: User Story 5 - Inspect Single Event Detail (Priority: P2)

**Goal**: Users can ask Copilot for full details of a specific event

**Independent Test**: Get event ID from query results → Ask for details → Verify full payload returned

### Tests for User Story 5 ⚠️

- [x] T034 [P] [US5] Unit test: returns error when session not found in test/unit/copilot/tools/profilerGetEventDetailTool.test.ts
- [x] T035 [P] [US5] Unit test: returns error when event not found in test/unit/copilot/tools/profilerGetEventDetailTool.test.ts
- [x] T036 [P] [US5] Unit test: returns full event detail with all fields in test/unit/copilot/tools/profilerGetEventDetailTool.test.ts
- [x] T037 [P] [US5] Unit test: truncates textData at 4096 chars and sets textTruncated flag in test/unit/copilot/tools/profilerGetEventDetailTool.test.ts
- [x] T038 [P] [US5] Unit test: includes additionalData map in response in test/unit/copilot/tools/profilerGetEventDetailTool.test.ts

### Implementation for User Story 5

- [x] T039 [US5] Create ProfilerGetEventDetailTool class in src/copilot/tools/profilerGetEventDetailTool.ts
- [x] T040 [US5] Implement event lookup by ID from session buffer
- [x] T041 [US5] Implement event-to-detail transformation with extended text limit
- [x] T042 [US5] Register tool in mainController.ts

**Checkpoint**: User Story 5 complete - `mssql_profiler_get_event_detail` tool functional ✅

---

## Phase 7: User Story 6 - Analyze Load Distribution (Priority: P3)

**Goal**: Users can ask which databases/applications generate the most load

**Note**: This functionality is provided by the Session Summary tool (US2) which already returns topDatabases and topApplications. No additional tool needed.

**Independent Test**: Verify session summary includes database and application distributions

- [x] T043 [US6] Add unit test: verify topDatabases sorted by count desc in profilerGetSessionSummaryTool.test.ts
- [x] T044 [US6] Add unit test: verify topApplications sorted by count desc in profilerGetSessionSummaryTool.test.ts

**Checkpoint**: User Story 6 complete - covered by existing session summary tool ✅

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Build verification, cleanup, and documentation

- [x] T045 Run `yarn build` and fix any compilation errors
- [x] T046 Run `yarn lint src/copilot/tools/profiler*.ts test/unit/copilot/tools/profiler*.ts` and fix issues
- [ ] T047 Run `yarn test --grep "Profiler"` and verify all tests pass
- [ ] T048 Run `yarn package` and verify VSIX builds successfully
- [x] T049 [P] Update CHANGELOG.md with new features
- [ ] T050 Manual testing: verify tools work with actual Copilot Agent mode

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - US1 (List Sessions): No dependencies on other stories
  - US2 (Summary): No dependencies on other stories
  - US3/US4 (Query Events): No dependencies on other stories
  - US5 (Event Detail): No dependencies on other stories
  - US6 (Load Analysis): Depends on US2 (covered by summary)
- **Polish (Phase 8)**: Depends on all user stories complete

### Parallel Opportunities by Phase

```text
Phase 1 (Setup):
  T001 → T002, T003, T004 (parallel)

Phase 2 (Foundation):
  T005 → T006

Phase 3 (US1 - List Sessions):
  T007, T008, T009 (parallel tests) → T010 → T011 → T012

Phase 4 (US2 - Summary):
  T013, T014, T015, T016 (parallel tests) → T017 → T018, T019 (parallel) → T020

Phase 5 (US3/US4 - Query Events):
  T021-T027 (parallel tests) → T028 → T029, T030, T031 (parallel) → T032 → T033

Phase 6 (US5 - Event Detail):
  T034-T038 (parallel tests) → T039 → T040, T041 (parallel) → T042

Phase 7 (US6 - Load Analysis):
  T043, T044 (parallel tests)

Phase 8 (Polish):
  T045 → T046 → T047 → T048
  T049 (parallel with build verification)
  T050 (after T048)
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T006)
3. Complete Phase 3: User Story 1 - List Sessions (T007-T012)
4. **VALIDATE**: Test `mssql_profiler_list_sessions` works with Copilot

### Incremental Delivery

After MVP:
1. Add User Story 2 (Summary) → Test → Now users can list AND summarize
2. Add User Story 3/4 (Query Events) → Test → Now users can filter and find slow queries
3. Add User Story 5 (Event Detail) → Test → Full investigation workflow complete
4. User Story 6 already covered by Summary tool

---

## Summary

| Phase | Tasks | Parallel Opportunities |
|-------|-------|----------------------|
| Setup | T001-T004 | T002, T003, T004 parallel |
| Foundational | T005-T006 | Sequential |
| US1 - List Sessions | T007-T012 (+T009a) | Tests parallel |
| US2 - Summary | T013-T020 (+T016a), T043-T044 | Tests parallel, T018/T019 parallel |
| US3/US4 - Query Events | T021-T033 | Tests parallel, T029/T030/T031 parallel |
| US5 - Event Detail | T034-T042 | Tests parallel, T040/T041 parallel |
| US6 - Load Analysis | T043-T044 | Both parallel |
| Polish | T045-T050 | T049 parallel |

**Total Tasks**: 52 (50 original + 2 remediation tasks)  
**Tasks per User Story**: US1(7), US2(10), US3/US4(13), US5(9), US6(2)  
**MVP Scope**: Phases 1-3 (Tasks T001-T012 + T009a) = 13 tasks
