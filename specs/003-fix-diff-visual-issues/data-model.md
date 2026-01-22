# Data Model: Fix Diff Viewer Visual Issues

**Feature**: 003-fix-diff-visual-issues | **Date**: 2026-01-21

## Overview

This document defines the data structures required to support column-level change indicators and reveal highlight functionality in the Schema Designer Diff Viewer.

## Entity Definitions

### 1. ColumnChangeMap

**Purpose**: Maps column names to their change types within a specific table.

```typescript
/**
 * Maps column names to their change type for a single table.
 * Used by useColumnDiffIndicator hook to determine indicator color.
 */
export interface ColumnChangeMap {
    [columnName: string]: SchemaDesigner.SchemaChangeType;
}
```

**Validation Rules**:
- Keys must be valid column names (non-empty strings)
- Values must be one of: `Addition`, `Modification`, `Deletion`

**State Transitions**: N/A (read-only from diff calculation)

---

### 2. TableColumnChanges

**Purpose**: Aggregates column changes across all tables in the schema.

```typescript
/**
 * Maps table IDs to their column change maps.
 * Stored in DiffViewerState for efficient lookup.
 */
export interface TableColumnChanges {
    [tableId: string]: ColumnChangeMap;
}
```

**Validation Rules**:
- Keys must be valid table IDs (UUID format)
- Values must be valid ColumnChangeMap objects

**State Transitions**: N/A (recalculated on each diff)

---

### 3. DeletedColumnInfo

**Purpose**: Preserves metadata for columns that were deleted from a table.

```typescript
/**
 * Information about a deleted column needed for inline display.
 * Includes original position to maintain visual ordering.
 */
export interface DeletedColumnInfo {
    /** Column name (for display) */
    name: string;
    /** Data type (for display in column list) */
    dataType: string;
    /** Whether this was a primary key column */
    isPrimaryKey: boolean;
    /** Original index in the column array (for sorting) */
    originalIndex: number;
}
```

**Validation Rules**:
- `name` must be non-empty string
- `dataType` must be valid SQL data type string
- `originalIndex` must be non-negative integer

**State Transitions**: N/A (captured from original schema)

---

### 4. DeletedColumnsMap

**Purpose**: Aggregates deleted columns across all tables.

```typescript
/**
 * Maps table IDs to arrays of their deleted columns.
 * Used to render deleted columns inline in table nodes.
 */
export interface DeletedColumnsMap {
    [tableId: string]: DeletedColumnInfo[];
}
```

**Validation Rules**:
- Keys must be valid table IDs
- Arrays should be sorted by `originalIndex`

**State Transitions**: N/A (recalculated on each diff)

---

### 5. ColumnDiffIndicator (Hook Return Type)

**Purpose**: Return type for the `useColumnDiffIndicator` hook.

```typescript
/**
 * Diff indicator state for a single column.
 * Returned by useColumnDiffIndicator hook.
 */
export interface ColumnDiffIndicator {
    /** Whether to show the indicator dot */
    showIndicator: boolean;
    /** The change type (determines color) */
    changeType: SchemaDesigner.SchemaChangeType | undefined;
}
```

---

### 6. RevealHighlightState

**Purpose**: Manages the currently highlighted element for reveal animations.

```typescript
/**
 * State for managing reveal highlight animations.
 * Only one element can be highlighted at a time.
 */
export interface RevealHighlightState {
    /** ID of the currently highlighted element (table or FK) */
    highlightedElementId: string | null;
    /** Type of element being highlighted */
    highlightedElementType: 'table' | 'foreignKey' | null;
}
```

**Validation Rules**:
- If `highlightedElementId` is null, `highlightedElementType` must also be null
- IDs must reference valid entities when set

**State Transitions**:
- `null → highlighted`: When reveal button clicked
- `highlighted → null`: When animation completes (~1 second)
- `highlighted → different highlight`: When new reveal clicked (clears previous)

---

## Extended DiffViewerState

The following fields will be added to the existing `SchemaDesigner.DiffViewerState` interface:

```typescript
interface DiffViewerState {
    // ... existing fields ...
    
    /** Column-level changes by table ID */
    tableColumnChanges: TableColumnChanges;
    
    /** Deleted columns by table ID (for inline display) */
    deletedColumns: DeletedColumnsMap;
    
    /** Currently highlighted element for reveal animation */
    revealHighlight: RevealHighlightState;
}
```

## Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                     DiffViewerState                              │
├─────────────────────────────────────────────────────────────────┤
│ changeGroups: ChangeGroup[]                                      │
│ deletedTableIds: Set<string>                                     │
│ deletedForeignKeyIds: Set<string>                                │
│ tableColumnChanges: TableColumnChanges  ◄── NEW                  │
│ deletedColumns: DeletedColumnsMap       ◄── NEW                  │
│ revealHighlight: RevealHighlightState   ◄── NEW                  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ computed from
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DiffCalculator                               │
├─────────────────────────────────────────────────────────────────┤
│ calculateDiff(original, current) → DiffResult                    │
│                                                                  │
│ DiffResult now includes:                                         │
│   - tableColumnChanges                                           │
│   - deletedColumns                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Index Strategy

**No database indices required** - All data is in-memory React state.

**Lookup optimization**:
- `TableColumnChanges` uses object/Map for O(1) table lookup
- `ColumnChangeMap` uses object/Map for O(1) column lookup
- Combined lookup is O(1) for any specific column

## Migration Notes

**No data migration required** - These are new fields added to existing in-memory state structures. Existing diff calculations will be extended to populate these fields.

**Backward compatibility**: All new fields are optional with sensible defaults (empty maps/null). Components not using column indicators will continue to work unchanged.
