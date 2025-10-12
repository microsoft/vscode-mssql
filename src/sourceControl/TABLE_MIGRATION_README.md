# Table Migration and Discard Changes Feature

## Overview

This feature enables users to safely discard table schema changes in the "Compare Database to Repo" functionality by generating and previewing SQL migration scripts before execution.

## Architecture

### Components

1. **tableMigrationTypes.ts** - TypeScript interfaces for table schemas, differences, and migration options
2. **tableSQLParser.ts** - Parses CREATE TABLE SQL scripts and extracts schema information
3. **tableSchemaComparator.ts** - Compares two table schemas and identifies differences
4. **tableMigrationGenerator.ts** - Generates SQL migration scripts from schema differences
5. **tableMigrationService.ts** - Main service that orchestrates parsing, comparison, and script generation
6. **databaseSourceControlProvider.ts** - Integration point for the discard changes workflow

### Data Flow

```
User clicks "Discard Changes" on a table
    ↓
Read database SQL (from local cache) and Git SQL (from repository)
    ↓
Parse both SQL scripts to extract table schemas
    ↓
Compare schemas to identify differences
    ↓
Analyze potential data loss (dropped columns, modified types, etc.)
    ↓
Show data loss warning dialog
    ↓
Generate migration script
    ↓
Show migration script preview in editor
    ↓
User reviews and confirms
    ↓
Execute migration script
    ↓
Update local cache and refresh UI
```

## Features

### 1. Data Loss Analysis

The system analyzes schema differences and identifies:

-   **Dropped Columns**: Columns that exist in the database but not in Git (data will be lost)
-   **Modified Columns**: Columns with changed data types (potential data loss)
-   **Dropped Constraints**: Constraints that will be removed
-   **Dropped Indexes**: Indexes that will be removed

### 2. Warning Dialogs

Different warning levels based on the operation:

#### For Modified Tables (with data loss)

```
⚠️ WARNING: Potential Data Loss

Discarding changes to table "Users" may result in data loss:

⚠️ 2 column(s) will be DROPPED (data will be lost):
   • MiddleName
   • LegacyId

⚠️ 1 column(s) will be MODIFIED (potential data loss):
   • Email: NVARCHAR(50) → NVARCHAR(100)

This operation CANNOT be undone. Do you want to preview the migration script?
```

#### For Modified Tables (no data loss)

```
Discard changes to table "Users"?

This will modify the table schema to match the Git repository version.

No data loss is expected, but you should preview the migration script.
```

#### For Added Tables (DROP operation)

```
⚠️ WARNING: Data Loss Operation

Table "Users" exists in the database but not in the Git repository.

Discarding this change will DROP THE ENTIRE TABLE and ALL ITS DATA.

This operation CANNOT be undone. Are you sure you want to continue?
```

#### For Deleted Tables (CREATE operation)

```
Table "Users" exists in the Git repository but not in the database.

Discarding this change will CREATE the table in the database.

Continue?
```

### 3. Migration Script Preview

Before execution, the generated migration script is displayed in a new SQL editor window with syntax highlighting. The user can:

-   Review the exact SQL that will be executed
-   Understand the order of operations
-   Cancel if the script doesn't look correct

Example migration script:

```sql
-- Migration Script
-- Table: [dbo].[Users]
-- Generated: 2025-01-15T10:30:00.000Z
-- WARNING: This script may result in data loss!

-- Drop Constraints
ALTER TABLE [dbo].[Users] DROP CONSTRAINT [FK_Users_Departments]
GO

-- Drop Indexes
DROP INDEX [IX_Users_Email] ON [dbo].[Users]
GO

-- Drop Columns (DATA LOSS WARNING!)
ALTER TABLE [dbo].[Users] DROP COLUMN [MiddleName]
GO

-- Add Columns
ALTER TABLE [dbo].[Users] ADD [PhoneNumber] NVARCHAR(20) NULL
GO

-- Modify Columns (POTENTIAL DATA LOSS WARNING!)
ALTER TABLE [dbo].[Users] ALTER COLUMN [Email] NVARCHAR(100) NOT NULL
GO

-- Add Constraints
ALTER TABLE [dbo].[Users] ADD CONSTRAINT [UQ_Users_Email] UNIQUE ([Email])
GO

-- Add Indexes
CREATE NONCLUSTERED INDEX [IX_Users_PhoneNumber] ON [dbo].[Users] ([PhoneNumber] ASC)
GO
```

### 4. Migration Script Generation Order

The migration generator follows a safe order of operations:

1. **Drop Constraints** - Remove constraints that depend on columns being dropped
2. **Drop Indexes** - Remove indexes before modifying columns
3. **Drop Columns** - Remove columns (data loss)
4. **Add Columns** - Add new columns
5. **Modify Columns** - Alter existing column definitions
6. **Add Constraints** - Add new constraints
7. **Add Indexes** - Create new indexes

This order minimizes errors and ensures dependencies are handled correctly.

## Supported SQL Features

### Columns

-   ✅ Data types (INT, NVARCHAR, DATETIME, BIT, DECIMAL, etc.)
-   ✅ NULL / NOT NULL constraints
-   ✅ IDENTITY(seed, increment) specifications
-   ✅ DEFAULT values (constants and functions)

### Constraints

