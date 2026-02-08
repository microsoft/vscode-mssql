# 04 — React Views: State & Core

> **Files covered:**
> - [reactviews/pages/SchemaDesigner/index.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/index.tsx)
> - [reactviews/pages/SchemaDesigner/schemaDesignerPage.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerPage.tsx)
> - [reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx)
> - [reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerUtils.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerEdgeUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerEdgeUtils.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerEvents.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerEvents.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerUndoState.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerUndoState.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerToolBatchHooks.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchHooks.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerIcons.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerIcons.ts)
> - [reactviews/pages/SchemaDesigner/schemaDesignerFindTables.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerFindTables.tsx)
> - [reactviews/pages/SchemaDesigner/schemaDesignerDefinitionsPanel.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerDefinitionsPanel.tsx)

---

## `index.tsx` — The Entry Point

This is the file that React DOM renders into the webview. It sets up the entire component tree.

### Rendering

```tsx
ReactDOM.createRoot(document.getElementById("root")).render(
    <VscodeWebviewProvider>
        <SchemaDesignerStateProvider>
            <ReactFlowProvider>
                <MainLayout />
            </ReactFlowProvider>
        </SchemaDesignerStateProvider>
    </VscodeWebviewProvider>
);
```

**Provider hierarchy:**
1. `VscodeWebviewProvider` — Connects to the VS Code webview messaging bridge
2. `SchemaDesignerStateProvider` — All Schema Designer state (the "brain")
3. `ReactFlowProvider` — React Flow's internal state (nodes, edges, viewport)

### `MainLayout` Component

Checks if DAB (Data API Builder) is enabled:
- **DAB disabled:** Renders just `<SchemaDesignerPage />`
- **DAB enabled:** Renders a vertical left nav bar with two icon buttons:
  - Table icon → Schema Designer view
  - Database Search icon → DAB view
  
  The content area shows either `<SchemaDesignerPage />` or `<DabPage />` based on `activeView`. Both are always mounted (using `display: block/none`), so state is preserved when switching.

---

## `schemaDesignerPage.tsx` — The Main Page

