# Research: Fix Diff View Bugs

**Feature**: 004-fix-diff-view-bugs  
**Date**: 2026-01-22

## Executive Summary

This document captures research findings for implementing diff viewer bug fixes in the Schema Designer. The feature addresses visualization of deleted elements, undo synchronization, FK reveal functionality, table rename display, FK modification indicators, and granular drawer entries.

## Technology Context

| Aspect | Current State | Notes |
|--------|---------------|-------|
| Language | TypeScript 5.x | Strict mode enabled |
| UI Framework | React 18+ | Functional components with hooks |
| Component Library | @fluentui/react-components | VS Code-aligned styling |
| Canvas Library | @xyflow/react (ReactFlow) | Node/edge visualization |
| State Management | React Context + useState | DiffViewerContext.tsx |
| Testing | Jest + React Testing Library | Unit tests in test/unit/ |

## Existing Architecture Analysis

### DiffViewerContext Structure

The diff viewer state is managed through `DiffViewerContext.tsx` which provides:

```typescript
interface DiffViewerState {
    isDrawerOpen: boolean;
    drawerWidth: number;
    selectedChangeId: string | undefined;
    changeGroups: ChangeGroup[];
    showCanvasIndicators: boolean;
    changeCounts: ChangeCountSummary;
    deletedTableIds: Set<string>;
    deletedForeignKeyIds: Set<string>;
    tableColumnChanges: { [tableId: string]: { [columnName: string]: SchemaChangeType } };
    deletedColumns: { [tableId: string]: DeletedColumnInfo[] };
    highlightedElementId: string | null;
    highlightedElementType: "table" | "foreignKey" | null;
}
```

### Current Capabilities

1. **Deleted tables/FKs tracking**: `deletedTableIds` and `deletedForeignKeyIds` are populated during `recalculateDiff()`
2. **Undo mechanism**: `handleUndoChange()` in `diffViewerIntegration.tsx` handles restore logic
3. **Navigation**: `handleNavigateToEntity()` centers canvas on tables or edges
4. **Reveal highlight**: `highlightedElementId/Type` with animation support

### Gap Analysis

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| FR-001: Deleted tables visible | deletedTableIds tracked | Canvas doesn't render deleted tables |
| FR-002: Deleted FKs visible | deletedForeignKeyIds tracked | Canvas doesn't render deleted FK edges |
| FR-003: Hide on drawer close | showCanvasIndicators flag exists | Need to filter deleted elements |
| FR-004: Undo restores properly | Basic undo exists | Need recalculation trigger |
| FR-005: Immediate UI sync | Events exist | Need to ensure all components subscribe |
| FR-006: FK reveal/focus | Navigation works | Edge highlight needs styling |
| FR-007: Table rename display | Name change detected | No strikethrough UI |
| FR-008: FK property → yellow | FK modification detected | No yellow edge styling |
| FR-009: FK structural → red/green | Not distinguished | Need separate old/new edges |
| FR-010: Granular FK entries | All changes tracked | FKs grouped with table |

## Design Decisions

### Decision 1: Deleted Element Rendering

**Chosen Approach**: Render deleted tables/FKs as "ghost" nodes/edges when drawer is open

**Rationale**: 
- Users need to see what will be removed
- ReactFlow supports adding/removing nodes dynamically
- Can use opacity + red border for deleted styling

**Implementation**:
1. When drawer opens, inject deleted tables from `originalSchema` into ReactFlow nodes
2. Apply `.schema-node--deleted` class for styling
3. When drawer closes, remove injected nodes

### Decision 2: FK Structural vs Property Changes

**Chosen Approach**: Track modification type in `SchemaChange` metadata

**Rationale**:
- Need to distinguish between:
  - Property changes (name, onDelete, onUpdate) → single yellow edge
  - Structural changes (columns, referencedColumns) → old red + new green edges

