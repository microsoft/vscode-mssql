# Azure SQL Database Container Integration Tests

Manual compatibility testing of MSSQL extension features against a local Azure SQL
Database (SqlDbDev) container. Test actual database behavior, not just whether a
dialog opens. Cloud provisioning and firewall management are outside this checklist.

## Results at a Glance

**As of October 2, 2026: 17 passed, 4 failed, none awaiting a result.**

Results are reported by the manual tester and apply only to the tested configuration.
The coverage column describes the intended checks, not an itemized execution log.
Environment versions, image digest, and detailed output/screenshots have not been
recorded. For future runs, capture the host OS/architecture, container engine/version,
image digest, VS Code/MSSQL versions, database, and relevant evidence.

| ID     | Feature                         | Status | Reported date | Coverage                                                                                      |
| ------ | ------------------------------- | ------ | ------------- | --------------------------------------------------------------------------------------------- |
| SQL-01 | Server/database detection       | Passed | 2026-09-30    | Record engine edition/version; verify commands match SqlDbDev capabilities                    |
| SQL-02 | Object Explorer                 | Passed | 2026-09-30    | Expand, refresh, filter, reconnect, and verify objects against the fixture                    |
| SQL-03 | Object search and scripting     | Passed | 2026-09-30    | Find the correct objects; generate and execute compatible scripts                             |
| SQL-04 | Query execution                 | Passed | 2026-10-02    | DDL, CRUD, commit/rollback, batches, result sets, messages, and errors                        |
| SQL-05 | Cancellation and recovery       | Passed | 2026-09-30    | Cancel a long query; verify the connection and subsequent results                             |
| SQL-06 | IntelliSense and editor tooling | Passed | 2026-09-30    | Schema-aware completions, diagnostics, formatting, and database selection                     |
| SQL-07 | Results grids                   | Passed | 2026-09-30    | Exact values, NULLs, Unicode, large values, sorting, selection, copying, and export           |
| SQL-08 | View & Edit Data                | Passed | 2026-10-02    | Persist edits; discard canceled edits; handle constraints, read-only columns, and concurrency |
| SQL-09 | Table Designer                  | Failed | 2026-10-02    | Create/alter columns, keys, indexes, defaults, and relationships                              |
| SQL-10 | Schema Designer                 | Failed | 2026-10-02    | Load, edit, publish, and reload schema changes                                                |
| SQL-11 | Schema Compare                  | Passed | 2026-10-02    | Compare fixtures, deploy selected differences, and compare again                              |
| SQL-12 | SQL Database Projects           | Passed | 2026-10-02    | Extract/import, build for the correct target, publish, and verify                             |
| SQL-13 | DACPAC/BACPAC                   | Passed | 2026-10-02    | Supported publish/extract/import/export workflows and schema/data round-trip                  |
| SQL-14 | Execution plans                 | Passed | 2026-10-02    | Estimated/actual plans, warnings, properties, XML, and query results                          |
| SQL-15 | Query Profiler                  | Passed | 2026-10-02    | Capture identifiable queries and stop cleanly without a leaked session                        |
| SQL-16 | Flat-file import                | Passed | 2026-10-02    | Imported types, counts, values, and malformed-input handling                                  |
| SQL-17 | Database management             | Failed | 2026-10-02    | Create, rename, and drop; dialogs and Object Explorer reflect actual state                    |
| SQL-18 | Backup/restore                  | Failed | 2026-10-02    | Supported workflows or clear unavailability/errors; host/container file paths                 |
| SQL-19 | Data API builder                | Passed | 2026-10-02    | Configuration, deployment, REST/GraphQL, CRUD, and networking                                 |
| SQL-20 | SQL notebooks                   | Passed | 2026-10-02    | Connect, execute cells, render results/errors, and reconnect after restart                    |
| SQL-21 | Copilot integrations            | Passed | 2026-10-02    | Correct database context and usable generated SQL, schema, and DAB configuration              |

### Remaining Work

- Fix and retest the four failures below.
- Verify automatic query timeout separately; SQL-05 covers manual cancellation only.
- Record the grid modes, value-length limits, and export formats tested for SQL-07.
  Coverage of both supported grids has not been confirmed.
- Attach evidence and GitHub issue links where available.

## Known Failures

