# Data Model: Fix Diff Viewer Bugs

**Feature**: 002-fix-diff-viewer-bugs | **Date**: 2026-01-21

## Overview

This is primarily a bug fix feature with minimal data model changes. The core entities (ChangeCountTracker, DiffViewerContext, SchemaChange, ChangeGroup) remain unchanged. This document captures the data structure additions needed for new requirements.

## Extended Entity: TableNodeData

For FR-010 (column-level indicators), table node data needs to track per-column change types.

```typescript
interface TableNodeData {
  // ... existing fields
  
  /** Map of column name to change type for diff visualization */
  columnChangeTypes?: Map<string, SchemaChangeType>;
}
```

## Extended Entity: EdgeData

For FR-012 (foreign key indicators), edge data needs change type information.

```typescript
interface EdgeData {
  // ... existing fields
  
  /** Change type for diff visualization (null if no change) */
  changeType?: SchemaChangeType | null;
}
```

## New Type: DiffViewerOptionalContext

For FR-003 (safe context handling), the context type needs an optional variant.

```typescript
/** Used by components that may render outside DiffViewerProvider */
type DiffViewerOptionalContext = DiffViewerContextValue | null;
```

## State Tracking: Deleted Elements

For FR-011 (deleted tables) and FR-012 (deleted foreign keys), the diff state needs to preserve deleted elements.

```typescript
interface DiffViewerState {
  // ... existing fields
  
  /** Table IDs that exist in original but not current schema */
  deletedTableIds: string[];
  
  /** Foreign key IDs that exist in original but not current schema */
  deletedForeignKeyIds: string[];
}
```

## Validation Rules

1. `columnChangeTypes` keys MUST match column names in table
2. `deletedTableIds` MUST reference valid table IDs from original schema
3. `deletedForeignKeyIds` MUST reference valid foreign key IDs from original schema
4. Change types MUST be one of: "Addition" | "Modification" | "Deletion"