**Implementation**:
1. Extend `SchemaChange` with `modificationDetails?: { isStructural: boolean }`
2. In `compareForeignKeys()`, check if columns/referencedColumns changed
3. For structural changes, create two change entries (deletion + addition)

### Decision 3: Table Rename Visualization

**Chosen Approach**: Conditional rendering in `TableHeader` component

**Rationale**:
- Header already shows `schema.name`
- Can detect rename from change data and show both

**Implementation**:
1. Pass rename info to `SchemaDesignerTableNode` via data prop
2. In `TableHeader`, check for rename and render:
   - `<s>old.name</s> → new.name`

### Decision 4: Granular FK Entries

**Chosen Approach**: Already implemented - FKs are separate entries

**Verification Needed**: 
- Check if new tables with FKs create separate entries
- May need to ensure FK changes aren't aggregated into table change

## Technical Patterns

### Pattern: Ghost Node Injection

```typescript
// When drawer opens, inject deleted tables
const injectDeletedTables = (originalTables: Table[], currentTableIds: Set<string>) => {
    const deletedTables = originalTables.filter(t => !currentTableIds.has(t.id));
    return deletedTables.map(t => ({
        ...createNodeFromTable(t),
        data: { ...t, isDeleted: true },
        className: 'schema-node--deleted'
    }));
};
```

### Pattern: Edge Styling by Change Type

```typescript
// In useStyledEdgesForDiff hook
const getEdgeStyleForChange = (change: SchemaChange) => {
    if (change.changeType === SchemaChangeType.Deletion) {
        return { stroke: 'var(--vscode-gitDecoration-deletedResourceForeground)' };
    }
    if (change.changeType === SchemaChangeType.Addition) {
        return { stroke: 'var(--vscode-gitDecoration-addedResourceForeground)' };
    }
    if (change.changeType === SchemaChangeType.Modification) {
        return { stroke: 'var(--vscode-gitDecoration-modifiedResourceForeground)' };
    }
};
```

### Pattern: Rename Visualization

```typescript
// In TableHeader component
const TableHeader = ({ table, renameInfo }) => {
    return (
        <div className={styles.tableHeader}>
            {renameInfo ? (
                <>
                    <span className="table-name--old">{renameInfo.oldName}</span>
                    <span className="table-name--new">{table.name}</span>
                </>
            ) : (
                <span>{table.name}</span>
            )}
        </div>
    );
};
```

## Files to Modify

| File | Purpose | Changes |
|------|---------|---------|
| `diffViewerContext.tsx` | State management | Add deleted element injection logic |
| `diffCalculator.ts` | Diff calculation | Add structural FK change detection |
| `schemaDesignerTableNode.tsx` | Table rendering | Add rename display, deleted styling |
| `schemaDesignerForeignKeyEdge.tsx` | Edge rendering | Support deleted/highlight styling |
| `SchemaDiagramFlow.tsx` | Canvas container | Inject/remove deleted nodes on drawer toggle |
| `diffViewer.css` | Styles | Add ghost node, rename, edge styles |
| `schemaDesigner.ts` | Interfaces | Extend change types |

## Testing Strategy

### Unit Tests
1. `diffCalculator.test.ts` - FK structural vs property detection
2. `diffViewerContext.test.ts` - Deleted element injection/removal

### Manual Testing
1. Delete a table → open drawer → verify ghost node visible
2. Undo deletion → verify ghost node removed, table restored
3. Rename table → verify strikethrough old + new name
4. Modify FK columns → verify red old + green new edges
5. Create table with FKs → verify separate drawer entries

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Ghost nodes affect layout | Medium | Medium | Use same positions from original |
| Performance with many deleted items | Low | Low | Limit visible deleted items |
| Edge rendering complexity | Medium | Medium | Reuse existing edge component |

## References

- Existing specs: 001-schema-diff-viewer, 002-fix-diff-viewer-bugs, 003-fix-diff-visual-issues
- ReactFlow docs: https://reactflow.dev/docs/api/nodes/
- VS Code theming: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content
