# 01 — Shared Interfaces & Types

> **Files covered:**
> - [sharedInterfaces/schemaDesigner.ts](../extensions/mssql/src/sharedInterfaces/schemaDesigner.ts)
> - [models/contracts/schemaDesigner.ts](../extensions/mssql/src/models/contracts/schemaDesigner.ts)

These two files define **every single TypeScript type, interface, enum, and RPC message** used across the entire Schema Designer feature — from the extension host to the webview to the backend service.

---

## File 1: `sharedInterfaces/schemaDesigner.ts`

This is the **master type file**. Everything lives inside the `SchemaDesigner` namespace. It is imported by virtually every other Schema Designer file in the codebase.

### Core Data Model

#### `Schema`
```typescript
interface Schema {
    tables: Table[];
}
```
The top-level container. A schema is simply an array of tables. This is the root data structure that flows everywhere: from the backend → controller → webview → React Flow nodes → and back.

#### `Table`
```typescript
type Table = {
    id: string;       // UUID, uniquely identifies this table across the session
    name: string;     // e.g. "Employees"
    schema: string;   // e.g. "dbo"
    columns: Column[];
    foreignKeys: ForeignKey[];
};
```
Each table has a unique `id` (a UUID generated when the table is first loaded from the database or when the user creates a new one). The `schema` field is the SQL Server schema name (like `dbo`, `Sales`), NOT to be confused with the overall `Schema` type.

#### `Column`
```typescript
interface Column {
    id: string;                // UUID
    name: string;              // e.g. "EmployeeId"
    dataType: string;          // e.g. "int", "nvarchar"
    maxLength: string;         // e.g. "50", "MAX", or ""
    precision: number;         // For decimal/numeric types
    scale: number;             // For decimal/numeric/time types
    isPrimaryKey: boolean;
    isIdentity: boolean;       // Auto-incrementing column
    identitySeed: number;      // Starting value for identity
    identityIncrement: number; // Increment step
    isNullable: boolean;
    defaultValue: string;      // Default constraint expression
    isComputed: boolean;       // Is this a computed column?
    computedFormula: string;   // e.g. "[Price] * [Quantity]"
    computedPersisted: boolean; // Is the computed value stored physically?
}
```
Every possible SQL Server column property is represented here. The `maxLength` is a string because it can be `"MAX"` (for varchar(MAX)).

#### `ForeignKey`
```typescript
type ForeignKey = {
    id: string;                   // UUID
    name: string;                 // e.g. "FK_Orders_Customers"
    columns: string[];            // Source column names  (e.g. ["CustomerId"])
    referencedSchemaName: string; // e.g. "dbo"
    referencedTableName: string;  // e.g. "Customers"
    referencedColumns: string[];  // Target column names (e.g. ["Id"])
    onDeleteAction: OnAction;
    onUpdateAction: OnAction;
};
```
Foreign keys reference columns by **name** (not by ID). The `columns` and `referencedColumns` arrays are parallel — `columns[0]` maps to `referencedColumns[0]`, etc.

#### `OnAction` enum
```typescript
enum OnAction {
    CASCADE = 0,
    NO_ACTION = 1,
    SET_NULL = 2,
    SET_DEFAULT = 3,
}
```
Controls what happens to child rows when the parent is updated/deleted.

---

### Session Management Types

#### `CreateSessionRequest`
```typescript
interface CreateSessionRequest {
    connectionString: string;  // Full connection string to the SQL Server
    accessToken?: string;      // For Azure AD authentication
    databaseName: string;      // Which database to load
}
```
Sent from the extension host to the SQL Tools Service when the user first opens a Schema Designer for a database.

#### `CreateSessionResponse`
```typescript
interface CreateSessionResponse {
    schema: Schema;          // The entire schema loaded from the database
    dataTypes: string[];     // All available data types (e.g. ["int", "varchar", ...])
    schemaNames: string[];   // All available schema names (e.g. ["dbo", "Sales"])
    sessionId: string;       // UUID identifying this server-side session
}
```
This response is what populates the entire UI. The `dataTypes` list populates the data type dropdowns. The `schemaNames` list populates the schema dropdowns.

#### `DisposeSessionRequest`
```typescript
interface DisposeSessionRequest {
    sessionId: string;
}
```
Tells the backend to clean up this session's resources.

#### `GenerateScriptRequest` / `GenerateScriptResponse`
```typescript
interface GenerateScriptRequest { sessionId: string; }
interface GenerateScriptResponse { script: string; }
```
Generates a SQL script that would apply all changes from the current schema to the database. This is what opens in a SQL editor when the user clicks "Open Script".

#### `GetDefinitionRequest` / `GetDefinitionResponse`
```typescript
interface GetDefinitionRequest {
    sessionId: string;
    updatedSchema: Schema;  // The current state of the schema in the UI
}
interface GetDefinitionResponse {
    script: string;  // CREATE TABLE statements for the current schema
}
```
Gets the SQL DDL definition (CREATE TABLE, ALTER TABLE, etc.) for the current state. This is shown in the Definitions Panel at the bottom.

