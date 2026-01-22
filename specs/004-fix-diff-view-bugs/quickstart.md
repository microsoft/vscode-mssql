# Quick Start Guide: Fix Diff View Bugs

**Feature**: 004-fix-diff-view-bugs  
**Date**: 2026-01-22

## Prerequisites

- Node.js v20.19.4+
- Yarn v1.22+
- VS Code (for testing the extension)

## Setup

```bash
# Navigate to extension directory
cd extensions/mssql

# Install dependencies
yarn install

# Build the extension
yarn build

# Start watch mode for development
yarn watch
```

## Development Workflow

### Running the Extension

1. Press `F5` in VS Code to launch Extension Development Host
2. Open a SQL database connection
3. Right-click a database → "Design Schema" to open Schema Designer
4. Make changes to test diff viewer functionality

### Testing Specific Features

#### US1: Deleted Elements Visualization

1. Open Schema Designer
2. Delete a table from the canvas
3. Open the diff drawer (click "Show Changes" button)
4. **Verify**: Deleted table appears with red border
5. Close the drawer
6. **Verify**: Deleted table disappears from canvas
7. Reopen drawer
8. **Verify**: Deleted table reappears

#### US2: Undo Synchronization

1. Delete a table
2. Open diff drawer
3. Click "Undo" on the deletion item
4. **Verify**: 
   - Table is restored on canvas
   - Red border is removed
   - Drawer item disappears
   - Toolbar count decreases immediately

#### US3: Foreign Key Reveal

1. Add or modify a foreign key
2. Open diff drawer
3. Click "Reveal" button on FK item
4. **Verify**:
   - Canvas pans to center the FK edge
   - Edge receives glowing highlight animation

#### US4: Table Rename Display

1. Edit a table and change its name or schema
2. Open diff drawer
3. Look at the table node on canvas
4. **Verify**: Old name shows with strikethrough, new name displayed next to it

#### US5: FK Modification Indicators

**Property Change Test**:
1. Edit a FK and change only its name or ON DELETE action
2. Open diff drawer
3. **Verify**: FK edge shows yellow/amber color

**Structural Change Test**:
1. Edit a FK and change its source or target column
2. Open diff drawer
3. **Verify**: 
   - Old relationship edge shows red
   - New relationship edge shows green

#### US6: Granular FK Entries

1. Create a new table with two foreign keys
2. Open diff drawer
3. **Verify**: 
   - One entry for the table (marked as "Added")
   - Two separate entries for each FK (marked as "Added")
4. Undo one FK
5. **Verify**: Only that FK is removed, table and other FK remain

## Build Commands

```bash
# Full build (required before testing)
yarn build

# Type checking only
yarn build:ts

# Lint source files
yarn lint src/ test/

# Run unit tests
yarn test

# Run specific tests (pattern matching)
yarn test --grep "DiffCalculator"

# Package extension for local testing
yarn package --online
```

## Key Files

| File | Purpose |
|------|---------|
| `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext.tsx` | State management for diff viewer |
| `src/reactviews/pages/SchemaDesigner/diffViewer/diffCalculator.ts` | Diff calculation logic |
| `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerIntegration.tsx` | Integration with Schema Designer |
| `src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx` | Table node rendering |
| `src/reactviews/pages/SchemaDesigner/graph/schemaDesignerForeignKeyEdge.tsx` | FK edge rendering |
| `src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx` | Main canvas component |
| `src/reactviews/pages/SchemaDesigner/diffViewer/diffViewer.css` | Diff viewer styles |
| `src/sharedInterfaces/schemaDesigner.ts` | TypeScript interfaces |

## Testing Checklist

### Manual Testing (Per User Story)

- [ ] **US1-1**: Deleted table visible with red border when drawer open
- [ ] **US1-2**: Deleted FK visible with red edge when drawer open  
- [ ] **US1-3**: Deleted elements hidden when drawer closes
- [ ] **US1-4**: Deleted table with FKs shows both as deleted
- [ ] **US2-1**: Undo restores table and removes red border
- [ ] **US2-2**: Undo restores FK and removes red edge
- [ ] **US2-3**: Toolbar count updates immediately after undo
- [ ] **US2-4**: Undone item removed from drawer list
- [ ] **US3-1**: FK reveal pans canvas to edge
- [ ] **US3-2**: Revealed FK shows glowing highlight
- [ ] **US4-1**: Renamed table shows old name with strikethrough
- [ ] **US4-2**: New name displayed next to old name
- [ ] **US5-1**: FK property change shows yellow edge
- [ ] **US5-2**: FK structural change shows red old + green new
- [ ] **US6-1**: New table with FKs shows separate entries
- [ ] **US6-2**: Can undo individual FKs without affecting table

### Automated Tests

```bash
# Run diff calculator tests
yarn test --grep "DiffCalculator"

# Run diff viewer context tests  
yarn test --grep "DiffViewerContext"

# Run all schema designer tests
yarn test --grep "SchemaDesigner"
```

## Debugging Tips

### React DevTools

1. Install React DevTools extension in Chrome/Edge
2. Open DevTools in Extension Development Host
3. Navigate to React tab to inspect component state

### Console Logging

Add temporary logs to trace state changes:

```typescript
// In diffViewerContext.tsx
useEffect(() => {
    console.log('Diff state changed:', {
        ghostNodes: ghostNodes.length,
        deletedTableIds: deletedTableIds.size,
        changeGroups: changeGroups.length
    });
}, [ghostNodes, deletedTableIds, changeGroups]);
```

### Breakpoints

Set breakpoints in:
- `recalculateDiff()` - to trace diff calculation
- `handleUndoChange()` - to trace undo logic
- `navigateToElement()` - to trace reveal/navigation

## Common Issues

### Issue: Deleted tables not appearing

**Check**: 
- Is `showCanvasIndicators` true when drawer is open?
- Is the table ID in `deletedTableIds` set?
- Is ghost node injection happening in `SchemaDiagramFlow`?

### Issue: Undo not updating UI

**Check**:
- Is `eventBus.emit('pushState')` being called after undo?
- Is `SchemaChangeListener` component mounted?
- Is the 150ms delay appropriate?

### Issue: FK highlight not visible

**Check**:
- Is `highlightedElementId` set to the FK ID?
- Is `highlightedElementType` set to 'foreignKey'?
- Does `.schema-edge--revealed` CSS exist and have visible styling?

## Success Metrics

Per spec success criteria, verify:

- **SC-001**: Deleted elements visible with red styling ✓
- **SC-002**: Undo updates within 200ms ✓
- **SC-003**: FK reveal highlights within 500ms ✓
- **SC-004**: Rename shows both names clearly ✓
- **SC-005**: FK changes show correct colors ✓
- **SC-006**: N FKs = N+1 drawer entries ✓
- **SC-007**: All unit tests pass ✓
- **SC-008**: Build and lint pass ✓
