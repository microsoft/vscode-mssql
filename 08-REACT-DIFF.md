# 08 — React Views: Diff Engine & Changes Panel

> **Files covered — Diff Engine:**
> - [diffUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/diffUtils.ts) — Core diff algorithm
> - [schemaDiff.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/schemaDiff.ts) — Human-readable change descriptions
> - [diffHighlights.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/diffHighlights.ts) — CSS highlight sets from diffs
> - [deletedVisualUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/deletedVisualUtils.ts) — Ghost nodes/edges for deleted items
> - [revertChange.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/revertChange.ts) — Undo individual changes
>
> **Files covered — Changes Panel UI:**
> - [changesPanel.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesPanel.tsx)
> - [changesTree.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesTree.tsx)
> - [changesHeader.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesHeader.tsx)
> - [changesFilters.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesFilters.tsx)
> - [changesFilterButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesFilterButton.tsx)
> - [changesEmptyState.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changesEmptyState.tsx)
> - [changeDetailsPopover.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/changeDetailsPopover.tsx)

This section covers **two responsibilities**: the diff algorithm that detects what changed, and the UI that displays those changes.

---

## Part 1: Diff Engine

### `diffUtils.ts` — Core Diff Algorithm

This file compares an "original" (baseline) schema against the "current" (modified) schema and produces a structured list of changes.

#### Core Types

```typescript
enum ChangeAction {
    Added = "added",
    Modified = "modified", 
    Deleted = "deleted",
}

enum ChangeCategory {
    Table = "table",
    Column = "column",
    ForeignKey = "foreignKey",
}

interface SchemaDiffChange {
    action: ChangeAction;
    category: ChangeCategory;
    tableName: string;
    tableSchema: string;
    itemName?: string;          // Column or FK name (for non-table changes)
    originalItem?: any;         // The original version (for modified/deleted)
    currentItem?: any;          // The current version (for added/modified)
    propertyChanges?: PropertyChange[];  // Property-level diffs (name, type, etc.)
}

interface PropertyChange {
    property: string;
    oldValue: any;
    newValue: any;
}
```

#### `calculateSchemaDiff(original, current)` — Main Function

```typescript
export function calculateSchemaDiff(
    originalSchema: SchemaDesignerSchema,
    currentSchema: SchemaDesignerSchema,
): SchemaDiffChange[] {
    const changes: SchemaDiffChange[] = [];

    // 1. Build lookup maps by table ID
    const originalTablesById = new Map(original.tables.map(t => [t.id, t]));
    const currentTablesById = new Map(current.tables.map(t => [t.id, t]));
    
    // 2. Check for ADDED tables (in current but not in original)
    for (const [id, table] of currentTablesById) {
        if (!originalTablesById.has(id)) {
            changes.push({
                action: ChangeAction.Added,
                category: ChangeCategory.Table,
                tableName: table.name,
                tableSchema: table.schema,
                currentItem: table,
            });
        }
    }
    
    // 3. Check for DELETED tables (in original but not in current)
    for (const [id, table] of originalTablesById) {
        if (!currentTablesById.has(id)) {
            changes.push({
                action: ChangeAction.Deleted,
                category: ChangeCategory.Table,
                tableName: table.name,
                tableSchema: table.schema,
                originalItem: table,
            });
        }
    }
    
    // 4. Check for MODIFIED tables (in both)
    for (const [id, originalTable] of originalTablesById) {
        const currentTable = currentTablesById.get(id);
        if (!currentTable) continue;
        
        // 4a. Table-level property changes (name, schema)
        const tablePropertyChanges = diffTableProperties(originalTable, currentTable);
        if (tablePropertyChanges.length > 0) {
            changes.push({ action: ChangeAction.Modified, category: ChangeCategory.Table, ... });
        }
        
        // 4b. Column-level changes
        diffColumns(originalTable, currentTable, changes);
        
        // 4c. Foreign key-level changes
        diffForeignKeys(originalTable, currentTable, changes);
    }
    
    return changes;
}
```

