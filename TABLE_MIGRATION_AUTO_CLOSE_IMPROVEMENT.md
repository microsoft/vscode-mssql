# Table Migration Script Auto-Close Improvement

## Overview

This document describes the UX improvement made to automatically close migration script preview documents when users cancel or complete table change operations in the Git integration feature.

## Problem Statement

### Before

When users previewed table migration scripts and then decided to cancel the operation, the migration script document remained open in VS Code. This led to:

-   **Orphaned tabs**: Migration script tabs accumulated in the editor
-   **Manual cleanup required**: Users had to manually close each preview document
-   **Cluttered workspace**: Multiple preview tabs made it harder to navigate
-   **Confusion**: Users might accidentally edit or save preview scripts

### User Workflow Issue

1. User right-clicks a modified table in Source Control view
2. Selects "Discard Changes"
3. Reviews data loss warnings
4. Clicks "Preview Migration Script"
5. Migration script opens in a new editor tab
6. User clicks "Cancel" to abort the operation
7. **Problem**: Migration script tab remains open ❌

## Solution

### After

Migration script preview documents are now automatically closed in two scenarios:

1. **When user cancels**: Document closes immediately when "Cancel" is clicked
2. **After successful execution**: Document closes after the migration script executes successfully

### Improved User Workflow

1. User right-clicks a modified table in Source Control view
2. Selects "Discard Changes"
3. Reviews data loss warnings
4. Clicks "Preview Migration Script"
5. Migration script opens in a new editor tab
6. User clicks "Cancel" to abort the operation
7. **Improvement**: Migration script tab closes automatically ✅

## Implementation Details

### Changes Made

#### 1. Updated `_showMigrationScriptPreview` Method

**File:** `src/sourceControl/databaseSourceControlProvider.ts`

**Before:**

```typescript
private async _showMigrationScriptPreview(
    script: string,
    tableName: string,
    operationType: string,
): Promise<boolean> {
    const doc = await vscode.workspace.openTextDocument({
        content: script,
        language: "sql",
    });

    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });

    const answer = await vscode.window.showWarningMessage(
        `⚠️ Review Migration Script\n\n...`,
        { modal: true },
        "Execute Script",
        "Cancel",
    );

    return answer === "Execute Script";
}
```

**After:**

```typescript
private async _showMigrationScriptPreview(
    script: string,
    tableName: string,
    operationType: string,
): Promise<{ confirmed: boolean; documentUri: vscode.Uri }> {
    const doc = await vscode.workspace.openTextDocument({
        content: script,
        language: "sql",
    });

    const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });

    const answer = await vscode.window.showWarningMessage(
        `⚠️ Review Migration Script\n\n...`,
        { modal: true },
        "Execute Script",
        "Cancel",
    );

    const confirmed = answer === "Execute Script";

    // If user cancelled, close the migration script document immediately
    if (!confirmed) {
        await this._closeMigrationScriptDocument(doc.uri);
    }

    return { confirmed, documentUri: doc.uri };
}
```

**Key Changes:**

-   Returns an object with `confirmed` boolean and `documentUri` instead of just a boolean
-   Automatically closes the document when user cancels
-   Provides the document URI for cleanup after successful execution

#### 2. Added `_closeMigrationScriptDocument` Method

**New Method:**

```typescript
private async _closeMigrationScriptDocument(documentUri: vscode.Uri): Promise<void> {
    try {
        // Find all tabs with this document
        const tabs = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter(
                (tab) =>
                    tab.input instanceof vscode.TabInputText &&
                    tab.input.uri.toString() === documentUri.toString(),
            );

        // Close all matching tabs
        if (tabs.length > 0) {
            await vscode.window.tabGroups.close(tabs);
        }
    } catch (error) {
        // Silently fail - don't break the workflow if we can't close the document
        console.error("[SourceControl] Failed to close migration script document:", error);
    }
}
```

**Features:**

