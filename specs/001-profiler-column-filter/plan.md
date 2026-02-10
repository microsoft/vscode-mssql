# Implementation Plan: Profiler Column-Level Filtering and Quick Filter

**Branch**: `dev/allancascante/001-profiler-column-filter` | **Date**: February 4, 2026 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-profiler-column-filter/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement an inline column-level filtering system for the Profiler grid that replaces the current global filter dialog with contextual filter popovers. Each column header displays a funnel icon that opens a popover with filter controls appropriate for the column's data type (categorical, numeric, date, or text). A new "Quick filter all columns…" toolbar input provides cross-column text search. All filtering logic executes in FilteredBuffer, not SlickGrid.

## Technical Context

**Language/Version**: TypeScript (ES2024), React 18+
**Primary Dependencies**: SlickGrid-React (grid rendering), Fluent UI React Components (popover, inputs, buttons), FilteredBuffer (filtering logic)
**Storage**: N/A (in-memory filtering only)
**Testing**: Mocha/Chai for unit tests (`yarn test` in extensions/mssql)
**Target Platform**: VS Code Extension (webview)
**Project Type**: VS Code Extension with React webviews
**Performance Goals**: Filter operations < 500ms for 100k rows, Quick filter debounce 200ms
**Constraints**: No setTimeout in webviews (use requestAnimationFrame/queueMicrotask), all filtering in FilteredBuffer
**Scale/Scope**: Profiler grid with up to 100,000 rows, ~10-15 columns

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. TypeScript-First | ✅ PASS | All code in TypeScript with strict mode |
| II. VS Code Extension Patterns | ✅ PASS | Using existing extension architecture |
| III. React Webview Standards | ✅ PASS | No setTimeout; use queueMicrotask for debounce |
| IV. Test-First | ✅ PASS | Unit tests for FilteredBuffer enhancements, component tests |
| V. Build Verification | ✅ PASS | yarn build, yarn lint src/ test/, yarn package |
| VI. Code Quality Gates | ✅ PASS | ESLint, Prettier, copyright headers |
| VII. Simplicity & YAGNI | ✅ PASS | Only implementing specified requirements |
| VIII. Extension Independence | ✅ PASS | Changes only in mssql extension |

## Project Structure

### Documentation (this feature)

```text
specs/001-profiler-column-filter/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
extensions/mssql/
├── src/
│   ├── profiler/
│   │   ├── filteredBuffer.ts        # MODIFY: Add quick filter, column filter state
│   │   ├── profilerTypes.ts         # MODIFY: Add ColumnFilterState, QuickFilterState
│   │   └── profilerWebviewController.ts  # MODIFY: Handle new filter reducers
│   ├── sharedInterfaces/
│   │   └── profiler.ts              # MODIFY: Add filter-related interfaces, column metadata
│   └── reactviews/
│       └── pages/Profiler/
│           ├── profiler.tsx         # MODIFY: Add funnel icons to column headers
│           ├── profilerToolbar.tsx  # MODIFY: Replace toolbar filter with Quick filter input
│           ├── profilerFilterDialog.tsx  # KEEP: Existing dialog (may be removed later)
│           └── components/          # NEW: Filter popover components
│               ├── ColumnFilterPopover.tsx      # NEW: Main popover container
│               ├── CategoricalFilter.tsx        # NEW: Checkbox list filter
│               ├── NumericFilter.tsx            # NEW: Operator + numeric input
│               ├── DateFilter.tsx               # NEW: Operator + date input
│               ├── TextFilter.tsx               # NEW: Operator + text input
│               └── QuickFilterInput.tsx         # NEW: Toolbar quick filter
├── test/
│   └── unit/
│       └── profiler/
│           ├── filteredBuffer.test.ts   # MODIFY: Add tests for new filter types
│           └── columnFilter.test.ts     # NEW: Component tests for filter popovers
└── l10n/
    └── bundle.l10n.json             # MODIFY: Add new localization strings
```

**Structure Decision**: Follows existing mssql extension structure. New filter components placed in a `components/` subfolder under Profiler page to maintain organization.

## Complexity Tracking

> No violations - implementation follows existing patterns and architecture.
