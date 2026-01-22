# Implementation Plan: Schema Diff Viewer

**Branch**: `001-schema-diff-viewer` | **Date**: 2026-01-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-schema-diff-viewer/spec.md`

## Summary

Add a real-time diff viewer to the Schema Designer that displays schema changes in a right-side drawer panel. The viewer shows changes grouped by table with color-coded indicators (green/yellow/red), enables navigation from change items to canvas elements, and supports per-item undo to restore original schema state. Diff calculation occurs on-demand when the drawer opens, while the toolbar displays a live change count tracked incrementally.

## Technical Context

**Language/Version**: TypeScript (strict mode) with React for webview components  
**Primary Dependencies**: React, @fluentui/react-components, @xyflow/react, vscode-jsonrpc  
**Storage**: In-memory state (original schema cached at session start, current schema from ReactFlow)  
**Testing**: Mocha/Chai for unit tests (`yarn test`), Playwright for E2E (`yarn smoketest`)  
**Target Platform**: VS Code Extension (webview)  
**Project Type**: VS Code Extension with React webviews  
**Performance Goals**: Diff calculation <500ms, change count updates <50ms, smooth rendering with 500+ changes  
**Constraints**: No `setTimeout` in webview code, VSIX <25MB, drawer resizable with persistence  
**Scale/Scope**: Single extension feature, ~10-15 new files, integrates with existing Schema Designer

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Code Quality First** | ✅ PASS | New code follows existing architectural patterns (controllers, services, React components). Will use existing ESLint/Prettier config. |
| **II. Testing Standards** | ✅ PASS | Unit tests required for diff calculation service and change tracking. Contract tests for new interfaces. No `setTimeout` in webview code per spec. |
| **III. User Experience Consistency** | ✅ PASS | Drawer pattern follows existing `SchemaDesignerEditorDrawer`. VS Code theming variables used for diff colors. Strings localized via `l10n/`. Keyboard navigation supported. |
| **IV. Performance Requirements** | ✅ PASS | Diff calculation <500ms (SC-002). No `setTimeout` in webview. Change count incremental (lightweight). Virtualization for large diffs (500+ changes). |

**Gate Result**: ✅ PASS - All constitution principles satisfied. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/001-schema-diff-viewer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── schema-diff.ts   # TypeScript interfaces for diff viewer
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (extensions/mssql)

```text
extensions/mssql/
├── src/
│   ├── sharedInterfaces/
│   │   └── schemaDesigner.ts        # Extend with diff viewer interfaces
│   ├── schemaDesigner/
│   │   └── schemaDesignerWebviewController.ts  # Add diff-related request handlers
│   └── reactviews/
│       ├── common/
│       │   └── locConstants.ts      # Add localized strings for diff viewer
│       └── pages/SchemaDesigner/
│           ├── schemaDesignerStateProvider.tsx  # Extend with diff state
│           ├── schemaDesignerPage.tsx           # Add diff drawer to layout
│           ├── toolbar/
│           │   └── showChangesButton.tsx        # NEW: Toolbar button with count
│           └── diffViewer/                      # NEW: Diff viewer components
│               ├── diffViewerDrawer.tsx         # Main drawer component
│               ├── diffViewerContext.tsx        # State management
│               ├── changesList.tsx              # Grouped changes list
│               ├── changeItem.tsx               # Individual change item
│               ├── diffCalculator.ts            # Diff calculation logic
│               ├── changeCountTracker.ts        # Lightweight change counter
│               └── diffViewer.css               # Diff-specific styles
├── l10n/
│   └── bundle.l10n.json             # Add diff viewer strings
└── test/
    └── unit/
        ├── diffCalculator.test.ts   # NEW: Unit tests for diff logic
        └── changeCountTracker.test.ts # NEW: Unit tests for counter
```

**Structure Decision**: Extends the existing VS Code extension structure under `extensions/mssql/`. New diff viewer components are co-located with Schema Designer components under `src/reactviews/pages/SchemaDesigner/diffViewer/`. Shared interfaces extend the existing `schemaDesigner.ts` file to maintain consistency.

## Complexity Tracking

> No constitution violations. No complexity justifications required.

---

## Post-Design Constitution Re-Evaluation

*Re-check after Phase 1 design completion (research.md, data-model.md, contracts/, quickstart.md)*

| Principle | Status | Post-Design Evidence |
|-----------|--------|---------------------|
| **I. Code Quality First** | ✅ PASS | Contracts define clear interfaces (`schema-diff.ts`). Service interfaces (`IDiffCalculator`, `IChangeCountTracker`) enable dependency injection. Event types (`DiffViewerEvents`) integrate with existing eventBus pattern. |
| **II. Testing Standards** | ✅ PASS | `quickstart.md` documents test commands (`npm test`, `npm run test:coverage`). Contracts provide testable interfaces. Data model includes sample JSON for test fixtures. |
| **III. User Experience Consistency** | ✅ PASS | Research confirms VS Code CSS variables for colors (`gitDecoration.*`). Component props follow existing patterns. `InlineDrawer` (non-modal) matches spec requirement for non-blocking workflow. |
| **IV. Performance Requirements** | ✅ PASS | Research confirms client-side diff calculation (no server round-trip). `IChangeCountTracker` enables incremental counter without full recalculation. On-demand diff calculation avoids continuous computation. |

**Post-Design Gate Result**: ✅ PASS - All constitution principles validated post-design. Ready for Phase 2 task generation.

## Generated Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Research | [research.md](./research.md) | Technical decisions and rationale |
| Data Model | [data-model.md](./data-model.md) | Entity definitions with relationships |
| Contracts | [contracts/schema-diff.ts](./contracts/schema-diff.ts) | TypeScript interfaces and types |
| Quickstart | [quickstart.md](./quickstart.md) | Development setup guide |
| Agent Context | [.github/agents/copilot-instructions.md](../../.github/agents/copilot-instructions.md) | Updated Copilot context |
