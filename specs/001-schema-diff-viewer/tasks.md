# Tasks: Schema Diff Viewer

**Input**: Design documents from `/specs/001-schema-diff-viewer/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- All paths relative to `extensions/mssql/`

## Path Conventions

Based on plan.md project structure:
- **Interfaces**: `src/sharedInterfaces/schemaDesigner.ts`
- **Services**: `src/reactviews/pages/SchemaDesigner/diffViewer/`
- **Components**: `src/reactviews/pages/SchemaDesigner/diffViewer/`
- **Styles**: `src/reactviews/pages/SchemaDesigner/diffViewer/`
- **Localization**: `l10n/bundle.l10n.json`
- **Tests**: `test/unit/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project structure and shared types for all user stories

- [X] T001 Create diffViewer directory structure at `src/reactviews/pages/SchemaDesigner/diffViewer/`
- [X] T002 [P] Add diff viewer interfaces to `src/sharedInterfaces/schemaDesigner.ts` (SchemaChangeType, SchemaEntityType, SchemaChange, ChangeGroup, ChangeCountSummary, DiffViewerState)
- [X] T003 [P] Add diff viewer localized strings to `l10n/bundle.l10n.json` (drawer title, empty state, button labels, change descriptions)
- [X] T004 [P] Create `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css` with VS Code CSS variable-based styles for change types (addition/modification/deletion colors)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services that ALL user stories depend on - MUST complete before user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Implement `ChangeCountTracker` class in `src/reactviews/pages/SchemaDesigner/diffViewer/changeCountTracker.ts` with increment/decrement/reset/subscribe methods per IChangeCountTracker interface
- [X] T006 Implement `DiffCalculator` service in `src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts` with calculateDiff method comparing original vs current schema
- [X] T007 Create `DiffViewerContext` and provider in `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx` with state management for drawer, selection, and change groups
- [X] T008 [P] Add unit tests for ChangeCountTracker in `test/unit/reactviews/schemaDesigner/changeCountTracker.test.ts`
- [X] T009 [P] Add unit tests for DiffCalculator in `test/unit/reactviews/schemaDesigner/diffCalculator.test.ts`

**Checkpoint**: Foundation ready - diff calculation and tracking services operational

---

## Phase 3: User Story 1 - View Real-Time Schema Changes (Priority: P1) 🎯 MVP

**Goal**: Users can see all pending schema changes grouped by table when opening the drawer

**Independent Test**: Open Schema Designer, modify tables, open drawer → verify all changes display with correct groupings and types

### Implementation for User Story 1

- [X] T010 [US1] Create `ChangeItem` component in `src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx` displaying change type icon, entity name, and description
- [X] T011 [US1] Create `ChangeGroup` component in `src/reactviews/pages/SchemaDesigner/diffViewer/changeGroup.tsx` with collapsible table header and nested ChangeItem list
- [X] T012 [US1] Create `ChangesList` component in `src/reactviews/pages/SchemaDesigner/diffViewer/changesList.tsx` rendering all ChangeGroup components with empty state handling
- [X] T013 [US1] Create `DiffViewerDrawer` component in `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx` using Fluent UI InlineDrawer with header showing change counts summary
- [X] T014 [US1] Integrate DiffViewerContext provider into `src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx`
- [X] T015 [US1] Wire DiffViewerDrawer into main layout in `src/reactviews/pages/SchemaDesigner/schemaDesignerPage.tsx`
- [X] T016 [US1] Hook ChangeCountTracker into existing schema modification events (table/column/FK add/edit/delete) in schemaDesignerStateProvider.tsx
- [X] T017 [US1] Trigger diff calculation when drawer opens via DiffViewerContext

**Checkpoint**: User Story 1 complete - drawer shows all changes grouped by table with change type indicators

---

## Phase 4: User Story 2 - Access Changes List in Right Drawer (Priority: P1)

**Goal**: Users can navigate from change items to canvas elements and undo specific changes

**Independent Test**: Click change item → canvas navigates to element; click undo → change reverts to original state

### Implementation for User Story 2

- [X] T018 [US2] Implement click-to-navigate in ChangeItem that calls existing canvas focus/zoom utilities in `src/reactviews/pages/SchemaDesigner/schemaDesignerUtils.ts`
- [X] T019 [US2] Add per-item undo button to ChangeItem component with confirmation for destructive actions
- [X] T020 [US2] Implement `undoChange` function in DiffViewerContext that restores original value (additions→delete, deletions→restore, modifications→revert)
- [X] T021 [US2] Update ChangesList to highlight selected change when navigating
- [X] T022 [US2] Add keyboard navigation support (arrow keys, Enter to navigate, Delete to undo) to ChangesList

**Checkpoint**: User Story 2 complete - navigation and per-item undo functional ✅

---

## Phase 5: User Story 3 - Visual Diff Display (Priority: P2)

**Goal**: Changes have clear visual styling with color-coded indicators and theme compatibility

**Independent Test**: Create add/modify/delete changes → verify green/yellow/red styling; switch themes → verify colors adapt

### Implementation for User Story 3

- [X] T023 [P] [US3] Add colored left border styling to ChangeItem for each change type in `diffViewer.css` using VS Code gitDecoration CSS variables
- [X] T024 [P] [US3] Add change type icons (plus/pencil/trash) to ChangeItem component using Fluent UI icons
- [X] T025 [US3] Implement modification detail view showing old→new value comparison in ChangeItem expanded state
- [X] T026 [US3] Add high-contrast theme support with explicit color fallbacks in `diffViewer.css`
- [ ] T027 [US3] Test and verify WCAG AA compliance for color contrast in all VS Code themes (Light, Dark, High Contrast)

