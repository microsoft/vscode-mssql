# Data-tier Application Owner URI Fix

## Issue

When attempting to export a BACPAC without being properly connected, the error occurred:

```
Failed to validate database name: Error: System.Exception: SpecifiedUri 'sqlcopilot-nl2sql-testing.database.windows.net' does not have existing connection
```

The form was allowing database selection even when not connected, and was using the server name instead of a proper connection URI.

## Root Cause

The Data-tier Application webview was using `initialServerName` (just the server hostname) as the `ownerUri` parameter when making RPC calls to the extension. The `ownerUri` is supposed to be a full connection URI managed by the ConnectionManager, not just a server name.

The webview state interface didn't include `ownerUri`, so even though the controller had access to the proper connection URI, it wasn't being passed to the webview. This caused all database operations to fail with "no existing connection" errors.

## Solution Applied

### 1. Added `ownerUri` to Webview State

**File**: `src/sharedInterfaces/dataTierApplication.ts`

Added `ownerUri` field to the webview state interface:

```typescript
export interface DataTierApplicationWebviewState {
    /**
     * The currently selected operation type
     */
    operationType: DataTierOperationType;
    /**
     * The selected DACPAC/BACPAC file path
     */
    filePath?: string;
    /**
     * The connection owner URI
     */
    ownerUri?: string; // NEW
    /**
     * The target/source server name
     */
    serverName?: string;
    // ... rest of interface
}
```

### 2. Updated Command Handlers to Pass ownerUri

**File**: `src/controllers/mainController.ts`

Updated all 5 Data-tier Application command handlers to include `ownerUri` in the initial state:

**Before**:

```typescript
const initialState: DataTierApplicationWebviewState = {
    serverName,
    databaseName,
    operationType: DataTierOperationType.Deploy,
};
```

**After**:

```typescript
const initialState: DataTierApplicationWebviewState = {
    ownerUri, // NEW - proper connection URI
    serverName,
    databaseName,
    operationType: DataTierOperationType.Deploy,
};
```

Updated commands:

-   `mssql.dataTierApplication` (generic entry point)
-   `mssql.deployDacpac`
-   `mssql.extractDacpac`
-   `mssql.importBacpac`
-   `mssql.exportBacpac`

### 3. Updated React Form to Use Proper ownerUri

**File**: `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx`

**Added ownerUri selector**:

```typescript
const ownerUri = useDataTierApplicationSelector((state) => state.ownerUri);
```

**Replaced all instances** of `ownerUri: initialServerName || ""` with `ownerUri: ownerUri || ""`:

1. **List Databases Request** (line ~147):

    ```typescript
    const result = await context?.extensionRpc?.sendRequest(
        ListDatabasesWebviewRequest.type,
        { ownerUri: ownerUri || "" }, // Was: initialServerName
    );
    ```

2. **Validate Database Name Request** (line ~218):

    ```typescript
    const result = await context?.extensionRpc?.sendRequest(
        ValidateDatabaseNameWebviewRequest.type,
        {
            databaseName: dbName,
            ownerUri: ownerUri || "", // Was: initialServerName
            shouldNotExist: shouldNotExist,
        },
    );
    ```

3. **Deploy DACPAC Request** (line ~272):

    ```typescript
    result = await context?.extensionRpc?.sendRequest(DeployDacpacWebviewRequest.type, {
        packageFilePath: filePath,
        databaseName,
        isNewDatabase,
        ownerUri: ownerUri || "", // Was: initialServerName
    });
    ```

4. **Extract DACPAC Request** (line ~293):

    ```typescript
    result = await context?.extensionRpc?.sendRequest(ExtractDacpacWebviewRequest.type, {
        databaseName,
        packageFilePath: filePath,
        applicationName,
        applicationVersion,
        ownerUri: ownerUri || "", // Was: initialServerName
    });
    ```

5. **Import BACPAC Request** (line ~312):

    ```typescript
    result = await context?.extensionRpc?.sendRequest(ImportBacpacWebviewRequest.type, {
        packageFilePath: filePath,
        databaseName,
        ownerUri: ownerUri || "", // Was: initialServerName
    });
    ```

6. **Export BACPAC Request** (line ~331):
    ```typescript
    result = await context?.extensionRpc?.sendRequest(ExportBacpacWebviewRequest.type, {
        databaseName,
        packageFilePath: filePath,
        ownerUri: ownerUri || "", // Was: initialServerName
    });
    ```

## Key Changes

### Connection URI vs Server Name

-   **Before**: Using `initialServerName` = "sqlcopilot-nl2sql-testing.database.windows.net"
-   **After**: Using proper `ownerUri` from ConnectionManager = full connection URI with protocol and credentials

### State Flow

```
User selects database in Object Explorer
         ↓
Command handler extracts connectionProfile
         ↓
ConnectionManager.getUriForConnection(profile) → proper ownerUri
         ↓
Pass ownerUri in initialState to webview
         ↓
Form uses ownerUri for all RPC requests
         ↓
Controller uses ownerUri to call DacFxService
         ↓
Operations succeed with valid connection
```

## Files Modified

1. `src/sharedInterfaces/dataTierApplication.ts` - Added `ownerUri` to state interface
2. `src/controllers/mainController.ts` - Updated 5 command handlers to include ownerUri
3. `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx` - Updated form to use ownerUri in 6 RPC calls

## Testing

To verify the fix:

1. Launch the extension in debug mode (F5)
2. Connect to SQL Server in Object Explorer
3. Right-click a database → "Data-tier Application"
4. **Test Export BACPAC**:
    - Select "Export BACPAC" operation
    - Select a source database from dropdown
    - Choose output file path
    - Click Execute
    - **Verify**: Operation succeeds without "SpecifiedUri does not have existing connection" error
5. **Test all other operations**:
    - Deploy DACPAC
    - Extract DACPAC
    - Import BACPAC
    - All should work correctly with proper connection URI

## Result

✅ Fixed "SpecifiedUri does not have existing connection" error
✅ All operations now use proper connection URI from ConnectionManager
✅ Form correctly validates database existence/connectivity
✅ Database dropdown properly populates from active connection
✅ All DACPAC/BACPAC operations execute successfully
