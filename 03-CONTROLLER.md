# 03 — Controller & Manager

> **Files covered:**
> - [schemaDesigner/schemaDesignerWebviewController.ts](../extensions/mssql/src/schemaDesigner/schemaDesignerWebviewController.ts)
> - [schemaDesigner/schemaDesignerWebviewManager.ts](../extensions/mssql/src/schemaDesigner/schemaDesignerWebviewManager.ts)

These two files form the **extension host side** of Schema Designer. The Manager is a singleton that handles lifecycle. The Controller is a per-instance class that handles all RPC communication between the webview and the backend.

---

## File 1: `SchemaDesignerWebviewController`

This class **extends `ReactWebviewPanelController`** — the base class for all webview-based panels in vscode-mssql. It manages one Schema Designer tab for one specific database.

### Class Hierarchy

```
ReactWebviewPanelController<WebviewState, Reducers>
    └── SchemaDesignerWebviewController
```

The generic parameters are:
- `SchemaDesigner.SchemaDesignerWebviewState` — state pushed from host to webview (feature flags)
- `SchemaDesigner.SchemaDesignerReducers` — actions the webview can call on the host

### Constructor Parameters

```typescript
constructor(
    context: vscode.ExtensionContext,         // VS Code extension context
    vscodeWrapper: VscodeWrapper,             // Wrapper around VS Code APIs
    mainController: MainController,            // Reference to the main controller
    schemaDesignerService: ISchemaDesignerService, // The service for backend calls
    connectionString: string,                  // Full SQL connection string
    accessToken: string | undefined,           // Azure AD token (optional)
    databaseName: string,                      // Database name (e.g. "AdventureWorks")
    schemaDesignerCache: Map<string, CacheItem>, // Shared cache across all instances
    treeNode?: TreeNodeInfo,                   // Object Explorer tree node (if opened from OE)
    connectionUri?: string,                    // Connection URI (if opened from active connection)
)
```

The constructor:
1. Calls `super()` to create the webview panel with title = database name and a custom icon
2. Computes a cache key: `${connectionString}-${databaseName}`
3. Resolves the server name from either the tree node or connection URI
4. Calls `setupRequestHandlers()` and `setupConfigurationListener()`

### Private State

| Field | Type | Purpose |
|-------|------|---------|
| `_sessionId` | `string` | The backend session ID |
| `_key` | `string` | Cache key (`connectionString-databaseName`) |
| `_serverName` | `string \| undefined` | Display name of the server |
| `_dabService` | `DabService` | Data API Builder service instance |
| `schemaDesignerDetails` | `CreateSessionResponse \| undefined` | The full session data |
| `baselineSchema` | `Schema \| undefined` | Snapshot at last publish (for diffs) |
| `_initTimelineStartMs` | `number \| undefined` | Performance tracking for initialization |

---

### Request Handlers (the core of the controller)

The controller registers handlers for messages coming FROM the webview.

#### `InitializeSchemaDesignerRequest`

```typescript
this.onRequest(SchemaDesigner.InitializeSchemaDesignerRequest.type, async () => {
```

**Flow:**
1. Check the cache for an existing session for this `connectionString + databaseName`
2. If NOT cached → call `schemaDesignerService.createSession()` with connection details
3. If cached → use the cached response
4. Store the response in `schemaDesignerDetails` and `baselineSchema`
5. Return the `CreateSessionResponse` to the webview

**Performance logging:** Records timestamps at each stage and logs elapsed times (e.g., "createSession finished, duration=450ms").

**Telemetry:** Wraps the entire operation in a telemetry activity for tracking success/failure rates and table counts.

#### `GetDefinitionRequest`

```typescript
this.onRequest(SchemaDesigner.GetDefinitionRequest.type, async (payload) => {
```

**Flow:**
1. Receive the current `updatedSchema` from the webview
2. Forward it to `schemaDesignerService.getDefinition()` with the session ID
3. Update the cache with the new schema state
4. Return the SQL script to the webview

