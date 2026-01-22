# Implementation Plan: Fix Diff View Bugs

**Branch**: `004-fix-diff-view-bugs` | **Date**: 2026-01-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-fix-diff-view-bugs/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement comprehensive fixes for diff viewer bugs in the Schema Designer. The feature addresses six key issues: (1) deleted elements not visible on canvas, (2) undo action not synchronizing UI state, (3) foreign key reveal not highlighting edges, (4) table rename not showing old name, (5) foreign key modifications lacking color distinction, and (6) foreign keys not having granular drawer entries. The technical approach uses ghost node injection for deleted elements, immediate eventBus integration for undo sync, edge highlight animations for FK reveal, conditional rendering for rename display, and FK modification metadata tracking for color indicators.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)  
**Primary Dependencies**: React 18+, @fluentui/react-components, @xyflow/react  
**Storage**: N/A (in-memory state via React Context)  
**Testing**: Jest + React Testing Library  
**Target Platform**: VS Code Extension (webview)
**Project Type**: Single project (VS Code extension)  
**Performance Goals**: 60 fps canvas rendering, <200ms state updates  
**Constraints**: <200ms for undo/redo response, no visual glitches during drawer transitions  
**Scale/Scope**: Schema Designer component, ~15 files affected

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Core Principles Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **Code Quality** | ✅ PASS | TypeScript strict mode, ESLint rules enforced |
| **Testing Requirements** | ✅ PASS | Unit tests for DiffCalculator, DiffViewerContext |
| **UX Consistency** | ✅ PASS | Fluent UI components, VS Code CSS variables |
| **Performance** | ✅ PASS | 60fps target, <200ms state updates |

### Quality Gates

| Gate | Requirement | Verification |
|------|-------------|--------------|
| `yarn build` | Must pass | Run after each significant change |
| `yarn lint src/ test/` | No new errors | Run before commit |
| `yarn test` | All tests pass | Run before PR |
| Accessibility | Keyboard navigation, screen reader support | Manual verification |
| Theming | Light/dark/high contrast | Test all three modes |

### Constitution Violations

**None identified.** This feature:
- Does not introduce new projects or layers
- Uses existing patterns (Context, eventBus)
- Follows established styling conventions
- Maintains existing file structure

## Project Structure

### Documentation (this feature)

```text
specs/004-fix-diff-view-bugs/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Technical research and gap analysis
├── data-model.md        # Entity definitions and state flows
├── quickstart.md        # Development and testing guide
├── contracts/           # TypeScript interface definitions
│   └── diff-viewer-types.ts
├── checklists/
│   └── requirements.md  # Requirements verification checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (files to modify)

```text
extensions/mssql/src/
├── sharedInterfaces/
│   └── schemaDesigner.ts              # Add FK modification interfaces
└── reactviews/pages/SchemaDesigner/
    ├── diffViewer/
    │   ├── diffCalculator.ts          # Add FK structural detection
    │   ├── diffViewerContext.tsx      # Add ghost node/edge state
    │   ├── diffViewerIntegration.tsx  # Improve undo sync timing
    │   └── diffViewer.css             # Ghost node, rename styles
    └── graph/
        ├── SchemaDiagramFlow.tsx       # Ghost node injection
        ├── schemaDesignerTableNode.tsx # Rename display, ghost styling
        ├── schemaDesignerForeignKeyEdge.tsx # Edge color indicators
        └── useStyledEdgesForDiff.ts    # Edge styling logic

extensions/mssql/test/
└── unit/
    └── schemaDesigner/
        ├── diffCalculator.test.ts     # New tests for FK detection
        └── diffViewerContext.test.ts  # New tests for ghost nodes
```

**Structure Decision**: Single project (VS Code extension). All changes are within the existing `extensions/mssql` directory structure. No new projects or architectural patterns introduced.

## Files to Modify

| File | Changes | User Stories |
|------|---------|--------------|
| `schemaDesigner.ts` | Add `ForeignKeyModificationDetails`, `GhostNodeData`, `RenameDisplayInfo` interfaces | US1, US4, US5 |
| `diffCalculator.ts` | Add `isStructuralChange()` method, track original FK in modifications | US5 |
| `diffViewerContext.tsx` | Add `ghostNodes`, `ghostEdges` state; improve undo handler | US1, US2 |
| `diffViewerIntegration.tsx` | Add immediate recalculation trigger after undo | US2 |
| `SchemaDiagramFlow.tsx` | Inject ghost nodes/edges when `showCanvasIndicators` is true | US1 |
| `schemaDesignerTableNode.tsx` | Add rename display, ghost node styling | US1, US4 |
| `schemaDesignerForeignKeyEdge.tsx` | Add yellow/red/green edge colors, glow animation | US3, US5 |
| `useStyledEdgesForDiff.ts` | Handle ghost edge styling, modification colors | US1, US5 |
| `diffViewer.css` | Add ghost node, rename, glow animation styles | US1, US3, US4 |

## Complexity Tracking

> **No violations identified.** All changes follow existing patterns and stay within constitution guidelines.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| *None* | - | - |
