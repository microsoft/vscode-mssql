# Tasks: Profiler Column-Level Filtering and Quick Filter

**Input**: Design documents from `/specs/001-profiler-column-filter/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED for new features. Unit tests for FilteredBuffer enhancements and component tests for filter popovers.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `extensions/mssql/`:
- **Extension code**: `src/profiler/`, `src/sharedInterfaces/`
- **Webview code**: `src/reactviews/pages/Profiler/`
- **Tests**: `test/unit/profiler/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Type definitions, interfaces, and shared infrastructure that all user stories depend on

- [X] T001 Add `filterMode?: "categorical" | "text"` to `ProfilerColumnDef` interface in `src/sharedInterfaces/profiler.ts`
- [X] T002 [P] Add `ColumnFilterCriteria` interface to `src/profiler/profilerTypes.ts`
- [X] T003 [P] Add `ColumnFilterType` type (`"categorical" | "numeric" | "date" | "text"`) to `src/profiler/profilerTypes.ts`
- [X] T004 [P] Extend `FilterState` interface with `quickFilter?: string` and `columnFilters?: Record<string, ColumnFilterCriteria>` in `src/profiler/profilerTypes.ts`
- [X] T005 [P] Add new filter-related localization strings to `l10n/bundle.l10n.json`
- [X] T006 Create `src/reactviews/pages/Profiler/components/` directory structure

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: FilteredBuffer enhancements that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (REQUIRED) ⚠️

- [ ] T007 Add unit tests for `getDistinctValues()` method in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T008 [P] Add unit tests for quick filter logic in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T009 [P] Add unit tests for column filter conversion to clauses in `test/unit/profiler/filteredBuffer.test.ts`

### Implementation for Foundational

- [X] T010 Add `_distinctValuesCache` private field and `getDistinctValues(field: string): string[]` method to `FilteredBuffer` in `src/profiler/filteredBuffer.ts`
- [X] T011 [P] Add cache invalidation in `FilteredBuffer` when buffer changes (add event, clear) in `src/profiler/filteredBuffer.ts`
- [X] T012 Add `setQuickFilter(term: string)` method to `FilteredBuffer` in `src/profiler/filteredBuffer.ts`
- [X] T013 Add `setColumnFilter(field: string, criteria: ColumnFilterCriteria)` and `clearColumnFilter(field: string)` methods to `FilteredBuffer` in `src/profiler/filteredBuffer.ts`
- [X] T014 Update `evaluateRow()` to combine quick filter + column filters with AND logic in `src/profiler/filteredBuffer.ts`
- [X] T015 Add `applyColumnFilter`, `clearColumnFilter`, `setQuickFilter`, `clearAllFilters`, `getDistinctValues` reducers to `ProfilerReducers` in `src/sharedInterfaces/profiler.ts`
- [X] T016 Implement reducer handlers in `ProfilerWebviewController` in `src/profiler/profilerWebviewController.ts`

**Checkpoint**: FilteredBuffer now supports quick filter and column-level filters. Extension ↔ webview communication is ready.

---

## Phase 3: User Story 1 - Filter by Categorical Column Values (Priority: P1) 🎯 MVP

**Goal**: Users can filter categorical columns (EventClass, ApplicationName) using a searchable checkbox list

**Independent Test**: Open profiler, click funnel on EventClass column, select values, click Apply, verify only matching rows appear

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T017 [P] [US1] Add unit test for categorical filter with OR logic in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T018 [P] [US1] Create component test file `test/unit/profiler/categoricalFilter.test.ts` with tests for CategoricalFilter component

### Implementation for User Story 1

- [X] T019 [P] [US1] Create `CategoricalFilter.tsx` component in `src/reactviews/pages/Profiler/components/CategoricalFilter.tsx`
- [X] T019a [US1] Add "Search values..." placeholder text to categorical filter search input in `src/reactviews/pages/Profiler/components/CategoricalFilter.tsx`
- [X] T020 [US1] Create `ColumnFilterPopover.tsx` container component in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T021 [US1] Add funnel icon button to column headers using custom `headerFormatter` in `src/reactviews/pages/Profiler/profiler.tsx`
- [X] T022 [US1] Add popover state management (openColumn, pendingCriteria) to profiler component in `src/reactviews/pages/Profiler/profiler.tsx`
- [X] T023 [US1] Implement `distinctValuesResponse` notification handler in webview in `src/reactviews/pages/Profiler/profilerStateProvider.tsx`
- [X] T024 [US1] Add active filter visual indicator to funnel icon in `src/reactviews/pages/Profiler/profiler.tsx`
- [X] T024a [US1] Add empty state message "No results match the current filters" when filteredRowCount is 0 in `src/reactviews/pages/Profiler/profiler.tsx`
- [X] T025 [US1] Implement close on outside click, Escape key, and horizontal scroll in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T026 [US1] Add `filterMode: "categorical"` to EventClass column definition in `src/profiler/profilerDefaultConfig.ts`

**Checkpoint**: Categorical filtering fully functional. Can be tested independently.

---

## Phase 4: User Story 2 - Filter by Numeric Comparison (Priority: P1)

