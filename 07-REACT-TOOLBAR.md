# 07 — React Views: Toolbar

> **Files covered:**
> - [schemaDesignerToolbar.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/schemaDesignerToolbar.tsx) — Composition of all buttons
> - [addTableButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/addTableButton.tsx)
> - [autoArrangeButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/autoArrangeButton.tsx)
> - [deleteNodesButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/deleteNodesButton.tsx)
> - [exportDiagramButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/exportDiagramButton.tsx)
> - [filterTablesButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/filterTablesButton.tsx)
> - [publishChangesDialogButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/publishChangesDialogButton.tsx)
> - [showChangesButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/showChangesButton.tsx)
> - [undoRedoButtons.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/undoRedoButtons.tsx)
> - [viewDefinitionsButton.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/viewDefinitionsButton.tsx)

The toolbar sits along the top of the Schema Designer view. Each button is a separate component, composed together in `schemaDesignerToolbar.tsx`.

---

## `schemaDesignerToolbar.tsx` — Toolbar Container

Simple composition component:

```tsx
<Toolbar>
    <AddTableButton />
    <AutoArrangeButton />
    <DeleteNodesButton />
    <Divider />
    <ExportDiagramButton />
    <FilterTablesButton />
    <ShowChangesButton />
    <ViewDefinitionsButton />
    <Divider />
    <UndoRedoButtons />
    <ToolbarDivider />
    <PublishChangesDialogButton />
</Toolbar>
```

Each button is self-contained — it reads context, listens for events, and directly calls context methods or emits events. There is no prop-drilling; everything goes through `SchemaDesignerContext`.

---

## `addTableButton.tsx` — Add Table

```tsx
const handleAddTable = () => {
    const newTable = context.addTable();
    // Opens the editor drawer for the new table
    eventBus.emit("openEditor", { table: newTable, tab: "table" });
};
```

What happens under the hood (in `context.addTable`):
1. Generates a unique table name (`Table1`, `Table2`, etc.)
2. Creates a table with one default column (`column1 int PrimaryKey`)
3. Adds a React Flow node positioned near the viewport center
4. Returns the new table data

After adding:
- The editor drawer opens automatically so the user can configure the table
- An undo state is pushed
- The script is regenerated

---

## `autoArrangeButton.tsx` — Auto-Arrange Layout

```tsx
const handleAutoArrange = () => {
    // Show confirmation dialog first
    setDialogOpen(true);
};

const confirmAutoArrange = () => {
    context.autoArrangeNodes();
    setDialogOpen(false);
};
```

### Confirmation Dialog

Before rearranging, a dialog warns the user:
> "This will rearrange all tables in the diagram. Do you want to continue?"

This is because auto-arrange replaces all custom node positions, which could be disruptive.

### Auto-Arrange Algorithm (from `schemaDesignerUtils.ts`)

Uses the **Dagre** graph layout algorithm:

```typescript
export function getLayoutedElements(nodes, edges) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 50, edgesep: 50, ranksep: 100 });
    
    nodes.forEach(node => g.setNode(node.id, { width: NODE_WIDTH, height: nodeHeight }));
    edges.forEach(edge => g.setEdge(edge.source, edge.target));
    
    dagre.layout(g);
    
    return nodes.map(node => {
        const pos = g.node(node.id);
        return { ...node, position: { x: pos.x, y: pos.y } };
    });
}
```

Tables are arranged left-to-right (`rankdir: "LR"`) with relationship edges guiding the layout.

---

## `deleteNodesButton.tsx` — Delete Selected Nodes

```tsx
const handleDelete = () => {
    const selectedNodes = reactFlow.getNodes().filter(n => n.selected);
    if (selectedNodes.length === 0) return;
    
    // Tell the graph to skip the delete confirmation dialog
    // (since the toolbar button already confirms)
    context.setSkipDeleteConfirmation(true);
    
    // Remove the selected nodes
    reactFlow.deleteElements({ nodes: selectedNodes });
};
```

This button:
1. Gets all currently selected nodes
2. Sets a flag to skip the React Flow `onBeforeDelete` confirmation (since the user already chose to delete via the toolbar)
3. Calls `deleteElements` on React Flow

The button is **disabled** when no nodes are selected.

---

## `exportDiagramButton.tsx` — Export as Image

```tsx
const handleExport = async (format: "svg" | "png" | "jpeg") => {
    const flowElement = document.querySelector(".react-flow");
    
    let dataUrl;
    switch (format) {
        case "svg":
            dataUrl = await toSvg(flowElement);
            break;
        case "png":
            dataUrl = await toPng(flowElement);
            break;
        case "jpeg":
            dataUrl = await toJpeg(flowElement);
            break;
    }
    
    // Send to extension host to save via native file dialog
    context.exportDiagram(dataUrl, format);
};
```

Uses the **html-to-image** library to capture the React Flow canvas as a raster or vector image.

### Format Options

A dropdown menu offers three formats:
- **SVG** — Vector format, infinitely scalable
- **PNG** — Lossless raster with transparency
- **JPEG** — Compressed raster (smaller file size)

The generated data URL is sent to the extension host, which opens a "Save As" dialog.

---

## `filterTablesButton.tsx` — Search & Filter Tables

A popover with a search box and a list of toggleable table entries.

### UI

```
┌──────────────────────────┐
│  [🔍 Search tables...]   │
│                          │
│  ☑ dbo.Employees         │
│  ☑ dbo.Departments       │
│  ☐ dbo.AuditLog          │  ← Unchecked = hidden
│  ☑ hr.Benefits           │
│                          │
│  [Show All] [Hide All]   │
└──────────────────────────┘
```

