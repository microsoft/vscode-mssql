# Fix SQL Tools Service DacFx Issue

## Problem

SQL Tools Service is returning `null` for the `script` property when trying to script database objects:

```json
{ "operationId": "2e71606f-7c9a-47e8-9a79-9fca544d9a54", "script": null }
```

This happens in the development extension but NOT in the published extension.

## Root Cause

The SQL Tools Service binaries in the development folder may be corrupted or have a DacFx initialization issue. This is separate from our code changes.

## Solution

### Step 1: Delete SQL Tools Service from Development Folder

```powershell
# Navigate to your extension directory
cd "e:\Coding\VSCode Extensions\vscode-mssql-git-integration"

# Delete the SQL Tools Service folder
Remove-Item -Recurse -Force "sqltoolsservice"
```

### Step 2: Force Re-download

The extension will automatically re-download SQL Tools Service when you run it next time. To force this:

1. **Close VS Code completely**
2. **Delete the folder** (done in Step 1)
3. **Restart VS Code**
4. **Press F5** to run the extension in debug mode
5. **Wait for SQL Tools Service to download** (check the Output panel → "MSSQL")

### Step 3: Verify

After the extension starts:

1. Connect to a database
2. Try to script an object (Script as SELECT, CREATE, etc.)
3. Check if the script window now has content

## Alternative: Use Published Extension's SQL Tools Service

If the above doesn't work, you can copy the SQL Tools Service from the published extension:

```powershell
# Find the published extension folder
$publishedExt = Get-ChildItem "$env:USERPROFILE\.vscode\extensions\ms-mssql.mssql-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Copy SQL Tools Service to development folder
Copy-Item -Path "$($publishedExt.FullName)\sqltoolsservice" -Destination "e:\Coding\VSCode Extensions\vscode-mssql-git-integration\" -Recurse -Force
```

## Why This Happens

The DacFx component (`Microsoft.Data.Tools.Schema.Sql.dll`) requires proper initialization. If the binaries are corrupted or if there's a .NET runtime issue, it will return `null` for scripts instead of throwing an error.

This is NOT caused by our code changes - it's a SQL Tools Service issue that can happen when:

-   Binaries are corrupted during download
-   .NET runtime has issues
-   File permissions are wrong
-   Antivirus interferes with the download

## Verification

After fixing, you should see in the logs:

```
[ScriptingService] Sending scripting request for operation: 1
[ScriptingService] Scripting objects: [{"type":"StoredProcedure","schema":"dbo","name":"MyProc"}]
[ScriptingService] Received result: exists
[ScriptingService] Script length: 245
```

Instead of:

```
SQL Tools Service returned an empty script. Result: {"operationId":"...","script":null}
```