#### Column Diffing

```typescript
function diffColumns(original, current, changes) {
    const originalById = new Map(original.columns.map(c => [c.id, c]));
    const currentById = new Map(current.columns.map(c => [c.id, c]));
    
    // Added columns
    for (const [id, col] of currentById) {
        if (!originalById.has(id)) {
            changes.push({ action: Added, category: Column, itemName: col.name, ... });
        }
    }
    
    // Deleted columns
    for (const [id, col] of originalById) {
        if (!currentById.has(id)) {
            changes.push({ action: Deleted, category: Column, itemName: col.name, ... });
        }
    }
    
    // Modified columns (property-level comparison)
    for (const [id, originalCol] of originalById) {
        const currentCol = currentById.get(id);
        if (!currentCol) continue;
        
        const propertyChanges = [];
        if (originalCol.name !== currentCol.name) 
            propertyChanges.push({ property: "name", oldValue: originalCol.name, newValue: currentCol.name });
        if (originalCol.dataType !== currentCol.dataType) 
            propertyChanges.push({ property: "dataType", oldValue: originalCol.dataType, newValue: currentCol.dataType });
        // ... isPrimaryKey, isNullable, isIdentity, defaultValue, length, precision, scale
        
        if (propertyChanges.length > 0) {
            changes.push({ action: Modified, category: Column, propertyChanges, ... });
        }
    }
}
```

Properties compared for each column: `name`, `dataType`, `isPrimaryKey`, `isNullable`, `isIdentity`, `defaultValue`, `length`, `precision`, `scale`.

#### FK Diffing

Same pattern as column diffing but compares: `name`, `columns`, `referencedSchemaName`, `referencedTableName`, `referencedColumns`, `onDeleteAction`, `onUpdateAction`.

For array properties like `columns` and `referencedColumns`, a deep comparison (via `lodash.isEqual`) is used.

---

### `schemaDiff.ts` — Human-Readable Change Descriptions

Converts raw `SchemaDiffChange` objects into user-friendly text descriptions.

```typescript
export function getChangeDescription(change: SchemaDiffChange): string {
    switch (change.category) {
        case ChangeCategory.Table:
            switch (change.action) {
                case ChangeAction.Added:
                    return `Added table '${change.tableSchema}.${change.tableName}'`;
                case ChangeAction.Deleted:
                    return `Deleted table '${change.tableSchema}.${change.tableName}'`;
                case ChangeAction.Modified:
                    return `Modified table '${change.tableSchema}.${change.tableName}'`;
            }
        case ChangeCategory.Column:
            // "Added column 'Email' to table 'dbo.Users'"
            // "Modified column 'Name' in table 'dbo.Users': type changed from 'varchar(50)' to 'nvarchar(100)'"
            // ...
    }
}
```

For modified items, it also lists which properties changed:
> "Modified column 'Name': name changed from 'FirstName' to 'Name', type changed from 'varchar(50)' to 'nvarchar(100)'"

---

### `diffHighlights.ts` — Extract Highlight Sets

Converts the diff results into Sets of IDs that the graph layer uses for highlight CSS classes.

```typescript
export function extractDiffHighlights(changes: SchemaDiffChange[]): DiffHighlightSets {
    const newTableIds = new Set<string>();
    const modifiedTableIds = new Set<string>();
    const deletedTableIds = new Set<string>();
    const newColumnIds = new Set<string>();
    const modifiedColumnIds = new Set<string>();
    const deletedColumnIds = new Set<string>();
    const newForeignKeyIds = new Set<string>();
    const modifiedForeignKeyIds = new Set<string>();
    const deletedForeignKeyIds = new Set<string>();
    
    for (const change of changes) {
        switch (change.action) {
            case ChangeAction.Added:
                if (change.category === ChangeCategory.Table) 
                    newTableIds.add(change.currentItem.id);
                else if (change.category === ChangeCategory.Column)
                    newColumnIds.add(change.currentItem.id);
                // ...
        }
    }
    
    return { newTableIds, modifiedTableIds, deletedTableIds, ... };
}
```