This is called frequently — every time the user makes a change and the Definitions Panel needs to refresh.

#### `GetReportWebviewRequest`

```typescript
this.onRequest(SchemaDesigner.GetReportWebviewRequest.type, async (payload) => {
```

**Flow:**
1. Show a VS Code progress notification ("Generating report...")
2. Call `schemaDesignerService.getReport()` with the current schema
3. Update cache
4. Return the report (including DacFx analysis)
5. On error, return the error message instead of throwing

#### `PublishSessionRequest`

```typescript
this.onRequest(SchemaDesigner.PublishSessionRequest.type, async (payload) => {
```

**Flow:**
1. Call `schemaDesignerService.publishSession()` to apply changes
2. Reset the cache dirty flag to `false`
3. Reset `baselineSchema` to the published schema (so future diffs compare against the new baseline)
4. Prompt for NPS (Net Promoter Score) survey
5. Return `{ success: true, updatedSchema }` or `{ success: false, error }` on failure

#### `GetBaselineSchemaRequest`

```typescript
this.onRequest(SchemaDesigner.GetBaselineSchemaRequest.type, async () => {
```

Returns the baseline schema (from cache or controller field) so the webview can compute diffs.

---

### Notification Handlers

These handle one-way messages from the webview (no response expected).

#### `ExportToFileNotification`

Shows a Save dialog, then writes the diagram image (SVG or PNG/JPEG) to the selected file path.

- SVG: Decoded from URI-encoded UTF-8
- PNG/JPEG: Decoded from base64

#### `CopyToClipboardNotification`

Copies the given text to the system clipboard and shows a confirmation message.

#### `OpenInEditorNotification`

Gets the current SQL definition and opens it in a new SQL editor tab (without a database connection).

#### `OpenInEditorWithConnectionNotification`

Gets the **migration script** (via `generateScript`) and opens it in a new SQL editor tab **with** the original database connection attached. This way the user can run the script directly.

Shows a progress notification while generating the script.

#### `CloseSchemaDesignerNotification`

Disposes the webview panel (closes the tab).

#### `SchemaDesignerDirtyStateNotification`

Updates the cache's `isDirty` flag based on whether the webview has unsaved changes.

---

### DAB Request Handlers

```typescript
this.onRequest(Dab.GenerateConfigRequest.type, async (payload) => {
    return this._dabService.generateConfig(payload.config, {
        connectionString: this.connectionString,
    });
});
```

Handles Data API Builder configuration generation and editor opening.

---

### Configuration Listener

```typescript
private setupConfigurationListener() {
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(configSchemaDesignerEnableExpandCollapseButtons)) {
            this.updateState({ enableExpandCollapseButtons: newValue });
        }
        if (e.affectsConfiguration(configEnableDab)) {
            this.updateState({ enableDAB: newValue });
        }
    });
}
```

When the user changes settings that affect Schema Designer, the controller pushes updated state to the webview.

---

### Cache Management

```typescript
private updateCacheItem(updatedSchema?: Schema, isDirty?: boolean): CacheItem {
```

Updates the shared cache map with the latest schema and/or dirty state. This cache is shared across all Schema Designer instances via the Manager.

---

### Public Methods (used by Copilot Tool)

#### `getSchemaState()`

```typescript
public async getSchemaState(): Promise<Schema> {
    await this.whenWebviewReady();
    const result = await this.sendRequest(GetSchemaStateRequest.type, undefined);
    return result.schema;
}
```

Asks the webview for its current schema state. The Copilot tool calls this to read what tables exist.

#### `applyEdits(params)`

```typescript
public async applyEdits(params: ApplyEditsWebviewParams): Promise<ApplyEditsWebviewResponse> {
    await this.whenWebviewReady();
    return this.sendRequest(ApplyEditsWebviewRequest.type, params);
}
```

Sends a batch of semantic edits to the webview for execution. The Copilot tool calls this to add tables, columns, etc.

---

### Lifecycle

```typescript
override async dispose(): Promise<void> {
    if (this.schemaDesignerDetails) {
        this.updateCacheItem(this.schemaDesignerDetails.schema);
    }
    super.dispose();
}
```

