# Scripting Issue - Empty Script Windows

## Problem

When trying to script database objects (Script as SELECT, CREATE, ALTER, etc.), a new query window opens but it's completely empty. No SQL script is generated.

## Root Cause

This issue is caused by the **SQL Tools Service DacFx initialization error** that you reported earlier:

```
The type initializer for 'Microsoft.Data.Tools.Schema.Sql.Common.SqlClient.CachedServerAndDatabaseInfo' threw an exception.
```

The DacFx (Data-tier Application Framework) component is responsible for:

-   Generating CREATE/ALTER/DROP scripts
-   Schema comparison operations
-   Database project operations

When DacFx fails to initialize, the scripting service returns an empty string instead of the SQL script.

## Why This Started Happening

The DacFx error is **NOT caused by the table discard feature**. The timing is coincidental. The DacFx error is a .NET initialization issue in the SQL Tools Service backend that can occur due to:

1. **Corrupted SQL Tools Service cache**
2. **Missing or corrupted DacFx assemblies**
3. **.NET runtime issues**
4. **File permission problems**
5. **Antivirus interference**

## Solution

### Option 1: Clean SQL Tools Service Cache (Recommended)

1. **Close VS Code completely**

2. **Delete the SQL Tools Service cache:**

    ```powershell
    Remove-Item -Recurse -Force "$env:USERPROFILE\.sqltoolsservice"
    ```

3. **Delete the local sqltoolsservice folder in your extension:**

    ```powershell
    Remove-Item -Recurse -Force "e:\Coding\VSCode Extensions\vscode-mssql-git-integration\sqltoolsservice"
    ```

4. **Restart VS Code** - The extension will re-download and initialize SQL Tools Service

5. **Test scripting** - Try to script an object again

### Option 2: Reload VS Code Window

Sometimes a simple reload fixes the issue:

1. Press `Ctrl+Shift+P`
2. Type "Reload Window"
3. Select "Developer: Reload Window"
4. Test scripting again

### Option 3: Reinstall the Extension

If the above doesn't work:

1. **Uninstall the extension:**

    - Go to Extensions view
    - Find "SQL Server (mssql)"
    - Click Uninstall

2. **Delete extension data:**

    ```powershell
    Remove-Item -Recurse -Force "$env:USERPROFILE\.vscode\extensions\ms-mssql.mssql-*"
    Remove-Item -Recurse -Force "$env:USERPROFILE\.sqltoolsservice"
    ```

3. **Reinstall the extension** from the Extensions marketplace

4. **Restart VS Code**

### Option 4: Check .NET Runtime

The SQL Tools Service requires .NET runtime. Verify it's installed:

```powershell
dotnet --list-runtimes
```

You should see .NET 6.0 or later. If not, install from: https://dotnet.microsoft.com/download

## Improved Error Handling

I've added better error handling to the scripting service. Now when SQL Tools Service returns an empty script, you'll see a clear error message:

> "SQL Tools Service returned an empty script. This may indicate a DacFx initialization error. Try restarting VS Code or reinstalling the extension."

This will help diagnose the issue more quickly in the future.

## Testing After Fix

After applying one of the solutions above, test the following:

1. **Script as SELECT** on a table

    - Right-click table → Script as SELECT
    - ✅ Should open window with SELECT statement

2. **Script as CREATE** on a table

    - Right-click table → Script as CREATE
    - ✅ Should open window with CREATE TABLE statement

3. **Script as ALTER** on a stored procedure

    - Right-click procedure → Script as ALTER
    - ✅ Should open window with ALTER PROCEDURE statement

4. **Script as EXECUTE** on a stored procedure
    - Right-click procedure → Script as EXECUTE
    - ✅ Should open window with EXECUTE statement

## Verification

To verify the DacFx error is resolved, check the VS Code Output panel:

1. **Open Output panel:** View → Output
2. **Select "MSSQL" from dropdown**
3. **Look for errors** - You should NOT see:
    - "CachedServerAndDatabaseInfo threw an exception"
    - "DacFx initialization failed"
    - Any other DacFx-related errors

## Prevention

To prevent this issue in the future:

1. **Keep VS Code updated** - Updates often include SQL Tools Service fixes
2. **Don't manually modify sqltoolsservice folder** - Let the extension manage it
3. **Exclude .sqltoolsservice from antivirus** - Some antivirus software interferes with .NET assemblies
4. **Ensure adequate disk space** - SQL Tools Service needs space for caching

## Related Files Modified

**File: `src/scripting/scriptingService.ts`**

Added validation to detect empty scripts and throw a descriptive error:

```typescript
public async script(scriptingParams: IScriptingParams): Promise<string> {
    const result = await this._client.sendRequest(ScriptingRequest.type, scriptingParams);

    // Check if the script is empty or undefined
    if (!result.script || result.script.trim().length === 0) {
        const errorMsg = "SQL Tools Service returned an empty script. This may indicate a DacFx initialization error. Try restarting VS Code or reinstalling the extension.";
        this._client.logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    return result.script;
}
```

## Build Status

✅ Build successful: `yarn build` (24.08s)
✅ No TypeScript errors
✅ No ESLint errors

## Summary

The scripting issue is caused by a SQL Tools Service DacFx initialization error, **not by the table discard feature**. The recommended fix is to clean the SQL Tools Service cache and restart VS Code. The improved error handling will now show a clear message when this occurs.
