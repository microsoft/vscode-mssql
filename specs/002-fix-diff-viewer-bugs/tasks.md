# Tasks: Fix Diff Viewer Bugs

**Input**: Design documents from `/specs/002-fix-diff-viewer-bugs/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Not explicitly requested in the feature specification. Tests are included for critical safety requirements (FR-003) only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Extension source**: `extensions/mssql/src/reactviews/pages/SchemaDesigner/`
- **Tests**: `extensions/mssql/test/unit/reactviews/schemaDesigner/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create centralized color constants module that all components will use

- [x] T001 Create colorConstants.ts from contract in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/colorConstants.ts`
- [x] T002 [P] Add barrel export for colorConstants in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Context safety and optional hook infrastructure that MUST be complete before user story work

**⚠️ CRITICAL**: Context safety is needed for all components to work reliably

- [x] T003 Add `useDiffViewerOptional()` hook in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [ ] T004 [P] ⏸️ DEFERRED - Add unit test for `useDiffViewerOptional` returning null outside provider (test infrastructure requires @testing-library/react which is not installed)
- [x] T005 Extend DiffViewerState interface with `deletedTableIds` and `deletedForeignKeyIds` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Consistent Color Theming (Priority: P1) 🎯 MVP

**Goal**: Standardize all diff viewer color references to use consistent CSS variables with identical fallback values

**Independent Test**: Open diff viewer drawer, make changes (add table, modify column, delete foreign key), verify all indicators use same colors: green=#73c991, amber=#e2c08d, red=#c74e39

### Implementation for User Story 1

- [x] T006 [P] [US1] Update diffViewerDrawer.tsx additionDot/modificationDot/deletionDot colors to use DIFF_COLORS in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx`
- [x] T007 [P] [US1] Update changeItem.tsx border colors (addition/modification/deletion) to use DIFF_COLORS in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T008 [P] [US1] Update changeItem.tsx icon colors (iconAddition/iconModification/iconDeletion) to use DIFF_COLORS in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T009 [P] [US1] Update changeItem.tsx oldValue/newValue colors to use DIFF_COLORS in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T010 [P] [US1] Update diffViewer.css deletion fallback from #f14c4c to #c74e39 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [x] T011 [US1] Add high-contrast theme support for diff colors in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`

**Checkpoint**: All color references now use standardized values (SC-001 verified)

---

## Phase 4: User Story 2 - Live Change Count Updates (Priority: P1)

**Goal**: Enable real-time change count updates in toolbar button within 500ms of schema modification, without opening drawer

**Independent Test**: Without opening drawer, add a table, modify a column, delete a foreign key. Verify toolbar button count updates after each action within 500ms.

### Implementation for User Story 2

- [x] T012 [US2] Update showChangesButton.tsx to use `useDiffViewerOptional` and show "No changes" splash when context unavailable in `extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/showChangesButton.tsx`
- [x] T013 [US2] Add schema change detection useEffect in diffViewerIntegration via SchemaChangeListener to trigger ChangeCountTracker updates
- [x] T014 [US2] Add `recalculateDiff` call on undo/redo operations via SchemaChangeListener in diffViewerIntegration.tsx
- [x] T015 [US2] Drawer recalculates diff automatically when schema changes via SchemaChangeListener
- [x] T016 [US2] Undo button triggers recalculation automatically via SchemaChangeListener event handling

**Checkpoint**: Toolbar button count updates in real-time (SC-002 verified), context safety works (SC-003 verified)

---

## Phase 5: User Story 3 - Drawer Styling Polish (Priority: P3)

**Goal**: Consistent drawer styling matching VS Code sidebar patterns with proper hover states, focus indicators, and spacing

**Independent Test**: Navigate through diff viewer using keyboard and mouse, verify all interactive elements have visible hover/focus states

### Implementation for User Story 3

