# 06 — React Views: Editor Drawer

> **Files covered:**
> - [schemaDesignerEditor.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/schemaDesignerEditor.tsx)
> - [schemaDesignerEditorDrawer.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/schemaDesignerEditorDrawer.tsx)
> - [schemaDesignerEditorFooter.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/schemaDesignerEditorFooter.tsx)
> - [schemaDesignerEditorForeignKeyPanel.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/schemaDesignerEditorForeignKeyPanel.tsx)
> - [schemaDesignerEditorTablePanel.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/schemaDesignerEditorTablePanel.tsx)

The editor is a **slide-out drawer** that appears on the right side of the graph when the user edits a table. It has two tabs: **Table** (columns) and **Foreign Keys** (relationships).

---

## `schemaDesignerEditorDrawer.tsx` — Drawer Shell

This is the outermost component. It wraps the editor in a Fluent UI `OverlayDrawer` (or `InlineDrawer` depending on settings).

### How It Opens

```tsx
useEffect(() => {
    const openEditor = (event: SchemaDesignerEditorOpenEvent) => {
        setIsEditorOpen(true);
        setEditorTable(deepClone(event.table));
        setActiveTab(event.tab ?? "table"); // "table" or "foreignKey"
    };
    eventBus.on("openEditor", openEditor);
    return () => eventBus.off("openEditor", openEditor);
}, []);
```

The drawer listens for `openEditor` events on the event bus. When triggered:
1. Sets `isEditorOpen = true` (slides drawer open)
2. Deep-clones the table being edited into local state (`editorTable`)
3. Sets the active tab (defaults to "table")

### Why Deep Clone?

The editor maintains a **working copy** of the table. The original node data is unchanged until the user clicks "Save". This allows cancel/discard without side effects.

### Table & Schema Name Management

```tsx
const updateTableName = (newName: string) => {
    setEditorTable(prev => ({ ...prev, name: newName }));
};

const updateSchemaName = (newSchema: string) => {
    setEditorTable(prev => ({ ...prev, schema: newSchema }));
};
```

The drawer component manages the table name and schema name fields at the top of the panel. Schema is a dropdown populated from the database's available schemas.

### Save Logic

```tsx
const handleSave = () => {
    // Validate: table name must not be empty
    // Validate: no duplicate column names
    // Validate: FK columns must exist
    
    context.updateTable(originalTableId, editorTable);
    setIsEditorOpen(false);
    eventBus.emit("pushState");
    eventBus.emit("getScript");
};
```

On save, the working copy replaces the original table data in the React Flow graph.

### Discard Logic

```tsx
const handleDiscard = () => {
    setIsEditorOpen(false);
    // Working copy is simply abandoned
};
```

### Close on Node Deletion

```tsx
useEffect(() => {
    const handleDelete = (event) => {
        if (event.tableIds.includes(currentTableId)) {
            setIsEditorOpen(false);
        }
    };
    eventBus.on("tablesDeleted", handleDelete);
}, [currentTableId]);
```

If the table being edited gets deleted (from the toolbar or Copilot), the drawer auto-closes.

---

## `schemaDesignerEditor.tsx` — Tab Panel

Renders the two-tab layout inside the drawer:

```tsx
<TabList selectedValue={activeTab} onTabSelect={(_, data) => setActiveTab(data.value)}>
    <Tab value="table">Table</Tab>
    <Tab value="foreignKey">Foreign Keys</Tab>
</TabList>

{activeTab === "table" && (
    <SchemaDesignerEditorTablePanel 
        table={editorTable} 
        onChange={setEditorTable} 
    />
)}

{activeTab === "foreignKey" && (
    <SchemaDesignerEditorForeignKeyPanel 
        table={editorTable}
        allTables={allTables}
        onChange={setEditorTable} 
    />
)}
```

Simple tab switching between the two panels.

---

## `schemaDesignerEditorTablePanel.tsx` — Columns Editor

This is the **Table tab** content. It displays a grid of columns.

### Column Grid Layout

| Column | Description |
|--------|-------------|
| **Name** | Text input for the column name |
| **Data Type** | Combo box (`nvarchar(50)`, `int`, `datetime`, etc.) |
| **PK** | Checkbox — is this column part of the primary key? |
| **Nullable** | Checkbox — is this column nullable? |
| **Delete** | Button to remove the column |

### Adding a Column

```tsx
const addColumn = () => {
    const newColumn: SchemaDesignerColumn = {
        id: uuidv4(),
        name: generateUniqueName("column", existingNames),
        dataType: "nvarchar(50)",
        isPrimaryKey: false,
        isNullable: true,
        isIdentity: false,
        defaultValue: "",
        length: "",
        precision: "",
        scale: "",
    };
    setEditorTable(prev => ({
        ...prev,
        columns: [...prev.columns, newColumn],
    }));
};
```

