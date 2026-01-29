# Tasks: Searchable Database Combobox

**Input**: Design documents from `/specs/001-database-combobox/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in spec (no test tasks included).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create database combobox component shell in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T002 Extend connection dialog state + request types in `extensions/mssql/src/sharedInterfaces/connectionDialog.ts`
- [x] T003 Implement list-databases request handler with temp connection and `<default>` injection in `extensions/mssql/src/connectionconfig/connectionDialogWebviewController.ts`
- [x] T004 [P] Add webview RPC method to request database lists in `extensions/mssql/src/reactviews/pages/ConnectionDialog/connectionDialogStateProvider.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Select from loaded databases (Priority: P1) 🎯 MVP

**Goal**: Load database options on focus when required fields are populated, allow selection, and reuse cached options when available.

**Independent Test**: Populate required fields, focus database field, select a database, then focus again with the same credentials and verify cached options are used without reload; trigger multiple opens quickly and confirm only one list request runs.

### Implementation for User Story 1

- [x] T005 [US1] Trigger database list load on combobox focus with required-field gating in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`
- [x] T006 [US1] Render database combobox instead of default field in `extensions/mssql/src/reactviews/pages/ConnectionDialog/connectionFormPage.tsx`
- [x] T007 [US1] Bind combobox options to `context.state.databaseOptions` and ensure `<default>` is present in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`
- [x] T008 [US1] Update `connectionProfile.database` on option selection via `context.formAction` in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`
- [x] T013 [US1] Validate cached database options reuse for repeated credentials in `extensions/mssql/src/connectionconfig/connectionDialogWebviewController.ts`
- [x] T014 [US1] Deduplicate concurrent list requests per credential key in `extensions/mssql/src/connectionconfig/connectionDialogWebviewController.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently

---

## Phase 4: User Story 2 - Manually enter a database (Priority: P2)

**Goal**: Allow manual entry even when list is missing or fails, and keep database value on auth/server changes.

**Independent Test**: Force list failure or missing entry; type database name and connect successfully.

### Implementation for User Story 2

- [x] T009 [US2] Enable freeform manual entry without list validation in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`
- [x] T010 [US2] Mark database options stale on server/auth/user/account changes while preserving database value in `extensions/mssql/src/connectionconfig/connectionDialogWebviewController.ts`

**Checkpoint**: User Stories 1 and 2 work independently

---

## Phase 5: User Story 3 - Search within the database list (Priority: P3)

**Goal**: Allow users to search within loaded database options to quickly find a database.

**Independent Test**: Load list with multiple entries, type to filter, and select a matching database.

### Implementation for User Story 3

- [x] T011 [US3] Enable type-to-filter search behavior using combobox input in `extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx`

**Checkpoint**: All user stories functional and independently testable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation and documentation alignment

- [x] T012 [P] Run quickstart validation steps and update notes in `specs/001-database-combobox/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion
- **User Stories (Phases 3-5)**: Depend on Foundational completion
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational
- **User Story 2 (P2)**: Can start after Foundational; builds on US1 UI
- **User Story 3 (P3)**: Can start after Foundational; builds on US1 UI

### Parallel Opportunities

- T004 can run in parallel with T002/T003 (different file)
- T012 can run after story completion independent of other polish tasks

---

## Parallel Example: User Story 1

```text
Task: "Trigger database list load on combobox focus with required-field gating in extensions/mssql/src/reactviews/pages/ConnectionDialog/components/databaseCombobox.component.tsx"
Task: "Render database combobox instead of default field in extensions/mssql/src/reactviews/pages/ConnectionDialog/connectionFormPage.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate User Story 1 independently

### Incremental Delivery

1. Add User Story 1 → Validate
2. Add User Story 2 → Validate
3. Add User Story 3 → Validate
4. Run Polish phase

---

## Notes

- [P] tasks = different files, no dependencies
- Keep database value when auth/server changes; only invalidate option list
- `<default>` must always appear in the list even on error or empty results