#### `GetReportRequest` / `GetReportResponse`
```typescript
interface GetReportRequest {
    sessionId: string;
    updatedSchema: Schema;
}
interface GetReportResponse {
    hasSchemaChanged: boolean;
    dacReport: DacReport;
}
```
Before publishing, the system generates a DacFx deployment report showing what changes will be made.

#### `DacReport`
```typescript
interface DacReport {
    report: string;                   // XML/Markdown report text
    requireTableRecreation: boolean;  // Does any change require dropping and recreating a table?
    possibleDataLoss: boolean;        // Could any data be lost?
    hasWarnings: boolean;
}
```
This is shown in the "Publish" confirmation dialog so the user can review before applying.

#### `PublishSessionRequest`
```typescript
interface PublishSessionRequest {
    sessionId: string;
}
```
Actually applies the changes to the database.

---

### Service Interface

#### `ISchemaDesignerService`
```typescript
interface ISchemaDesignerService {
    createSession(request: CreateSessionRequest): Thenable<CreateSessionResponse>;
    disposeSession(request: DisposeSessionRequest): Thenable<void>;
    publishSession(request: PublishSessionRequest): Thenable<void>;
    getDefinition(request: GetDefinitionRequest): Thenable<GetDefinitionResponse>;
    generateScript(request: GenerateScriptRequest): Thenable<GenerateScriptResponse>;
    getReport(request: GetReportRequest): Thenable<GetReportResponse>;
    onSchemaReady(listener: (model: SchemaDesignerSession) => void): void;
}
```
The contract that `SchemaDesignerService` implements. All methods are async and communicate with the SQL Tools Service backend.

---

### Webview State Types

#### `SchemaDesignerWebviewState`
```typescript
interface SchemaDesignerWebviewState {
    enableExpandCollapseButtons?: boolean;  // Feature flag for expand/collapse on table nodes
    enableDAB?: boolean;                    // Feature flag for Data API Builder tab
    activeView?: SchemaDesignerActiveView;  // Which tab is active
}
```
This is the state that flows FROM the extension host TO the webview (one-directional). It controls feature flags.

#### `SchemaDesignerActiveView` enum
```typescript
enum SchemaDesignerActiveView {
    SchemaDesigner = "schemaDesigner",
    Dab = "dab",
}
```
Controls whether the Schema Designer tab or the DAB tab is active (when DAB is enabled).

#### `SchemaDesignerReducers`
```typescript
interface SchemaDesignerReducers {
    exportToFile: ExportFileOptions;
    getScript: GetScriptOptions;
    getReport: GetReportOptions;
    copyToClipboard: CopyToClipboardOptions;
    openInEditor: OpenInEditorOptions;
}
```
Defines the reducer actions the webview can trigger on the extension host.

---

### RPC Message Types (Webview ↔ Extension Host)

These are typed JSON-RPC messages sent between the webview and extension host.

| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| `InitializeSchemaDesignerRequest` | Webview → Host | Load or reload the schema session |
| `GetDefinitionRequest` | Webview → Host | Get SQL DDL for current schema |
| `GetReportWebviewRequest` | Webview → Host | Get deployment report before publish |
| `PublishSessionRequest` | Webview → Host | Apply changes to database |
| `GetBaselineSchemaRequest` | Webview → Host | Get the starting schema for diff comparison |
| `GetSchemaStateRequest` | Host → Webview | Ask webview for its current schema state |
| `ApplyEditsWebviewRequest` | Host → Webview | Apply bulk edits from Copilot tool |
| `ExportToFileNotification` | Webview → Host | Save diagram as image file |
| `CopyToClipboardNotification` | Webview → Host | Copy text to clipboard |
| `OpenInEditorNotification` | Webview → Host | Open SQL in editor without connection |
| `OpenInEditorWithConnectionNotification` | Webview → Host | Open SQL in editor with connection |
| `CloseSchemaDesignerNotification` | Webview → Host | Close the panel |
| `SchemaDesignerDirtyStateNotification` | Webview → Host | Inform host about unsaved changes |

---

### Deleted-Flag Types

```typescript
type TableWithDeletedFlag = Table & { isDeleted?: boolean };
type ColumnWithDeletedFlag = Column & { isDeleted?: boolean };
type ForeignKeyWithDeletedFlag = ForeignKey & { isDeleted?: boolean };
```
Used in the diff visualization to show "ghost" nodes/rows for deleted items.

---

### Copilot Tool Edit Types

These types support the AI-driven editing that the Copilot LM tool uses.

#### `TableRef` / `ColumnRef` / `ForeignKeyRef`
```typescript
interface TableRef { schema: string; name: string; id?: string; }
interface ColumnRef { name: string; id?: string; }
interface ForeignKeyRef { name: string; id?: string; }
```
Name-based references. The Copilot tool does NOT know internal UUIDs, so it identifies objects by name. If `id` is provided, it takes priority.

