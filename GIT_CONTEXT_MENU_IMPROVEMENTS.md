# Git Integration Context Menu Improvements

## Overview

This document describes the improvements made to the Git integration context menu UX in the Object Explorer. The context menu items for Git operations now conditionally show/hide based on whether a database is currently linked to a Git repository.

## Changes Made

### 1. TypeScript Interface Update

**File:** `typings/vscode-mssql.d.ts`

Added a new optional property `gitLinked` to the `TreeNodeContextValue` interface:

```typescript
export interface TreeNodeContextValue {
    type: string;
    subType: string;
    filterable: boolean;
    hasFilters: boolean;
    gitLinked?: boolean; // NEW: Indicates if database is linked to Git
}
```

### 2. Object Explorer Provider Update

**File:** `src/objectExplorer/objectExplorerProvider.ts`

Modified the `_applyDatabaseGitDecoration` method to set the `gitLinked` property in the node's context:

```typescript
// Get Git link information
const gitInfo = await this._gitStatusService!.getDatabaseGitInfo(dbCredentials);

// Update context value to include Git link status
const context = node.context;
context.gitLinked = gitInfo.isLinked;
node.context = context;
```

This ensures that every database node in the Object Explorer has its Git link status available in the context value.

### 3. Tree Node Context Value Conversion

**File:** `src/objectExplorer/nodes/treeNodeInfo.ts`

Updated the `_convertToContextValue` method to skip undefined values:

```typescript
private _convertToContextValue(context: vscodeMssql.TreeNodeContextValue): string {
    if (context === undefined) {
        return "";
    }
    let contextValue = "";
    Object.keys(context).forEach((key) => {
        // Skip undefined values to avoid "key=undefined" in context string
        if (context[key] !== undefined) {
            contextValue += key + "=" + context[key] + ",";
        }
    });
    return contextValue;
}
```

This prevents `gitLinked=undefined` from appearing in the context string for nodes that haven't been checked yet.

### 4. Package.json Menu Contributions

**File:** `package.json`

Updated the `when` clauses for all Git-related context menu items and created a dedicated menu group for cache and Git operations:

#### Menu Group Structure

Created a new dedicated group `2_MSSQL_cacheAndGit` for local cache and Git operations, which appears as a separate section with dividers in the context menu:

-   **Group 0:** Connection Groups (`0_MSSQL_connectionGroups`)
-   **Group 1:** Server and Database Management (`1_MSSQL_serverAndDbManagement`)
-   **Group 2:** Cache and Git Operations (`2_MSSQL_cacheAndGit`) - **NEW**
-   **Group 3:** Server/Database Actions (`3_MSSQL_serverDbActions`)
-   **Group 4:** Scripting Operations (`4_MSSQL_script`)
-   **Group 5:** Object Operations (`5_MSSQL_object`)
-   **Group 6:** Tree Operations (`6_MSSQL_tree`)

#### Refresh Local Cache

-   **Group:** `2_MSSQL_cacheAndGit@1`
-   **When:** `view == objectExplorer && viewItem =~ /\\btype=(Server|Database)\\b/ && config.mssql.localCache.enabled`
-   **Effect:** Shows when local cache is enabled

#### Link Database to Git

-   **Group:** `2_MSSQL_cacheAndGit@2`
-   **Before:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/"`
-   **After:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/ && viewItem =~ /\\bgitLinked=false\\b/"`
-   **Effect:** Only shows when database is NOT linked to Git

#### Unlink Database from Git

-   **Group:** `2_MSSQL_cacheAndGit@3`
-   **Before:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/"`
-   **After:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/ && viewItem =~ /\\bgitLinked=true\\b/"`
-   **Effect:** Only shows when database IS linked to Git

#### Show Source Control (Compare Database to Repo)

-   **Group:** `2_MSSQL_cacheAndGit@4`
-   **Before:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/"`
-   **After:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/ && viewItem =~ /\\bgitLinked=true\\b/"`
-   **Effect:** Only shows when database IS linked to Git

#### Open Git Repository