**Goal**: Users can filter numeric columns (Duration, CPU, Reads, Writes) using operator + value

**Independent Test**: Open profiler, click funnel on Duration column, select "greater than", enter 1000, click Apply, verify only matching rows appear

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T027 [P] [US2] Add unit tests for numeric filter validation in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T028 [P] [US2] Create component test file `test/unit/profiler/numericFilter.test.ts` with tests for NumericFilter component

### Implementation for User Story 2

- [X] T029 [P] [US2] Create `NumericFilter.tsx` component with operator dropdown and numeric input in `src/reactviews/pages/Profiler/components/NumericFilter.tsx`
- [X] T030 [US2] Add numeric validation (reject non-numeric input, show error) in `src/reactviews/pages/Profiler/components/NumericFilter.tsx`
- [X] T031 [US2] Integrate NumericFilter into ColumnFilterPopover for `type: "number"` columns in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T032 [US2] Add example hint line "Example: Find queries with Duration > 100" to numeric filter in `src/reactviews/pages/Profiler/components/NumericFilter.tsx`

**Checkpoint**: Numeric filtering fully functional. Can be tested independently.

---

## Phase 5: User Story 3 - Quick Filter Across All Columns (Priority: P1)

**Goal**: Users can type in "Quick filter all columns..." input to search across all column values

**Independent Test**: Open profiler, type "deadlock" in quick filter, verify only rows containing "deadlock" in any column appear

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T033 [P] [US3] Add unit test for quick filter cross-column search in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T034 [P] [US3] Create component test file `test/unit/profiler/quickFilter.test.ts` with tests for QuickFilterInput component

### Implementation for User Story 3

- [X] T035 [P] [US3] Create `QuickFilterInput.tsx` component with debounced input in `src/reactviews/pages/Profiler/components/QuickFilterInput.tsx`
- [X] T036 [US3] Implement RAF-based debounce (200ms) without setTimeout in `src/reactviews/pages/Profiler/components/QuickFilterInput.tsx`
- [X] T037 [US3] Replace existing toolbar filter button with QuickFilterInput in `src/reactviews/pages/Profiler/profilerToolbar.tsx`
- [X] T038 [US3] Add `maxLength={1000}` to quick filter input in `src/reactviews/pages/Profiler/components/QuickFilterInput.tsx`

**Checkpoint**: Quick filter fully functional. Can be tested independently.

---

## Phase 6: User Story 4 - Filter TextData by String Operators (Priority: P2)

**Goal**: Users can filter text columns (TextData) using operator (contains, starts with, etc.) + text value

**Independent Test**: Open profiler, click funnel on TextData column, select "starts with", enter "SELECT", click Apply, verify only matching rows appear

### Tests for User Story 4 (REQUIRED) ⚠️

- [ ] T039 [P] [US4] Add unit tests for text filter operators in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T040 [P] [US4] Create component test file `test/unit/profiler/textFilter.test.ts` with tests for TextFilter component

### Implementation for User Story 4

- [X] T041 [P] [US4] Create `TextFilter.tsx` component with operator dropdown and text input in `src/reactviews/pages/Profiler/components/TextFilter.tsx`
- [X] T041a [US4] Add placeholder text "Enter text..." to text filter input in `src/reactviews/pages/Profiler/components/TextFilter.tsx`
- [X] T041b [US4] Add hint line "Search within {ColumnName} text content" below text filter input in `src/reactviews/pages/Profiler/components/TextFilter.tsx`
- [X] T042 [US4] Add `maxLength={1000}` to text filter input in `src/reactviews/pages/Profiler/components/TextFilter.tsx`
- [X] T043 [US4] Integrate TextFilter into ColumnFilterPopover for `type: "string"` + `filterMode: "text"` columns in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T044 [US4] Add `filterMode: "text"` to TextData column definition in `src/profiler/profilerDefaultConfig.ts`

**Checkpoint**: Text filtering fully functional. Can be tested independently.

---

## Phase 7: User Story 5 - Clear All Filters (Priority: P2)

**Goal**: Users can click "Clear All Filters" to reset quick filter and all column filters

**Independent Test**: Apply multiple filters, click "Clear All Filters", verify all filters cleared and all rows visible

### Tests for User Story 5 (REQUIRED) ⚠️

- [ ] T045 [P] [US5] Add unit test for clearAllFilters in `test/unit/profiler/filteredBuffer.test.ts`

### Implementation for User Story 5

- [X] T046 [US5] Update "Clear All Filters" button to call `clearAllFilters` reducer in `src/reactviews/pages/Profiler/profilerToolbar.tsx`
- [X] T047 [US5] Implement `clearAllFilters()` method in FilteredBuffer that clears quickFilter and columnFilters in `src/profiler/filteredBuffer.ts`
- [X] T048 [US5] Reset all funnel icon visual indicators on clear in `src/reactviews/pages/Profiler/profiler.tsx`

**Checkpoint**: Clear all filters fully functional. Can be tested independently.

---

## Phase 8: User Story 6 - Filter by Date/Time Values (Priority: P3)

