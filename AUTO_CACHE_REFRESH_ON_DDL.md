# Automatic Local Cache Refresh on DDL Execution

## Overview

This feature automatically refreshes the local cache for Git-linked databases when DDL (Data Definition Language) statements are executed successfully. This ensures that the local cache stays in sync with schema changes, improving the accuracy of Git integration comparisons.

## Problem Statement

Previously, when users executed DDL statements (e.g., `CREATE TABLE`, `ALTER VIEW`, `DROP PROCEDURE`) on a Git-linked database, the local cache would become stale. Users had to manually trigger a cache refresh using the "Refresh Local Cache" command to see the changes reflected in the Source Control view.

This created a poor user experience:

-   **Manual intervention required**: Users had to remember to refresh the cache
-   **Stale comparisons**: Git integration would show incorrect differences
-   **Confusion**: Users might not understand why their changes weren't showing up

## Solution

The extension now automatically detects DDL statements in executed queries and triggers a cache refresh for Git-linked databases. The refresh is:

-   **Automatic**: No user intervention required
-   **Debounced**: Multiple DDL statements in quick succession trigger only one refresh
-   **Non-blocking**: Runs asynchronously without interrupting the user
-   **Configurable**: Can be enabled/disabled via VS Code settings

## Architecture

### Components

#### 1. **DdlDetectionService** (`src/services/ddlDetectionService.ts`)

-   **Purpose**: Detect DDL statements in SQL query text
-   **Key Methods**:
    -   `containsDdl(queryText: string): boolean` - Check if query contains DDL
    -   `extractDdlTypes(queryText: string): string[]` - Extract DDL statement types
    -   `normalizeQuery(queryText: string): string` - Remove comments and strings

**DDL Keywords Detected**:

-   Table operations: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE TABLE`
-   View operations: `CREATE VIEW`, `ALTER VIEW`, `DROP VIEW`
-   Stored Procedure operations: `CREATE PROCEDURE`, `ALTER PROCEDURE`, `DROP PROCEDURE`
-   Function operations: `CREATE FUNCTION`, `ALTER FUNCTION`, `DROP FUNCTION`
-   Index operations: `CREATE INDEX`, `DROP INDEX`, `ALTER INDEX`
-   Schema operations: `CREATE SCHEMA`, `ALTER SCHEMA`, `DROP SCHEMA`
-   Type operations: `CREATE TYPE`, `DROP TYPE`
-   Trigger operations: `CREATE TRIGGER`, `ALTER TRIGGER`, `DROP TRIGGER`
-   Sequence operations: `CREATE SEQUENCE`, `ALTER SEQUENCE`, `DROP SEQUENCE`
-   Synonym operations: `CREATE SYNONYM`, `DROP SYNONYM`

**Non-DDL Statements (Excluded)**:

-   Read-only: `SELECT`
-   Data manipulation: `INSERT`, `UPDATE`, `DELETE`, `MERGE`
-   Transaction control: `BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK`
-   Session statements: `USE`, `SET`, `DECLARE`

#### 2. **AutoCacheRefreshService** (`src/services/autoCacheRefreshService.ts`)

-   **Purpose**: Manage automatic cache refresh with debouncing
-   **Key Features**:
    -   Singleton pattern for global state management
    -   Debouncing to avoid multiple refreshes (default: 2 seconds)
    -   Per-connection tracking of pending refreshes
    -   Telemetry for monitoring usage
    -   Creates dedicated cache connections when needed

**Key Methods**:

-   `handleQueryCompletion(ownerUri, queryText, hasError, credentials)` - Entry point for query completion
-   `scheduleDebouncedRefresh(ownerUri, credentials, ddlTypes)` - Schedule refresh with debouncing
-   `performRefresh(connectionKey)` - Execute the actual cache refresh
-   `generateConnectionHash(credentials)` - Generate deterministic hash for cache connection URI

**Debouncing Strategy**:

1. When a DDL statement is detected, start a 2-second timer
2. If another DDL statement executes before the timer expires, reset the timer
3. Only trigger the cache refresh when the timer expires without new DDL statements
4. Track pending refreshes per database connection to avoid conflicts

#### 3. **QueryRunner Integration** (`src/controllers/queryRunner.ts`)

-   **Modified Methods**:
    -   Constructor: Accept `AutoCacheRefreshService` and `ConnectionManager` dependencies
    -   `handleQueryComplete()`: Call `_handleAutoCacheRefresh()` after query completion
    -   `_handleAutoCacheRefresh()`: New private method to trigger auto-refresh

**Integration Flow**:

```
Query Execution Complete
    ↓
