# Tasks: Fix Diff View Bugs

**Input**: Design documents from `/specs/004-fix-diff-view-bugs/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Not explicitly requested in specification. Tests omitted per task generation rules.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in descriptions

## Path Conventions

Base path: `extensions/mssql/src/reactviews/pages/SchemaDesigner/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Interface extensions needed by multiple user stories

- [X] T001 Add `ForeignKeyModificationDetails` interface to `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`
- [X] T002 [P] Add `GhostNodeData` interface to `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`
- [X] T003 [P] Add `RenameDisplayInfo` interface to `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`
- [X] T004 Extend `DiffViewerState` with `ghostNodes`, `ghostEdges`, `tableRenameInfo`, `fkModificationType` in `extensions/mssql/src/sharedInterfaces/schemaDesigner.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure changes that MUST complete before user story work

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Initialize `ghostNodes` and `ghostEdges` state arrays in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T006 Initialize `tableRenameInfo` and `fkModificationType` state objects in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T007 Add ghost node/edge base CSS classes (`.schema-node--ghost`, `.schema-edge--ghost`) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [X] T008 Add `buildGhostNodesFromDeletedTables()` helper function in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T009 Add `buildGhostEdgesFromDeletedForeignKeys()` helper function in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`

**Checkpoint**: Foundation ready - user story implementation can begin

---

## Phase 3: User Story 1 - Deleted Elements Canvas Visualization (Priority: P1) 🎯 MVP

**Goal**: Show deleted tables and foreign keys on canvas with red styling when diff drawer is open

**Independent Test**: Delete a table and FK, open drawer → both appear on canvas with red borders. Close drawer → they disappear. Reopen → they reappear.

### Implementation for User Story 1

- [X] T010 [US1] Extend `calculateDiff()` to populate `ghostNodes` array with deleted tables including original positions in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T011 [US1] Extend `calculateDiff()` to populate `ghostEdges` array with deleted foreign keys in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T012 [US1] Update `recalculateDiff()` to store ghostNodes and ghostEdges in context state in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T013 [US1] Expose `ghostNodes` and `ghostEdges` from `useDiffViewer()` hook in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T014 [US1] Inject ghost nodes into ReactFlow when `showCanvasIndicators` is true in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T015 [US1] Remove ghost nodes from ReactFlow when `showCanvasIndicators` is false in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T016 [US1] Add `isGhostNode` prop handling in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [X] T017 [US1] Apply red border styling when `isGhostNode=true` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [X] T018 [US1] Inject ghost edges into ReactFlow when `showCanvasIndicators` is true in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T019 [US1] Style ghost edges with red color using `useStyledEdgesForDiff` hook in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T020 [US1] Add CSS styles for ghost node red border (`.schema-node--ghost`) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [X] T021 [US1] Add CSS styles for ghost edge red stroke (`.schema-edge--ghost`) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`

**Checkpoint**: Deleted tables and FKs visible on canvas with red styling when drawer open

---

## Phase 4: User Story 2 - Undo Action Synchronization (Priority: P1) 🎯 MVP

**Goal**: Undo from drawer updates all indicators immediately (drawer list, toolbar count, canvas)

**Independent Test**: Delete a table, open drawer, click undo → drawer item disappears, count decreases, canvas removes red border from restored table.

### Implementation for User Story 2

- [X] T022 [US2] Add immediate `recalculateDiff()` call after undo in `handleUndoChange()` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx`
- [X] T023 [US2] Remove delay or reduce to 0ms for undo-triggered recalculation in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx`
- [X] T024 [US2] Ensure ghost nodes are removed from canvas after undo restores table in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T025 [US2] Ensure ghost edges are removed from canvas after undo restores FK in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T026 [US2] Update `ChangeCountTracker` immediately on undo action in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeCountTracker.ts`
- [X] T027 [US2] Verify toolbar subscribes to change count updates for immediate refresh in `extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerToolbar.tsx`

