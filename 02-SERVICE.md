# 02 — Service Layer

> **File covered:**
> - [services/schemaDesignerService.ts](../extensions/mssql/src/services/schemaDesignerService.ts)

---

## What Does the Service Do?

`SchemaDesignerService` is the **bridge between the extension host and the SQL Tools Service backend**. It takes requests from the controller, sends them over the Language Server Protocol (LSP) channel, and returns the responses.

Think of it as a thin RPC client — it doesn't contain any business logic itself. Its job is to:
1. Forward requests to the backend
2. Handle errors (log them and re-throw)
3. Provide a listener mechanism for schema-ready events

---

## Class: `SchemaDesignerService`

```typescript
export class SchemaDesignerService implements SchemaDesigner.ISchemaDesignerService {
```
It implements the `ISchemaDesignerService` interface defined in the shared interfaces file.

### Constructor

```typescript
constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
```
Takes a `SqlToolsServiceClient` — this is the vscode-mssql extension's connection to the background SQL Tools Service process. All RPC calls go through this client.

### Private State

```typescript
private _modelReadyListeners: ((modelReady: SchemaDesigner.SchemaDesignerSession) => void)[] = [];
```
An array of callback functions that get called when a schema model is ready. This is a simple observer pattern.

---

## Methods

### `createSession(request)`

```typescript
async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    try {
        return await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.CreateSession.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Sends a `schemaDesigner/createSession` request to the SQL Tools Service with the connection string, access token, and database name. The backend creates a session, loads the schema from the database, and returns:
- The full `Schema` (all tables, columns, foreign keys)
- The list of available data types
- The list of available schema names
- A `sessionId` to use in subsequent calls

**When called:** When the user opens a Schema Designer for a database for the first time (or when the cache doesn't have it).

---

### `disposeSession(request)`

```typescript
async disposeSession(request: DisposeSessionRequest): Promise<void> {
    try {
        await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.DisposeSession.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Tells the backend to clean up the server-side session identified by `sessionId`. Frees memory and releases any locks.

**When called:** When the user closes the Schema Designer webview panel and there are no unsaved changes (or they decline to restore).

---

### `getDefinition(request)`

```typescript
async getDefinition(request: GetDefinitionRequest): Promise<GetDefinitionResponse> {
    try {
        return await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.GetDefinition.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Sends the current schema state to the backend and gets back the SQL DDL script (CREATE TABLE, ALTER TABLE, etc.) that represents the current state.

**When called:** Every time the user makes a change. The definitions panel at the bottom of the Schema Designer shows this script live.

---

### `generateScript(request)`

```typescript
async generateScript(request: GenerateScriptRequest): Promise<GenerateScriptResponse> {
    try {
        return await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.GenerateScript.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Generates a SQL migration script — a diff script that would transform the database from its current state to the edited state. This is NOT the same as `getDefinition` (which shows CREATE TABLE). This shows ALTER TABLE, DROP TABLE, etc.

**When called:** When the user clicks "Open Script" to get the deployment SQL and open it in a new editor tab.

---

### `publishSession(request)`

```typescript
async publishSession(request: PublishSessionRequest): Promise<void> {
    try {
        await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.PublishSession.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Actually applies the schema changes to the database. This is the "deploy" operation — it runs the migration script against the live database.

**When called:** After the user confirms in the Publish dialog.

---

### `getReport(request)`

```typescript
async getReport(request: GetReportRequest): Promise<GetReportResponse> {
    try {
        return await this._sqlToolsClient.sendRequest(
            SchemaDesignerRequests.GetReport.type,
            request,
        );
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e;
    }
}
```

**What it does:** Gets a DacFx deployment report before publishing. The report tells the user:
- Whether any changes were detected
- Whether any tables need to be recreated (destructive)
- Whether there's potential data loss
- Whether there are warnings

**When called:** When the user clicks "Publish Changes" — before showing the confirmation dialog.

---

### `onSchemaReady(listener)`

```typescript
onSchemaReady(listener: (model: SchemaDesignerSession) => void): void {
    this._modelReadyListeners.push(listener);
}
```

**What it does:** Registers a callback that will be invoked when a schema model becomes ready. This is a notification mechanism.

**Note:** In the current code, this listener array is populated but the listeners are never actually invoked within this file. The notification firing likely happens through a different path in the SQL Tools Service notification handling.

---

## Error Handling Pattern

Every method follows the same pattern:
```typescript
try {
    return await this._sqlToolsClient.sendRequest(RequestType, request);
} catch (e) {
    this._sqlToolsClient.logger.error(e);
    throw e;
}
```

1. Try to send the LSP request
2. If it fails, log the error to the extension's output channel
3. Re-throw the error so the caller (the controller) can handle it (e.g., show an error dialog to the user)

---

## Where Is This Service Created?

In [mainController.ts](../extensions/mssql/src/controllers/mainController.ts), during extension activation:

```typescript
const schemaDesignerService = new SchemaDesignerService(this.sqlToolsClient);
```

The `SqlToolsServiceClient` is the extension's LSP client that manages the connection to the backend process. The service is then passed to the `SchemaDesignerWebviewManager` when creating controller instances.
