# Data Model: Schema Diff Viewer

**Feature**: 001-schema-diff-viewer  
**Date**: 2026-01-21  
**Source**: Extracted from spec.md Key Entities and research.md decisions

## Entity Definitions

### SchemaChangeType (Enum)

Categorizes the type of change made to a schema element.

```typescript
enum SchemaChangeType {
    Addition = "addition",      // New element added
    Modification = "modification", // Existing element changed
    Deletion = "deletion"       // Element removed
}
```

### SchemaEntityType (Enum)

Identifies what kind of schema element was changed.

```typescript
enum SchemaEntityType {
    Table = "table",
    Column = "column",
    ForeignKey = "foreignKey"
}
```

### SchemaChange

Represents a single change to the schema. This is the core entity for the diff viewer.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for this change (UUID) |
| changeType | SchemaChangeType | Addition, Modification, or Deletion |
| entityType | SchemaEntityType | Table, Column, or ForeignKey |
| tableId | string | ID of the table this change belongs to |
| tableName | string | Display name of the table (e.g., "dbo.Users") |
| entityId | string | ID of the specific entity changed (table ID, column ID, or FK ID) |
| entityName | string | Name of the changed entity for display |
| previousValue | object \| null | Original state before change (null for additions) |
| currentValue | object \| null | New state after change (null for deletions) |
| description | string | Human-readable description of the change |

**Validation Rules**:
- `id` must be unique across all changes
- `changeType` must be one of the enum values
- `entityType` must be one of the enum values
- `tableId` must reference an existing table
- For `Addition`: `previousValue` is null, `currentValue` is required
- For `Deletion`: `previousValue` is required, `currentValue` is null
- For `Modification`: both `previousValue` and `currentValue` are required

**State Transitions**: None (immutable once created during diff calculation)

### ChangeGroup

Groups changes by table for hierarchical display in the drawer.

| Field | Type | Description |
|-------|------|-------------|
| tableId | string | ID of the table |
| tableName | string | Display name (schema.table format) |
| schemaName | string | Schema name (e.g., "dbo") |
| aggregateState | SchemaChangeType | Overall state: Addition if table is new, Deletion if dropped, Modification otherwise |
| changes | SchemaChange[] | List of individual changes to this table |
| isExpanded | boolean | UI state: whether the group is expanded |

**Validation Rules**:
- `tableId` must be unique across all groups
- `changes` array must not be empty
- `aggregateState` is computed:
  - If all changes are additions and table didn't exist: `Addition`
  - If table existed and all changes are deletions and no items remain: `Deletion`
  - Otherwise: `Modification`

### DiffViewerState

Represents the current state of the diff viewer panel (UI state).

| Field | Type | Description |
|-------|------|-------------|
| isDrawerOpen | boolean | Whether the drawer is visible |
| drawerWidth | number | Current width in pixels (persisted) |
| selectedChangeId | string \| null | Currently selected change for navigation |
| changeGroups | ChangeGroup[] | Computed groups of changes |
| showCanvasIndicators | boolean | Whether to show visual indicators on canvas |

**Persistence**:
- `drawerWidth` persisted to VS Code workspace state
- Other fields are ephemeral (reset on session close)

### ChangeCountSummary

Lightweight summary for toolbar display (tracked incrementally).

| Field | Type | Description |
|-------|------|-------------|
| additions | number | Count of new elements |
| modifications | number | Count of modified elements |
| deletions | number | Count of deleted elements |
| total | number | Sum of all changes |

**Computed**: `total = additions + modifications + deletions`

## Entity Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                      DiffViewerState                        │
│  ┌─────────────────┐   ┌──────────────────────────────────┐ │
│  │ ChangeCountSummary│   │        ChangeGroup[]            │ │
│  │ (toolbar display) │   │  ┌──────────────────────────┐  │ │
│  │ - additions: 5   │   │  │ Table: dbo.Users         │  │ │
│  │ - modifications: 3│   │  │ aggregateState: Modified │  │ │
│  │ - deletions: 1   │   │  │ ┌────────────────────┐   │  │ │
│  │ - total: 9       │   │  │ │ SchemaChange       │   │  │ │
│  └─────────────────┘   │  │ │ - Add column Email │   │  │ │
│                        │  │ │ - Modify column Id │   │  │ │
│                        │  │ └────────────────────┘   │  │ │
│                        │  └──────────────────────────┘  │ │
│                        │  ┌──────────────────────────┐  │ │
│                        │  │ Table: dbo.Orders       │  │ │
│                        │  │ aggregateState: Added   │  │ │
│                        │  │ ┌────────────────────┐   │  │ │
│                        │  │ │ SchemaChange       │   │  │ │
│                        │  │ │ - Add table        │   │  │ │
│                        │  │ └────────────────────┘   │  │ │
│                        │  └──────────────────────────┘  │ │
│                        └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Integration with Existing Schema Designer Entities

The diff viewer entities relate to existing Schema Designer types:

| Existing Entity | Relationship | Description |
|-----------------|--------------|-------------|
| `SchemaDesigner.Schema` | Input | Original schema (session start) and current schema (from ReactFlow) |
| `SchemaDesigner.Table` | Compared | Table additions, modifications, deletions |
| `SchemaDesigner.Column` | Compared | Column-level changes within tables |
| `SchemaDesigner.ForeignKey` | Compared | Foreign key relationship changes |
| `UndoRedoStack` | Sibling | Separate from diff tracking; undo stack is for canvas operations |

## Sample Data

### Example SchemaChange (Column Addition)

```json
{
  "id": "change-uuid-1",
  "changeType": "addition",
  "entityType": "column",
  "tableId": "table-uuid-users",
  "tableName": "dbo.Users",
  "entityId": "column-uuid-email",
  "entityName": "Email",
  "previousValue": null,
  "currentValue": {
    "name": "Email",
    "dataType": "nvarchar",
    "maxLength": "255",
    "isNullable": true,
    "isPrimaryKey": false
  },
  "description": "Added column 'Email' (nvarchar(255))"
}
```

### Example SchemaChange (Column Modification)

```json
{
  "id": "change-uuid-2",
  "changeType": "modification",
  "entityType": "column",
  "tableId": "table-uuid-users",
  "tableName": "dbo.Users",
  "entityId": "column-uuid-name",
  "entityName": "Name",
  "previousValue": {
    "name": "Name",
    "dataType": "nvarchar",
    "maxLength": "50"
  },
  "currentValue": {
    "name": "Name",
    "dataType": "nvarchar",
    "maxLength": "100"
  },
  "description": "Modified column 'Name': maxLength changed from 50 to 100"
}
```

### Example ChangeGroup

```json
{
  "tableId": "table-uuid-users",
  "tableName": "dbo.Users",
  "schemaName": "dbo",
  "aggregateState": "modification",
  "changes": [
    { "id": "change-uuid-1", "changeType": "addition", "..." },
    { "id": "change-uuid-2", "changeType": "modification", "..." }
  ],
  "isExpanded": true
}
```