### SQL-09 and SQL-10: Designer validation

Table Designer and Schema Designer both fail validation for `TestDb`, which was
created through the New Database dialog:

```text
One or more errors occured during validation.
1. The element TestDb is not supported in Microsoft Azure SQL Database v12.
2. The element TestDb_log is not supported in Microsoft Azure SQL Database v12.
```

Expected: supported design changes validate and publish successfully.
The root cause is unconfirmed; the element names may refer to logical database
files, but metadata and generated scripts are needed to verify that.

### SQL-17: Errors after successful database operations

Create, rename, and drop succeed functionally, but each displays errors afterward.
Expected: successful operations update the UI without misleading errors.
The tester reports existing GitHub bugs; issue links and exact messages are not
yet recorded.

### SQL-18: Restore never finishes loading

Opening Restore on the container leaves the dialog loading indefinitely instead
of displaying an error or warning. Expected: load the supported workflow or explain
why it is unavailable. Backup behavior and image-level restore support remain
unverified.

Regression check for [#23042](https://github.com/microsoft/vscode-mssql/issues/23042):
open Restore on a connected SqlDbDev container using `localhost` or an IP address.
Expect the Azure SQL Database unsupported message instead of a loading spinner.
Repeat on cloud Azure SQL Database, then verify ordinary SQL Server still loads
the restore form. The fix uses the connected engine edition rather than relying
on the hostname and displays configuration errors returned by the service.
The October 2 failure remains recorded until the fixed build is manually retested.

## Test Queries and Steps

Use a disposable test database and connect directly to it unless a test says
otherwise. Keep credentials out of scripts and evidence. The scripts below are
the recorded fixtures; expected output is not a substitute for captured results.

### SQL-01: Engine metadata and capability probes

Connect directly to an existing test user database, not `master`. This script
reads metadata and probes behavior without changing data or configuration.
Inspect Object Explorer/context menus separately: SQL cannot verify which commands
the extension exposes.

```sql
SELECT
    SYSUTCDATETIME() AS captured_at_utc,
    @@SERVERNAME AS server_name,
    DB_NAME() AS database_name,
    ORIGINAL_LOGIN() AS login_name,
    SERVERPROPERTY('EngineEdition') AS engine_edition,
    SERVERPROPERTY('Edition') AS edition,
    SERVERPROPERTY('ProductVersion') AS product_version,
    SERVERPROPERTY('ProductLevel') AS product_level,
    @@VERSION AS full_version;

SELECT
    name AS database_name,
    compatibility_level,
    collation_name
FROM sys.databases
WHERE name = DB_NAME();

BEGIN TRY
    EXEC sys.sp_executesql N'EXEC sp_configure;';

    SELECT
        'sp_configure' AS probe,
        'Succeeded; compare with expected image capabilities' AS outcome;
END TRY
BEGIN CATCH
    SELECT
        'sp_configure' AS probe,
        'Failed; inspect error before classifying support' AS outcome,
        ERROR_NUMBER() AS error_number,
        ERROR_MESSAGE() AS error_message;
END CATCH;

IF DB_NAME() = N'master'
BEGIN
    SELECT
        'Cross-database USE' AS probe,
        'Not tested: reconnect directly to a user database and rerun' AS outcome;
END
ELSE
BEGIN
    BEGIN TRY
        EXEC sys.sp_executesql N'USE [master];';

        SELECT
            'Cross-database USE' AS probe,
            'Succeeded; compare with expected image capabilities' AS outcome;
    END TRY
    BEGIN CATCH
        SELECT
            'Cross-database USE' AS probe,
            'Failed; inspect error before classifying support' AS outcome,
            ERROR_NUMBER() AS error_number,
            ERROR_MESSAGE() AS error_message;
    END CATCH;
END;
```

The reference expectations discussed for SqlDbDev were `EngineEdition = 5`,
`Edition = SQL Azure`, unavailable `sp_configure` (2812), and rejected cross-database
`USE` (40508). These are expectations, not captured output from this run. Compare
with the actual image digest; a permission error alone does not prove a feature
is unsupported. A successful `USE` inside dynamic SQL does not change the outer
batch's database context.

### SQL-04: Query execution script (corrected)

Run in a fresh query editor connected directly to a disposable test database.
Keep the same connection across `GO` batches so the temporary table remains
available. `GO` is an editor batch separator, not a SQL engine command.
This script creates no permanent objects and drops its temporary table before
the intentional unhandled error.

The original summary query used the reserved keyword `RowCount` without
delimiters, producing error 156. The corrected query below uses `[RowCount]`.
If cleanup already ran, rerun the full script rather than only the summary batch.

```sql
-- 1. DDL.
CREATE TABLE #SqlDbDevQueryTest
(
    Id int NOT NULL PRIMARY KEY,
    ItemName nvarchar(100) NOT NULL,
    Quantity int NOT NULL CHECK (Quantity >= 0)
);

ALTER TABLE #SqlDbDevQueryTest
ADD Notes nvarchar(200) NULL;

-- 2. CREATE / READ.
INSERT INTO #SqlDbDevQueryTest (Id, ItemName, Quantity, Notes)
VALUES
    (1, N'First item', 10, NULL),
    (2, N'Unicode: café 日本語', 20, N'Test notes'),
    (3, N'Delete this item', 30, NULL);

SELECT *
FROM #SqlDbDevQueryTest
ORDER BY Id;
-- Expected: 3 rows, including Unicode and NULL values.

-- 3. UPDATE.
UPDATE #SqlDbDevQueryTest
SET Quantity = 15
WHERE Id = 1;

SELECT
    N'Update' AS Test,
    CASE WHEN Quantity = 15 THEN N'PASS' ELSE N'FAIL' END AS Result
FROM #SqlDbDevQueryTest
WHERE Id = 1;

-- 4. DELETE.
DELETE FROM #SqlDbDevQueryTest
WHERE Id = 3;

SELECT
    N'Delete' AS Test,
    CASE
        WHEN COUNT(*) = 2
             AND COUNT(CASE WHEN Id = 3 THEN 1 END) = 0
        THEN N'PASS' ELSE N'FAIL'
    END AS Result
FROM #SqlDbDevQueryTest;
GO

-- 5. TRANSACTION / COMMIT.
BEGIN TRANSACTION;

UPDATE #SqlDbDevQueryTest
SET Quantity = 25
WHERE Id = 1;

COMMIT TRANSACTION;

SELECT
    N'Commit' AS Test,
    CASE
        WHEN Quantity = 25 AND @@TRANCOUNT = 0
        THEN N'PASS' ELSE N'FAIL'
    END AS Result
FROM #SqlDbDevQueryTest
WHERE Id = 1;
GO

-- 6. ROLLBACK.
BEGIN TRANSACTION;

UPDATE #SqlDbDevQueryTest
SET Quantity = 999
WHERE Id = 1;

INSERT INTO #SqlDbDevQueryTest (Id, ItemName, Quantity)
VALUES (4, N'Rolled-back item', 40);

SELECT * FROM #SqlDbDevQueryTest ORDER BY Id;
-- Expected inside transaction: Id 1 has Quantity 999; Id 4 exists.

ROLLBACK TRANSACTION;

SELECT
    N'Rollback' AS Test,
    CASE
        WHEN (SELECT Quantity FROM #SqlDbDevQueryTest WHERE Id = 1) = 25
             AND NOT EXISTS (SELECT 1 FROM #SqlDbDevQueryTest WHERE Id = 4)
             AND @@TRANCOUNT = 0
        THEN N'PASS' ELSE N'FAIL'
    END AS Result;
GO

-- 7. MULTIPLE RESULT SETS.
SELECT N'Detail rows' AS ResultSet, *
FROM #SqlDbDevQueryTest
ORDER BY Id;

SELECT N'Summary' AS ResultSet, COUNT(*) AS [RowCount], SUM(Quantity) AS TotalQuantity
FROM #SqlDbDevQueryTest;
-- Expected: RowCount = 2, TotalQuantity = 45.

SELECT N'Empty result' AS ResultSet, Id
FROM #SqlDbDevQueryTest
WHERE 1 = 0;
-- Expected: zero rows, but column metadata is retained.
GO

-- 8. MESSAGES.
PRINT N'SQLDBDEV TEST: PRINT message';

RAISERROR(N'SQLDBDEV TEST: informational message', 10, 1) WITH NOWAIT;

SELECT N'Execution continues after informational messages' AS Result;
GO

-- 9. SQL ERROR + TRANSACTION RECOVERY.
BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE #SqlDbDevQueryTest
    SET Quantity = 777
    WHERE Id = 1;

    INSERT INTO #SqlDbDevQueryTest (Id, ItemName, Quantity)
    VALUES (1, N'Duplicate key', 1);

    ROLLBACK TRANSACTION;
    SELECT N'Duplicate key handling' AS Test, N'FAIL: no error raised' AS Result;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    SELECT
        N'Duplicate key handling' AS Test,
        CASE
            WHEN ERROR_NUMBER() = 2627
                 AND (SELECT Quantity FROM #SqlDbDevQueryTest WHERE Id = 1) = 25
                 AND @@TRANCOUNT = 0
            THEN N'PASS' ELSE N'FAIL'
        END AS Result,
        ERROR_NUMBER() AS ErrorNumber,
        ERROR_MESSAGE() AS ErrorMessage;
END CATCH;
GO

-- 10. DDL CLEANUP.
DROP TABLE #SqlDbDevQueryTest;

SELECT
    N'Drop table' AS Test,
    CASE
        WHEN OBJECT_ID(N'tempdb..#SqlDbDevQueryTest') IS NULL
        THEN N'PASS' ELSE N'FAIL'
    END AS Result;
GO

-- 11. UNHANDLED ERROR: expected in the editor's error display.
;THROW 51000, N'SQLDBDEV TEST: intentional error; expected by this test.', 1;
GO
```

Expected: every assertion returns a row with `PASS`, the three result sets in
batch 7 are represented (including the empty set's columns), both informational
messages appear, and the final intentional error is displayed as 51000.
Run the following query separately afterward to verify connection recovery:

```sql
SELECT
    N'Connection remains usable after an error' AS Result,
    DB_NAME() AS CurrentDatabase,
    @@TRANCOUNT AS OpenTransactions;
-- Expected: the original test database and OpenTransactions = 0.
```

### SQL-05: Manual cancellation and connection recovery

Use the same query editor and connection throughout. Execute this batch, then
click Cancel after the first result appears and before the two-minute wait ends:

```sql
SELECT
    N'CANCEL-TEST: started' AS Marker,
    @@SPID AS SessionId;

WAITFOR DELAY '00:02:00';

SELECT N'CANCEL-TEST: SHOULD NOT APPEAR' AS Marker;
```

Expected: execution stops promptly, cancellation is reported, and the
`CANCEL-TEST: SHOULD NOT APPEAR` result is never returned.

After cancellation completes, replace the editor contents with this query and
execute it without manually reconnecting:

```sql
SELECT
    N'AFTER-CANCEL: fresh result' AS Marker,
    42 AS ExpectedValue,
    DB_NAME() AS CurrentDatabase,
    @@SPID AS SessionId,
    @@TRANCOUNT AS OpenTransactions;
```

Expected: one row with the new marker, `42`, the intended database, and
`OpenTransactions = 0`. The new execution must not receive delayed results or
a cancellation error from the previous execution. Record both session IDs;
a change indicates that the client replaced the SQL session.

### SQL-06: IntelliSense and editor tooling

Change the test schema and verify completions reflect the update. Exercise
diagnostics, formatting, and database selection against the container.
No case-specific query was recorded.

### SQL-07: Results grids

Run the following query in a test database. It creates no objects. Repeat the
checks in each supported results grid, recording the grid mode, configured
value-length limits, and export formats exercised.

```sql
SELECT
    v.Id,
    v.Label,
    v.NullableText,
    v.UnicodeText,
    v.SpecialText,
    CAST(v.Amount AS decimal(28, 8)) AS ExactDecimal,
    CAST(v.LargeInteger AS bigint) AS LargeInteger,
    CAST('2026-09-30T16:25:53.1234567' AS datetime2(7)) AS ExactTimestamp,
    p.LargeText,
    DATALENGTH(p.LargeText) / 2 AS LargeTextUtf16Units
FROM
(
    VALUES
    (
        3,
        N'Item 10',
        CAST(NULL AS nvarchar(30)),
        N'日本語 中文 한국어',
        N'comma,value',
        '12345678901234567890.12345678',
        '9007199254740993'
    ),
    (
        1,
        N'Item 2',
        N'',
        N'café naïve résumé',
        N'He said "hello"',
        '-0.00000001',
        '-9007199254740993'
    ),
    (
        5,
        N'Item 1',
        N'NULL',
        N'مرحبا',
        N'line one' + NCHAR(13) + NCHAR(10) + N'line two',
        '0.00000000',
        '0'
    ),
    (
        2,
        N'Duplicate',
        N' ',
        N'😀 🚀',
        N'left' + NCHAR(9) + N'right',
        '42.50000000',
        '9223372036854775807'
    ),
    (
        4,
        N'Duplicate',
        N'ordinary text',
        N'Ελληνικά',
        N'  padded text  ',
        '-123.45000000',
        '-9223372036854775808'
    )
) AS v
(
    Id, Label, NullableText, UnicodeText, SpecialText,
    Amount, LargeInteger
)
CROSS APPLY
(
    SELECT CASE v.Id
        WHEN 3 THEN
            REPLICATE(CAST(N'A' AS nvarchar(max)), 12000) + N'[END]'
        WHEN 1 THEN CAST(N'' AS nvarchar(max))
        WHEN 5 THEN CAST(NULL AS nvarchar(max))
        ELSE CAST(N'short' AS nvarchar(max))
    END AS LargeText
) AS p
ORDER BY v.Id;
```

#### Actions and Expected Results

| Area          | Actions and expected results                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact values  | Five rows initially ordered 1, 2, 3, 4, 5. Decimals retain precision; large integers match the literals without rounding. The timestamp retains `.1234567`.                                                                                     |
| NULL handling | `NullableText` contains an empty string (Id 1), one space (2), SQL NULL (3), ordinary text (4), and the literal string `NULL` (5). Verify SQL NULL is distinguishable from text according to documented display behavior.                       |
| Unicode       | Accents, Asian scripts, Arabic, Greek, and emoji display and copy without replacement characters or corruption.                                                                                                                                 |
| Large values  | Id 3 has 12,005 UTF-16 units and ends in `[END]`. Id 1 has length 0; Id 5 has SQL NULL. A shortened cell preview is acceptable, but full-value viewing, copying, and export preserve the complete value unless an explicit limit is configured. |
| Sorting       | Sort `Id` ascending and descending: 1 through 5 and 5 through 1. Sort `ExactDecimal` ascending: Ids 4, 1, 5, 2, 3. Sort `Label` both ways; behavior is consistent and duplicate labels do not lose or duplicate rows.                           |
| Selection     | Select a cell, a rectangular range, an entire row, and all rows using supported mouse and keyboard actions. Selection stays aligned with visible values after sorting.                                                                          |
| Copying       | Copy cells and ranges, with and without headers where supported. Verify Unicode, full large text, exact numbers, quotes, tabs, line breaks, and leading/trailing spaces. No unselected cells appear.                                            |
| Export        | Export to each supported format, such as CSV, JSON, and Excel. Verify five records, correct columns, exact values, Unicode, and complete large text. Verify displayed versus original sort order according to the feature's contract.           |

Inspect CSV using a text editor or CSV parser, not only Excel, which can round
large numbers. Embedded newlines must remain inside one parsed record. CSV has
no universal NULL representation, so check the extension's convention. For JSON,
distinguish `null` from `""` and `"NULL"` and avoid readers that round large numbers.
No database cleanup is required.

## Automation

Reuse the existing Playwright infrastructure, adding a real
**wizard -> container -> SQL connection -> feature operation** path.

Relevant starting points in this test folder:

- `unit/azureSqlContainerForm.test.ts`: form validation, command construction,
  credential environment forwarding, connection retries, and cancellation.
- `unit/containerEnginePrerequisites.test.ts`: engine detection and prerequisite logic.
- `e2e/connection.spec.ts`: connection and disconnection.
- `e2e/queryExecution.spec.ts`: basic database/table creation and query results.
- `e2e/executionPlan.spec.ts`: execution-plan interactions.

The existing query smoke tests use a fixed `TestDB` and SQL Server-style cleanup.
Make them isolated and capability-aware before reusing them against this image.

Give deployment tests appropriate per-test timeouts. The current Playwright default
is five minutes, while the implementation allows ten minutes for image pull alone.
Account for creation, readiness, and connection stages separately rather than treating
five minutes as an overall deployment deadline.
