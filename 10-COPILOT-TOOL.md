# 10 — Copilot Tool: `SchemaDesignerTool`

> **File:**
> - [copilot/tools/schemaDesignerTool.ts](../extensions/mssql/src/copilot/tools/schemaDesignerTool.ts) (~865 lines)

This file implements a **VS Code Language Model Tool** that lets GitHub Copilot (the AI chat) read and modify the Schema Designer's state programmatically. It's registered as a tool that the LLM can call during a chat conversation.

---

## Registration

```typescript
export class SchemaDesignerTool implements vscode.LanguageModelTool<ISchemaDesignerToolParameters> {
    public static readonly toolId = "mssql-schema-designer_schemaDesigner";
    
    // Called to describe what the current schema looks like (for tool confirmation UI)
    async prepareInvocation(options, token) { ... }
    
    // Called to actually execute the operation
    async invoke(options, token) { ... }
}
```

The tool is registered with VS Code's LM tool API. When Copilot decides to call this tool, VS Code invokes `prepareInvocation` (for a confirmation prompt) and then `invoke` (for actual execution).

---

## Operations

The tool supports **four operations**, selected via the `operation` parameter:

| Operation | Purpose |
|-----------|---------|
| `show` | Open/focus the Schema Designer for a given connection |
| `get_overview` | Return a list of all tables with column counts |
| `get_table` | Return full details for a specific table |
| `apply_edits` | Apply batch edits (add/modify/delete tables/columns/FKs) |

### `ISchemaDesignerToolParameters`

```typescript
interface ISchemaDesignerToolParameters {
    operation: "show" | "get_overview" | "get_table" | "apply_edits";
    
    // For "show" — identify which connection to use
    connectionUri?: string;
    
    // For "get_table" — which table to fetch
    tableName?: string;
    schemaName?: string;
    
    // For "apply_edits" — batch of changes + version for concurrency
    edits?: SchemaDesignerEdit[];
    schemaVersion?: string;
}
```

---

## Operation: `show`

```typescript
case "show": {
    const manager = SchemaDesignerWebviewManager.getInstance();
    await manager.getSchemaDesigner(connectionUri);
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart("Schema Designer opened successfully.")
    ]);
}
```

Opens (or focuses) the Schema Designer webview for the given database connection. If the Schema Designer is already open for this connection, it simply brings it to front.

---

## Operation: `get_overview`

```typescript
case "get_overview": {
    const controller = this.getControllerForUri(connectionUri);
    const schema = controller.getCachedSchema();
    
    // Build a compact overview: table name + column count
    const overview = schema.tables.map(table => ({
        name: `${table.schema}.${table.name}`,
        columns: table.columns.length,
        foreignKeys: table.foreignKeys.length,
    }));
    
    // Also include the schema version (SHA-256 hash)
    const version = controller.getSchemaVersion();
    
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({
            tables: overview,
            schemaVersion: version,
        }))
    ]);
}
```

Returns a JSON summary of all tables. This is intentionally **compact** — it only shows counts, not full column definitions — to stay within LLM token limits.

### Schema Version (SHA-256 Hash)

```typescript
getSchemaVersion(): string {
    const schema = this.getCachedSchema();
    const canonical = JSON.stringify(schema);  // deterministic serialization
    return crypto.createHash("sha256").update(canonical).digest("hex");
}
```

The schema version is a SHA-256 hash of the entire schema JSON. It changes whenever any table, column, or FK is modified. This is used for **optimistic concurrency control** — see "apply_edits" below.

---

## Operation: `get_table`

```typescript
case "get_table": {
    const controller = this.getControllerForUri(connectionUri);
    const schema = controller.getCachedSchema();
    
    // Find the table by name
    const table = schema.tables.find(
        t => t.name === tableName && t.schema === schemaName
    );
    
    if (!table) {
        return errorResult(`Table '${schemaName}.${tableName}' not found.`);
    }
    
    // Return full table details
    const version = controller.getSchemaVersion();
    
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({
            table: {
                name: table.name,
                schema: table.schema,
                columns: table.columns.map(c => ({
                    name: c.name,
                    dataType: c.dataType,
                    isPrimaryKey: c.isPrimaryKey,
                    isNullable: c.isNullable,
                    isIdentity: c.isIdentity,
                    defaultValue: c.defaultValue,
                })),
                foreignKeys: table.foreignKeys.map(fk => ({
                    name: fk.name,
                    columns: fk.columns,
                    referencedTable: `${fk.referencedSchemaName}.${fk.referencedTableName}`,
                    referencedColumns: fk.referencedColumns,
                    onDelete: fk.onDeleteAction,
                    onUpdate: fk.onUpdateAction,
                })),
            },
            schemaVersion: version,
        }))
    ]);
}
```

