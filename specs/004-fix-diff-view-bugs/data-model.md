# Data Model: Fix Diff View Bugs

**Feature**: 004-fix-diff-view-bugs  
**Date**: 2026-01-22

## Entity Overview

This feature extends the existing Schema Designer diff system with:
1. Ghost node/edge rendering for deleted elements
2. Structural vs property FK modification tracking
3. Rename visualization metadata
4. Enhanced undo synchronization

## Extended Interfaces

### SchemaChange Extension

Add metadata for FK structural changes:

```typescript
interface ForeignKeyModificationDetails {
    /** Whether the FK columns/references changed (structural) vs just properties */
    isStructural: boolean;
    /** Original FK state for structural changes */
    originalForeignKey?: SchemaDesigner.ForeignKey;
    /** For structural changes, the old edge ID to show as deleted */
    oldEdgeId?: string;
}

// Extend existing SchemaChange interface
interface SchemaChange {
    // ... existing fields
    
    /** Additional details for FK modifications */
    fkModificationDetails?: ForeignKeyModificationDetails;
}
```

### GhostNodeData

Data attached to deleted table nodes rendered on canvas:

```typescript
interface GhostNodeData extends SchemaDesigner.Table {
    /** Flag indicating this is a ghost (deleted) node */
    isGhostNode: true;
    /** Original position when deleted */
    originalPosition: { x: number; y: number };
}
```

### RenameDisplayInfo

Metadata for tables with name/schema changes:

```typescript
interface RenameDisplayInfo {
    /** Previous fully qualified name (schema.name) */
    oldDisplayName: string;
    /** Previous schema only */
    oldSchema: string;
    /** Previous name only */
    oldName: string;
    /** Whether schema changed */
    schemaChanged: boolean;
    /** Whether name changed */
    nameChanged: boolean;
}
```

### Extended DiffViewerState

Additional state fields for this feature:

```typescript
interface DiffViewerStateExtension {
    /** Tables to render as ghost nodes when drawer is open */
    ghostNodes: GhostNodeData[];
    /** FK edges to render as ghost (deleted) edges */
    ghostEdges: Array<{
        id: string;
        sourceTableId: string;
        targetTableId: string;
        fkData: SchemaDesigner.ForeignKey;
    }>;
    /** Rename info indexed by table ID */
    tableRenameInfo: { [tableId: string]: RenameDisplayInfo };
    /** FK modification type indexed by FK ID */
    fkModificationType: { [fkId: string]: 'property' | 'structural' };
}
```

## Data Flow

### Diff Calculation Flow

```
┌─────────────────────┐
│   Original Schema   │
│  (session start)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   DiffCalculator    │
│  calculateDiff()    │
│                     │
│  ┌───────────────┐  │
│  │ Compare Tables│──┼──► Detect: Added, Deleted, Renamed
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │Compare Columns│──┼──► Detect: Added, Deleted, Modified
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Compare FKs   │──┼──► Detect: Property vs Structural
│  └───────────────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ExtendedDiffResult  │
│                     │
│ • changes[]         │
│ • changeGroups[]    │
│ • ghostNodes[]      │ ◄─── NEW
│ • ghostEdges[]      │ ◄─── NEW
│ • tableRenameInfo{} │ ◄─── NEW
│ • fkModificationType│ ◄─── NEW
└─────────────────────┘
```

### Canvas Rendering Flow

