# Research: Fix Diff Viewer Visual Issues

**Feature**: 003-fix-diff-visual-issues | **Date**: 2026-01-21

## Column Change Tracking Analysis

### Current State Audit

| Component | Current Capability | Gap |
|-----------|-------------------|-----|
| `diffCalculator.ts` | Tracks table-level and FK changes | Does NOT track column-level changes within tables |
| `diffViewerContext.tsx` | Has `useTableDiffIndicator`, `useForeignKeyDiffIndicator` | Missing `useColumnDiffIndicator` hook |
| `schemaDesignerTableNode.tsx` | Renders columns via `TableColumn` component | No indicator rendering, no deleted column display |
| `diffViewer.css` | Has table border styles (`.diffIndicator*`) | Missing column indicator styles |

### Decision: Add Column-Level Change Tracking

**Chosen Approach**: Extend `diffCalculator` to emit column-level changes and add `useColumnDiffIndicator` hook

**Rationale**:
- Follows existing patterns established in spec 002
- Column changes are already detected but not exposed at granular level
- Hook pattern allows components to subscribe to specific column changes

**Alternatives Considered**:
1. Parse column changes from existing `SchemaChange` entries in component - Rejected: Breaks separation of concerns
2. Store column changes in table node data - Rejected: Would require ReactFlow re-renders for all changes

### Data Model for Column Changes

```typescript
// Stored per table in diff state
interface ColumnChangeMap {
  [columnName: string]: SchemaDesigner.SchemaChangeType;
}

// Stored in diff context state (parallel to deletedTableIds)
interface TableColumnChanges {
  [tableId: string]: ColumnChangeMap;
}

// Also need to track deleted columns that no longer exist in current schema
interface DeletedColumnInfo {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  position: number; // Original index in column array
}

interface DeletedColumnsMap {
  [tableId: string]: DeletedColumnInfo[];
}
```

## Reveal Highlight Animation

### Current State

- Existing `reveal-highlight` animation in `diffViewer.css` (from spec 002)
- Animation applies pulsing border effect
- Currently triggered by adding CSS class

### Decision: Extend Animation to Support FK Edges

**Chosen Approach**: Add `useRevealHighlight` hook that manages highlight state and supports both nodes and edges

**Rationale**:
- Edge highlighting requires different approach (SVG stroke animation vs border)
- Centralized state prevents animation queue buildup
- Can integrate with `prefers-reduced-motion` check

**Implementation Pattern**:
```typescript
// Hook manages highlighted element ID and auto-clears after animation
function useRevealHighlight() {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  
  const triggerHighlight = useCallback((id: string) => {
    setHighlightedId(id);
    // No setTimeout - use CSS animation-end event
  }, []);
  
  const clearHighlight = useCallback(() => {
    setHighlightedId(null);
  }, []);
  
  return { highlightedId, triggerHighlight, clearHighlight };
}
```

### Animation Timing

- Duration: 1 second total (3 pulses × ~330ms each)
- Easing: ease-in-out for smooth transitions
- Respect `prefers-reduced-motion`: Use static highlight instead

## Resize Handle Visibility

### Current State

From `diffViewer.css`:
```css
.diff-viewer-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.15s ease;
}

.diff-viewer-resize-handle:hover,
.diff-viewer-resize-handle--dragging {
    background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
}
```

### Decision: Add Grip Indicator

**Chosen Approach**: Add a subtle grip pattern (vertical dots) on hover using CSS pseudo-elements

**Rationale**:
- VS Code uses similar grip patterns for resizable panels
- Pure CSS solution, no React changes needed
- Maintains theme compatibility via CSS variables

**CSS Pattern**:
```css
.diff-viewer-resize-handle::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 24px;
  opacity: 0;
  transition: opacity 0.15s ease;
  /* Dotted pattern using radial gradient */
  background: radial-gradient(
    circle at center,
    var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)) 1px,
    transparent 1px
  );
  background-size: 2px 6px;
}

.diff-viewer-resize-handle:hover::before,
.diff-viewer-resize-handle--dragging::before {
  opacity: 1;
}
```

## Empty State Illustration

### Current State

From `diffViewer.css`:
```css
.diff-viewer-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
}
```

Currently shows only text, no icon.

### Decision: Use Fluent UI Checkmark Icon

**Chosen Approach**: Add `CheckmarkCircleRegular` icon from `@fluentui/react-icons`

**Rationale**:
- Consistent with existing icon usage in the codebase
- Theme-aware via CSS variables
- Small bundle impact (already have @fluentui/react-icons dependency)

**Alternatives Considered**:
1. Custom SVG illustration - Rejected: Would need designer input, more maintenance
2. Emoji checkmark - Rejected: Inconsistent rendering across platforms
3. DocumentCheckmarkRegular - Considered but simple checkmark is cleaner

### Styling

```css
.diff-viewer-empty-icon {
    font-size: 48px;
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    opacity: 0.6;
    margin-bottom: 16px;
}
```

## Deleted Column Display

### Decision: Inline Strikethrough (Per Clarification)

**Confirmed by user**: Show deleted columns inline at their original position with:
- Strikethrough text styling
- Dimmed opacity (0.5)
- Red indicator dot

### Implementation Approach

1. **Data requirement**: `DeletedColumnsMap` in diff context must include original column position
2. **Rendering**: In `TableColumn` component, check if column is in deleted set
3. **Merged list**: Create combined list of current + deleted columns sorted by position
4. **Styling**: Apply `.column--deleted` class with strikethrough and dimmed styles

### CSS Styling

```css
.column--deleted {
    opacity: 0.5;
}

.column--deleted .column-name {
    text-decoration: line-through;
}

.column-diff-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-right: 4px;
}

.column-diff-indicator--addition {
    background-color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
}

.column-diff-indicator--modification {
    background-color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
}

.column-diff-indicator--deletion {
    background-color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
}
```

## Font Color Fix (FR-009)

### Current Issue

Table names in the drawer may use hardcoded colors or incorrect CSS variable.

### Decision: Use VS Code foreground variable

**Chosen Approach**: Ensure `.change-group-name` uses `var(--vscode-foreground)` consistently

From current CSS (already correct):
```css
.change-group-name {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground);
    ...
}
```

**Action**: Audit `diffViewerDrawer.tsx` for any inline color overrides that might conflict.

## Accessibility Considerations

### Reduced Motion

All animations must respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
    .reveal-highlight {
        animation: none;
        /* Use static highlight instead */
        box-shadow: 0 0 0 3px var(--vscode-focusBorder);
    }
}
```

### Contrast Requirements

- All indicator colors use VS Code theme variables
- High contrast theme support already exists in `diffViewer.css`
- Verify empty state icon meets 3:1 contrast ratio

### Keyboard Navigation

- Reveal button already keyboard accessible
- No additional keyboard requirements for visual indicators