-   **Group:** `2_MSSQL_cacheAndGit@5`
-   **Before:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/"`
-   **After:** `"when": "view == objectExplorer && viewItem =~ /\\btype=(Database)\\b/ && viewItem =~ /\\bgitLinked=true\\b/"`
-   **Effect:** Only shows when database IS linked to Git

## How It Works

1. **On Tree Item Rendering:** When the Object Explorer renders a database node, it calls `getTreeItem()` which triggers `_applyGitDecorations()`.

2. **Git Status Check:** The `_applyDatabaseGitDecoration()` method queries the Git status service to determine if the database is linked to a Git repository.

3. **Context Update:** The `gitLinked` property is set to `true` or `false` in the node's context value.

4. **Context String Generation:** The context value is converted to a string format like `type=Database,gitLinked=true,filterable=false,hasFilters=false`.

5. **Menu Filtering:** VS Code's `when` clause evaluates the context string using regex patterns to determine which menu items to show.

## User Experience Improvements

### Before

-   All Git-related menu items were always visible for every database
-   Users could click "Link to Git" on an already-linked database (would show error)
-   Users could click "Unlink from Git" on a non-linked database (would show error)
-   Cluttered context menu with irrelevant options
-   Cache and Git operations mixed with other management commands

### After

-   **Non-linked databases** show only: "Refresh Local Cache" (if enabled) and "Link to Git Branch..."
-   **Linked databases** show only: "Refresh Local Cache" (if enabled), "Unlink from Git", "Compare Database to Repo", "Open Git Repository in Source Control"
-   **Dedicated menu section** with dividers separating cache and Git operations from other commands
-   Cleaner, more intuitive context menu
-   Prevents user errors and confusion
-   Better visual organization with related features grouped together

### Visual Example

**Context Menu for Non-Linked Database:**

```
New Query
Edit Connection
Disconnect
Remove
─────────────────────────────  (divider)
Refresh Local Cache            (if enabled)
Link to Git Branch...
─────────────────────────────  (divider)
Schema Designer
Schema Compare
─────────────────────────────  (divider)
...
```

**Context Menu for Linked Database:**

```
New Query
Edit Connection
Disconnect
Remove
─────────────────────────────  (divider)
Refresh Local Cache            (if enabled)
Unlink from Git
Compare Database to Repo
Open Git Repository in Source Control
─────────────────────────────  (divider)
Schema Designer
Schema Compare
─────────────────────────────  (divider)
...
```

## Automatic Refresh

The Object Explorer automatically refreshes when:

-   A database is linked to Git (via `onLinkDatabaseToGitBranch`)
-   A database is unlinked from Git (via `onUnlinkDatabaseFromGit`)

Both methods call:

```typescript
this.gitStatusService.clearCache(credentials);
this._objectExplorerProvider.refresh(node);
```

This ensures the context menu updates immediately after link/unlink operations.

## Testing Recommendations

1. **Test Non-Linked Database:**

    - Right-click on a database that is NOT linked to Git
    - Verify only "Link to Git Branch..." appears
    - Verify "Unlink from Git", "Compare Database to Repo", and "Open Git Repository" do NOT appear

2. **Test Linked Database:**

    - Right-click on a database that IS linked to Git
    - Verify "Unlink from Git", "Compare Database to Repo", and "Open Git Repository" appear
    - Verify "Link to Git Branch..." does NOT appear

3. **Test Link/Unlink Operations:**

    - Link a database to Git
    - Verify context menu updates immediately to show linked options
    - Unlink the database
    - Verify context menu updates immediately to show unlinked options

4. **Test Multiple Databases:**
    - Have some databases linked and some not linked
    - Verify each database shows the correct context menu items based on its individual link status

## Technical Notes

-   The `gitLinked` property is optional to maintain backward compatibility
-   The context value conversion skips undefined values to avoid polluting the context string
-   The regex pattern `\\bgitLinked=true\\b` uses word boundaries to ensure exact matching
-   The Git status is checked asynchronously when rendering tree items, so there may be a brief delay before the context updates on first load