handleQueryComplete()
    ↓
_handleAutoCacheRefresh()
    ↓
Get query text from _uriToQueryStringMap
    ↓
Get connection credentials from ConnectionManager
    ↓
Call AutoCacheRefreshService.handleQueryCompletion()
    ↓
(Async, non-blocking) Check DDL → Check Git link → Schedule refresh
```

#### 4. **SqlOutputContentProvider Integration** (`src/models/sqlOutputContentProvider.ts`)

-   **Modified**:
    -   Constructor: Accept `AutoCacheRefreshService` and `ConnectionManager` parameters
    -   `createQueryRunner()`: Pass services to QueryRunner constructor

#### 5. **MainController Integration** (`src/controllers/mainController.ts`)

-   **Modified**:
    -   `initialize()`: Create `AutoCacheRefreshService` singleton after `GitStatusService`
    -   Inject services into `SqlOutputContentProvider` after initialization

## User Experience

### Automatic Refresh Flow

1. **User executes DDL statement**:

    ```sql
    CREATE TABLE Customers (
        Id INT PRIMARY KEY,
        Name NVARCHAR(100)
    );
    ```

2. **Extension detects DDL**:

    - Query completes successfully
    - `DdlDetectionService` identifies `CREATE TABLE` statement
    - Checks if database is linked to Git (yes)

3. **Debounce timer starts**:

    - 2-second timer begins
    - If user executes more DDL, timer resets

4. **Cache refresh triggers**:

    - Status bar shows: `$(sync~spin) Refreshing cache for MyDatabase...`
    - Refresh runs in background (non-blocking)
    - Status bar shows: `$(check) Cache refreshed for MyDatabase`

5. **Source Control view updates**:
    - New table appears in "Changes" section
    - User can stage, commit, or discard the change

### User Settings

**Setting**: `mssql.gitIntegration.autoRefreshCacheOnDDL`

-   **Type**: `boolean`
-   **Default**: `true` (enabled)
-   **Description**: "Automatically refresh the local cache when DDL (Data Definition Language) statements are executed on Git-linked databases. This ensures the cache stays in sync with schema changes."

**To disable**:

1. Open VS Code Settings (Ctrl+,)
2. Search for "mssql git integration auto refresh"
3. Uncheck "Auto Refresh Cache On DDL"

## Edge Cases Handled

### 1. **Multi-Statement Queries**

-   **Scenario**: Query contains both DDL and DML
    ```sql
    CREATE TABLE Test (Id INT);
    INSERT INTO Test VALUES (1);
    ```
-   **Behavior**: Refresh is triggered (DDL detected)

### 2. **Failed DDL Statements**

-   **Scenario**: DDL statement has syntax error
-   **Behavior**: No refresh (only successful queries trigger refresh)

### 3. **Database Switching**

-   **Scenario**: Query contains `USE [DatabaseName]`
-   **Behavior**: Refresh is triggered for the connection's current database

### 4. **Concurrent Queries**

-   **Scenario**: Multiple query windows executing DDL on same database
-   **Behavior**: Debouncing ensures only one refresh occurs

### 5. **Non-Git-Linked Databases**

-   **Scenario**: DDL executed on database not linked to Git
-   **Behavior**: No refresh (Git link check fails early)

### 6. **Batch Queries**

-   **Scenario**: Multiple DDL statements separated by `GO`
    ```sql
    CREATE TABLE Table1 (Id INT);
    GO
    CREATE TABLE Table2 (Id INT);
    GO
    ```
-   **Behavior**: Single refresh after all batches complete (debounced)

## Performance Considerations

### Minimal Overhead

-   **DDL Detection**: Regex-based, runs in <1ms for typical queries
-   **Git Link Check**: Cached, no database round-trip
-   **Debouncing**: Prevents excessive refreshes during migration scripts

### Async Execution

-   Cache refresh runs asynchronously
-   Does not block query result display
-   Does not block user interaction

### Telemetry

-   Tracks automatic refresh events
-   Records DDL statement types
-   Monitors debounce effectiveness (DDL count per refresh)

## Testing Scenarios

### ✅ Positive Tests

1. **Single DDL Statement**

    - Execute: `CREATE TABLE Test (Id INT)`
    - Expected: Cache refreshes after 2 seconds

2. **Multiple DDL Statements (Debounced)**

    - Execute 5 `ALTER TABLE` statements within 2 seconds
    - Expected: Only 1 cache refresh occurs

3. **Mixed DDL Types**

    - Execute: `CREATE TABLE`, `CREATE VIEW`, `CREATE PROCEDURE`
    - Expected: Single refresh, telemetry shows all 3 types

4. **Git-Linked Database**
    - Execute DDL on Git-linked database
    - Expected: Refresh occurs, Source Control view updates

### ❌ Negative Tests

1. **Non-DDL Statement**

    - Execute: `SELECT * FROM Customers`
    - Expected: No cache refresh

2. **DML Statement**

    - Execute: `INSERT INTO Customers VALUES (1, 'John')`
    - Expected: No cache refresh

3. **Failed DDL**

    - Execute: `CREATE TABLE Test (InvalidSyntax`
    - Expected: No cache refresh (query has error)

4. **Non-Git-Linked Database**

    - Execute DDL on database not linked to Git
    - Expected: No cache refresh

5. **Feature Disabled**
    - Set `mssql.gitIntegration.autoRefreshCacheOnDDL` to `false`
    - Execute DDL
    - Expected: No cache refresh

## Future Enhancements

### Potential Improvements

1. **Configurable Debounce Delay**

    - Add setting: `mssql.gitIntegration.autoRefreshDebounceMs`
    - Allow users to adjust debounce period (default: 2000ms)

2. **Selective Refresh**

    - Only refresh affected object types (e.g., only tables if `CREATE TABLE`)
    - Faster refresh for targeted changes

3. **User Notification Options**

    - Add setting for notification level (none, status bar, toast)
    - Allow users to customize feedback

4. **Refresh Progress**

    - Show progress bar for large cache refreshes
    - Display object count being refreshed

5. **Smart Refresh**
    - Parse DDL to extract object names
    - Only refresh specific objects instead of full cache

## Troubleshooting

### Issue: Cache not refreshing after DDL

**Possible Causes**:

1. Feature is disabled in settings
2. Database is not linked to Git
3. Query had errors
4. DDL statement type not recognized

**Solutions**:

1. Check `mssql.gitIntegration.autoRefreshCacheOnDDL` setting
2. Verify database is linked: Right-click database → "Link to Git Branch..."
3. Check query executed successfully (no errors in Messages pane)
4. Manually refresh: Right-click database → "Refresh Local Cache"

### Issue: Multiple refreshes occurring

**Possible Cause**: Debounce delay too short for your workflow

**Solution**: Wait for debounce period (2 seconds) between DDL statements

### Issue: Refresh taking too long

**Possible Cause**: Large database with many objects

**Solution**:

-   Use manual refresh for large databases
-   Consider disabling auto-refresh for very large databases

## Summary

The automatic cache refresh on DDL feature provides a seamless experience for developers working with Git-integrated databases. By automatically detecting schema changes and updating the local cache, it eliminates manual steps and ensures accurate Git comparisons.

**Key Benefits**:

-   ✅ **Automatic**: No manual intervention required
-   ✅ **Smart**: Only refreshes for DDL on Git-linked databases
-   ✅ **Efficient**: Debouncing prevents excessive refreshes
-   ✅ **Non-intrusive**: Runs in background without blocking
-   ✅ **Configurable**: Can be disabled if not needed