A new column is appended with sensible defaults. The name is auto-generated as `column1`, `column2`, etc. using `generateUniqueName`.

### Column Reordering

Columns can be reordered via drag-and-drop within the grid. The order matters because it determines the column order in the generated `CREATE TABLE` script.

### Advanced Options (Expandable Section)

Each column row has an expandable "Advanced" section with:
- **Identity** — Is this an auto-increment column?
- **Default Value** — SQL expression for default (e.g., `GETDATE()`)
- **Length** — For string types (`nvarchar(50)` → 50)
- **Precision / Scale** — For decimal types

```tsx
{showAdvanced && (
    <div className={classes.advancedOptions}>
        <Field label="Identity">
            <Checkbox checked={column.isIdentity} onChange={...} />
        </Field>
        <Field label="Default Value">
            <Input value={column.defaultValue} onChange={...} />
        </Field>
        {/* Length, Precision, Scale fields */}
    </div>
)}
```

### Data Type Combo Box

The data type field is a combo box with all SQL Server data types. It supports:
- Free-text typing (e.g., `nvarchar(MAX)`)
- Dropdown selection from a predefined list
- Parameterized types (e.g., `decimal(18,2)` where precision and scale are part of the type string)

---

## `schemaDesignerEditorForeignKeyPanel.tsx` — Foreign Key Editor

This is the **Foreign Keys tab** content. Each foreign key is shown as a card.

### FK Card Layout

```
┌─────────────────────────────────────────────┐
│  FK Name:  FK_Employees_Departments         │
│                                             │
│  Referenced Table:  [Departments ▾]         │
│                                             │
│  Column Mappings:                           │
│    DepartmentId  →  Id                      │
│    [+ Add Column Mapping]                   │
│                                             │
│  On Delete:  [CASCADE ▾]                    │
│  On Update:  [NO ACTION ▾]                  │
│                                             │
│  [Delete FK]                                │
└─────────────────────────────────────────────┘
```

### Column Mapping

Each FK can have one or more column mappings (for composite keys):

```tsx
const addColumnMapping = () => {
    setEditorTable(prev => {
        const fk = prev.foreignKeys[fkIndex];
        fk.columns.push("");
        fk.referencedColumns.push("");
        return { ...prev };
    });
};
```

Each mapping has two dropdowns:
- **Source column** — A column from the current table
- **Referenced column** — A column from the referenced (target) table

### Referenced Table Dropdown

Populated with all tables in the schema. When the user changes the referenced table, the column dropdowns update to show columns from the new target.

### On Delete / On Update Actions

Dropdown with SQL Server referential actions:
- `NO ACTION`
- `CASCADE`
- `SET NULL`
- `SET DEFAULT`

### Adding a New FK

```tsx
const addForeignKey = () => {
    const newFK: SchemaDesignerForeignKey = {
        id: uuidv4(),
        name: generateUniqueName("FK_" + tableName, existingFKNames),
        columns: [""],
        referencedSchemaName: "",
        referencedTableName: "",
        referencedColumns: [""],
        onDeleteAction: OnAction.NoAction,
        onUpdateAction: OnAction.NoAction,
    };
    setEditorTable(prev => ({
        ...prev,
        foreignKeys: [...prev.foreignKeys, newFK],
    }));
};
```

### Deleting an FK

Removes the FK from the working copy array. The corresponding edge is removed from the graph on save.

---

## `schemaDesignerEditorFooter.tsx` — Save / Cancel Buttons

Simple footer with two buttons:

```tsx
<div className={classes.footer}>
    <Button appearance="primary" onClick={onSave}>
        Save
    </Button>
    <Button appearance="subtle" onClick={onDiscard}>
        Cancel
    </Button>
</div>
```

- **Save** — Calls the drawer's `handleSave` which validates and commits changes
- **Cancel** — Calls `handleDiscard` which closes the drawer without saving

### Keyboard Shortcut

```tsx
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onDiscard();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
}, [onSave, onDiscard]);
```

- **Escape** → Cancel
- **Ctrl+Enter** → Save

---

## Data Flow Summary

```
User clicks "Edit" on table node
           │
           ▼
  eventBus.emit("openEditor", { table, tab })
           │
           ▼
  EditorDrawer: deep-clone table → local state
           │
           ▼
  Editor: render Tab Panel
     ┌─────────┴──────────┐
     ▼                    ▼
  TablePanel          ForeignKeyPanel
  (columns grid)      (FK cards)
     │                    │
     ▼                    ▼
  User edits local state (working copy)
           │
           ▼
  User clicks Save → validate → context.updateTable(...)
           │
           ▼
  eventBus.emit("pushState") + eventBus.emit("getScript")
```

The key insight is that the editor works on a **detached copy** of the table. The graph state is only mutated on save, making cancel zero-cost.
