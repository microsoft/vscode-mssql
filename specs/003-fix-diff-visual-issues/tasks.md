# Tasks: Fix Diff Viewer Visual Issues

**Input**: Design documents from `/specs/003-fix-diff-visual-issues/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **Checkbox**: Every task starts with `- [ ]`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3, US4) - ONLY for user story phases

---

## Phase 1: Setup

**Purpose**: Project already initialized - no setup tasks needed for this feature

- [x] T001 Verify feature branch `003-fix-diff-visual-issues` is checked out

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Extend `calculateDiff()` to extract column-level changes into `TableColumnChanges` map in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts
- [x] T003 Extend `calculateDiff()` to track deleted columns with original position in `DeletedColumnsMap` in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts
- [x] T004 Add `tableColumnChanges` and `deletedColumns` fields to `DiffViewerState` interface in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [x] T005 Populate new state fields in `recalculateDiff()` function in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx

**Checkpoint**: Foundation ready - column change data now available in diff context

---

## Phase 3: User Story 1 - Column-Level Change Indicators (Priority: P1) 🎯 MVP

**Goal**: Show colored indicator dots next to changed columns in table nodes when diff drawer is open

**Independent Test**: Add/modify/delete columns, open drawer, verify indicators appear on canvas with correct colors (green=added, yellow=modified, red=deleted with strikethrough)

### Implementation for User Story 1

- [x] T006 [US1] Create `useColumnDiffIndicator(tableId, columnName)` hook returning `ColumnDiffIndicator` in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [x] T007 [P] [US1] Add `.column-diff-indicator` base class and color variants (`--addition`, `--modification`, `--deletion`) in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [x] T008 [P] [US1] Add `.column--deleted` class with strikethrough text and 0.5 opacity in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [x] T009 [US1] Import `useColumnDiffIndicator` hook in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx
- [x] T010 [US1] Modify `TableColumn` component to render indicator dot based on hook result in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx
- [x] T011 [US1] Create `useDeletedColumns(tableId)` hook to get deleted columns for a table in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [x] T012 [US1] Create merged column list (current + deleted) sorted by original position in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx
- [x] T013 [US1] Render deleted columns inline with `.column--deleted` class and red indicator in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx
- [x] T014 [US1] Add unit tests for `useColumnDiffIndicator` hook in extensions/mssql/test/unit/reactviews/schemaDesigner/diffViewerContext.test.tsx

**Checkpoint**: User Story 1 complete - column-level indicators display for added, modified, and deleted columns

---

## Phase 4: User Story 2 - Reveal Highlight Animation (Priority: P2)

**Goal**: When reveal button clicked, target element receives pulsing highlight animation (~1 second)

**Independent Test**: Click reveal on change item, verify target element pulses 3 times then returns to normal

### Implementation for User Story 2

- [X] T015 [US2] Add `revealHighlight` state with `highlightedElementId` and `highlightedElementType` to `DiffViewerState` in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [X] T016 [US2] Create `triggerRevealHighlight(id, type)` and `clearRevealHighlight()` functions in diff context in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [X] T017 [P] [US2] Add `.reveal-highlight` animation CSS with 3 pulses over 1 second in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [X] T018 [P] [US2] Add `@media (prefers-reduced-motion: reduce)` override for static highlight in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [X] T019 [US2] Update `handleReveal` in changeItem.tsx to call `triggerRevealHighlight` after navigation in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx
- [X] T020 [US2] Apply `.reveal-highlight` class to table nodes when `highlightedElementId` matches in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx
- [X] T021 [US2] Apply highlight style to FK edges via `useStyledEdgesForDiff` when highlighted in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx
- [X] T022 [US2] Add `onAnimationEnd` handler to clear highlight state preventing queue buildup in extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx

**Checkpoint**: User Story 2 complete - reveal button triggers navigation + pulsing highlight animation

---

## Phase 5: User Story 3 - Drawer Resize Handle Visibility (Priority: P2)

**Goal**: Resize handle shows visible grip indicator on hover

**Independent Test**: Hover over drawer left edge, verify grip dots appear and cursor changes to col-resize

### Implementation for User Story 3

- [X] T023 [P] [US3] Add `.diff-viewer-resize-handle::before` pseudo-element with radial gradient grip dots in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [X] T024 [P] [US3] Add hover/dragging opacity transition to show grip indicator in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [X] T025 [P] [US3] Add high-contrast theme support for resize handle grip in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css

**Checkpoint**: User Story 3 complete - resize handle has visible affordance on hover

---

## Phase 6: User Story 4 - Empty State Illustration (Priority: P3)

**Goal**: Empty state shows checkmark icon above "No pending changes" text

**Independent Test**: Open drawer with no changes, verify checkmark icon displays with theme-appropriate color

### Implementation for User Story 4

- [X] T026 [P] [US4] Import `CheckmarkCircleRegular` icon from @fluentui/react-icons in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx
- [X] T027 [P] [US4] Add `.diff-viewer-empty-icon` CSS class with 48px size and 0.6 opacity in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css
- [X] T028 [US4] Render `CheckmarkCircleRegular` icon above empty state message text in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx
- [X] T029 [US4] Verify icon color adapts to light/dark/high-contrast themes in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx

**Checkpoint**: User Story 4 complete - empty state displays theme-aware checkmark icon

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Fix existing issues, validation, and cleanup

- [X] T030 [P] Fix table name font color in drawer (FR-009) - use `--vscode-foreground` in extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx
- [X] T031 [P] Verify no layout shifts when column indicators render on tables with many columns
- [X] T032 Run `yarn build && yarn test && yarn lint src/ test/` validation
- [ ] T033 Manual testing per quickstart.md checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - **BLOCKS all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 completion
- **Phases 4, 5, 6 (US2, US3, US4)**: Can run in parallel after Phase 2 completes
- **Phase 7 (Polish)**: After all user stories complete

### User Story Dependencies

| Story | Depends On | Can Parallel With |
|-------|------------|-------------------|
| US1 (P1) | Phase 2 only | None (MVP) |
| US2 (P2) | Phase 2 only | US3, US4 |
| US3 (P2) | Phase 2 only | US2, US4 |
| US4 (P3) | Phase 2 only | US2, US3 |

### Parallel Opportunities per User Story

**User Story 1**:
- T007, T008 (CSS classes) can run in parallel

**User Story 2**:
- T017, T018 (CSS animation + reduced-motion) can run in parallel

**User Story 3**:
- T023, T024, T025 (all CSS-only) can run in parallel

**User Story 4**:
- T026, T027 (icon import + CSS) can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup ✓
2. Complete Phase 2: Foundational (T002-T005)
3. Complete Phase 3: User Story 1 (T006-T014)
4. **STOP and VALIDATE**: Test column indicators independently
5. Deploy/demo if ready - users can now see column-level changes

### Incremental Delivery

| Increment | Stories | Value Delivered |
|-----------|---------|-----------------|
| MVP | US1 | Column-level change indicators on canvas |
| +1 | US2 | Reveal animation for navigation feedback |
| +2 | US3 | Discoverable drawer resize |
| +3 | US4 | Polished empty state |

---

## Summary

| Phase | Tasks | Story | Estimated |
|-------|-------|-------|-----------|
| 1 - Setup | T001 | - | 5 min |
| 2 - Foundational | T002-T005 | - | 2 hours |
| 3 - US1 Column Indicators | T006-T014 | P1 🎯 | 4 hours |
| 4 - US2 Reveal Animation | T015-T022 | P2 | 3 hours |
| 5 - US3 Resize Handle | T023-T025 | P2 | 1 hour |
| 6 - US4 Empty State | T026-T029 | P3 | 1 hour |
| 7 - Polish | T030-T033 | - | 1 hour |

**Total Tasks**: 33  
**Tasks per User Story**: US1=9, US2=8, US3=3, US4=4  
**Parallel Opportunities**: 8 task groups  
**MVP Scope**: Phase 1-3 (T001-T014) = ~6 hours  
**Total Estimated Effort**: ~12 hours