These sets are stored in `SchemaDesignerContext` and read by:
- `schemaDesignerTableNode.tsx` — For row-level highlights (green/yellow/red column rows)
- `SchemaDiagramFlow.tsx` — For edge highlights (green/yellow FK edges)

---

### `deletedVisualUtils.ts` — Ghost Nodes & Edges

When diff highlighting is active, deleted tables and FKs need to be **shown** even though they no longer exist in the current schema. This file creates "ghost" visual representations.

```typescript
export function createDeletedTableNodes(
    changes: SchemaDiffChange[],
    existingNodePositions: Map<string, Position>,
): Node[] {
    const deletedTableChanges = changes.filter(
        c => c.action === ChangeAction.Deleted && c.category === ChangeCategory.Table
    );
    
    return deletedTableChanges.map(change => ({
        id: change.originalItem.id,
        type: "schemaDesignerTable",
        position: existingNodePositions.get(change.originalItem.id) ?? { x: 0, y: 0 },
        data: {
            ...change.originalItem,
            isDeleted: true,  // Flag for ghost styling
        },
        selectable: false,
        draggable: false,
    }));
}
```

Ghost table nodes:
- Use the original table's position (or `{0,0}` if unknown)
- Are flagged with `isDeleted: true` for CSS styling (redish semi-transparent overlay)
- Are non-selectable and non-draggable

```typescript
export function createDeletedForeignKeyEdges(
    changes: SchemaDiffChange[],
): Edge[] {
    const deletedFKChanges = changes.filter(
        c => c.action === ChangeAction.Deleted && c.category === ChangeCategory.ForeignKey
    );
    
    return deletedFKChanges.map(change => ({
        id: `deleted-${change.originalItem.id}`,
        source: change.originalItem.sourceTableId,
        target: change.originalItem.targetTableId,
        className: "schema-designer-edge-deleted",  // Dashed red line
        selectable: false,
        data: { isDeleted: true },
    }));
}
```

Ghost FK edges appear as dashed red lines connecting the relevant tables.

---

### `revertChange.ts` — Undo Individual Changes

Allows users to revert a single change without undoing everything.

```typescript
export function revertChange(
    change: SchemaDiffChange,
    currentSchema: SchemaDesignerSchema,
    originalSchema: SchemaDesignerSchema,
): SchemaDesignerSchema {
    switch (change.action) {
        case ChangeAction.Added:
            // Remove the added item
            if (change.category === ChangeCategory.Table) {
                return {
                    ...currentSchema,
                    tables: currentSchema.tables.filter(t => t.id !== change.currentItem.id),
                };
            }
            if (change.category === ChangeCategory.Column) {
                // Remove the added column from its table
                return removeColumnFromTable(currentSchema, change);
            }
            // ...
            
        case ChangeAction.Deleted:
            // Restore the deleted item
            if (change.category === ChangeCategory.Table) {
                return {
                    ...currentSchema,
                    tables: [...currentSchema.tables, change.originalItem],
                };
            }
            // ...
            
        case ChangeAction.Modified:
            // Replace the current item with the original
            if (change.category === ChangeCategory.Column) {
                return replaceColumnInTable(currentSchema, change.originalItem);
            }
            // ...
    }
}
```

Each action type has a reverse:
| Action | Revert Strategy |
|--------|----------------|
| Added | Remove the item from current schema |
| Deleted | Restore the original item back into current schema |
| Modified | Replace current version with original version |

---

## Part 2: Changes Panel UI

### `changesPanel.tsx` — Panel Container

The Changes Panel is a **slide-in panel** that appears at the bottom or side of the graph. It shows a list of all detected changes.

