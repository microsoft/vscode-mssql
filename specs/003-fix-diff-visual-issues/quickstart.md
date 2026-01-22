# Quickstart: Fix Diff Viewer Visual Issues

**Feature**: 003-fix-diff-visual-issues | **Date**: 2026-01-21

## Prerequisites

- Node.js v20.19.4+
- Yarn v1.22+
- VS Code with ESLint and Prettier extensions

## Setup

```bash
# Clone and setup (if not already done)
cd c:\Users\aaskhan\src\vscode-mssql-speckit

# Ensure you're on the feature branch
git checkout 003-fix-diff-visual-issues

# Install dependencies (NEVER CANCEL - may take 120s)
yarn install

# Build the extension
yarn build
```

## Development Workflow

### 1. Watch Mode

Start the development watcher for live recompilation:

```bash
yarn watch
```

This provides sub-second recompilation feedback as you modify files.

### 2. Run Extension in Debug Mode

1. Open VS Code
2. Press `F5` to launch Extension Development Host
3. Open a database connection and launch Schema Designer
4. Open the diff viewer drawer to test changes

### 3. Test Changes

Run unit tests:

```bash
# Run all tests
yarn test

# Run specific test file
yarn test --grep "diffViewerContext"

# Run with coverage
yarn test --coverage
```

### 4. Lint Before Commit

```bash
# Lint source files only (required)
yarn lint src/ test/
```

## Key Files to Modify

| File | Purpose |
|------|---------|
| [diffViewerContext.tsx](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx) | Add `useColumnDiffIndicator` hook, extend state |
| [diffCalculator.ts](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts) | Extract column-level changes |
| [schemaDesignerTableNode.tsx](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx) | Render column indicators, deleted columns |
| [diffViewer.css](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css) | Add indicator styles, animations |
| [diffViewerDrawer.tsx](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerDrawer.tsx) | Add empty state icon |
| [changeItem.tsx](../../extensions/mssql/src/reactviews/pages/SchemaDesigner/diffViewer/changeItem.tsx) | Enhance reveal button |

## Testing Checklist

### Column Indicators

1. Add a new column to a table → Green indicator appears
2. Modify column data type → Yellow indicator appears
3. Delete a column → Red indicator with strikethrough appears
4. Verify indicators only show when drawer is open

### Reveal Highlight

1. Click reveal on table change → Table receives pulsing border
2. Click reveal on FK change → Edge line pulses
3. Rapid clicks → Only latest element highlights
4. Check `prefers-reduced-motion` → Animation skipped, static highlight shown

### Resize Handle

1. Hover over drawer left edge → Grip indicator appears
2. Drag to resize → Smooth update
3. Release → Width persisted

### Empty State

1. No changes → Checkmark icon displayed
2. Different themes → Icon colors adapt
3. Make a change → Transitions to change list

## Architecture Notes

### Hook Pattern

Column indicators use the same hook pattern as existing diff indicators:

```typescript
// Existing pattern (table-level)
const { showIndicator, aggregateState } = useTableDiffIndicator(tableId);

// New pattern (column-level)
const { showIndicator, changeType } = useColumnDiffIndicator(tableId, columnName);
```

### CSS Variable Usage

All colors must use VS Code theme variables:

```css
/* Correct */
color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);

/* Incorrect - hardcoded fallback without variable */
color: #73c991;
```

### Animation Best Practices

- Use CSS animations only (GPU-accelerated)
- Never use `setTimeout` in webviews (throttled when tab hidden)
- Respect `prefers-reduced-motion` media query

## Common Issues

### "Cannot find module" errors

```bash
yarn build
```

### Lint errors

```bash
yarn lint src/ test/ --fix
```

### Tests failing

Check if diff context mocks need updating for new state fields.

## Next Steps

After implementing, run the full validation:

```bash
yarn build && yarn test && yarn lint src/ test/
```

Then proceed to `/speckit.tasks` to generate implementation tasks.
