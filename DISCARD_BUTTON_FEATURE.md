# Discard Changes Button Feature

## Overview

This feature adds visual "Discard Changes" buttons to the database comparison view (Compare Database to Repo), following VS Code's Source Control Management (SCM) design patterns. Users can now discard changes more efficiently without relying solely on the right-click context menu.

## Changes Made

### 1. New Command: `mssql.sourceControl.discardAll`

**File**: `src/sourceControl/databaseSourceControlProvider.ts`

Added a new command that allows users to discard all changes at once:

-   **Command ID**: `mssql.sourceControl.discardAll`
-   **Functionality**: Discards all database objects in the "Changes" group to match the Git repository version
-   **Safety Features**:
    -   Shows confirmation dialog before proceeding
    -   Skips tables (which require individual confirmation due to potential data loss)
    -   Provides detailed progress reporting
    -   Shows summary of successes and failures
    -   Handles errors gracefully

**Implementation Details**:

```typescript
private async _discardAllChanges(): Promise<void>
```

-   Iterates through all changes in the `_changesGroup`
-   For each non-table object:
    -   Executes the discard script (ALTER/CREATE/DROP)
    -   Updates the local cache file
-   For table objects:
    -   Skips and reports as requiring individual attention
    -   Tables need special handling due to migration scripts and data loss warnings
-   Clears Git status cache and refreshes the view
-   Shows summary message with success/failure counts

### 2. Enhanced UI Buttons

**File**: `package.json`

#### Individual Resource Discard Button

Added inline discard button to individual database objects:

```json
{
    "command": "mssql.sourceControl.discard",
    "when": "scmProvider == mssql-database && scmResourceGroup == changes",
    "group": "inline@2"
}
```

This makes the discard action visible as an inline button (trash icon) next to each changed object, similar to how VS Code's Git extension shows discard buttons.

#### Resource Group Discard All Button

Added "Discard All Changes" button to the Changes resource group header:

```json
{
    "command": "mssql.sourceControl.discardAll",
    "when": "scmProvider == mssql-database && scmResourceGroup == changes",
    "group": "inline@2"
}
```

This appears as a button in the Changes group header, allowing users to discard all changes at once.

### 3. Command Registration

**File**: `src/sourceControl/databaseSourceControlProvider.ts`

Registered the new command in the `_registerCommands()` method:

```typescript
// Discard all changes
this._disposables.push(
    vscode.commands.registerCommand("mssql.sourceControl.discardAll", async () => {
        await this._discardAllChanges();
    }),
);
```

### 4. Command Definition

**File**: `package.json`

Added command definition with proper metadata:

```json
{
    "command": "mssql.sourceControl.discardAll",
    "title": "Discard All Changes",
    "category": "MS SQL",
    "icon": "$(discard)"
}
```

## User Experience

### Before

Users had to:

1. Right-click on each individual database object
2. Select "Discard Changes" from the context menu
3. Confirm the action
4. Repeat for each object

### After

Users can now:

**Option 1: Discard Individual Objects**

-   Click the inline discard button (trash icon) next to any changed object
-   Confirm the action in the dialog

**Option 2: Discard All Changes**

-   Click the "Discard All Changes" button in the Changes group header
-   Confirm the action in the dialog
-   All non-table objects are discarded automatically
-   Tables are skipped with a notification (require individual attention)

## Design Patterns

This implementation follows VS Code's SCM design patterns:

1. **Inline Actions**: Buttons appear directly in the UI, not just in context menus
2. **Group Actions**: Actions can be performed on entire groups (like "Stage All")
3. **Visual Consistency**: Uses the same `$(discard)` icon as VS Code's Git extension
4. **Safety First**: Requires confirmation before destructive operations
5. **Progress Reporting**: Shows progress for batch operations
6. **Error Handling**: Gracefully handles failures and reports them to the user

## Technical Details

### Menu Contribution Points

The feature uses VS Code's SCM menu contribution points:

-   `scm/resourceState/context`: For individual resource actions
-   `scm/resourceGroup/context`: For group-level actions

### When Clauses

Actions are conditionally shown based on:

-   `scmProvider == mssql-database`: Only for MSSQL database source control
-   `scmResourceGroup == changes`: Only for the "Changes" group (not "Staged Changes")

### Icon Usage

Uses VS Code's built-in `$(discard)` icon for consistency with the Git extension.

## Special Handling for Tables

Tables require special handling because:

1. They may contain data that could be lost
2. Migration scripts need to be generated and previewed
3. Users need to see data loss warnings before proceeding

Therefore, the "Discard All Changes" feature:

-   **Skips tables** in batch operations
-   **Reports them** as requiring individual attention
-   **Preserves** the existing individual discard flow for tables

Users must still discard tables individually to ensure they review:

-   Migration scripts
-   Data loss warnings
-   Column changes that might affect data

## Testing Recommendations

1. **Test Individual Discard**:

    - Link a database to Git
    - Make changes to stored procedures, views, functions
    - Click the inline discard button on individual objects
    - Verify the object is reverted to the Git version

2. **Test Discard All**:

    - Make changes to multiple objects (mix of procedures, views, functions)
    - Click "Discard All Changes" button
    - Verify all non-table objects are discarded
    - Verify tables are skipped with appropriate message

3. **Test Table Handling**:

    - Make changes to a table
    - Try to discard using the individual discard button
    - Verify migration script preview appears
    - Verify data loss warnings are shown

4. **Test Error Handling**:
    - Disconnect from database
    - Try to discard changes
    - Verify appropriate error messages are shown

## Future Enhancements

Potential improvements for future versions:

1. **Selective Discard**: Allow users to select multiple objects and discard them together
2. **Undo Discard**: Implement a way to undo discard operations (challenging due to database state)
3. **Batch Table Discard**: Allow discarding multiple tables with a single confirmation (showing combined migration script)
4. **Keyboard Shortcuts**: Add keyboard shortcuts for discard operations
5. **Discard Preview**: Show a preview of what will be changed before discarding

## Related Files

-   `src/sourceControl/databaseSourceControlProvider.ts` - Main implementation
-   `package.json` - Command and menu contributions
-   `src/sourceControl/tableMigrationService.ts` - Table migration logic (existing)
-   `src/controllers/migrationScriptPreviewController.ts` - Migration preview (existing)

## Compatibility

-   **VS Code Version**: ^1.98.0 (as specified in package.json)
-   **Extension Version**: 1.37.0
-   **Breaking Changes**: None - this is a purely additive feature

## Summary

This feature significantly improves the user experience for discarding database changes by:

-   Making the discard action more discoverable through inline buttons
-   Allowing batch discard operations for efficiency
-   Following VS Code's established SCM design patterns
-   Maintaining safety through confirmations and special table handling
-   Providing clear feedback on operation results

The implementation is consistent with the existing codebase patterns and integrates seamlessly with the current Git integration features.