On dispose, saves the current state to the cache (so a restore can pick it up).

---

## File 2: `SchemaDesignerWebviewManager`

This is a **singleton** that manages all Schema Designer instances.

### Singleton Pattern

```typescript
private static instance: SchemaDesignerWebviewManager;

public static getInstance(): SchemaDesignerWebviewManager {
    if (!this.instance) {
        this.instance = new SchemaDesignerWebviewManager();
    }
    return this.instance;
}

private constructor() {}
```

### Private State

| Field | Type | Purpose |
|-------|------|---------|
| `schemaDesigners` | `Map<string, Controller>` | Active controllers, keyed by `connectionString-databaseName` |
| `schemaDesignerCache` | `Map<string, CacheItem>` | Persisted session data (survives controller dispose) |
| `schemaDesignerSchemaHashes` | `Map<string, string>` | Version hashes for Copilot tool concurrency |
| `_activeDesigner` | `Controller \| undefined` | The most recently visible designer |

### `getActiveDesigner()`

```typescript
public getActiveDesigner(): Controller | undefined {
    if (this._activeDesigner?.isDisposed || !this._activeDesigner?.panel.visible) {
        this._activeDesigner = undefined;
    }
    return this._activeDesigner;
}
```

Returns the currently visible Schema Designer, or `undefined` if none is visible. Used by the Copilot tool to find which designer to operate on.

### `getSchemaDesigner()` — The Main Method

This is the **entry point** for opening a Schema Designer. Parameters:

1. `context`, `vscodeWrapper`, `mainController`, `schemaDesignerService` — dependencies
2. `databaseName` — which database
3. `treeNode` OR `connectionUri` — how to get the connection

**Flow:**

1. **Get connection details:**
   - If `treeNode`: Extract connection profile, prepare credentials, get connection string
   - If `connectionUri`: Get connection info from the connection manager

2. **Compute cache key:** `${connectionString}-${databaseName}`

3. **Check for existing instance:**
   - If a controller exists for this key and isn't disposed → reuse it
   - Otherwise → create a new `SchemaDesignerWebviewController`

4. **Set up lifecycle management for the new controller:**
   - `onDidChangeViewState` → track which designer is active
   - `onDisposed` → handle cleanup:
     - Remove from the `schemaDesigners` map
     - Clear schema hash
     - If the cache shows dirty state → prompt the user: "Restore?"
       - If "Restore" → recursively call `getSchemaDesigner()` to reopen
       - If declined → dispose the backend session and delete the cache entry

5. **Store and return** the controller

### Schema Hash Methods

```typescript
public getSchemaHash(cacheKey: string): string | undefined
public setSchemaHash(cacheKey: string, hash: string): void
public clearSchemaHash(cacheKey: string): void
```

Used by the Copilot tool for optimistic concurrency control. The hash is a SHA-256 of the normalized schema state.

---

## How Controller & Manager Work Together

```
User right-clicks database → "Design Schema"
                    ↓
          SchemaDesignerWebviewManager.getSchemaDesigner()
                    ↓
          ┌─ Controller exists? ──► Reuse (reveal panel)
          │
          └─ No controller ──► Create new SchemaDesignerWebviewController
                                  ↓
                               Webview renders
                                  ↓
                               Webview sends InitializeSchemaDesignerRequest
                                  ↓
                               Controller checks cache
                                  ↓
                    ┌─ Cached? ──► Return cached session data
                    │
                    └─ Not cached ──► Call schemaDesignerService.createSession()
                                       ↓
                                    Store in cache, return to webview
```

When the user closes the tab:

```
User closes tab
      ↓
Controller.dispose() ──► Save state to cache
      ↓
Manager.onDisposed callback
      ↓
Cache is dirty? ──► Show "Restore?" dialog
      ↓                    ↓
     No                  Yes, Restore
      ↓                    ↓
  Dispose session     Reopen (recursive call)
  Delete cache
```