Composes the visual layout of the Schema Designer view.

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│  SchemaDesignerEditorDrawer (overlay, hidden until opened)   │
├──────────────────────────────────────────────────────────────┤
│  MainLayout (with FindTableWidget floating on top)           │
│  ┌───────────────────────────┬──────────────────────────┐   │
│  │  PanelGroup (vertical)    │  Changes Panel            │   │
│  │  ┌───────────────────┐   │  (visible when DAB is on)  │   │
│  │  │ GraphContainer     │   │                            │   │
│  │  │  ┌─ Toolbar ──────┤   │                            │   │
│  │  │  │ SchemaDesigner  │   │                            │   │
│  │  │  │ Flow (React     │   │                            │   │
│  │  │  │ Flow graph)     │   │                            │   │
│  │  │  └────────────────┤   │                            │   │
│  │  ├───────────────────┤   │                            │   │
│  │  │  Resize Handle     │   │                            │   │
│  │  ├───────────────────┤   │                            │   │
│  │  │  DefinitionsPanel  │   │                            │   │
│  │  └───────────────────┘   │                            │   │
│  └───────────────────────────┴──────────────────────────┘   │
│                                                              │
│  LoadingOverlay (visible during initialization)              │
│  ErrorDialog (visible on initialization failure)             │
└──────────────────────────────────────────────────────────────┘
```

Uses `react-resizable-panels` for the split between graph/definitions and for graph/changes panel.

### Key Components

- **`LoadingOverlay`** — A spinner shown while the schema is loading
- **`ErrorDialog`** — If initialization fails, shows the error with a "Retry" button
- **`SchemaDesignerFindTableWidget`** — A floating search box triggered by Ctrl+F to find tables

---

## `schemaDesignerStateProvider.tsx` — The Brain

This is the **largest and most important file** in the Schema Designer React code (~1325 lines). It creates a React Context that provides all state and operations to every child component.

### The Context Interface (`SchemaDesignerContextProps`)

The context provides:

#### Core State
| Property | Type | Purpose |
|----------|------|---------|
| `state` | `SchemaDesignerWebviewState` | Feature flags from extension host |
| `extensionRpc` | `WebviewRpc` | RPC client for extension host communication |
| `schemaNames` | `string[]` | Available SQL schemas (e.g. `["dbo", "Sales"]`) |
| `datatypes` | `string[]` | Available SQL data types (e.g. `["int", "varchar"]`) |
| `isInitialized` | `boolean` | Is the designer ready to use? |
| `initializationError` | `string \| undefined` | Error message if init failed |

#### Schema Operations
| Function | Purpose |
|----------|---------|
| `initializeSchemaDesigner()` | Load schema from backend, populate graph |
| `getDefinition()` | Get current SQL script |
| `extractSchema()` | Convert React Flow nodes/edges into Schema model |
| `addTable(table)` | Add a new table to the graph |
| `updateTable(table)` | Update an existing table (columns, FKs, name) |
| `deleteTable(table)` | Remove a table from the graph |
| `getTableWithForeignKeys(tableId)` | Get a table's data including FKs from edges |
| `publishSession()` | Deploy changes to database |

#### UI State
| Property | Purpose |
|----------|---------|
| `findTableText` | Current search text in the find widget |
| `renderOnlyVisibleTables` | Performance optimization flag |
| `isExporting` | True during diagram export (disables virtual rendering) |
| `isChangesPanelVisible` | Is the changes panel open? |
| `showChangesHighlight` | Should diff highlights be shown on the graph? |

#### Diff/Changes State
| Property | Purpose |
|----------|---------|
| `schemaChangesCount` | Total number of changes |
| `schemaChanges` | Human-readable change descriptions |
| `structuredSchemaChanges` | Machine-readable `SchemaChange[]` |
| `newTableIds` | Set of IDs for newly added tables |
| `newColumnIds` | Set of IDs for newly added columns |
| `modifiedColumnHighlights` | Map of column ID → what properties changed |
| `deletedTableNodes` | Ghost nodes for deleted tables |
| `revertChange(change)` | Revert a specific change to baseline |
| `canRevertChange(change)` | Check if a change can be safely reverted |

#### DAB State
Properties for Data API Builder configuration (toggle entities, API types, etc.)

---

### How Initialization Works

```typescript
const initializeSchemaDesigner = async () => {
    setIsInitialized(false);
    
    // 1. Fetch schema from extension host
    const model = await extensionRpc.sendRequest(InitializeSchemaDesignerRequest.type);
    
    // 2. Fetch baseline schema for diffing
    baselineSchemaRef.current = await extensionRpc.sendRequest(GetBaselineSchemaRequest.type);
    
    // 3. Convert schema to React Flow nodes/edges
    const { nodes, edges } = flowUtils.generateSchemaDesignerFlowComponents(model.schema);
    
    // 4. Store available data types and schema names
    setDatatypes(model.dataTypes);
    setSchemaNames(model.schemaNames);
    
    // 5. Initialize undo stack with current state
    stateStack.setInitialState(reactFlow.toObject());
    
    setIsInitialized(true);
    return { nodes, edges };
};
```

### `addTable` — Adding a New Table

```typescript
const addTable = async (table: Table) => {
    // 1. Get existing nodes/edges (filtering out deleted ghost nodes)
    const existingNodes = filterDeletedNodes(reactFlow.getNodes());
    const existingEdges = filterDeletedEdges(reactFlow.getEdges());
    
    // 2. Build a schema model and add the new table
    const schemaModel = flowUtils.extractSchemaModel(existingNodes, existingEdges);
    schemaModel.tables.push(table);
    
    // 3. Generate layout positions for all tables
    const updatedPositions = flowUtils.generateSchemaDesignerFlowComponents(schemaModel);
    
    // 4. Position the new node below all existing nodes
    const bottomMostNode = existingNodes.reduce(...);
    nodeWithPosition.position = {
        x: bottomMostNode.position.x,
        y: bottomMostNode.position.y + height + 50
    };
    
    // 5. Update React Flow state
    reactFlow.setNodes([...existingNodes, nodeWithPosition]);
    reactFlow.setEdges([...existingEdges, ...edgesForNewTable]);
    
    // 6. Center viewport on the new table
    setCenter(nodeWithPosition.id, true);
    
    // 7. Trigger script refresh
    eventBus.emit("getScript");
};
```

### `updateTable` — Modifying a Table

```typescript
const updateTable = async (updatedTable: Table) => {
    // 1. Find the existing node
    const existingTableNode = existingNodes.find(node => node.id === updatedTable.id);
    
    // 2. Track column renames
    const renamedColumns = new Map<string, string>();
    for (const oldCol of existingTableNode.data.columns) {
        const newCol = updatedTable.columns.find(c => c.id === oldCol.id);
        if (newCol && newCol.name !== oldCol.name) {
            renamedColumns.set(oldCol.name, newCol.name);
        }
    }
    
    // 3. Update FK edges that reference this table (schema/name changes)
    existingEdges.forEach(edge => {
        if (edge.data.referencedTableName === existingTableNode.data.name) {
            edge.data.referencedTableName = updatedTable.name;
        }
    });
    
    // 4. Update incoming FK edges for column renames
    applyColumnRenamesToIncomingForeignKeyEdges(existingEdges, updatedTable.id, renamedColumns);
    
    // 5. Update node data
    existingTableNode.data = updatedTable;
    
    // 6. Rebuild FK edges for this table
    existingEdges = existingEdges.filter(edge => edge.source !== updatedTable.id);
    // ... rebuild from updatedTable.foreignKeys
    
    // 7. Apply to React Flow and trigger refresh
    reactFlow.setNodes(existingNodes);
    reactFlow.setEdges(existingEdges);
};
```

### Undo/Redo System

The state provider listens for event bus events:

```typescript
eventBus.on("pushState", () => {
    const state = reactFlow.toObject();
    stateStack.pushState(state);    // Push full snapshot
    eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
});