- [x] T017 [P] [US3] Update drawer header typography to match VS Code sideBarTitle patterns in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx`
- [x] T018 [P] [US3] Fix table name font color in drawer per FR-009 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T019 [P] [US3] Add hover background color using --vscode-list-hoverBackground in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [x] T020 [P] [US3] Add focus outline using --vscode-focusBorder per FR-005 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [x] T021 [US3] Add chevron rotation animation for group expand/collapse in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeGroup.tsx`
- [x] T022 [US3] Ensure text truncation with ellipsis and tooltip on hover for long names in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T023 [US3] Update drawer padding/margins to match VS Code sidebar per FR-008 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx`

**Checkpoint**: All interactive elements have visible focus states (SC-004 verified), WCAG AA contrast (SC-005 verified)

---

## Phase 6: Canvas Indicators (Priority: P2)

**Goal**: Show color indicators for deleted tables, deleted foreign keys, and changed columns on canvas

**Independent Test**: Delete a table and foreign key, open drawer, verify canvas shows red borders on deleted elements

### Implementation for Canvas Indicators

- [ ] T024 [US4] Add columnChangeTypes to table node data type in `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`
- [ ] T025 [US4] Add changeType to edge data type for foreign keys in `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`
- [x] T026 [US4] Update diffCalculator to populate deletedTableIds and deletedForeignKeyIds in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [ ] T027 [US4] Add column-level change type indicators in schemaDesignerTableNode per FR-010 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [x] T028 [US4] Show deleted tables with red border on canvas when drawer open per FR-011 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [x] T029 [US4] Show deleted foreign key edges with red color when drawer open per FR-012 in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerForeignKeyEdge.tsx`

**Checkpoint**: Canvas displays all change types with consistent visual indicators

---

## Phase 7: Reveal Button Navigation (Priority: P2)

**Goal**: Add reveal button on diff list items to navigate to corresponding canvas element per FR-014

**Independent Test**: Click reveal button on a table change item, verify canvas scrolls and centers on that table with highlight effect

### Implementation for Reveal Button

- [x] T030 [P] [US5] Add reveal icon button to change item component in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx`
- [x] T031 [US5] Add `navigateToElement` method to DiffViewerContext for canvas navigation in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [x] T032 [US5] Implement canvas scroll-to-node with fitView for tables in `extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx`
- [x] T033 [US5] Implement canvas scroll-to-edge for foreign keys in `extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx`
- [x] T034 [US5] Add highlight animation on revealed element (brief border glow) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`

**Checkpoint**: Clicking reveal button centers and highlights corresponding canvas element

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [x] T035 [P] Run `yarn build` to verify TypeScript compilation passes
- [x] T036 [P] Run `yarn lint src/ test/` to verify linting passes
- [x] T037 Run `yarn test` to verify all existing tests still pass
- [x] T038 Manual accessibility audit: verify all colors meet WCAG AA contrast (using VS Code gitDecoration standard colors)
- [x] T039 Run quickstart.md validation checklist (build/test/lint verified)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (US1 → US2 → US4 → US5 → US3)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational - Uses T003 (optional context hook)
- **User Story 3 (P3)**: Can start after Foundational - Independent of other stories
- **Canvas Indicators (P2)**: Can start after Foundational - Uses T005 (extended state)
- **Reveal Button (P2)**: Can start after Foundational - Uses DiffViewerContext

### Within Each User Story

- Models/types before implementation
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001, T002 can run in parallel (Setup phase)
- T003, T004 can run in parallel (Foundational phase)
- Once Foundational is done, T006-T011 (US1 colors) can all run in parallel
- T017-T020 (US3 CSS changes) can all run in parallel
- T024, T025 (type definitions) can run in parallel
- T030 can run in parallel with other Phase 7 setup tasks

---

## Parallel Example: User Story 1

```bash
# Launch all color standardization tasks together:
Task T006: "Update diffViewerDrawer.tsx colors"
Task T007: "Update changeItem.tsx border colors"
Task T008: "Update changeItem.tsx icon colors"
Task T009: "Update changeItem.tsx oldValue/newValue colors"
Task T010: "Update diffViewer.css deletion fallback"

# Then after all parallel tasks complete:
Task T011: "Add high-contrast theme support"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T005)
3. Complete Phase 3: User Story 1 (T006-T011)
4. **STOP and VALIDATE**: Verify all colors are consistent
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test colors → SC-001 verified (MVP!)
3. Add User Story 2 → Test live updates → SC-002, SC-003 verified
4. Add Canvas Indicators → Test canvas display
5. Add Reveal Button → Test navigation to canvas elements (FR-014 verified)
6. Add User Story 3 → Test accessibility → SC-004, SC-005 verified
7. Each story adds value without breaking previous stories

---

## Summary

| Metric | Value |
|--------|-------|
| **Total Tasks** | 39 |
| **Setup Tasks** | 2 |
| **Foundational Tasks** | 3 |
| **US1 (Colors) Tasks** | 6 |
| **US2 (Live Updates) Tasks** | 5 |
| **US3 (Styling) Tasks** | 7 |
| **US4 (Canvas) Tasks** | 6 |
| **US5 (Reveal Button) Tasks** | 5 |
| **Polish Tasks** | 5 |
| **Parallel Opportunities** | 19 tasks marked [P] |
| **MVP Scope** | T001-T011 (Setup + Foundation + US1) |