Returns the complete definition of a single table, including all columns with their properties and all foreign keys. The `schemaVersion` is included so the LLM can reference it in a subsequent `apply_edits` call.

---

## Operation: `apply_edits`

This is the most complex operation. It applies a batch of schema modifications.

### Optimistic Concurrency Check

```typescript
case "apply_edits": {
    const controller = this.getControllerForUri(connectionUri);
    const currentVersion = controller.getSchemaVersion();
    
    if (schemaVersion !== currentVersion) {
        return errorResult(
            "Schema version mismatch. The schema has been modified since you last read it. " +
            "Please call get_overview or get_table again to get the current version."
        );
    }
    // ... proceed with edits
}
```

Before applying edits, the tool checks that the `schemaVersion` provided by the LLM matches the current hash. If the user (or another Copilot call) modified the schema in the meantime, the edit is **rejected** and the LLM is told to re-read the schema.

This prevents the AI from making edits based on stale data.

### Edit Types

```typescript
interface SchemaDesignerEdit {
    type: "addTable" | "modifyTable" | "deleteTable" |
          "addColumn" | "modifyColumn" | "deleteColumn" |
          "addForeignKey" | "modifyForeignKey" | "deleteForeignKey";
    
    // Target identification
    tableName?: string;
    schemaName?: string;
    columnName?: string;
    foreignKeyName?: string;
    
    // New values (for add/modify)
    table?: { name, schema, columns, foreignKeys };
    column?: { name, dataType, isPrimaryKey, isNullable, ... };
    foreignKey?: { name, columns, referencedTable, referencedColumns, ... };
}
```

### Edit Processing

Each edit type maps to operations on the controller:

#### `addTable`

```typescript
case "addTable": {
    const newTable = controller.addTable({
        name: edit.table.name,
        schema: edit.table.schema,
        columns: edit.table.columns,
        foreignKeys: edit.table.foreignKeys || [],
    });
    results.push(`Added table '${edit.table.schema}.${edit.table.name}'`);
}
```

#### `modifyTable`

```typescript
case "modifyTable": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    if (!table) return errorResult(`Table not found`);
    
    // Update name, schema, or other table-level properties
    if (edit.table.name) table.name = edit.table.name;
    if (edit.table.schema) table.schema = edit.table.schema;
    
    controller.updateTable(table.id, table);
    results.push(`Modified table '${edit.schemaName}.${edit.tableName}'`);
}
```

#### `deleteTable`

```typescript
case "deleteTable": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    if (!table) return errorResult(`Table not found`);
    
    // Skip the deletion confirmation dialog
    controller.setSkipDeleteConfirmation(true);
    controller.deleteTable(table.id);
    results.push(`Deleted table '${edit.schemaName}.${edit.tableName}'`);
}
```

#### `addColumn`

```typescript
case "addColumn": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    table.columns.push({
        id: uuidv4(),
        name: edit.column.name,
        dataType: edit.column.dataType,
        isPrimaryKey: edit.column.isPrimaryKey ?? false,
        isNullable: edit.column.isNullable ?? true,
        isIdentity: edit.column.isIdentity ?? false,
        defaultValue: edit.column.defaultValue ?? "",
    });
    controller.updateTable(table.id, table);
}
```

#### `modifyColumn`

```typescript
case "modifyColumn": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    const column = table.columns.find(c => c.name === edit.columnName);
    if (!column) return errorResult(`Column not found`);
    
    // Apply only the properties that were specified
    if (edit.column.name !== undefined) column.name = edit.column.name;
    if (edit.column.dataType !== undefined) column.dataType = edit.column.dataType;
    if (edit.column.isPrimaryKey !== undefined) column.isPrimaryKey = edit.column.isPrimaryKey;
    // ...
    
    controller.updateTable(table.id, table);
}
```

#### `deleteColumn`

```typescript
case "deleteColumn": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    table.columns = table.columns.filter(c => c.name !== edit.columnName);
    controller.updateTable(table.id, table);
}
```

#### `addForeignKey`

```typescript
case "addForeignKey": {
    const table = findTable(schema, edit.tableName, edit.schemaName);
    
    // Parse "schema.table" format for referenced table
    const [refSchema, refTable] = parseTableReference(edit.foreignKey.referencedTable);
    
    table.foreignKeys.push({
        id: uuidv4(),
        name: edit.foreignKey.name,
        columns: edit.foreignKey.columns,
        referencedSchemaName: refSchema,
        referencedTableName: refTable,
        referencedColumns: edit.foreignKey.referencedColumns,
        onDeleteAction: edit.foreignKey.onDelete || OnAction.NoAction,
        onUpdateAction: edit.foreignKey.onUpdate || OnAction.NoAction,
    });
    
    controller.updateTable(table.id, table);
}
```