eventBus.on("undo", () => {
    const state = stateStack.undo();
    pendingFlowStateRef.current = { nodes: state.nodes, edges: state.edges };
    reactFlow.setNodes(state.nodes);
    reactFlow.setEdges(state.edges);
    eventBus.emit("refreshFlowState");
    eventBus.emit("getScript");
});

eventBus.on("redo", () => {
    const state = stateStack.redo();
    // ... same as undo but calls stateStack.redo()
});
```

**Important:** The `pendingFlowStateRef` is used because React Flow's state updates are asynchronous. When we undo and then immediately compute diffs, we need the state we just restored — not the stale state from the React Flow store.

### Schema Changes Tracking

The `updateSchemaChanges` function runs every time `getScript` fires:

```typescript
const updateSchemaChanges = async () => {
    // 1. Get baseline (from extension host, cached in ref)
    if (!baselineSchemaRef.current) {
        baselineSchemaRef.current = await extensionRpc.sendRequest(GetBaselineSchemaRequest.type);
    }
    
    // 2. Get current schema from flow state
    const currentSchema = flowUtils.extractSchemaModel(nodes, edges);
    
    // 3. Compute diff
    const summary = calculateSchemaDiff(baselineSchemaRef.current, currentSchema);
    
    // 4. Update all diff-related state
    setStructuredSchemaChanges(allChanges);
    setNewTableIds(getNewTableIds(summary));
    setNewColumnIds(getNewColumnIds(summary));
    setModifiedColumnHighlights(getModifiedColumnHighlights(summary));
    setDeletedColumnsByTable(deletedColumns);
    setDeletedTableNodes(deletedNodes);  // Ghost nodes for deleted tables
    
    // 5. Notify extension host about dirty state
    if (hasChanges !== lastHasChangesRef.current) {
        extensionRpc.sendNotification(SchemaDesignerDirtyState, { hasChanges });
    }
};
```

---

## `schemaDesignerRpcHandlers.ts` — Webview-Side RPC

This file contains two handler registration functions:

### `registerSchemaDesignerApplyEditsHandler`

Handles `ApplyEditsWebviewRequest` — the message the extension host sends when the Copilot tool wants to make changes.

**Processing a batch of edits:**

```typescript
for (let i = 0; i < params.edits.length; i++) {
    const edit = params.edits[i];
    
    switch (edit.op) {
        case "add_table":    // Create new table with normalizeColumn()
        case "drop_table":   // Delete via deleteTable(table, skipConfirmation=true)
        case "set_table":    // Rename table/schema via updateTable()
        case "add_column":   // Add to table's columns, validate, updateTable()
        case "drop_column":  // Filter out from columns, validate, updateTable()
        case "set_column":   // Merge changes into column, validate, updateTable()
        case "add_foreign_key":  // Create FK, validate mappings, updateTable()
        case "drop_foreign_key": // Filter out FK, updateTable()
        case "set_foreign_key":  // Merge changes into FK, validate, updateTable()
    }
    
    await waitForNextFrame();       // Let React process
    workingSchema = extractSchema(); // Read back actual state
    onPushUndoState();              // Push to undo stack
}
```

For each edit:
1. **Resolve** the target table/column/FK by name (case-insensitive)
2. **Validate** the edit (data types, column names, FK constraints)
3. **Apply** via `addTable()` / `updateTable()` / `deleteTable()`
4. **Wait** for React to process
5. **Push** undo state

If any edit fails, it returns the index of the failed edit and how many succeeded.

### `registerSchemaDesignerGetSchemaStateHandler`

Handles `GetSchemaStateRequest` — simply calls `extractSchema()` and returns the result.

---

## `schemaDesignerUtils.ts` — Utility Functions (~1015 lines)

This is the **workhorse utility file** containing all table/column/FK creation, validation, and layout logic.

### `namingUtils`

Auto-generates names for new objects:
- `getNextColumnName(columns)` → `"column_1"`, `"column_2"`, etc.
- `getNextForeignKeyName(foreignKeys, tables)` → `"FK_1"`, `"FK_2"`, etc.
- `getNextTableName(tables)` → `"table_1"`, `"table_2"`, etc.

### `tableUtils`

- **`getAllTables(schema, current?)`** — Lists all tables except `current` (for FK reference dropdowns)
- **`getTableFromDisplayName(schema, displayName)`** — Looks up `"dbo.Employees"` → Table object
- **`tableNameValidationError(schema, table)`** — Returns error if name is empty or duplicated
- **`createNewTable(schema, schemaNames)`** — Creates a default table with:
  - Name: next available `table_N`
  - Schema: first available schema
  - One `Id` column (int, PK, identity)
  - No foreign keys

### `columnUtils`

- **`isColumnValid(column, columns)`** — Validates: no duplicate names, not empty, PK can't be nullable, maxLength must be valid
- **`isLengthBasedType(type)`** — `"char"`, `"varchar"`, `"nchar"`, `"nvarchar"`, `"binary"`, `"varbinary"`, `"vector"`
- **`isTimeBasedWithScale(type)`** — `"datetime2"`, `"datetimeoffset"`, `"time"`
- **`isPrecisionBasedType(type)`** — `"decimal"`, `"numeric"`
- **`isIdentityBasedType(type, scale)`** — int-like types (or decimal/numeric with scale=0)
- **`fillColumnDefaults(column)`** — Sets appropriate defaults when data type changes
- **`getAdvancedOptions(column)`** — Returns UI configuration for the advanced options popover (nullable, identity, maxLength, default value, computed, etc.)

### `foreignKeyUtils`

- **`areDataTypesCompatible(col, refCol)`** — Checks that FK columns have matching types/lengths
- **`isCyclicForeignKey(tables, current, target)`** — Detects circular FK chains (but allows self-references)
- **`isForeignKeyValid(tables, table, fk)`** — Full FK validation: referenced table exists, no duplicate FK columns, columns exist, types match, referenced columns are PKs
- **`getForeignKeyWarnings(tables, table, fk)`** — Non-blocking warnings: empty FK name, cyclic references
- **`extractForeignKeysFromEdges(edges, tableId, schema)`** — Reconstructs FK objects from React Flow edges
- **`createForeignKeyFromConnection(sourceNode, targetNode, ...)`** — Creates FK from a drag-and-drop connection
- **`validateConnection(connection, nodes, edges)`** — Validates a React Flow connection attempt

### `flowUtils` — Layout & Conversion

- **`getTableWidth()`** — Returns `300 + 50` (node width + margin)
- **`getTableHeight(table)`** — Returns `70 + columns.length * 30` (header + rows)
- **`generatePositions(nodes, edges)`** — Uses **dagre** (graph layout algorithm) to compute non-overlapping positions for all nodes
- **`generateSchemaDesignerFlowComponents(schema)`** — Converts a `Schema` into React Flow `Node[]` and `Edge[]`, with dagre layout
- **`extractSchemaModel(nodes, edges)`** — The reverse: converts React Flow nodes/edges back into a `Schema`

---

## `schemaDesignerEdgeUtils.ts` — Edge Identity & Renames

### `buildForeignKeyEdgeId(source, target, srcCol, tgtCol)`

Creates a deterministic edge ID: `"tableA-tableB-colId1-colId2"`. Note this is the React Flow edge ID, NOT the FK's UUID.

### `applyColumnRenamesToIncomingForeignKeyEdges(edges, tableId, renames)`

When a column on table A is renamed, any FK edges that point TO table A (as the referenced table) need their `data.referencedColumns` updated.

### `applyColumnRenamesToOutgoingForeignKeyEdges(edges, tableId, renames)`

Same but for outgoing FK edges — updates `data.columns`.

### `removeEdgesForForeignKey(edges, foreignKeyId)`

Filters out all edges that belong to a specific FK (by `edge.data.id`, not `edge.id`).

---

## `schemaDesignerEvents.ts` — Event Bus

A typed event emitter for decoupled communication between components.

```typescript
type MyEvents = {
    getScript: () => void;               // Trigger SQL definition refresh + diff update
    refreshFlowState: () => void;         // Sync controlled state with React Flow store
    revealForeignKeyEdges: (fkId) => void; // Select and center on FK edges
    clearEdgeSelection: () => void;
    openCodeDrawer: () => void;           // Open the definitions panel
    toggleChangesPanel: () => void;
    editTable: (table, schema, showFKs?) => void;  // Open editor for a table
    newTable: (schema) => void;           // Open editor for a new table
    onFindWidgetValueChange: (text) => void;
    pushState: () => void;               // Push current state to undo stack
    undo: () => void;
    redo: () => void;
    updateUndoRedoState: (canUndo, canRedo) => void;
};
```

This event bus avoids deep prop drilling and allows components in different parts of the tree to communicate.

---

## `schemaDesignerUndoState.ts` — Undo/Redo

Creates a singleton `UndoRedoStack` instance:

```typescript
export const stateStack = new UndoRedoStack<
    ReactFlowJsonObject<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>