### How Filtering Works

```tsx
const toggleTableVisibility = (nodeId: string) => {
    reactFlow.setNodes(nodes =>
        nodes.map(node =>
            node.id === nodeId
                ? { ...node, hidden: !node.hidden }
                : node
        )
    );
};
```

Tables are not removed from the graph — they are simply hidden via React Flow's `hidden` property. FK edges connected to hidden tables are also hidden automatically by React Flow.

### Search

```tsx
const filteredTables = allTables.filter(t =>
    `${t.schema}.${t.name}`.toLowerCase().includes(searchText.toLowerCase())
);
```

Filters the table list in the popover as the user types.

---

## `showChangesButton.tsx` — Toggle Change Highlighting

```tsx
const handleToggle = () => {
    context.setShowChangesHighlight(!context.showChangesHighlight);
};
```

When toggled on:
- The diff engine calculates differences between the original and current schema
- Green, yellow, and red highlights appear on nodes and edges
- Deleted tables appear as ghost nodes
- Deleted FKs appear as dashed edges
- A badge shows the count of changes

### Change Count Badge

```tsx
<Badge count={context.changeCount} appearance="filled" color="important">
    <Button icon={<BranchCompare24Regular />} onClick={handleToggle} />
</Badge>
```

Displays a small red badge on the button showing the number of changes.

---

## `undoRedoButtons.tsx` — Undo/Redo

```tsx
const handleUndo = () => eventBus.emit("undo");
const handleRedo = () => eventBus.emit("redo");
```

Emits events that the state provider picks up to pop/push the undo/redo stacks.

```tsx
<Button 
    icon={<ArrowUndo24Regular />}
    disabled={context.undoStack.length === 0}
    onClick={handleUndo}
/>
<Button
    icon={<ArrowRedo24Regular />}
    disabled={context.redoStack.length === 0}
    onClick={handleRedo}
/>
```

Both buttons are disabled when their respective stacks are empty.

### Keyboard Shortcuts (registered in `SchemaDiagramFlow.tsx`)

- **Ctrl+Z** → Undo
- **Ctrl+Y** or **Ctrl+Shift+Z** → Redo

---

## `viewDefinitionsButton.tsx` — Toggle Definitions Panel

```tsx
const handleToggle = () => {
    context.setShowDefinitions(!context.showDefinitions);
};
```

Toggles the SQL definitions panel (on the right side of the graph). When visible, the panel shows the generated SQL `CREATE TABLE` / `ALTER TABLE` script.

---

## `publishChangesDialogButton.tsx` — Publish to Database

This is the most complex toolbar button. It manages a **multi-stage dialog** for publishing schema changes to the actual database.

### Publish Flow

```
[Publish Button]
       │
       ▼
┌─────────────────────┐
│  Stage 1: Preview   │  ← Show generated SQL script
│  [Generate Script]  │
│  [Update Database]  │
│  [Cancel]           │
└─────────────────────┘
       │ (User clicks Update)
       ▼
┌─────────────────────┐
│  Stage 2: Progress  │  ← Show progress bar
│  "Publishing..."    │
└─────────────────────┘
       │ (Complete or Error)
       ▼
┌─────────────────────────┐
│  Stage 3a: Success      │
│  "Published successfully"│
│  [Close]                │
│  OR                     │
│  Stage 3b: Error        │
│  "Error: ..."           │
│  [View Report]          │
│  [Cancel]               │
└─────────────────────────┘
```

### Script Preview (Stage 1)

```tsx
const handlePublish = () => {
    // Request the current SQL script from the extension host
    eventBus.emit("getScript");
    setDialogStage("preview");
    setDialogOpen(true);
};
```

The dialog shows the SQL script that will be executed. The script is rendered using **react-markdown** for syntax highlighting.

### Update Database (Stage 2)

```tsx
const handleUpdateDatabase = async () => {
    setDialogStage("progress");
    const result = await context.publishChanges();
    
    if (result.success) {
        setDialogStage("success");
    } else {
        setPublishError(result.errorMessage);
        setDialogStage("error");
    }
};
```

Calls `context.publishChanges()` which sends an RPC to the extension host, which forwards to SQL Tools Service to execute the DDL script against the live database.

### Generate Script Only

```tsx
const handleGenerateScript = () => {
    context.openInEditor();  // Opens the SQL in a VS Code text editor
    setDialogOpen(false);
};
```

Instead of running the script, opens it in a VS Code editor tab so the user can review, modify, or run it themselves.

### After Successful Publish

After a successful publish:
1. The extension host reloads the schema from the database
2. The "original" baseline schema is updated to match the new state
3. All diff highlights reset (no more changes to show)
4. The undo/redo stacks are cleared

---

## Summary

| Button | Action | Events/Methods |
|--------|--------|----------------|
| **Add Table** | Creates a new table node + opens editor | `context.addTable()` → `openEditor` |
| **Auto Arrange** | Rearranges all nodes using Dagre | `context.autoArrangeNodes()` |
| **Delete** | Removes selected nodes | `reactFlow.deleteElements()` |
| **Export** | Saves diagram as SVG/PNG/JPEG | `html-to-image` → `context.exportDiagram()` |
| **Filter** | Toggles table visibility | `reactFlow.setNodes(hidden: true/false)` |
| **Show Changes** | Toggles diff highlighting | `context.setShowChangesHighlight()` |
| **Undo / Redo** | Reverts/replays edits | `eventBus.emit("undo"/"redo")` |
| **View Definitions** | Toggles SQL script panel | `context.setShowDefinitions()` |
| **Publish** | Multi-stage publish dialog | `context.publishChanges()` |
