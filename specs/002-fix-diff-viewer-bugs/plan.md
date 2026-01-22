# Implementation Plan: Fix Diff Viewer Bugs

**Branch**: `002-fix-diff-viewer-bugs` | **Date**: 2026-01-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-fix-diff-viewer-bugs/spec.md`

## Summary

This plan addresses bugs in the Schema Designer Diff Viewer, focusing on: (1) standardizing inconsistent color fallbacks across components, (2) enabling live change count updates when the drawer is closed, (3) graceful handling of missing context, (4) canvas indicators for deleted tables/foreign keys, and (5) drawer styling polish. The approach will standardize all colors using CSS variables with consistent fallback values, connect the ChangeCountTracker to schema change events, and add safe context patterns.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18+  
**Primary Dependencies**: @fluentui/react-components, @xyflow/react (ReactFlow), VS Code Webview API  
**Storage**: N/A (in-memory state via React Context)  
**Testing**: Jest + React Testing Library (`yarn test`)  
**Target Platform**: VS Code Extension Webview  
**Project Type**: Single extension with webview components  
**Performance Goals**: 500ms max latency for change count updates (per FR-002)  
**Constraints**: Must use VS Code CSS variables for theming, must pass lint/build  
**Scale/Scope**: Bug fixes to existing diff viewer feature (~10 files affected)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality First** | ✅ PASS | Changes will follow existing architectural patterns (React context, services, makeStyles) |
| **II. Testing Standards** | ✅ PASS | Will add/update unit tests for color standardization and context safety |
| **III. UX Consistency** | ✅ PASS | Using VS Code CSS variables for theming; addressing accessibility (FR-005, FR-007) |
| **IV. Performance** | ✅ PASS | 500ms latency target specified; no setTimeout usage in webview |

**Pre-commit validation commands:**
```bash
yarn build                 # Must compile without errors
yarn test                  # Unit tests must pass
yarn lint src/ test/       # Linting must pass
```

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-diff-viewer-bugs/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal - bug fix)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── color-constants.ts  # Standardized color definitions
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (affected files)

```text
extensions/mssql/src/reactviews/pages/SchemaDesigner/
├── diffViewer/
│   ├── diffViewerContext.tsx      # Context + live updates (FR-002, FR-004)
│   ├── diffViewerDrawer.tsx       # Drawer colors (FR-001), styling (FR-008)
│   ├── changeItem.tsx             # Change item colors (FR-001, FR-006)
│   ├── changeCountTracker.ts      # Live count subscription (FR-002)
│   ├── diffViewer.css             # CSS colors (FR-001, FR-007)
│   └── colorConstants.ts          # NEW: Centralized color definitions
├── graph/
│   └── schemaDesignerTableNode.tsx # Table node colors (FR-001, FR-010, FR-011)
├── toolbar/
│   └── showChangesButton.tsx      # Safe context (FR-003)
└── schemaDesignerStateProvider.tsx # Trigger recalculations (FR-002, FR-013)

extensions/mssql/test/unit/reactviews/schemaDesigner/
├── changeCountTracker.test.ts     # Existing tests to extend
├── showChangesButton.test.tsx     # NEW: Context safety tests
└── colorConstants.test.ts         # NEW: Color standardization tests
```

**Structure Decision**: Single extension project with webview components. All changes are within the existing `extensions/mssql/src/reactviews/pages/SchemaDesigner/` structure.

## Complexity Tracking

> No Constitution violations requiring justification.

## Constitution Check Post-Design

*Re-evaluated after Phase 1 design completion.*

| Principle | Status | Design Validation |
|-----------|--------|-------------------|
| **I. Code Quality First** | ✅ PASS | `colorConstants.ts` follows singleton pattern; all changes use existing makeStyles/CSS variable patterns |
| **II. Testing Standards** | ✅ PASS | Test files identified: `showChangesButton.test.tsx`, `colorConstants.test.ts` (new), existing tracker tests extended |
| **III. UX Consistency** | ✅ PASS | Research confirms VS Code sidebar CSS variables will be used (`--vscode-sideBar-*`, `--vscode-list-*`) |
| **IV. Performance** | ✅ PASS | Live updates use lightweight count tracking, not full diff recalculation; no setTimeout patterns |

**All gates passed. Ready for Phase 2 (/speckit.tasks).**

## Generated Artifacts

| Artifact | Path | Purpose |
|----------|------|---------|
| Research | [research.md](research.md) | Color audit, architecture decisions |
| Data Model | [data-model.md](data-model.md) | Extended entity definitions |
| Contract | [contracts/color-constants.ts](contracts/color-constants.ts) | Standardized color definitions |
| Quickstart | [quickstart.md](quickstart.md) | Development workflow guide |
