# 05 — React Views: Graph Layer

> **Files covered:**
> - [reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/SchemaDiagramFlow.tsx)
> - [reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerTableNode.tsx)
> - [reactviews/pages/SchemaDesigner/graph/schemaDesignerFlowColors.css](../extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/schemaDesignerFlowColors.css)

These files implement the **visual graph diagram** — the main canvas where tables appear as nodes and foreign keys appear as connecting edges.

---

## `SchemaDiagramFlow.tsx` — The React Flow Canvas (~748 lines)

This is the central graph component. It renders the React Flow canvas with all the table nodes, FK edges, minimap, controls, and background grid.

### Component Setup

```tsx
export const SchemaDesignerFlow = () => {
    // Controlled node/edge state
    const [schemaNodes, setSchemaNodes, onNodesChange] = useNodesState([]);
    const [deletedSchemaNodes, setDeletedSchemaNodes] = useState([]);
    const [relationshipEdges, setRelationshipEdges, onEdgesChange] = useEdgesState([]);
    
    // Context for schema data
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();
```

React Flow uses **controlled state** — the component owns the nodes/edges arrays and passes them to `<ReactFlow>`. There are separate arrays for:
- `schemaNodes` — Active (non-deleted) table nodes
- `deletedSchemaNodes` — Ghost nodes for tables that were deleted from baseline
- `relationshipEdges` — FK edges between tables

### Initialization

```tsx
useEffect(() => {
    const initialize = async () => {
        const { nodes, edges } = await context.initializeSchemaDesigner();
        setSchemaNodes(nodes);
        setRelationshipEdges(edges);
        // Trigger script generation for restored sessions
        setTimeout(() => eventBus.emit("getScript"), 0);
    };
    void initialize();
}, [context.initializationRequestId]);
```

When the component mounts (or when `initializationRequestId` changes), it loads the schema and populates the graph.

### Edge Highlighting for Diffs

```tsx
const highlightedEdges = useMemo(() => {
    return relationshipEdges.map(edge => {
        const foreignKeyId = edge.data?.id;
        const isNew = context.newForeignKeyIds.has(foreignKeyId);
        const isModified = context.modifiedForeignKeyIds.has(foreignKeyId);
        
        // Add CSS classes for green (added) or yellow (modified) highlighting
        if (isNew) classSet.add("schema-designer-edge-added");
        if (isModified) classSet.add("schema-designer-edge-modified");
        
        return { ...edge, className: nextClassName };
    });
}, [context.showChangesHighlight, context.newForeignKeyIds, ...]);
```

When change highlighting is enabled, FK edges get colored CSS classes (`schema-designer-edge-added` for green, `schema-designer-edge-modified` for yellow).

### Display Nodes & Edges

```tsx
const displayNodes = useMemo(() => {
    if (!context.showChangesHighlight) return schemaNodes;
    return mergeDeletedTableNodes(schemaNodes, deletedSchemaNodes);
}, [context.showChangesHighlight, deletedSchemaNodes, schemaNodes]);

const displayEdges = useMemo(() => {
    if (!context.showChangesHighlight) return highlightedEdges;
    return [...highlightedEdges, ...context.deletedForeignKeyEdges];
}, [...]);
```

When showing diffs:
- Deleted tables appear as "ghost" nodes (grayed out, non-interactive)
- Deleted FK edges appear as dashed red lines
- New items are highlighted green
- Modified items are highlighted yellow

### Refresh Mechanism

```tsx
useEffect(() => {
    const refresh = () => {
        requestAnimationFrame(() => {
            setSchemaNodes(filterDeletedNodes(reactFlow.getNodes()));
            setRelationshipEdges(filterDeletedEdges(reactFlow.getEdges()));
        });
    };
    eventBus.on("refreshFlowState", refresh);
    return () => eventBus.off("refreshFlowState", refresh);
}, []);
```

When the state provider programmatically modifies nodes/edges (via `reactFlow.setNodes()`), the controlled state needs to resync. The `refreshFlowState` event triggers this.

### Connection Handling (Drag-and-Drop FK Creation)

```tsx
const onConnect = useCallback((params: Connection) => {
    // 1. Find source and target tables
    const sourceTable = reactFlow.getNode(params.source);
    const targetTable = reactFlow.getNode(params.target);
    
    // 2. Get column names from handle IDs
    const sourceColumnName = sourceTable.data.columns.find(c => c.id === sourceColumnId)?.name;
    const targetColumnName = targetTable.data.columns.find(c => c.id === targetColumnId)?.name;
    
    // 3. Validate the connection
    const validation = foreignKeyUtils.validateConnection(params, nodes, edges);
    if (!validation.isValid) {
        // Show toast with error message
        return;
    }
    
    // 4. Create FK and edge
    const foreignKey = foreignKeyUtils.createForeignKeyFromConnection(...);
    const newEdge = addEdge({ ...params, data: foreignKey }, edges);
    setRelationshipEdges(newEdge);
    
    // 5. Update source table's FK list
    sourceTable.data.foreignKeys.push(foreignKey);
    
    // 6. Push undo state and refresh script
    eventBus.emit("pushState");
    eventBus.emit("getScript");
}, []);
```

Users can drag from a column handle on one table to a column handle on another to create a foreign key.

### Node Deletion with Confirmation

```tsx
const onBeforeDelete = useCallback(async ({ nodes, edges }) => {
    if (context.consumeSkipDeleteConfirmation()) return true;
    
    // Show confirmation dialog
    setOpen(true);
    const result = await new Promise(resolve => {
        deleteNodeConfirmationPromise.current = resolve;
    });
    
    return result;  // true = delete, false = cancel
}, []);
```