**Checkpoint**: User Story 3 complete - visual diff styling with theme compatibility

---

## Phase 6: User Story 4 - Toggle and Resize Diff Panel (Priority: P3)

**Goal**: Users can show/hide drawer via toolbar button with change count, and resize drawer with persistence

**Independent Test**: Click toolbar button → drawer toggles; drag resize handle → width changes; reopen → width persisted

### Implementation for User Story 4

- [X] T028 [US4] Create `ShowChangesButton` component in `src/reactviews/pages/SchemaDesigner/toolbar/showChangesButton.tsx` displaying "Show Changes (N)" with live count from ChangeCountTracker
- [X] T029 [US4] Integrate ShowChangesButton into existing toolbar in `src/reactviews/pages/SchemaDesigner/toolbar/schemaDesignerToolbar.tsx`
- [X] T030 [US4] Add resize handle to DiffViewerDrawer with min/max width constraints (200px min, 50% max)
- [X] T031 [US4] Implement drawer width persistence to VS Code workspace state via webview messaging
- [X] T032 [US4] Add visual diff indicators (colored borders) to table nodes in canvas when drawer is open in `src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [X] T033 [US4] Connect drawer open state to canvas indicator visibility toggle

**Checkpoint**: User Story 4 complete - toolbar button, resize, persistence, and canvas indicators functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T034 [P] Add aria-labels and screen reader announcements for accessibility in all diff viewer components
- [ ] T035 [P] Add virtualization to ChangesList for performance with 500+ changes using react-window or similar (optional, not needed for typical use cases)
- [X] T036 [P] Update `src/reactviews/common/locConstants.ts` with localization keys for all diff viewer strings
- [ ] T037 Run quickstart.md manual test scenarios and verify all acceptance criteria
- [ ] T038 Performance validation: verify diff calculation <500ms with 100-table schema
- [X] T039 Code cleanup: ensure all new code passes ESLint and follows existing patterns

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup ─────────────────┐
                                ├──► Phase 2: Foundational ─────┐
                                                                │
                                ┌───────────────────────────────┘
                                │
                                ▼
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
     Phase 3: US1 🎯   Phase 4: US2      Phase 5: US3
     (View Changes)    (Navigate/Undo)   (Visual Styling)
              │                 │                 │
              └────────┬────────┴────────┬────────┘
                       │                 │
                       ▼                 │
              Phase 6: US4 ◄─────────────┘
              (Toggle/Resize)
                       │
                       ▼
              Phase 7: Polish
```

### User Story Dependencies

| Story | Can Start After | Dependencies |
|-------|-----------------|--------------|
| **US1** (P1) | Phase 2 complete | None - MVP foundation |
| **US2** (P1) | Phase 2 complete | Independent, but benefits from US1 drawer existing |
| **US3** (P2) | Phase 2 complete | Independent - enhances US1/US2 visuals |
| **US4** (P3) | US1 complete | Needs drawer to exist for toggle/resize |

### Within Each User Story

1. Components before integration
2. Core functionality before enhancements
3. Implementation before tests

### Parallel Opportunities

**Phase 1** (all [P] tasks):
```
T002, T003, T004 can run in parallel
```

**Phase 2** (after T005-T007):
```
T008, T009 can run in parallel (tests for different services)
```

**Phase 5** (visual styling):
```
T023, T024 can run in parallel (CSS and icons)
```

**Phase 7** (polish):
```
T034, T035, T036 can run in parallel (accessibility, performance, localization)
```

---

## Parallel Example: Phase 1 Setup

```bash
# Launch all setup tasks together:
Task T002: "Add diff viewer interfaces to sharedInterfaces/schemaDesigner.ts"
Task T003: "Add diff viewer localized strings to l10n/bundle.l10n.json"
Task T004: "Create diffViewer.css with VS Code CSS variables"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. ✅ Complete Phase 1: Setup (T001-T004)
2. ✅ Complete Phase 2: Foundational (T005-T009)
3. 🔄 Complete Phase 3: User Story 1 (T010-T017)
4. **STOP and VALIDATE**: Test drawer opens with change list
5. Ship MVP if timeline requires

### Recommended Order

1. **Phase 1 + 2**: Setup + Foundation (~2 days)
2. **Phase 3**: US1 - View Changes (~2 days) → **MVP deliverable**
3. **Phase 4**: US2 - Navigation/Undo (~1 day)
4. **Phase 5**: US3 - Visual Styling (~1 day)
5. **Phase 6**: US4 - Toggle/Resize (~1 day)
6. **Phase 7**: Polish (~1 day)

**Total estimate**: ~8 days for full feature

### Parallel Team Strategy

With 2 developers after Phase 2:
- **Dev A**: US1 → US4 (core drawer functionality)
- **Dev B**: US2 → US3 (navigation, undo, styling)

---

## Summary

| Metric | Value |
|--------|-------|
| **Total Tasks** | 39 |
| **Phase 1 (Setup)** | 4 tasks |
| **Phase 2 (Foundation)** | 5 tasks |
| **US1 Tasks** | 8 tasks |
| **US2 Tasks** | 5 tasks |
| **US3 Tasks** | 5 tasks |
| **US4 Tasks** | 6 tasks |
| **Polish Tasks** | 6 tasks |
| **Parallel Opportunities** | 12 tasks marked [P] |
| **MVP Scope** | Phases 1-3 (17 tasks) |

---

## Notes

- All [P] tasks can run in parallel with other [P] tasks in same phase
- [US#] label maps task to user story for traceability
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Tests (T008, T009) are included for foundational services only due to constitution requirement