-   Finds all tabs displaying the migration script document
-   Closes all matching tabs (handles split views)
-   Silently fails if closing fails (doesn't break the workflow)
-   Uses VS Code's Tab Groups API for reliable tab management

#### 3. Updated All Call Sites

Updated three call sites in `_discardTableChanges` method:

**DROP TABLE scenario (line 895):**

```typescript
const previewResult = await this._showMigrationScriptPreview(
    dropScript,
    resourceState.label,
    "DROP TABLE",
);

if (!previewResult.confirmed) {
    return;
}

await this._executeTableMigrationScript(resourceState, dropScript);

// Close the migration script document after successful execution
await this._closeMigrationScriptDocument(previewResult.documentUri);
```

**CREATE TABLE scenario (line 928):**

```typescript
const previewResult = await this._showMigrationScriptPreview(
    gitSQL,
    resourceState.label,
    "CREATE TABLE",
);

if (!previewResult.confirmed) {
    return;
}

await this._executeTableMigrationScript(resourceState, gitSQL);

// Close the migration script document after successful execution
await this._closeMigrationScriptDocument(previewResult.documentUri);
```

**ALTER TABLE scenario (line 991):**

```typescript
const previewResult = await this._showMigrationScriptPreview(
    migrationScript,
    resourceState.label,
    "ALTER TABLE",
);

if (!previewResult.confirmed) {
    return;
}

await this._executeTableMigrationScript(resourceState, migrationScript);

// Close the migration script document after successful execution
await this._closeMigrationScriptDocument(previewResult.documentUri);
```

## Behavior Details

### When Document Closes

#### Scenario 1: User Cancels

1. Migration script preview opens
2. User reviews the script
3. User clicks "Cancel" in the confirmation dialog
4. **Document closes immediately** before returning from `_showMigrationScriptPreview`

#### Scenario 2: Successful Execution

1. Migration script preview opens
2. User reviews the script
3. User clicks "Execute Script"
4. Migration script executes successfully
5. **Document closes after execution completes**

#### Scenario 3: Execution Fails

1. Migration script preview opens
2. User reviews the script
3. User clicks "Execute Script"
4. Migration script execution fails (error thrown)
5. **Document remains open** (user may want to review the script that failed)

### Edge Cases Handled

1. **Multiple tabs with same document**: Closes all tabs displaying the migration script
2. **Split views**: Handles documents open in multiple editor groups
3. **Close failure**: Silently fails without breaking the workflow
4. **Document already closed**: No error if document was manually closed by user

## Benefits

### User Experience

-   ✅ **Cleaner workspace**: No orphaned migration script tabs
-   ✅ **Less manual work**: No need to manually close preview documents
-   ✅ **Better focus**: Easier to navigate between actual work files
-   ✅ **Prevents confusion**: Users won't accidentally edit preview scripts

### Developer Experience

-   ✅ **Consistent behavior**: All three migration scenarios (DROP, CREATE, ALTER) behave the same
-   ✅ **Robust implementation**: Handles edge cases gracefully
-   ✅ **Maintainable code**: Clear separation of concerns with dedicated cleanup method

## Testing Recommendations

### Manual Testing

1. **Test Cancel on DROP TABLE:**

    - Add a table to database (not in Git)
    - Right-click in Source Control → "Discard Changes"
    - Click "Preview DROP Script"
    - Verify script opens
    - Click "Cancel"
    - **Verify**: Script tab closes automatically

2. **Test Cancel on CREATE TABLE:**

    - Delete a table that exists in Git
    - Right-click in Source Control → "Discard Changes"
    - Click "Preview CREATE Script"
    - Verify script opens
    - Click "Cancel"
    - **Verify**: Script tab closes automatically

3. **Test Cancel on ALTER TABLE:**

    - Modify a table schema
    - Right-click in Source Control → "Discard Changes"
    - Click "Preview Migration Script"
    - Verify script opens
    - Click "Cancel"
    - **Verify**: Script tab closes automatically

4. **Test Successful Execution:**

    - Modify a table schema
    - Right-click in Source Control → "Discard Changes"
    - Click "Preview Migration Script"
    - Verify script opens
    - Click "Execute Script"
    - Wait for execution to complete
    - **Verify**: Script tab closes automatically after success message

5. **Test Multiple Previews:**

    - Preview and cancel multiple table migrations
    - **Verify**: No orphaned tabs accumulate

6. **Test Split View:**
    - Open migration script preview
    - Drag tab to create split view
    - Click "Cancel"
    - **Verify**: Both tabs close

## Technical Notes

-   Uses VS Code's Tab Groups API (`vscode.window.tabGroups`) for reliable tab management
-   Compares document URIs using `toString()` for accurate matching
-   Handles both `TabInputText` and other tab input types
-   Async/await pattern ensures proper cleanup timing
-   Error handling prevents workflow interruption if cleanup fails

## Backward Compatibility

This change is **fully backward compatible**:

-   No breaking changes to public APIs
-   No changes to user-facing commands
-   No changes to configuration options
-   Only affects internal implementation of migration script preview

## Future Enhancements

Potential future improvements:

1. Add user preference to keep preview open after execution
2. Add "Save Migration Script" option before closing
3. Track preview documents for batch cleanup
4. Add telemetry to measure cleanup success rate