#### `ColumnCreate`
```typescript
type ColumnCreate = Partial<Omit<Column, "id"> & {
    name: string;
    dataType: string;
}>;
```
A partial column definition for creating new columns. Only `name` and `dataType` are required; everything else gets defaults.

#### `ForeignKeyCreate`
```typescript
interface ForeignKeyCreate {
    name: string;
    referencedTable: TableRef;
    mappings: ForeignKeyMapping[];  // [{column: "OrderId", referencedColumn: "Id"}]
    onDeleteAction: number;
    onUpdateAction: number;
}
```

#### `SchemaDesignerEdit` (discriminated union)
```typescript
type SchemaDesignerEdit =
    | { op: "add_table"; table: TableRef; initialColumns?: ColumnCreate[] }
    | { op: "drop_table"; table: TableRef }
    | { op: "set_table"; table: TableRef; set: { name?: string; schema?: string } }
    | { op: "add_column"; table: TableRef; column: ColumnCreate }
    | { op: "drop_column"; table: TableRef; column: ColumnRef }
    | { op: "set_column"; table: TableRef; column: ColumnRef; set: Partial<ColumnCreate> }
    | { op: "add_foreign_key"; table: TableRef; foreignKey: ForeignKeyCreate }
    | { op: "drop_foreign_key"; table: TableRef; foreignKey: ForeignKeyRef }
    | { op: "set_foreign_key"; table: TableRef; foreignKey: ForeignKeyRef; set: ... }
```
This is the **core edit operation type**. Each variant has an `op` field that determines what kind of edit it is. The Copilot tool sends an array of these to the webview via `ApplyEditsWebviewRequest`.

#### `ApplyEditsWebviewResponse`
```typescript
interface ApplyEditsWebviewResponse {
    success: boolean;
    message?: string;
    reason?: "not_found" | "ambiguous_identifier" | "validation_error" | "invalid_request" | "internal_error";
    failedEditIndex?: number;   // Which edit in the batch failed
    appliedEdits?: number;      // How many edits were applied before failure
    schema?: Schema;            // Full schema after edits (for version computation)
}
```
Tells the Copilot tool whether the edits succeeded, and if not, exactly which one failed and why.

---

### Cache Types

#### `SchemaDesignerCacheItem`
```typescript
interface SchemaDesignerCacheItem {
    schemaDesignerDetails: CreateSessionResponse;
    baselineSchema: Schema;  // Snapshot at last publish
    isDirty: boolean;        // Are there unsaved changes?
}
```
Stored in the `SchemaDesignerWebviewManager`'s cache map, keyed by `${connectionString}-${databaseName}`.

---

## File 2: `models/contracts/schemaDesigner.ts`

This file defines the **Language Server Protocol request types** used to communicate with the SQL Tools Service backend.

```typescript
export namespace SchemaDesignerRequests {
    export namespace CreateSession {
        export const type = new RequestType<CreateSessionRequest, CreateSessionResponse, void, void>(
            "schemaDesigner/createSession"
        );
    }
    export namespace DisposeSession {
        export const type = new RequestType<DisposeSessionRequest, void, void, void>(
            "schemaDesigner/disposeSession"
        );
    }
    export namespace GenerateScript {
        export const type = new RequestType<GenerateScriptRequest, GenerateScriptResponse, void, void>(
            "schemaDesigner/generateScript"
        );
    }
    export namespace GetDefinition {
        export const type = new RequestType<GetDefinitionRequest, GetDefinitionResponse, void, void>(
            "schemaDesigner/getDefinition"
        );
    }
    export namespace GetReport {
        export const type = new RequestType<GetReportRequest, GetReportResponse, void, void>(
            "schemaDesigner/getReport"
        );
    }
    export namespace PublishSession {
        export const type = new RequestType<PublishSessionRequest, void, void, void>(
            "schemaDesigner/publishSession"
        );
    }
}
```

Each namespace wraps a `RequestType` object from `vscode-languageclient`. These types are used by `SchemaDesignerService` to send strongly-typed requests over the LSP channel. The string like `"schemaDesigner/createSession"` is the **method name** that SQL Tools Service registers as an RPC handler.

---

## How These Types Flow Through the System

```
SQL Tools Service          Extension Host                   Webview
(C#/.NET backend)          (Node.js)                        (React)

    ◄──── LSP Request ────  SchemaDesignerService
          types use            ↕ uses
          contracts/*.ts    SchemaDesignerWebviewController
                               ↕ uses
                            sharedInterfaces/schemaDesigner.ts
                               ↕ webview RPC
                            SchemaDesignerStateProvider
                               reads same shared interfaces
```

Because `sharedInterfaces/schemaDesigner.ts` is in a shared location, both the extension host code and the webview code import from the same file. This ensures type safety across the webview boundary.