```tsx
<Panel>
    <ChangesHeader changeCount={changes.length} />
    <ChangesFilters 
        actionFilter={actionFilter} 
        categoryFilter={categoryFilter}
        onActionFilterChange={setActionFilter}
        onCategoryFilterChange={setCategoryFilter}
    />
    {filteredChanges.length === 0 ? (
        <ChangesEmptyState />
    ) : (
        <ChangesTree changes={filteredChanges} onRevert={handleRevert} />
    )}
</Panel>
```

### `changesHeader.tsx`

Displays the panel title with a count badge:
```
Changes (12)
```

### `changesFilters.tsx` & `changesFilterButton.tsx` — Filtering

Two filter dimensions:
1. **By Action** — Added / Modified / Deleted (toggle buttons)
2. **By Category** — Tables / Columns / Foreign Keys (toggle buttons)

```tsx
<ToggleButton checked={showAdded} onClick={toggleAdded}>
    <AddCircle16Regular /> Added
</ToggleButton>
<ToggleButton checked={showModified} onClick={toggleModified}>
    <Edit16Regular /> Modified
</ToggleButton>
<ToggleButton checked={showDeleted} onClick={toggleDeleted}>
    <Delete16Regular /> Deleted
</ToggleButton>
```

Filters are combined with AND logic: if "Added" + "Columns" are selected, only added columns are shown.

### `changesTree.tsx` — Change List

Renders changes as a flat tree (list) using Fluent UI's `FlatTree` component.

Each row shows:
- **Icon** — Color-coded by action (green ➕, yellow ✏️, red ❌)
- **Description** — Human-readable text from `schemaDiff.ts`
- **Badge** — Shows the action type
- **Revert button** — Undo this individual change
- **Details popover** — Click to see property-level diff

```tsx
<TreeItem>
    <TreeItemLayout
        iconBefore={getActionIcon(change.action)}
        actions={
            <>
                <Button icon={<ArrowUndo16Regular />} onClick={() => onRevert(change)} />
                <ChangeDetailsPopover change={change} />
            </>
        }
    >
        {getChangeDescription(change)}
    </TreeItemLayout>
</TreeItem>
```

### `changeDetailsPopover.tsx` — Property Diff Popover

When a change has `propertyChanges`, clicking it opens a popover showing the exact diff:

```
┌──────────────────────────────────────────┐
│  Column: Email                           │
│                                          │
│  Property    Old Value     New Value     │
│  ─────────   ──────────   ──────────    │
│  dataType    varchar(50)   nvarchar(100) │
│  isNullable  true          false         │
│  length      50            100           │
└──────────────────────────────────────────┘
```

### `changesEmptyState.tsx`

Shown when there are no changes (or no changes match the current filters):

```tsx
<div className={classes.emptyState}>
    <BranchCompare24Regular />
    <Text>No changes detected</Text>
</div>
```

---

## Data Flow: How Diffs Are Calculated and Displayed

```
User makes edits → schema changes
        │
        ▼
context.showChangesHighlight toggled ON
        │
        ▼
calculateSchemaDiff(originalSchema, currentSchema)
        │
        ▼
SchemaDiffChange[]  ←── Raw diff results
        │
        ├───▶ extractDiffHighlights() → Sets of IDs
        │         │
        │         ▼
        │     schemaDesignerTableNode.tsx reads Sets
        │     SchemaDiagramFlow.tsx reads Sets
        │         │
        │         ▼
        │     Green/Yellow/Red highlights on graph
        │
        ├───▶ createDeletedTableNodes() → Ghost nodes
        │     createDeletedForeignKeyEdges() → Ghost edges
        │         │
        │         ▼
        │     Merged into displayNodes / displayEdges
        │
        └───▶ getChangeDescription() → Text labels
              changesPanel.tsx → List of changes
              changeDetailsPopover.tsx → Property diffs
```
