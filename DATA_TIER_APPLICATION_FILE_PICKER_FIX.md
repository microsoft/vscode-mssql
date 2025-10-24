# Data-tier Application File Picker Fix

## Issue

The browse button to select files and specify where to save files was not opening the system file picker with the appropriate file extension filters (.dacpac or .bacpac).

## Root Cause

The browse button in the Data-tier Application form had no onClick handler connected to it. The button was rendering but not functional - clicking it did nothing.

## Solution Applied

Implemented full RPC communication between the webview and extension to enable file browsing with proper filters.

### 1. Added RPC Request Types

**File**: `src/sharedInterfaces/dataTierApplication.ts`

Added two new request types for file browsing:

```typescript
/**
 * Request to browse for an input file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseInputFileWebviewRequest {
    export const type = new RequestType<{ fileExtension: string }, { filePath?: string }, void>(
        "dataTierApplication/browseInputFile",
    );
}

/**
 * Request to browse for an output file (DACPAC or BACPAC) from the webview
 */
export namespace BrowseOutputFileWebviewRequest {
    export const type = new RequestType<
        { fileExtension: string; defaultFileName?: string },
        { filePath?: string },
        void
    >("dataTierApplication/browseOutputFile");
}
```

### 2. Implemented RPC Handlers in Controller

**File**: `src/controllers/dataTierApplicationWebviewController.ts`

Added two request handlers that use VS Code's native file picker dialogs:

**Browse for Input File** (Deploy DACPAC, Import BACPAC):

```typescript
this.onRequest(BrowseInputFileWebviewRequest.type, async (params: { fileExtension: string }) => {
    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: LocConstants.DataTierApplication.Select,
        filters: {
            [`${params.fileExtension.toUpperCase()} Files`]: [params.fileExtension],
        },
    });

    if (!fileUri || fileUri.length === 0) {
        return { filePath: undefined };
    }

    return { filePath: fileUri[0].fsPath };
});
```

**Browse for Output File** (Extract DACPAC, Export BACPAC):

```typescript
this.onRequest(
    BrowseOutputFileWebviewRequest.type,
    async (params: { fileExtension: string; defaultFileName?: string }) => {
        const defaultFileName = params.defaultFileName || `database.${params.fileExtension}`;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const defaultUri = workspaceFolder
            ? vscode.Uri.joinPath(workspaceFolder, defaultFileName)
            : vscode.Uri.file(path.join(require("os").homedir(), defaultFileName));

        const fileUri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            saveLabel: LocConstants.DataTierApplication.Save,
            filters: {
                [`${params.fileExtension.toUpperCase()} Files`]: [params.fileExtension],
            },
        });

        if (!fileUri) {
            return { filePath: undefined };
        }

        return { filePath: fileUri.fsPath };
    },
);
```

### 3. Added Localization Strings

**File**: `src/constants/locConstants.ts`

Added two new localization strings:

```typescript
export class DataTierApplication {
    // ... existing strings ...
    public static Select = l10n.t("Select");
    public static Save = l10n.t("Save");
}
```

### 4. Implemented handleBrowseFile Function in Form

**File**: `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx`

Added the browse handler function that:

1. Determines the correct file extension based on operation type (dacpac or bacpac)
2. Calls the appropriate RPC request (input vs output file)
3. Updates the file path state when a file is selected
4. Clears validation errors
5. Validates the selected file path

```typescript
const handleBrowseFile = async () => {
    const fileExtension =
        operationType === DataTierOperationType.Deploy ||
        operationType === DataTierOperationType.Extract
            ? "dacpac"
            : "bacpac";

    let result: { filePath?: string } | undefined;

    if (requiresInputFile) {
        // Browse for input file (Deploy or Import)
        result = await context?.extensionRpc?.sendRequest(BrowseInputFileWebviewRequest.type, {
            fileExtension,
        });
    } else {
        // Browse for output file (Extract or Export)
        const defaultFileName = `${initialDatabaseName || "database"}.${fileExtension}`;
        result = await context?.extensionRpc?.sendRequest(BrowseOutputFileWebviewRequest.type, {
            fileExtension,
            defaultFileName,
        });
    }

    if (result?.filePath) {
        setFilePath(result.filePath);
        // Clear validation error when file is selected
        const newErrors = { ...validationErrors };
        delete newErrors.filePath;
        setValidationErrors(newErrors);
        // Validate the selected file path
        await validateFilePath(result.filePath, requiresInputFile);
    }
};
```

### 5. Connected onClick Handler to Button

**File**: `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx`

Updated the Browse button to call the handler:

```tsx
<Button
    icon={<FolderOpen20Regular />}
    appearance="secondary"
    onClick={handleBrowseFile}
    disabled={isOperationInProgress}>
    {locConstants.dataTierApplication.browse}
</Button>
```

## Key Features

### File Extension Filtering

-   **Deploy DACPAC**: Shows only .dacpac files
-   **Extract DACPAC**: Saves as .dacpac with default filename
-   **Import BACPAC**: Shows only .bacpac files
-   **Export BACPAC**: Saves as .bacpac with default filename

### Smart Default Paths

-   **Input Files**: Opens in workspace folder or user's home directory
-   **Output Files**: Suggests filename based on database name (e.g., "AdventureWorks.dacpac")
-   Falls back to "database.dacpac" or "database.bacpac" if database name unavailable

### User Experience

-   Native OS file picker dialogs
-   Proper file extension filters
-   Automatic validation after file selection
-   Clears previous validation errors
-   Disabled during operation execution

## Files Modified

1. `src/sharedInterfaces/dataTierApplication.ts` - Added 2 RPC request types
2. `src/controllers/dataTierApplicationWebviewController.ts` - Added 2 request handlers
3. `src/constants/locConstants.ts` - Added 2 localization strings
4. `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx` - Added handleBrowseFile function and onClick handler

## Testing

To verify the fix:

1. Launch the extension in debug mode (F5)
2. Connect to SQL Server in Object Explorer
3. Right-click a database → "Data-tier Application"
4. **Test Deploy DACPAC**:
    - Click Browse button
    - Verify file picker shows only .dacpac files
    - Select a file and verify path is populated
5. **Test Extract DACPAC**:
    - Select "Extract DACPAC" operation
    - Click Browse button
    - Verify save dialog suggests "DatabaseName.dacpac"
    - Choose location and verify path is populated
6. **Test Import BACPAC**:
    - Select "Import BACPAC" operation
    - Click Browse button
    - Verify file picker shows only .bacpac files
7. **Test Export BACPAC**:
    - Select "Export BACPAC" operation
    - Click Browse button
    - Verify save dialog suggests "DatabaseName.bacpac"

## Result

✅ Browse button now opens system file picker
✅ Correct file extensions filtered (.dacpac or .bacpac)
✅ Smart default filenames for save operations
✅ Automatic validation after file selection
✅ Follows VS Code file picker patterns (similar to Schema Compare)
✅ Full RPC communication between webview and extension