#### `modifyForeignKey` and `deleteForeignKey`

Follow the same pattern as columns — find by name, update or remove.

### Batch Processing

All edits in the `edits` array are processed sequentially in a single call. After all edits:

```typescript
// Push undo state so the user can undo the entire batch
controller.pushUndoState();

// Regenerate the SQL script
controller.refreshScript();

// Return the results
return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify({
        success: true,
        results: results,
        newSchemaVersion: controller.getSchemaVersion(),
    }))
]);
```

The response includes the **new schema version** so the LLM can use it for subsequent edits without re-reading the schema.

---

## Error Handling

### Table/Column/FK Not Found

```typescript
if (!table) {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify({
            success: false,
            error: `Table '${schemaName}.${tableName}' not found. ` +
                   `Available tables: ${availableTableNames.join(", ")}`,
        }))
    ]);
}
```

When a target is not found, the error message includes the **list of available items** so the LLM can self-correct.

### Version Mismatch

```typescript
if (providedVersion !== currentVersion) {
    return errorResult(
        "Schema version mismatch. Please re-read the schema using get_overview or get_table."
    );
}
```

LLM is instructed to re-fetch and retry.

### No Active Schema Designer

```typescript
if (!controller) {
    return errorResult(
        "No Schema Designer is currently open. Use the 'show' operation first."
    );
}
```

---

## `prepareInvocation` — Confirmation UI

```typescript
async prepareInvocation(options, token) {
    const params = options.input;
    
    // Build a human-readable description of what the tool will do
    let confirmationMessage: string;
    
    switch (params.operation) {
        case "show":
            confirmationMessage = "Open the Schema Designer";
            break;
        case "get_overview":
            confirmationMessage = "Read the schema overview";
            break;
        case "get_table":
            confirmationMessage = `Read table '${params.schemaName}.${params.tableName}'`;
            break;
        case "apply_edits":
            const editDescriptions = params.edits.map(e => describeEdit(e));
            confirmationMessage = `Apply edits:\n${editDescriptions.join("\n")}`;
            break;
    }
    
    return {
        invocationMessage: confirmationMessage,
    };
}
```

This shows a confirmation tooltip in the Copilot chat UI before the tool runs, so the user can see what operations will be performed.

---

## Telemetry

```typescript
// Each operation records telemetry
sendActionEvent(TelemetryViews.SchemaDesignerCopilotTool, TelemetryActions.ToolInvoked, {
    operation: params.operation,
    editCount: params.edits?.length?.toString(),
    success: result.success.toString(),
});
```

Telemetry is collected for:
- Which operation was called
- How many edits were in a batch
- Whether the operation succeeded or failed
- Duration (via start/end timestamps)

No user data or schema content is sent — only structural metadata.

---

## Data Flow: Copilot Chat → Schema Diagram

```
User in Copilot Chat: "Add an Email column to the Users table"
                    │
                    ▼
        LLM decides to call schemaDesigner tool
                    │
                    ▼
        prepareInvocation() → "Apply edits: Add column 'Email' to 'dbo.Users'"
                    │
                    ▼ (user confirms)
        invoke({ operation: "apply_edits", edits: [...], schemaVersion: "abc123" })
                    │
                    ▼
        Version check: "abc123" === currentHash? ✓
                    │
                    ▼
        Process edit: addColumn → table.columns.push({ name: "Email", ... })
                    │
                    ▼
        controller.updateTable() → sends to webview via RPC
                    │
                    ▼
        React state updates → node re-renders with new column
                    │
                    ▼
        controller.pushUndoState() + controller.refreshScript()
                    │
                    ▼
        Return: { success: true, newSchemaVersion: "def456" }
                    │
                    ▼
        LLM receives result → responds to user: "Done! Added Email column."
```

---

## Key Design Decisions

1. **Optimistic concurrency via SHA-256**: Prevents stale edits without requiring locks. The LLM simply retries with fresh data if a conflict occurs.

2. **Batch edits**: All changes in one `apply_edits` call are treated as a single undo unit. This prevents the user from having to undo 10 times for a 10-edit batch.

3. **Skip delete confirmation**: The tool sets `skipDeleteConfirmation` before deleting tables, so the user doesn't get dialog popups during AI-driven edits.

4. **Compact overview**: `get_overview` returns minimal data (name + counts) to conserve LLM tokens. The LLM can call `get_table` for full details when needed.

5. **Available items in errors**: When a target isn't found, listing available options helps the LLM self-correct without another round-trip.