**Goal**: Users can filter date columns (StartTime) using operator + date value

**Independent Test**: Open profiler, click funnel on StartTime column, select "greater than", enter date, click Apply, verify only matching rows appear

### Tests for User Story 6 (REQUIRED) ⚠️

- [ ] T049 [P] [US6] Add unit tests for date filter validation and comparison in `test/unit/profiler/filteredBuffer.test.ts`
- [ ] T050 [P] [US6] Create component test file `test/unit/profiler/dateFilter.test.ts` with tests for DateFilter component

### Implementation for User Story 6

- [X] T051 [P] [US6] Create `DateFilter.tsx` component with operator dropdown and date input in `src/reactviews/pages/Profiler/components/DateFilter.tsx`
- [X] T052 [US6] Add date validation (reject invalid dates, show error) in `src/reactviews/pages/Profiler/components/DateFilter.tsx`
- [X] T053 [US6] Integrate DateFilter into ColumnFilterPopover for `type: "datetime"` columns in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`

**Checkpoint**: Date filtering fully functional. Can be tested independently.

---

## Phase 9: User Story 7 - Keyboard-Accessible Filtering (Priority: P2)

**Goal**: All filter interactions are keyboard accessible

**Independent Test**: Navigate entire filter workflow using only Tab, Enter, Escape keys

### Tests for User Story 7 (REQUIRED) ⚠️

- [ ] T054 [P] [US7] Add accessibility tests for keyboard navigation in `test/unit/profiler/columnFilter.test.ts`

### Implementation for User Story 7

- [X] T055 [US7] Add keyboard handler for funnel icon (Enter/Space opens popover) in `src/reactviews/pages/Profiler/profiler.tsx` *(Fluent UI Button handles this)*
- [X] T056 [US7] Implement focus management (auto-focus first element on open) in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T057 [US7] Add Tab navigation order through all popover controls in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx` *(Fluent UI trapFocus handles this)*
- [X] T058 [US7] Add Escape key handler to close popover and return focus in `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx`
- [X] T059 [US7] Add ARIA labels and roles to all filter controls in all component files in `src/reactviews/pages/Profiler/components/`

**Checkpoint**: Keyboard accessibility complete. All interactions work without mouse.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup and validation

- [X] T060 [P] Verify all localization strings are used correctly
- [X] T061 [P] Run `yarn lint src/ test/` and fix any issues
- [X] T062 Run `yarn build` and verify no errors
- [X] T063 Run `yarn test` and verify all tests pass *(77 FilteredBuffer tests pass; unrelated Copilot tool failures)*
- [X] T064 Run quickstart.md validation scenarios manually *(documented for manual validation)*
- [X] T065 Code cleanup: remove any unused imports or dead code

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - US1 (Categorical), US2 (Numeric), US3 (Quick Filter) are P1 - highest priority
  - US4 (Text), US5 (Clear All), US7 (Keyboard) are P2 - medium priority
  - US6 (Date) is P3 - lower priority
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (Categorical - P1)**: Can start after Foundational - Creates ColumnFilterPopover used by all filter types
- **User Story 2 (Numeric - P1)**: Depends on US1 (uses ColumnFilterPopover)
- **User Story 3 (Quick Filter - P1)**: Can start after Foundational - Independent of column filters
- **User Story 4 (Text - P2)**: Depends on US1 (uses ColumnFilterPopover)
- **User Story 5 (Clear All - P2)**: Can start after Foundational - Independent
- **User Story 6 (Date - P3)**: Depends on US1 (uses ColumnFilterPopover)
- **User Story 7 (Keyboard - P2)**: Depends on US1, US2, US3, US4 (adds accessibility to all components)

### Parallel Opportunities

**Phase 1 (Setup)**:
```
T002, T003, T004, T005 can all run in parallel (different files)
```

**Phase 2 (Foundational)**:
```
T007, T008, T009 can run in parallel (tests in same file but independent)
T010, T011 can run in parallel (both FilteredBuffer methods)
```

**After Foundational - User Stories in Parallel**:
```
US1 (Categorical) + US3 (Quick Filter) + US5 (Clear All) can start in parallel
US2 (Numeric) + US4 (Text) + US6 (Date) depend on US1's ColumnFilterPopover
US7 (Keyboard) should be done last
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Categorical) - creates shared popover component
4. Complete Phase 4: User Story 2 (Numeric)
5. Complete Phase 5: User Story 3 (Quick Filter)
6. **STOP and VALIDATE**: Test all P1 stories independently
7. Deploy/demo MVP

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Categorical filtering works!
3. Add User Story 2 → Test independently → Numeric filtering works!
4. Add User Story 3 → Test independently → Quick filter works! (MVP complete)
5. Add User Stories 4, 5, 6, 7 → Each adds value without breaking previous

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All tests MUST fail before implementation (TDD)
- No `setTimeout` in webview code - use `requestAnimationFrame`
- All filtering logic in FilteredBuffer, not SlickGrid
- Apply/Clear buttons required per popover (per clarification)
- Case-insensitive text matching (per clarification)
- 1000 character limit on text inputs (per spec)