>();
```

The stack stores full snapshots of the React Flow state (all nodes + edges + viewport). The `useOnPushUndoState` hook wraps the push operation in a `useCallback`.

---

## `schemaDesignerToolBatchUtils.ts` — Batch Edit Helpers

### `waitForNextFrame()`
Returns a promise that resolves on the next animation frame. Used between batch edits to let React process updates.

### `shouldAutoArrangeForToolBatch(params)`
Returns `true` if enough tables (≥5) or foreign keys (≥3) were added to warrant an auto-layout.

### `normalizeColumn(column)`
Fills in all default values for a column. If `maxLength` is empty for a varchar, sets it to `"50"`. If `precision` is missing for decimal, sets it to `18`. Ensures `id` is generated.

### `normalizeTable(table)`
Normalizes all columns and foreign keys in a table, ensuring IDs exist and arrays are valid.

### `validateTable(schema, table, schemas)`
Full validation: must have columns, schema must exist, no duplicate table names, all columns valid, all FKs valid.

---

## `schemaDesignerFindTables.tsx` — Find Widget

A floating search box (Ctrl+F) for finding tables by name:
- Filters visible table nodes as you type
- Shows match count
- Up/Down arrows to navigate between matches
- Centers the viewport on the selected match

---

## `schemaDesignerDefinitionsPanel.tsx` — SQL Definitions Panel

A collapsible panel at the bottom that shows the live SQL script:
- Tabs: "Create Script" and "Alter Script"
- Auto-refreshes when `getScript` event fires
- Has "Copy to Clipboard" and "Open in Editor" buttons
- Uses a Monaco-like code display (via `DesignerDefinitionPane`)