```
┌─────────────────────────────────────────────────────────┐
│                   SchemaDiagramFlow                      │
│                                                          │
│  isDrawerOpen=true?                                      │
│        │                                                 │
│        ▼                                                 │
│  ┌─────────────────────────────────────────┐            │
│  │ Merge: existingNodes + ghostNodes        │            │
│  └─────────────────────────────────────────┘            │
│        │                                                 │
│        ▼                                                 │
│  ┌─────────────────────────────────────────┐            │
│  │ Merge: existingEdges + ghostEdges        │            │
│  │        + structuralFKOldEdges            │            │
│  └─────────────────────────────────────────┘            │
│        │                                                 │
│        ▼                                                 │
│  ┌─────────────────────────────────────────┐            │
│  │ ReactFlow renders all nodes/edges        │            │
│  └─────────────────────────────────────────┘            │
│                                                          │
│  isDrawerOpen=false?                                     │
│        │                                                 │
│        ▼                                                 │
│  ┌─────────────────────────────────────────┐            │
│  │ Remove: ghostNodes, ghostEdges           │            │
│  │ Reset: styling on restored elements      │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### Undo Synchronization Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Drawer Undo    │     │ State Provider  │     │   eventBus      │
│  Button Click   │────►│ handleUndo()    │────►│ emit('pushState')
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
         ┌───────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                SchemaChangeListener                      │
│                                                          │
│   on('pushState') ───► setTimeout(150ms) ───►           │
│                         recalculateDiff()                │
│                                │                         │
│                                ▼                         │
│   ┌─────────────────────────────────────────┐           │
│   │ Updates: changeGroups, changeCounts,     │           │
│   │          ghostNodes, ghostEdges,         │           │
│   │          tableRenameInfo                 │           │
│   └─────────────────────────────────────────┘           │
│                                │                         │
│                                ▼                         │
│   UI components re-render with new state                 │
└─────────────────────────────────────────────────────────┘
```

## State Transitions

### Deleted Table Lifecycle

```
State: TABLE_EXISTS
  │
  ├─[User deletes table]─► State: TABLE_DELETED_INVISIBLE
  │                              (deletedTableIds contains ID)
  │
  ├─[Open drawer]─────────► State: TABLE_DELETED_VISIBLE
  │                              (ghostNodes contains table)
  │                              (canvas shows red border)
  │
  ├─[Close drawer]────────► State: TABLE_DELETED_INVISIBLE
  │                              (ghostNodes empty)
  │
  └─[Undo delete]─────────► State: TABLE_EXISTS
                                 (deletedTableIds removes ID)
                                 (ghostNodes removes table)
```

### FK Modification Lifecycle

```
State: FK_UNCHANGED
  │
  ├─[Modify FK name/actions]────► State: FK_PROPERTY_MODIFIED
  │                                    (fkModificationType[id] = 'property')
  │                                    (edge shows yellow)
  │
  └─[Modify FK columns/refs]────► State: FK_STRUCTURAL_MODIFIED
                                       (fkModificationType[id] = 'structural')
                                       (old edge shows red)
                                       (new edge shows green)
```

## Validation Rules

1. **Ghost nodes must have valid positions**: If original position unknown, calculate from remaining nodes
2. **FK structural changes require both old and new**: Cannot show only red or only green
3. **Rename info must have at least one change**: Either schema or name must differ
4. **Undo must recalculate within 200ms**: Per SC-002 requirement

## Relationships

```
┌──────────────────────────────────────────────────────────────┐
│                        DiffViewerState                        │
├──────────────────────────────────────────────────────────────┤
│ changeGroups[]          ─────► Each group has tableId         │
│ ghostNodes[]            ─────► Each has isGhostNode: true     │
│ ghostEdges[]            ─────► References source/target tables│
│ tableRenameInfo{}       ─────► Keyed by tableId               │
│ fkModificationType{}    ─────► Keyed by fkId                  │
│ deletedTableIds         ─────► Set of table IDs               │
│ deletedForeignKeyIds    ─────► Set of FK IDs                  │
└──────────────────────────────────────────────────────────────┘
                                 │
                                 │ provides data to
                                 ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│SchemaDesignerNode│     │  ForeignKeyEdge  │     │   ChangeItem     │
│                  │     │                  │     │                  │
│ • Render ghost   │     │ • Render ghost   │     │ • Show undo btn  │
│ • Show rename    │     │ • Color by type  │     │ • Show reveal btn│
│ • Red border     │     │ • Highlight anim │     │ • Separate FK    │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```
