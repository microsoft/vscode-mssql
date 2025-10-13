# Local Cache and Git Integration User Guide

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Setup Instructions](#setup-instructions)
4. [Usage Workflows](#usage-workflows)
5. [Configuration Options](#configuration-options)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The MSSQL extension for Visual Studio Code provides powerful **Local Cache** and **Git Integration** features that enable version control for your database schema objects. These features work together to provide a seamless database development workflow with full Git integration.

### What is Local Cache?

The **Local Cache** feature automatically scripts and stores your database objects (tables, views, stored procedures, functions, etc.) as SQL files on your local machine. This cache:

-   **Stores database object definitions** as SQL scripts in a structured folder hierarchy
-   **Automatically refreshes** at configurable intervals to stay in sync with database changes
-   **Enables offline access** to database object definitions
-   **Powers Git integration** by providing the source files for version control comparison

### What is Git Integration?

The **Git Integration** feature allows you to link your database to a Git repository branch, enabling:

-   **Version control** for database schema objects
-   **Change tracking** to see what's different between your database and the repository
-   **Staging and committing** database changes to Git
-   **Discarding changes** to revert database objects to match the repository
-   **Visual diff views** to compare database objects with their Git versions
-   **Automatic cache refresh** when DDL statements are executed

### Benefits

✅ **Version Control for Databases**: Track schema changes just like application code
✅ **Team Collaboration**: Share database schemas through Git repositories
✅ **Change Visibility**: See exactly what changed in your database schema
✅ **Easy Rollback**: Revert database objects to previous versions from Git
✅ **Automated Workflows**: Automatic cache refresh keeps everything in sync
✅ **Offline Development**: Access cached object definitions without database connection

[IMAGE PLACEHOLDER: Architecture diagram showing the relationship between Database → Local Cache → Git Repository, with arrows indicating data flow and sync operations]

---

## Prerequisites

Before using the Local Cache and Git Integration features, ensure you have:

### Required

1. **Visual Studio Code** version 1.98.0 or higher
2. **MSSQL Extension** installed and activated
3. **SQL Server Connection**: Access to SQL Server, Azure SQL Database, or SQL Database in Fabric
4. **Git Installed**: Git must be installed on your system and available in your PATH
    - Download from: https://git-scm.com/downloads
    - Verify installation: Run `git --version` in terminal

### Optional (for Git Integration)

5. **Git Repository**: A Git repository (local or remote) to link your database to
    - Can be GitHub, Azure DevOps, GitLab, Bitbucket, or any Git hosting service
    - Repository should be accessible via HTTPS or SSH
6. **Git Credentials**: Authentication configured for your Git repository
    - For HTTPS: Username and password/token
    - For SSH: SSH keys configured

### Permissions

-   **Database Permissions**: Read access to system views (`sys.objects`, `sys.sql_modules`, etc.)
-   **File System Permissions**: Write access to VS Code's global storage directory
-   **Git Permissions**: Read/write access to the Git repository (for Git integration)

[IMAGE PLACEHOLDER: Screenshot of VS Code Extensions view with MSSQL extension installed and highlighted]

---

## Setup Instructions

### Step 1: Enable Local Cache

The local cache is enabled by default. To verify or modify settings:

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,` on macOS)
2. Search for `mssql.localCache`
3. Verify the following settings:

```json
{
    "mssql.localCache.enabled": true,
    "mssql.localCache.autoRefreshEnabled": true,
    "mssql.localCache.autoRefreshIntervalMinutes": 15
}
```

[IMAGE PLACEHOLDER: Screenshot of VS Code Settings UI showing the Local Cache settings section with the three settings visible and their current values]

### Step 2: Connect to Your Database

1. Open the **SQL Server** view in the Activity Bar (left sidebar)
2. Click the **Add Connection** button (+ icon)
3. Enter your connection details:
    - Server name
    - Authentication type
    - Database name
    - Credentials (if applicable)
4. Click **Connect**

[IMAGE PLACEHOLDER: Screenshot of the Connection Dialog with fields filled in for a sample database connection]

### Step 3: Initial Cache Population

When you first connect to a database with local cache enabled:

1. The extension automatically creates a cache for the database
2. A progress notification appears: "Caching database objects for [DatabaseName]"
3. All database objects are scripted and saved to the local cache
4. A success message appears when complete: "Database cache created for [DatabaseName]"

**Note**: Initial cache population may take 1-5 minutes depending on database size.

[IMAGE PLACEHOLDER: Screenshot of VS Code notification showing "Caching database objects for AdventureWorks" with a progress indicator]

### Step 4: Link Database to Git Repository (Optional)

To enable Git integration:

1. In the **Object Explorer**, right-click on your database
2. Select **Link to Git Branch...**
3. Enter the Git repository URL (HTTPS or SSH):
    - Example HTTPS: `https://github.com/username/repo.git`
    - Example SSH: `git@github.com:username/repo.git`
4. Click **Validate URL** to verify the repository is accessible
5. Select a branch from the dropdown list
6. Click **Link**
7. Wait for the repository to be cloned (progress notification will appear)
8. Success message: "Database [DatabaseName] linked to [branch] branch of [repo URL]"

[IMAGE PLACEHOLDER: Screenshot of the "Link to Git Branch" dialog showing URL input field, branch dropdown, and Validate/Link buttons]

[IMAGE PLACEHOLDER: Screenshot of Object Explorer showing a database node with a Git branch icon decoration indicating it's linked to Git]

---

## Usage Workflows

### Workflow 1: Viewing Cached Database Objects

**Purpose**: Access database object definitions without querying the database.

**Steps**:

1. Navigate to your VS Code global storage directory:

    - Windows: `%APPDATA%\Code\User\globalStorage\ms-mssql.mssql\LocalScriptCache`
    - macOS: `~/Library/Application Support/Code/User/globalStorage/ms-mssql.mssql/LocalScriptCache`
    - Linux: `~/.config/Code/User/globalStorage/ms-mssql.mssql/LocalScriptCache`

2. Browse the folder structure:

    ```
    LocalScriptCache/
    └── [connection-hash]/
        ├── cache-metadata.json
        ├── Tables/
        │   ├── dbo.Customers.sql
        │   └── dbo.Orders.sql
        ├── Views/
        │   └── dbo.CustomerOrders.sql
        ├── StoredProcedures/
        │   └── dbo.GetCustomerById.sql
        └── Functions/
            └── dbo.CalculateTotal.sql
    ```

3. Open any `.sql` file to view the object definition

[IMAGE PLACEHOLDER: Screenshot of VS Code Explorer showing the LocalScriptCache folder structure with expanded folders showing SQL files]

### Workflow 2: Manually Refreshing the Cache

**Purpose**: Update the cache immediately after making database changes.

**Steps**:

1. In **Object Explorer**, right-click on the **Server** or **Database** node
2. Select **Refresh Local Cache**
3. Wait for the refresh to complete (progress notification will appear)
4. Success message: "Cache refreshed for [DatabaseName]"

**When to use**:

-   After executing DDL statements manually (if auto-refresh is disabled)
-   After making changes through external tools
-   When you want to ensure the cache is up-to-date before comparing with Git

[IMAGE PLACEHOLDER: Screenshot of Object Explorer context menu with "Refresh Local Cache" option highlighted]

### Workflow 3: Comparing Database with Git Repository

**Purpose**: See what's different between your database and the Git repository.

**Steps**:

1. Ensure your database is linked to a Git repository (see Setup Step 4)
2. In **Object Explorer**, right-click on the **Database** node
3. Select **Compare Database to Repo** (or **Show Source Control**)
4. The **Source Control** view opens, showing:

    - **Changes**: Objects that differ between database and Git
    - **Staged Changes**: Objects ready to be applied to Git

5. Review the changes:
    - **Modified** (M): Object exists in both but content differs
    - **Added** (A): Object exists in database but not in Git
    - **Deleted** (D): Object exists in Git but not in database

[IMAGE PLACEHOLDER: Screenshot of VS Code Source Control view showing the "MSSQL Database" source control provider with Changes and Staged Changes sections, displaying several modified, added, and deleted objects with their status icons]

### Workflow 4: Viewing Differences (Diff View)

**Purpose**: See exactly what changed in a database object.

**Steps**:

1. In the **Source Control** view, click on any changed object
2. A diff view opens showing:

    - **Left side**: Git repository version
    - **Right side**: Current database version
    - **Highlighted differences**: Lines that changed

3. Review the changes:
    - Green highlighting: Added lines
    - Red highlighting: Removed lines
    - Modified lines shown side-by-side

[IMAGE PLACEHOLDER: Screenshot of VS Code diff view showing a stored procedure comparison with Git version on left and database version on right, with highlighted differences]

### Workflow 5: Staging and Applying Changes to Git

**Purpose**: Save database changes to the Git repository.

**Steps**:

1. In the **Source Control** view, review the **Changes** section
2. **Stage individual changes**:

    - Click the **+** icon next to an object to stage it
    - Or right-click and select **Stage Changes**

3. **Stage all changes**:

    - Click the **+** icon in the **Changes** section header
    - Or right-click and select **Stage All Changes**

4. **Review staged changes** in the **Staged Changes** section

5. **Apply to Git repository**:

    - Enter a commit message in the input box at the top
    - Click the **✓** (checkmark) button or press `Ctrl+Enter`
    - Changes are copied to the local Git repository

6. **Commit and push using Git tools**:
    - Open the built-in Git view (`Ctrl+Shift+G`)
    - Review the changes
    - Commit and push to remote repository

**Important**: The MSSQL extension applies changes to the local Git repository files only. You must use Git tools to commit and push to the remote repository.

[IMAGE PLACEHOLDER: Screenshot showing the staging workflow - Source Control view with an object being staged (+ icon highlighted), then the Staged Changes section with the object listed]

[IMAGE PLACEHOLDER: Screenshot of the commit message input box with a sample message entered and the checkmark button highlighted]

### Workflow 6: Discarding Changes (Reverting to Git Version)

**Purpose**: Revert database objects to match the Git repository version.

**Steps**:

1. In the **Source Control** view, find the object you want to revert
2. Right-click on the object
3. Select **Discard Changes**
4. **Review the confirmation dialog**:

    - For non-table objects: Shows a warning about modifying the database
    - For tables: Shows a detailed migration preview with data loss analysis

5. **For tables** (special handling):

    - Review the migration script preview
    - Check the data loss summary:
        - Columns being dropped
        - Data type changes
        - Constraint changes
    - If data loss is detected, a warning is shown
    - Click **Continue** to proceed or **Cancel** to abort

6. **Confirm the operation**:

    - Click **Continue** in the confirmation dialog
    - The extension generates and executes the necessary SQL script:
        - `ALTER` statement for modified objects
        - `CREATE` statement for deleted objects
        - `DROP` statement for added objects
    - Progress notification: "Syncing database from Git repository"

7. **Verify the result**:
    - The object is updated in the database
    - The local cache is refreshed
    - The object disappears from the Changes list

**Warning**: Discarding changes modifies the database directly. This operation cannot be undone. Always review the changes carefully before proceeding.

[IMAGE PLACEHOLDER: Screenshot of the Discard Changes confirmation dialog for a stored procedure, showing the warning message and Continue/Cancel buttons]

[IMAGE PLACEHOLDER: Screenshot of the table migration preview dialog showing the migration script, data loss summary with warnings about dropped columns, and Continue/Cancel buttons]

### Workflow 7: Automatic Cache Refresh on DDL Execution

**Purpose**: Keep the cache in sync automatically when you make schema changes.

**How it works**:

1. Execute a DDL statement in a query editor:

    ```sql
    CREATE TABLE Customers (
        Id INT PRIMARY KEY,
        Name NVARCHAR(100),
        Email NVARCHAR(255)
    );
    ```

2. The extension automatically:

    - Detects the DDL statement (CREATE, ALTER, DROP, etc.)
    - Checks if the database is linked to Git
    - Schedules a cache refresh (debounced by 2 seconds)
    - Shows a status bar notification: "Refreshing cache for [DatabaseName]..."

3. After the refresh completes:
    - Status bar shows: "Cache refreshed for [DatabaseName]"
    - Source Control view updates automatically
    - New/modified objects appear in the Changes section

**Supported DDL statements**:

-   Table operations: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE TABLE`
-   View operations: `CREATE VIEW`, `ALTER VIEW`, `DROP VIEW`
-   Stored Procedure operations: `CREATE PROCEDURE`, `ALTER PROCEDURE`, `DROP PROCEDURE`
-   Function operations: `CREATE FUNCTION`, `ALTER FUNCTION`, `DROP FUNCTION`
-   Index operations: `CREATE INDEX`, `DROP INDEX`, `ALTER INDEX`
-   And more (see Configuration Options for full list)

**Debouncing**: If you execute multiple DDL statements within 2 seconds, only one cache refresh occurs after the last statement.

[IMAGE PLACEHOLDER: Screenshot of VS Code status bar showing the cache refresh notification with a spinning sync icon]

[IMAGE PLACEHOLDER: Screenshot of a query editor with a CREATE TABLE statement executed, and the Source Control view showing the new table appearing in the Changes section]

### Workflow 8: Unlinking Database from Git

**Purpose**: Remove the Git repository link from a database.

**Steps**:

1. In **Object Explorer**, right-click on the **Database** node
2. Select **Unlink from Git**
3. Confirm the operation in the dialog
4. The Git repository link is removed:
    - Local repository clone is deleted
    - Git decorations removed from Object Explorer
    - Source Control view no longer shows changes for this database

**Note**: This does not affect the remote Git repository or your local cache. Only the link between the database and Git is removed.

[IMAGE PLACEHOLDER: Screenshot of Object Explorer context menu with "Unlink from Git" option highlighted]

### Workflow 9: Opening Git Repository in File Explorer

**Purpose**: Access the local Git repository clone directly.

**Steps**:

1. In **Object Explorer**, right-click on the **Database** node (must be linked to Git)
2. Select **Open Git Repository in Source Control**
3. The local repository folder opens in your system's file explorer
4. You can:
    - View the repository structure
    - Use external Git tools
    - Manually edit files (not recommended)

**Repository location**: `%APPDATA%\Code\User\globalStorage\ms-mssql.mssql\LocalRepoCache\[connection-hash]`

[IMAGE PLACEHOLDER: Screenshot of Windows File Explorer showing the LocalRepoCache folder with the cloned Git repository structure]

---

## Configuration Options

### Local Cache Settings

Configure local cache behavior in VS Code Settings (`Ctrl+,`):

#### `mssql.localCache.enabled`

-   **Type**: `boolean`
-   **Default**: `true`
-   **Description**: Enable or disable the local cache feature
-   **Effect**: When disabled, no caching occurs and Git integration is unavailable

```json
{
    "mssql.localCache.enabled": true
}
```

#### `mssql.localCache.autoRefreshEnabled`

-   **Type**: `boolean`
-   **Default**: `true`
-   **Description**: Enable automatic periodic cache refresh
-   **Effect**: When enabled, the cache refreshes at the interval specified by `autoRefreshIntervalMinutes`

```json
{
    "mssql.localCache.autoRefreshEnabled": true
}
```

#### `mssql.localCache.autoRefreshIntervalMinutes`

-   **Type**: `number`
-   **Default**: `15`
-   **Range**: `1` to `300` (5 hours)
-   **Description**: How frequently (in minutes) to automatically check for database changes and update the cache
-   **Recommendation**:
    -   Development: 5-15 minutes
    -   Production: 30-60 minutes

```json
{
    "mssql.localCache.autoRefreshIntervalMinutes": 15
}
```

### Git Integration Settings

#### `mssql.gitIntegration.autoRefreshCacheOnDDL`

-   **Type**: `boolean`
-   **Default**: `true`
-   **Description**: Automatically refresh the local cache when DDL statements are executed on Git-linked databases
-   **Effect**: When enabled, executing DDL statements triggers an automatic cache refresh after a 2-second debounce period

```json
{
    "mssql.gitIntegration.autoRefreshCacheOnDDL": true
}
```

### Example Configuration

Complete configuration for optimal local cache and Git integration:

```json
{
    // Enable local cache
    "mssql.localCache.enabled": true,

    // Enable automatic periodic refresh
    "mssql.localCache.autoRefreshEnabled": true,

    // Refresh every 10 minutes
    "mssql.localCache.autoRefreshIntervalMinutes": 10,

    // Auto-refresh on DDL execution
    "mssql.gitIntegration.autoRefreshCacheOnDDL": true
}
```

[IMAGE PLACEHOLDER: Screenshot of VS Code settings.json file showing the complete configuration example with syntax highlighting]

---

## Best Practices

### 1. Cache Management

✅ **DO**:

-   Keep auto-refresh enabled for active development databases
-   Use manual refresh after bulk schema changes
-   Verify cache is up-to-date before comparing with Git
-   Clear cache if you encounter sync issues (right-click database → Refresh Local Cache)

❌ **DON'T**:

-   Set refresh interval too low (< 5 minutes) for large databases
-   Disable auto-refresh on Git-linked databases
-   Manually edit cached SQL files (they will be overwritten)

### 2. Git Integration Workflow

✅ **DO**:

-   Link databases to feature branches for development
-   Review diffs before staging changes
-   Write descriptive commit messages
-   Use the Source Control view to track all changes
-   Test discarded changes in a development environment first
-   Keep your Git repository up-to-date with regular pulls

❌ **DON'T**:

-   Link production databases directly to main/master branch
-   Stage changes without reviewing diffs
-   Discard table changes without reviewing data loss warnings
-   Bypass the extension and manually edit Git repository files
-   Commit sensitive data (passwords, connection strings) to Git

### 3. Team Collaboration

✅ **DO**:

-   Use a shared Git repository for team database schemas
-   Establish naming conventions for database objects
-   Document schema changes in commit messages
-   Use pull requests for schema change reviews
-   Communicate schema changes to team members
-   Use `.gitignore` to exclude sensitive files

❌ **DON'T**:

-   Make conflicting schema changes without coordination
-   Force push to shared branches
-   Ignore merge conflicts in SQL files
-   Commit without pulling latest changes first

### 4. Performance Optimization

✅ **DO**:

-   Adjust refresh interval based on database size:
    -   Small databases (< 100 objects): 5-10 minutes
    -   Medium databases (100-500 objects): 15-30 minutes
    -   Large databases (> 500 objects): 30-60 minutes
-   Use manual refresh for one-time bulk changes
-   Monitor cache refresh notifications for performance issues

❌ **DON'T**:

-   Set very short refresh intervals on large databases
-   Run multiple manual refreshes simultaneously
-   Keep auto-refresh enabled on databases you rarely modify

### 5. Security Considerations

✅ **DO**:

-   Use SSH keys for Git authentication when possible
-   Store Git credentials securely (use credential managers)
-   Review what's being committed to Git (avoid sensitive data)
-   Use private repositories for proprietary database schemas
-   Limit database permissions to read-only for cache operations

❌ **DON'T**:

-   Commit database credentials to Git
-   Use public repositories for sensitive database schemas
-   Share connection strings in commit messages
-   Grant excessive database permissions for caching

### 6. Troubleshooting Prevention

✅ **DO**:

-   Verify Git is installed and accessible before linking
-   Test Git repository access before linking
-   Keep VS Code and MSSQL extension up-to-date
-   Monitor cache refresh notifications for errors
-   Regularly check Source Control view for unexpected changes

❌ **DON'T**:

-   Ignore error notifications
-   Continue working if cache refresh fails repeatedly
-   Assume cache is always up-to-date without verification

---

## Troubleshooting

### Issue 1: Cache Not Refreshing Automatically

**Symptoms**:

-   Database changes not appearing in Source Control view
-   Cached files are outdated
-   No refresh notifications appearing

**Possible Causes**:

1. Auto-refresh is disabled
2. Database is not linked to Git (for DDL auto-refresh)
3. Refresh interval is too long
4. Extension encountered an error

**Solutions**:

1. **Check auto-refresh settings**:

    ```json
    {
        "mssql.localCache.enabled": true,
        "mssql.localCache.autoRefreshEnabled": true
    }
    ```

2. **Verify database is linked to Git** (for DDL auto-refresh):

    - Right-click database in Object Explorer
    - Look for Git branch icon decoration
    - If not linked, select "Link to Git Branch..."

3. **Check refresh interval**:

    - Open Settings → Search for `mssql.localCache.autoRefreshIntervalMinutes`
    - Reduce interval if needed (e.g., from 60 to 15 minutes)

4. **Manually trigger refresh**:

    - Right-click database → "Refresh Local Cache"
    - Check for error messages

5. **Check Output panel**:
    - View → Output → Select "MSSQL" from dropdown
    - Look for error messages related to cache refresh

[IMAGE PLACEHOLDER: Screenshot of VS Code Output panel with "MSSQL" selected, showing cache refresh log messages]

### Issue 2: Git Repository Link Fails

**Symptoms**:

-   "Failed to clone repository" error message
-   "Failed to validate URL" error
-   Link operation times out

**Possible Causes**:

1. Git is not installed or not in PATH
2. Invalid repository URL
3. Authentication failure
4. Network connectivity issues
5. Repository doesn't exist or is inaccessible

**Solutions**:

1. **Verify Git installation**:

    - Open terminal in VS Code
    - Run: `git --version`
    - If not found, install Git from https://git-scm.com/downloads
    - Restart VS Code after installation

2. **Check repository URL format**:

    - HTTPS: `https://github.com/username/repo.git`
    - SSH: `git@github.com:username/repo.git`
    - Ensure `.git` extension is included

3. **Test repository access manually**:

    ```bash
    git ls-remote --heads <repository-url>
    ```

    - If this fails, fix Git authentication first

4. **Configure Git credentials**:

    - For HTTPS: Use Git credential manager
    - For SSH: Set up SSH keys
    - Test with a simple `git clone` command

5. **Check network connectivity**:
    - Verify you can access the Git hosting service
    - Check firewall/proxy settings
    - Try accessing repository in a web browser

[IMAGE PLACEHOLDER: Screenshot of terminal showing successful `git --version` and `git ls-remote` commands]

### Issue 3: Source Control View Shows No Changes

**Symptoms**:

-   Source Control view is empty
-   Database is linked to Git
-   You know there are differences

**Possible Causes**:

1. Cache is not populated
2. Cache is out of sync
3. Git repository is empty
4. All changes have been staged

**Solutions**:

1. **Refresh the cache**:

    - Right-click database → "Refresh Local Cache"
    - Wait for completion

2. **Refresh Source Control view**:

    - Right-click database → "Compare Database to Repo"
    - This clears the Git status cache and reloads

3. **Check cache status**:

    - Navigate to cache directory
    - Verify SQL files exist
    - Check `cache-metadata.json` for object count

4. **Verify Git repository has content**:

    - Right-click database → "Open Git Repository in Source Control"
    - Check if SQL files exist in the repository

5. **Check Staged Changes section**:
    - Changes may already be staged
    - Unstage if needed to see them in Changes section

### Issue 4: Diff View Not Opening

**Symptoms**:

-   Clicking on a changed object does nothing
-   Error message when trying to open diff
-   Diff view shows empty content

**Possible Causes**:

1. Cached file is missing
2. Git repository file is missing
3. File permissions issue
4. VS Code diff editor issue

**Solutions**:

1. **Refresh the cache**:

    - Right-click database → "Refresh Local Cache"

2. **Verify files exist**:

    - Check local cache directory for the SQL file
    - Check Git repository directory for the SQL file

3. **Check file permissions**:

    - Ensure VS Code has read access to both directories

4. **Try opening files manually**:

    - Navigate to cache directory
    - Open SQL file in VS Code
    - If this fails, check file permissions

5. **Restart VS Code**:
    - Sometimes the diff editor needs a restart

### Issue 5: Discard Changes Fails

**Symptoms**:

-   "Failed to discard changes" error message
-   Database object not updated
-   Error in Messages pane

**Possible Causes**:

1. Insufficient database permissions
2. Object is locked by another process
3. Syntax error in generated script
4. Foreign key constraints preventing changes

**Solutions**:

1. **Check database permissions**:

    - Ensure you have ALTER/CREATE/DROP permissions
    - For tables: Ensure you have data modification permissions

2. **Check for locks**:

    - Close other query windows using the object
    - Check for active transactions

3. **Review the error message**:

    - Check Messages pane for SQL error details
    - Look for constraint violations or syntax errors

4. **Try manual execution**:

    - Copy the generated script from the preview
    - Execute manually to see detailed error
    - Fix any issues and retry

5. **For tables with foreign keys**:
    - Temporarily disable foreign key constraints
    - Or discard dependent objects first

### Issue 6: Auto-Refresh on DDL Not Working

**Symptoms**:

-   Execute DDL statement
-   No cache refresh notification
-   Changes not appearing in Source Control view

**Possible Causes**:

1. Feature is disabled
2. Database is not linked to Git
3. DDL statement not recognized
4. Query execution failed

**Solutions**:

1. **Check setting**:

    ```json
    {
        "mssql.gitIntegration.autoRefreshCacheOnDDL": true
    }
    ```

2. **Verify database is linked to Git**:

    - Right-click database → Check for Git branch icon
    - If not linked, this feature won't activate

3. **Check DDL statement type**:

    - Supported: CREATE, ALTER, DROP for tables, views, procedures, functions, etc.
    - Not supported: SELECT, INSERT, UPDATE, DELETE

4. **Verify query executed successfully**:

    - Check Messages pane for errors
    - Auto-refresh only triggers on successful execution

5. **Wait for debounce period**:

    - Refresh occurs 2 seconds after last DDL statement
    - Execute another DDL or wait 2 seconds

6. **Manually refresh if needed**:
    - Right-click database → "Refresh Local Cache"

### Issue 7: Large Database Performance Issues

**Symptoms**:

-   Cache refresh takes very long (> 5 minutes)
-   VS Code becomes unresponsive during refresh
-   Frequent timeout errors

**Possible Causes**:

1. Database has thousands of objects
2. Refresh interval is too short
3. Network latency to database server
4. Insufficient system resources

**Solutions**:

1. **Increase refresh interval**:

    ```json
    {
        "mssql.localCache.autoRefreshIntervalMinutes": 60
    }
    ```

2. **Disable auto-refresh**:

    ```json
    {
        "mssql.localCache.autoRefreshEnabled": false
    }
    ```

    - Use manual refresh only when needed

3. **Optimize database connection**:

    - Use a faster network connection
    - Connect to a local database replica if available

4. **Filter objects** (future enhancement):

    - Currently not supported
    - Consider using a subset database for development

5. **Monitor system resources**:
    - Close unnecessary applications
    - Ensure adequate RAM and CPU available

### Issue 8: Merge Conflicts in Git

**Symptoms**:

-   Git shows merge conflicts in SQL files
-   Unable to pull latest changes
-   Conflicting changes from team members

**Possible Causes**:

1. Multiple developers modified same object
2. Didn't pull before making changes
3. Concurrent schema changes

**Solutions**:

1. **Pull latest changes first**:

    - Always pull before making schema changes
    - Use Git tools to pull: `git pull origin <branch>`

2. **Resolve conflicts manually**:

    - Open conflicting SQL file in VS Code
    - Use VS Code's merge conflict resolver
    - Choose incoming, current, or both changes
    - Test the merged script before committing

3. **Communicate with team**:

    - Coordinate schema changes
    - Use feature branches for major changes
    - Review pull requests before merging

4. **Use database comparison tools**:

    - Compare your database with the merged Git version
    - Verify the merged script is correct

5. **Test in development environment**:
    - Apply merged changes to a test database
    - Verify functionality before pushing

[IMAGE PLACEHOLDER: Screenshot of VS Code showing a merge conflict in a SQL file with conflict markers and the merge conflict resolver UI]

### Getting Additional Help

If you continue to experience issues:

1. **Check the Output panel**:

    - View → Output → Select "MSSQL"
    - Look for detailed error messages and stack traces

2. **Enable debug logging**:

    ```json
    {
        "mssql.logDebugInfo": true
    }
    ```

    - Restart VS Code
    - Reproduce the issue
    - Check Output panel for detailed logs

3. **Report an issue**:

    - Visit: https://github.com/Microsoft/vscode-mssql/issues
    - Provide:
        - VS Code version
        - MSSQL extension version
        - Steps to reproduce
        - Error messages from Output panel
        - Screenshots if applicable

4. **Community support**:
    - GitHub Discussions: https://github.com/Microsoft/vscode-mssql/discussions
    - Stack Overflow: Tag questions with `vscode-mssql`

---

## Summary

The Local Cache and Git Integration features provide a powerful workflow for database schema version control. By following this guide, you can:

✅ Automatically cache database objects for offline access
✅ Link databases to Git repositories for version control
✅ Track and visualize schema changes
✅ Stage and commit database changes to Git
✅ Revert database objects to match repository versions
✅ Collaborate with team members using Git workflows

For more information, see:

-   [MSSQL Extension Documentation](https://aka.ms/vscode-mssql-docs)
-   [GitHub Repository](https://github.com/Microsoft/vscode-mssql)
-   [Feature Demos](https://aka.ms/vscode-mssql-demos)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-XX
**Extension Version**: 1.37.0+
