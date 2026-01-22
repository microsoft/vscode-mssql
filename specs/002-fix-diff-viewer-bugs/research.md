# Research: Fix Diff Viewer Bugs

**Feature**: 002-fix-diff-viewer-bugs | **Date**: 2026-01-21

## Color Inconsistency Analysis

### Current State Audit

| File | Change Type | Current Fallback | Standard (FR-001) |
|------|-------------|------------------|-------------------|
| `diffViewerDrawer.tsx` L73 | Addition | `#81b88b` | `#73c991` ❌ |
| `diffViewerDrawer.tsx` L76 | Modification | `#e2c08d` | `#e2c08d` ✅ |
| `diffViewerDrawer.tsx` L79 | Deletion | `#c74e39` | `#c74e39` ✅ |
| `changeItem.tsx` L47 | Addition | `#81b88b` | `#73c991` ❌ |
| `changeItem.tsx` L50 | Modification | `#e2c08d` | `#e2c08d` ✅ |
| `changeItem.tsx` L53 | Deletion | `#c74e39` | `#c74e39` ✅ |
| `changeItem.tsx` L64-72 | Icons (all) | `#81b88b` / `#c74e39` | Mixed ❌ |
| `changeItem.tsx` L121-125 | Old/New values | `#c74e39` / `#81b88b` | `#73c991` ❌ |
| `diffViewer.css` L147-157 | All types | `#73c991` / `#f14c4c` | `#f14c4c` → `#c74e39` ❌ |
| `schemaDesignerTableNode.tsx` L95-103 | All types | Correct | ✅ |

### Decision: Centralized Color Constants

**Chosen Approach**: Create `colorConstants.ts` with exported CSS variable strings

**Rationale**:
- Single source of truth prevents future drift
- TypeScript exports allow type-safe usage in both makeStyles and inline styles
- CSS file uses same variables via standard var() syntax

**Alternatives Considered**:
1. Fix colors inline in each file - Rejected: prone to future drift
2. CSS-only solution - Rejected: TypeScript makeStyles needs JS constants
3. Theme tokens from Fluent - Rejected: VS Code variables provide better theme integration

### Standard Colors (FR-001)

```typescript
// Canonical color values per spec FR-001
export const DIFF_COLORS = {
  addition: "var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
  modification: "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
  deletion: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
} as const;
```

## Live Update Architecture (FR-002, FR-004, FR-013)

### Current Flow Analysis

```
Current:
  User makes change → Canvas updates → (nothing happens to change count)
  User opens drawer → recalculateDiff() called → Count updated

Required:
  User makes change → Canvas updates → ChangeCountTracker.increment() → Subscribers notified
  User undoes change → Canvas updates → ChangeCountTracker.decrement() → Subscribers notified
```

### Decision: Event-Driven Updates via SchemaDesignerStateProvider

**Chosen Approach**: Add `useEffect` in `schemaDesignerStateProvider.tsx` to detect schema changes and trigger tracker updates

**Rationale**:
- State provider already has access to schema state
- Avoids prop drilling through component tree
- ChangeCountTracker singleton already supports subscriptions

**Implementation Steps**:
1. Import `getChangeCountTracker` in state provider
2. Add `useEffect` hook that watches `currentSchema` changes
3. When schema changes, call lightweight diff to update counts
4. Use `recalculateDiff` only for full diff on drawer open

**Alternatives Considered**:
1. Full diff on every change - Rejected: Too expensive for large schemas
2. Custom event bus - Rejected: ChangeCountTracker already has subscription pattern
3. Polling - Rejected: Violates 500ms requirement and wastes resources

## Context Safety (FR-003)

### Current Issue

```tsx
// showChangesButton.tsx - throws if context unavailable
const { toggleDrawer, state } = useDiffViewer(); // throws error
```

### Decision: Optional Context Hook + Empty State

**Chosen Approach**: Create `useDiffViewerOptional()` hook that returns null if context unavailable, show "No changes" splash

**Rationale**:
- Matches clarification answer: "Show a blank splash screen saying 'No changes'"
- Graceful degradation without breaking toolbar
- Component remains functional when context available

**Implementation**:
```tsx
export function useDiffViewerOptional(): DiffViewerContextValue | null {
  return useContext(DiffViewerContext) ?? null;
}
```

## Canvas Indicators (FR-010, FR-011, FR-012)

### Current State

- Table nodes show colored borders for added/modified tables via `useTableDiffIndicator`
- No support for deleted tables (tables are removed from canvas)
- No column-level indicators
- No foreign key edge indicators

### Decision: Extended Diff State with Ghost Elements

**Chosen Approach**: 
1. Track deleted tables in diff state (not removed from canvas when viewing diff)
2. Add `columnChangeTypes` to table node data
3. Add `edgeChangeType` to foreign key edges

**Rationale**:
- Users need to see what was deleted, not just what was changed
- Column indicators help identify specific changes within tables
- Consistent visual language across all elements

**Alternatives Considered**:
1. Separate "deleted items" panel - Rejected: FR-011/FR-012 require canvas display
2. Overlay system - Rejected: More complex, harder to maintain

## Drawer Styling (FR-008, FR-009)

### Current Issues Identified

1. Font color in table names not matching VS Code theme
2. Inconsistent padding/margins
3. Missing hover states on some elements

### Decision: Align with VS Code Sidebar Patterns

**Chosen Approach**: Update CSS to use VS Code sidebar CSS variables:
- `--vscode-sideBar-background`
- `--vscode-sideBarTitle-foreground`
- `--vscode-list-hoverBackground`
- `--vscode-list-activeSelectionBackground`

**Rationale**: Follows Constitution Principle III (UX Consistency) - must follow VS Code design patterns