-   ✅ PRIMARY KEY (CLUSTERED/NONCLUSTERED)
-   ✅ UNIQUE constraints
-   ✅ CHECK constraints
-   ✅ FOREIGN KEY constraints

### Indexes

-   ✅ CLUSTERED / NONCLUSTERED indexes
-   ✅ UNIQUE indexes
-   ✅ Single and multi-column indexes
-   ✅ ASC / DESC ordering

## User Workflow

### Scenario 1: Discard Modified Table (with data loss)

1. User sees table "Users" marked as Modified in Source Control view
2. User right-clicks and selects "Discard Changes"
3. System analyzes differences and detects dropped column "MiddleName"
4. Warning dialog appears showing data loss details
5. User clicks "Preview Migration Script"
6. Migration script opens in new editor showing DROP COLUMN statement
7. User reviews script and clicks "Execute Script"
8. Progress notification shows "Executing table migration script..."
9. Script executes successfully
10. Local cache updates and Source Control view refreshes
11. Success message: "Successfully synced table Users from Git repository."

### Scenario 2: Discard Added Table (DROP operation)

1. User sees table "TempData" marked as Added (exists in DB but not in Git)
2. User right-clicks and selects "Discard Changes"
3. Warning dialog appears: "This will DROP THE ENTIRE TABLE and ALL ITS DATA"
4. User clicks "Preview DROP Script"
5. DROP TABLE script opens in editor
6. User confirms and clicks "Execute Script"
7. Table is dropped from database
8. Source Control view refreshes

### Scenario 3: Discard Deleted Table (CREATE operation)

1. User sees table "NewFeature" marked as Deleted (exists in Git but not in DB)
2. User right-clicks and selects "Discard Changes"
3. Info dialog appears: "This will CREATE the table in the database"
4. User clicks "Preview CREATE Script"
5. CREATE TABLE script from Git opens in editor
6. User confirms and clicks "Execute Script"
7. Table is created in database
8. Source Control view refreshes

## Error Handling

The system handles various error scenarios:

1. **Parse Errors**: If SQL cannot be parsed, shows error message with details
2. **Execution Errors**: If migration script fails, shows error and does not update cache
3. **File Read Errors**: If Git or cache files cannot be read, shows appropriate error
4. **Connection Errors**: If database connection fails, shows connection error

All errors are logged to the console with `[SourceControl]` prefix for debugging.

## Limitations

1. **Column Rename Detection**: The system cannot detect column renames - they appear as DROP + ADD
2. **Data Type Compatibility**: No validation of data type compatibility (e.g., VARCHAR to INT)
3. **Complex Constraints**: Some complex constraint definitions may not parse correctly
4. **Triggers**: Table triggers are not included in the migration
5. **Permissions**: Table permissions are not included in the migration

## Future Enhancements

-   Column rename detection using heuristics (name similarity, position, type)
-   Data type compatibility validation with warnings
-   Support for table triggers in migration scripts
-   Rollback script generation
-   Dry-run mode to test migration without executing
-   Migration script history and versioning
-   Support for other database objects (views, stored procedures) using similar patterns

## Testing

To test the table migration functionality:

1. Create a test database and link it to a Git repository
2. Create a table in the database
3. Modify the table schema (add/remove columns, change types)
4. Use "Compare Database to Repo" to see changes
5. Right-click the table and select "Discard Changes"
6. Verify warning dialogs appear correctly
7. Review the generated migration script
8. Execute and verify the table schema matches Git

## Code Examples

### Using TableMigrationService Directly

```typescript
import { TableMigrationService } from "./tableMigrationService";

const service = new TableMigrationService({
    includeDrop: true,
    includeComments: true,
});

// Generate migration script
const databaseSQL = "CREATE TABLE [dbo].[Users] (...)";
const gitSQL = "CREATE TABLE [dbo].[Users] (...)";
const migrationScript = service.generateMigrationScript(databaseSQL, gitSQL);

// Analyze data loss
const dataLoss = service.analyzeDataLoss(databaseSQL, gitSQL);
if (dataLoss.hasDataLoss) {
    console.log(service.formatDataLossSummary(dataLoss));
}
```

### Parsing Table Schema

```typescript
import { TableSQLParser } from "./tableSQLParser";

const parser = new TableSQLParser();
const schema = parser.parse("CREATE TABLE [dbo].[Users] (...)");

console.log(`Table: ${schema.schema}.${schema.name}`);
console.log(`Columns: ${schema.columns.length}`);
console.log(`Constraints: ${schema.constraints.length}`);
console.log(`Indexes: ${schema.indexes.length}`);
```

## Integration Points

The table migration functionality integrates with:

1. **DatabaseSourceControlProvider** - Main integration point for discard changes
2. **GitStatusService** - Provides Git status information
3. **LocalCacheService** - Provides cached database object scripts
4. **SqlToolsServiceClient** - Executes migration scripts against the database
5. **VS Code UI** - Shows dialogs, previews, and progress notifications

## Security Considerations

1. **No Automatic Execution**: Migration scripts are never executed without explicit user confirmation
2. **Preview Required**: Users must review the script before execution
3. **Multiple Confirmations**: For destructive operations (DROP), multiple confirmation steps are required
4. **Logging**: All operations are logged for audit purposes
5. **Error Messages**: Error messages do not expose sensitive connection information