Before deleting a node, a confirmation dialog appears. The `consumeSkipDeleteConfirmation` mechanism allows programmatic deletions (from the Copilot tool) to skip the dialog.

### Edge Click — Undo Button for Diffs

When change highlighting is on and the user clicks an edge, a small undo button appears at the click position. This lets users revert individual FK changes.

### Node Change Handler

```tsx
const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const filteredChanges = changes.filter(change => {
        if (change.type === "position") return true;
        if (change.type === "remove") return true;
        // ... filter out changes to deleted ghost nodes
    });
    onNodesChange(filteredChanges);
}, []);
```

Filters React Flow's change notifications to prevent modifications to deleted ghost nodes.

### Rendering

```tsx
<ReactFlow
    nodes={displayNodes}
    edges={displayEdges}
    nodeTypes={NODE_TYPES}
    onNodesChange={handleNodesChange}
    onEdgesChange={onEdgesChange}
    onConnect={onConnect}
    onBeforeDelete={onBeforeDelete}
    connectionMode={ConnectionMode.Loose}
    minZoom={0.01}
    maxZoom={3}
>
    <MiniMap />
    <Controls>
        <ControlButton onClick={() => eventBus.emit("undo")}>
            <ArrowUndo16Regular />
        </ControlButton>
        <ControlButton onClick={toggleHighlight}>
            {highlighted ? <BranchCompare16Filled /> : <BranchCompare16Regular />}
        </ControlButton>
    </Controls>
    <Background variant={BackgroundVariant.Dots} />
    <Toaster toasterId={toasterId} />
</ReactFlow>
```

The canvas includes:
- **MiniMap** — Small overview of the entire graph
- **Controls** — Zoom in/out/fit plus custom undo and highlight toggle buttons
- **Background** — Dot grid pattern
- **Toaster** — Toast notifications for validation errors

---

## `schemaDesignerTableNode.tsx` — Table Node Component (~877 lines)

This is the **custom React Flow node** that renders each table as a visual card.

### Visual Structure

```
┌──────────────────────────────────────────┐
│ [Table Icon]  Employees    [Edit] [Menu] │  ← Header
│              dbo                         │  ← Subtitle (schema)
├──────────────────────────────────────────┤
│ ○  🔑  Id          int              ○   │  ← Column row (PK icon)
│ ○  🔗  ManagerId   int              ○   │  ← Column row (FK icon)
│ ○      FirstName   nvarchar(50)     ○   │  ← Column row
│ ○      LastName    nvarchar(50)     ○   │  ← Column row
├──────────────────────────────────────────┤
│         [▼ Show more] / [▲ Collapse]     │  ← Expand/collapse (optional)
└──────────────────────────────────────────┘
 ○ = React Flow handles (connection points)
```

### Key Sub-Components

#### `TableHeaderActions`
The edit button and context menu in the header:
- **Edit button** — Opens the editor drawer for this table
- **Menu button** — Shows options: Edit, Manage Relationships, Delete

#### `ColumnRow`
Each column is rendered as a row:
- **Left handle** — Connection point for incoming FKs (target)
- **Key icon** — Primary key (🔑) or Foreign key (🔗) icon
- **Column name** — With conditional tooltip if text overflows
- **Data type** — Shown in muted text
- **Right handle** — Connection point for outgoing FKs (source)

#### `ConditionalTooltip`
Custom hook that detects text overflow and only shows a tooltip when the text is actually truncated:

```typescript
const useTextOverflow = (text: string) => {
    const textRef = useRef(null);
    useEffect(() => {
        const isOverflowing = textRef.current.scrollWidth > textRef.current.clientWidth;
        setIsOverflowing(isOverflowing);
    }, [text]);
    return { isOverflowing, textRef };
};
```

### Diff Highlighting on Nodes

When change highlighting is enabled, the node applies CSS classes:

| State | Visual Effect |
|-------|---------------|
| New table | Green border shadow (`tableNodeDiffAdded`) |
| Deleted table | Red border shadow (`tableNodeDeleted`) + overlay |
| Modified table header | Yellow background on the header bar |
| New column | Green background on the column row |
| Modified column | Yellow background; old value shown with strikethrough |
| Deleted column | Red background; shown as a ghost row |

For modified columns, the specific changed property is shown:

```tsx
// Example: column name was renamed
<span className={classes.columnDiffOldValue}>OldName</span>
<span> → </span>
<span>NewName</span>
```

### Deleted Table Nodes

Deleted tables are shown as "ghost" nodes with:
- A semi-transparent overlay (`opacity: 0.4`)
- Red border
- Non-interactive (no selection, no dragging)
- An "Undo" button in the top-right corner to restore the table

```tsx
{data.isDeleted && (
    <div className={styles.tableOverlay} />
)}
{data.isDeleted && (
    <div className={styles.undoButtonWrapper}>
        <Tooltip content="Undo delete">
            <Button icon={<ArrowUndo16Regular />} onClick={handleRevertDelete} />
        </Tooltip>
    </div>
)}
```

### Expand/Collapse (Optional Feature)

When `enableExpandCollapseButtons` is set in the state:
- Tables show only a few columns by default
- A "Show more" button expands to show all columns
- A "Collapse" button hides them again

---

## `schemaDesignerFlowColors.css` — Color Overrides

CSS custom properties that override React Flow's default colors to match VS Code's theme:

```css
.schema-designer-edge-added {
    stroke: var(--vscode-gitDecoration-addedResourceForeground);
}

.schema-designer-edge-modified {
    stroke: var(--vscode-gitDecoration-modifiedResourceForeground);
}
```

Uses VS Code's semantic color tokens so the colors adapt to light/dark/high-contrast themes.
