# Research: Schema Diff Viewer

**Feature**: 001-schema-diff-viewer  
**Date**: 2026-01-21  
**Purpose**: Resolve unknowns from Technical Context and establish best practices

## Research Tasks

### 1. Diff Calculation Strategy

**Question**: How should we compute differences between original and current schema states?

**Research Findings**:

The existing Schema Designer already has mechanisms for comparing schemas:
- `GetReportRequest`/`GetReportResponse` in `schemaDesigner.ts` provides a `DacReport` from SQL Tools Service
- `stateStack` in `schemaDesignerStateProvider.tsx` maintains undo/redo state using ReactFlow's JSON object format
- The initial schema is cached in `schemaDesignerCache` when a session is created

**Decision**: Implement a client-side diff calculator that compares the original schema (cached at session start) with the current schema (extracted from ReactFlow state). This avoids round-trips to SQL Tools Service for simple change detection.

**Rationale**: 
- On-demand calculation means we don't need real-time tracking of every change
- Client-side diffing is faster for UI updates (<500ms requirement)
- Existing `flowUtils.extractSchemaModel()` already provides current schema extraction
- Alternatives considered:
  - Using SQL Tools Service `getReport()`: Too slow for interactive UI, better for publish-time validation
  - Real-time change tracking: Adds complexity, not needed per clarifications

### 2. Change Count Tracking

**Question**: How should we track change count for the toolbar button without full diff calculation?

**Research Findings**:

The existing `UndoRedoStack` tracks state changes but counts undo/redo operations, not semantic schema changes. We need a lightweight counter that:
- Increments/decrements as users add/modify/delete tables/columns/foreign keys
- Does not require full schema comparison
- Survives undo/redo operations

**Decision**: Create a `ChangeCountTracker` class that hooks into existing eventBus events (`pushState`, `undo`, `redo`) and maintains counts for additions, modifications, and deletions.

**Rationale**:
- EventBus pattern already exists (`schemaDesignerEvents.ts`)
- Lightweight - just increments/decrements numbers
- Updates immediately on user actions (no computation delay)
- Alternatives considered:
  - Polling with interval: Adds latency, against constitution (no `setTimeout`)
  - Full diff on every change: Too slow, unnecessary

### 3. Drawer Component Pattern

**Question**: Should we use `OverlayDrawer` (modal) or `InlineDrawer` (non-modal) from Fluent UI?

**Research Findings**:

The existing `SchemaDesignerEditorDrawer` uses `OverlayDrawer` from `@fluentui/react-components`, which is modal by default. Per spec clarification, the diff drawer should allow interaction with the canvas while open.

**Decision**: Use `InlineDrawer` component with `position="end"` for non-modal behavior, allowing users to interact with the canvas while reviewing changes.

**Rationale**:
- Spec clarification explicitly states drawer won't be modal
- `InlineDrawer` integrates into page layout without overlay
- Enables click-to-navigate from change items to canvas elements
- Alternatives considered:
  - `OverlayDrawer` with modal={false}: Works but `InlineDrawer` is more semantic
  - Custom drawer: Unnecessary, Fluent UI provides what we need

### 4. Visual Diff Styling

**Question**: How should we implement VS Code-compatible diff colors that work with all themes?

**Research Findings**:

VS Code provides CSS variables for diff colors:
- `--vscode-diffEditor-insertedTextBackground` (green for additions)
- `--vscode-diffEditor-removedTextBackground` (red for deletions)
- `--vscode-diffEditor-modifiedLineBackground` (blue/yellow for modifications)

The existing `schemaDesignerFlowColors.css` demonstrates using VS Code theme variables.

**Decision**: Use VS Code CSS variables for diff colors, with explicit fallbacks for accessibility in high-contrast themes.

**Rationale**:
- Consistent with VS Code's native diff views
- Automatically adapts to user's theme
- High-contrast themes have specific diff color variables
- Alternatives considered:
  - Custom color scheme: Inconsistent with VS Code, accessibility concerns
  - Hard-coded colors: Fails in dark/light/high-contrast themes

### 5. Canvas Visual Indicators

**Question**: How should we show visual diff indicators on affected canvas elements?

**Research Findings**:

The existing `SchemaDesignerTableNode` component (`graph/schemaDesignerTableNode.tsx`) renders table nodes in the ReactFlow canvas. We can add a visual indicator (border color, badge, or glow effect) to nodes that have changes.

**Decision**: Add a colored border/outline to table nodes based on their change state (green for new, yellow for modified, red for deleted). The border is conditionally rendered when diff viewer is open.

**Rationale**:
- Non-intrusive visual indicator
- Uses same color scheme as drawer for consistency
- Only shown when diff viewer is open (per clarification)
- Alternatives considered:
  - Badges/icons on nodes: Clutters the canvas
  - Background color change: May conflict with selection highlighting

### 6. Per-Item Undo Implementation

**Question**: How should we implement undo for a specific change from the drawer?

**Research Findings**:

The existing undo/redo system uses `UndoRedoStack` which operates on the entire ReactFlow state. Per-item undo is different - it restores a specific element to its original value without affecting other changes.

**Decision**: Implement per-item undo as a targeted schema mutation:
- For additions: Remove the added item from current schema
- For deletions: Restore the item from original schema
- For modifications: Replace current value with original value

This bypasses the undo/redo stack and directly modifies the current state.

**Rationale**:
- More intuitive for users (reverts just that change)
- Doesn't affect other pending changes
- Original schema is already cached, so restoration is straightforward
- Alternatives considered:
  - Walk back undo stack: Complex, may undo unrelated changes
  - Disable per-item undo: Reduces usability

## Summary of Decisions

| Topic | Decision | Key Rationale |
|-------|----------|---------------|
| Diff Calculation | Client-side comparison of original vs current schema | Fast (<500ms), no server round-trip |
| Change Count | EventBus-based counter with increment/decrement | Lightweight, real-time updates |
| Drawer Component | `InlineDrawer` (non-modal) | Allows canvas interaction while open |
| Diff Colors | VS Code CSS variables | Theme-compatible, accessible |
| Canvas Indicators | Colored borders on affected nodes | Non-intrusive, consistent with drawer |
| Per-Item Undo | Direct schema mutation to restore original | Intuitive, doesn't affect other changes |

## Dependencies Identified

- `@fluentui/react-components` - InlineDrawer, Button, Tree components
- `@xyflow/react` - ReactFlow state, Node/Edge types
- VS Code CSS variables - Theme-compatible styling
- Existing Schema Designer infrastructure - eventBus, flowUtils, stateStack