**Checkpoint**: Undo action syncs drawer, toolbar, and canvas within 200ms

---

## Phase 5: User Story 3 - Foreign Key Reveal and Focus (Priority: P2)

**Goal**: Reveal button on FK items pans canvas to edge and applies glowing highlight

**Independent Test**: Add/modify FK, open drawer, click reveal → canvas pans to edge, edge receives glowing animation.

### Implementation for User Story 3

- [X] T028 [US3] Add FK reveal handler in `handleNavigateToEntity()` for foreignKey type in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx`
- [X] T029 [US3] Implement edge centering calculation using source/target node positions in `extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx`
- [X] T030 [US3] Set `highlightedElementId` and `highlightedElementType='foreignKey'` on reveal in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T031 [US3] Apply highlighted class to edge when `highlightedElementId` matches in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T032 [US3] Add glow animation CSS (`.schema-edge--revealed`) with keyframes in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [X] T033 [US3] Add auto-clear of highlight after animation (2s timeout) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`

**Checkpoint**: FK reveal pans to edge and highlights with glowing animation

---

## Phase 6: User Story 4 - Table Rename Visualization (Priority: P2)

**Goal**: Renamed tables show old name with strikethrough and new name next to it

**Independent Test**: Rename a table, open drawer → table node shows old name strikethrough + new name.

### Implementation for User Story 4

- [X] T034 [US4] Detect table renames in `compareTables()` and populate `tableRenameInfo` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T035 [US4] Store `tableRenameInfo` object in context state in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T036 [US4] Expose `tableRenameInfo` from `useDiffViewer()` hook in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T037 [US4] Pass rename info to `SchemaDesignerTableNode` via data prop in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx`
- [X] T038 [US4] Render strikethrough old name + new name in table header when `renameInfo` present in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`
- [X] T039 [US4] Add CSS for strikethrough styling (`.table-name--old`) in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`
- [X] T040 [US4] Handle schema-only rename vs name-only rename vs both in `extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx`

**Checkpoint**: Table renames display old name strikethrough + new name clearly

---

## Phase 7: User Story 5 - Foreign Key Modification Indicators (Priority: P2)

**Goal**: Property FK changes show yellow; structural changes show old red + new green edges

**Independent Test**: 
1. Change FK name → edge turns yellow
2. Change FK source column → old edge red, new edge green

### Implementation for User Story 5

- [X] T041 [US5] Add `isStructuralFKChange()` helper to detect column/reference changes in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T042 [US5] Populate `fkModificationDetails.isStructural` flag in `compareForeignKeys()` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T043 [US5] Store original FK reference for structural changes in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T044 [US5] Create ghost edge for old FK position on structural changes in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T045 [US5] Store `fkModificationType` map in context state in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T046 [US5] Apply yellow stroke for property-only FK modifications in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T047 [US5] Apply red stroke to old edge for structural FK modifications in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T048 [US5] Apply green stroke to new edge for structural FK modifications in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx`
- [X] T049 [US5] Add CSS variables for yellow/amber modification color in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css`

**Checkpoint**: FK property changes yellow, structural changes show red old + green new

---

## Phase 8: User Story 6 - Granular Foreign Key Entries in Drawer (Priority: P2)

**Goal**: New tables with FKs have separate drawer entries (1 table + N FKs)

**Independent Test**: Create table with 2 FKs → drawer shows 3 entries. Undo one FK → only that FK removed.

### Implementation for User Story 6

- [X] T050 [US6] Verify FK changes create separate `SchemaChange` entries in `calculateDiff()` in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T051 [US6] Ensure FKs from new tables are not grouped with table entry in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts`
- [X] T052 [US6] Add individual undo support for FK entries within new table context in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx`
- [X] T053 [US6] Add individual reveal support for FK entries within new table context in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx`
- [X] T054 [US6] Verify drawer renders separate items for table and each FK in `extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changesList.tsx`

