# Implementation Plan: Fix Diff Viewer Visual Issues

**Branch**: `003-fix-diff-visual-issues` | **Date**: 2026-01-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-fix-diff-visual-issues/spec.md`

## Summary

This plan addresses visual polish items for the Schema Designer Diff Viewer, focusing on: (1) adding column-level change indicators in table nodes, (2) displaying deleted columns inline with strikethrough styling, (3) enhancing reveal highlight animations, (4) improving drawer resize handle visibility, and (5) adding an empty state illustration. The approach extends existing diff context hooks to provide column-level change data and uses CSS classes and animations for visual feedback.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18+  
**Primary Dependencies**: @fluentui/react-components, @xyflow/react (ReactFlow), @fluentui/react-icons  
**Storage**: N/A (in-memory state via React Context)  
**Testing**: Jest + React Testing Library (`yarn test`)  
**Target Platform**: VS Code Extension Webview  
**Project Type**: Single extension with webview components  
**Performance Goals**: Column indicators render within 16ms frame budget; animations at 60fps  
**Constraints**: Must use VS Code CSS variables for theming; must respect `prefers-reduced-motion`  
**Scale/Scope**: Visual polish for existing diff viewer feature (~8 files affected)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality First** | ✅ PASS | All changes follow existing React/TypeScript patterns (hooks, makeStyles, CSS modules) |
| **II. Testing Standards** | ✅ PASS | Unit tests will be added for new hooks (useColumnDiffIndicator) |
| **III. UX Consistency** | ✅ PASS | Using VS Code CSS variables; respecting `prefers-reduced-motion`; following existing diff viewer patterns |
| **IV. Performance** | ✅ PASS | No setTimeout in webviews; animations use CSS only (GPU-accelerated) |

**Pre-commit validation commands:**
```bash
yarn build                 # Must compile without errors
yarn test                  # Unit tests must pass
yarn lint src/ test/       # Linting must pass
```

## Project Structure

### Documentation (this feature)

```text
specs/003-fix-diff-visual-issues/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── column-diff-types.ts  # TypeScript interfaces
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (affected files)

```text
extensions/mssql/src/reactviews/pages/SchemaDesigner/
├── diffViewer/
│   ├── diffViewerContext.tsx      # Add useColumnDiffIndicator hook
│   ├── diffCalculator.ts          # Extend to track column changes per table
│   ├── diffViewer.css             # Add column indicator + animation styles
│   ├── changeItem.tsx             # Enhance reveal button with highlight trigger
│   └── diffViewerDrawer.tsx       # Fix font color (FR-009), empty state illustration
├── graph/
│   └── schemaDesignerTableNode.tsx # Render column indicators + deleted columns inline
└── schemaDesignerStateProvider.tsx # Expose reveal highlight state

extensions/mssql/test/unit/reactviews/schemaDesigner/
├── diffViewerContext.test.tsx     # Test useColumnDiffIndicator hook
└── schemaDesignerTableNode.test.tsx # Test column indicator rendering
```

**Structure Decision**: Single extension project with webview components. All changes are within the existing `extensions/mssql/src/reactviews/pages/SchemaDesigner/` structure, extending the diff viewer feature implemented in spec 002.

## Complexity Tracking

> No Constitution violations requiring justification.

## Constitution Check Post-Design

*Re-evaluated after Phase 1 design completion.*

| Principle | Status | Design Validation |
|-----------|--------|-------------------|
| **I. Code Quality First** | ✅ PASS | All new code follows existing patterns: React hooks, makeStyles, CSS modules; TypeScript interfaces defined in contracts/ |
| **II. Testing Standards** | ✅ PASS | Test files identified: `diffViewerContext.test.tsx` (extend), `schemaDesignerTableNode.test.tsx` (new tests for column indicators) |
| **III. UX Consistency** | ✅ PASS | Uses VS Code CSS variables throughout; respects `prefers-reduced-motion`; follows existing diff viewer visual language |
| **IV. Performance** | ✅ PASS | No setTimeout in webviews; CSS-only animations (GPU-accelerated); O(1) lookups via Maps |

**All gates passed. Ready for Phase 2 (/speckit.tasks).**

## Generated Artifacts

| Artifact | Path | Purpose |
|----------|------|---------|
| Research | [research.md](research.md) | Technical analysis and decisions |
| Data Model | [data-model.md](data-model.md) | Entity definitions and relationships |
| Contracts | [contracts/column-diff-types.ts](contracts/column-diff-types.ts) | TypeScript interface definitions |
| Quickstart | [quickstart.md](quickstart.md) | Development setup and workflow |