**Checkpoint**: N FKs on new table = N+1 drawer entries, individually actionable

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [X] T055 [P] Run `yarn build` to verify no compile errors in `extensions/mssql/`
- [X] T056 [P] Run `yarn lint src/ test/` to verify no lint errors in `extensions/mssql/`
- [ ] T057 Verify all three themes (light/dark/high contrast) render correctly (manual testing required)
- [ ] T058 Test keyboard accessibility for reveal and undo actions (manual testing required)
- [ ] T059 Run manual validation per `quickstart.md` testing checklist (manual testing required)
- [X] T060 Update CHANGELOG.md with bug fix entries

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phases 3-8 (User Stories)**: All depend on Phase 2 completion
  - US1 + US2 (P1): Implement first, can run in parallel
  - US3-US6 (P2): Can start after Phase 2, independent of each other
- **Phase 9 (Polish)**: Depends on all user stories complete

### User Story Dependencies

| User Story | Depends On | Can Parallel With |
|------------|------------|-------------------|
| US1 (Deleted Elements) | Phase 2 | US2 |
| US2 (Undo Sync) | Phase 2 | US1 |
| US3 (FK Reveal) | Phase 2 | US1, US2, US4, US5, US6 |
| US4 (Table Rename) | Phase 2 | US1, US2, US3, US5, US6 |
| US5 (FK Indicators) | Phase 2 | US1, US2, US3, US4, US6 |
| US6 (Granular FKs) | Phase 2 | US1, US2, US3, US4, US5 |

### Within Each User Story

- Context state changes before component rendering
- Hook updates before component consumption
- CSS changes can parallel with TypeScript changes

### Parallel Opportunities

**Phase 1 (Setup):**
```
T001 ─┬─► T002 (parallel)
      └─► T003 (parallel)
T004 (depends on T001-T003)
```

**Phase 2 (Foundational):**
```
T005 ─┬─► T007 (parallel, different files)
T006 ─┤
      └─► T008, T009 (parallel)
```

**User Stories (after Phase 2):**
```
                    ┌─► US3 (FK Reveal)
         ┌─► US1 ──┼─► US4 (Table Rename)  
Phase 2 ─┤         └─► US5 (FK Indicators)
         └─► US2 ──────► US6 (Granular FKs)
```

---

## Implementation Strategy

### MVP First (P1 Stories Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T009)
3. Complete Phase 3: US1 - Deleted Elements (T010-T021)
4. Complete Phase 4: US2 - Undo Sync (T022-T027)
5. **STOP and VALIDATE**: Test US1 + US2 independently
6. Demo/deploy if ready

### Incremental Delivery

| Increment | Stories | Value Delivered |
|-----------|---------|-----------------|
| MVP | US1 + US2 | Core diff visualization + undo works |
| v2 | + US3 | FK reveal functionality |
| v3 | + US4 | Table rename display |
| v4 | + US5 | FK modification colors |
| v5 | + US6 | Granular FK entries |

### Task Counts by Story

| Phase/Story | Task Count | Parallelizable |
|-------------|------------|----------------|
| Phase 1: Setup | 4 | 2 |
| Phase 2: Foundational | 5 | 3 |
| US1: Deleted Elements | 12 | 2 |
| US2: Undo Sync | 6 | 0 |
| US3: FK Reveal | 6 | 0 |
| US4: Table Rename | 7 | 1 |
| US5: FK Indicators | 9 | 0 |
| US6: Granular FKs | 5 | 0 |
| Phase 9: Polish | 6 | 2 |
| **TOTAL** | **60** | **10** |

---

## Notes

- All tasks use VS Code CSS variables for theming compliance
- Ghost nodes use same positions from original schema to avoid layout shift
- Structural FK changes require tracking original FK state for old edge rendering
- 200ms max delay for undo responsiveness per SC-002
- Verify all 6 user stories pass `quickstart.md` checklist before marking complete
