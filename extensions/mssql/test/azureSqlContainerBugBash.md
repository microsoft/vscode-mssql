# Azure SQL Database Container Bug Bash

## Goal and pass criteria

Exercise the MSSQL extension's complete **provision -> connect -> use features** journey
against a local Azure SQL Database container.

**Compatibility target: Azure SQL Database, not SQL Server.** For features supported by
both the container image and Azure SQL Database, expect the same database-scoped behavior,
generated T-SQL, validation, and feature availability as a cloud Azure SQL Database.
Detection must work with `localhost` and IP addresses, not depend on a
`.database.windows.net` hostname.

The container runs the Azure SQL Database engine locally; it is not a complete Azure
service emulator. Do not expect Azure resource provisioning, firewall management,
service tiers, managed backups, or cloud identity setup to work locally. Local endpoint,
container management, and SQL Login setup intentionally differ from the cloud.

A passing check verifies the actual database result, not just an open dialog or a
success notification. Record image limitations and extension defects separately.
An engine limitation does not excuse an endless spinner, exposed credentials, an
incorrect success message, or an unexplained extension error.

## Prepare

1. Install the MSSQL VSIX selected for the bug bash. Record the extension version/build,
   VS Code version, OS/architecture, container engine/version, and test date.
2. Enable the container preview in VS Code user settings, then reopen any deployment view:

    ```json
    {
        "mssql.preview.azureSqlContainers": true
    }
    ```

    This explicit setting is required; enabling experimental features alone does not
    enable the Azure SQL container wizard.

3. Install and start the container engine you will test. Spread coverage across Docker,
   Podman, containerd/nerdctl, WSL containers on Windows, and Apple container where
   offered and supported by the host and preview image. Record architecture/emulation
   constraints from the current preview instructions; do not assume native ARM support.
4. Obtain private-preview registry credentials from the
   [preview signup](https://aka.ms/sqldbcontainerpreview-signup). Authenticate the
   **same engine, runtime context, and OS user** that the extension will use.
   For Docker, run this in a terminal and enter the registry password at the prompt:

    ```text
    docker login sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io --username YOUR_PREVIEW_USERNAME
    ```

    Use the corresponding login command for other engines. Registry credentials only
    authorize image pulls; they are not database credentials. Never paste them into
    screenshots, issues, SQL scripts, or connection profiles.

5. Use an available host port and a unique container name. Reserve an owned prefix such
   as `azsql-bugbash-YOUR_INITIALS`. Do not reuse another tester's container or database.
6. If available, prepare a disposable **cloud Azure SQL Database** as a comparison target
   and an ordinary **SQL Server** connection for feature-gating regression checks.
   Lack of a cloud comparison is recorded as not compared, not as confirmed parity.

Reference the current [setup guide](https://microsoft.github.io/azure-sql-database-container/getting-started.html)
and [known limitations](https://microsoft.github.io/azure-sql-database-container/known-limitations.html).
Record the image tag and digest used; preview behavior can change between images.

## Provision through the extension

Do not pre-create the container from the command line for this scenario. A CLI-created
container tests feature compatibility, but bypasses the provisioning experience.

| Step | Action                                                                                                                                         | Expected behavior                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | Open the SQL Server sidebar and select **New Deployment**, then **Azure SQL Database** and **Local container (Preview)**.                      | The Azure SQL container wizard opens, not the cloud resource wizard or SQL Server container wizard. No Azure subscription sign-in is required.                                                                                                                                                                            |
| P-02 | Read the introduction and select **Next**.                                                                                                     | The engine detection/prerequisites page loads and provides usable installation/help links.                                                                                                                                                                                                                                |
| P-03 | Select an installed engine and wait for its checks.                                                                                            | The selected engine is detected, running, and configured correctly before proceeding. With multiple engines, the selected one is actually used.                                                                                                                                                                           |
| P-04 | Continue to configuration.                                                                                                                     | User name is read-only `sa`; this wizard currently uses SQL Login. A container name and available host port are generated.                                                                                                                                                                                                |
| P-05 | Enter a new database password, optional **Profile Name**, and **Connection Group**. Inspect **Save Password**.                                 | Password is masked and requires 8-128 characters from at least three categories: uppercase, lowercase, digits, symbols. Saving is opt-in. The selected profile/group is retained.                                                                                                                                         |
| P-06 | Inspect advanced options. Keep or edit **Container Name**, **Port**, and optional **Hostname**.                                                | Defaults do not overwrite edits. Names/hostname are validated. The port is valid and unused. Hostname is the container hostname, not a cloud DNS name or a replacement for the host connection endpoint.                                                                                                                  |
| P-07 | Accept **Terms & Conditions** and continue.                                                                                                    | Invalid configuration is blocked with actionable validation. Valid configuration starts provisioning once, even after repeated clicks.                                                                                                                                                                                    |
| P-08 | Observe **Pulling container image**, **Creating container**, **Setting up container**, and **Connecting to container**, plus Background Tasks. | Progress reflects real work; success is not reported before connection succeeds. A first pull can be slow: the implementation allows up to 10 minutes for pull and 5 minutes for readiness. Capture the failing stage rather than applying an arbitrary short timeout.                                                    |
| P-09 | After success, inspect connection details and finish the wizard.                                                                               | Exactly one intended container is running. A usable profile appears in the selected group, named from Profile Name or the container name if blank. It connects as `sa` to `localhost,<chosen-port>` with the local certificate trusted. Connection information reflects the chosen port and does not expose the password. |
| P-10 | Open a new query on the created connection and execute the metadata query below.                                                               | The query succeeds and reports Azure SQL Database engine edition `5`, rather than SQL Server Developer edition. Record the initial database, version, and edition.                                                                                                                                                        |

```sql
SELECT
    DB_NAME() AS database_name,
    SERVERPROPERTY('EngineEdition') AS engine_edition,
    SERVERPROPERTY('Edition') AS edition,
    SERVERPROPERTY('ProductVersion') AS product_version,
    @@VERSION AS full_version;
```

For Docker, record the actual image digest without collecting the container's environment:

```text
docker ps --filter name=YOUR_CONTAINER_NAME
docker inspect --format "{{.Image}}" YOUR_CONTAINER_NAME
docker image inspect --format "{{json .RepoDigests}}" sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest
```

Do not attach full `docker inspect` output: it includes environment variables and may
contain the database password.

### Negative and recovery scenarios

Run these only against resources you own. Change one condition at a time and restore it
before proceeding.

| ID   | Action                                                                                                                                              | Expected behavior                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-11 | Open the wizard with no engine installed, or stop the selected engine before its prerequisite check. Restore it and retry.                          | The problem is explained with install/start guidance. Next is blocked until prerequisites pass; retry recovers without restarting VS Code.                                                                                                                     |
| P-12 | Use an invalid/weak password, omit license acceptance, enter an invalid name/hostname, or use an occupied/out-of-range port.                        | Invalid input is rejected without creating a container. Port/name conflicts are actionable and unrelated containers are untouched.                                                                                                                             |
| P-13 | Test an unavailable registry login in a separate engine context, or interrupt network access during an uncached pull. Restore access and retry.     | Pull failure identifies registry/authentication or network recovery as appropriate. The failed step is visible, errors are sanitized, and retry can complete. Do not log out a shared engine context used by others.                                           |
| P-14 | Fail a provisioning stage, inspect details, retry, or go back and correct configuration.                                                            | Errors remain readable/copyable without secrets. Retry uses the corrected configuration and does not silently provision duplicates or report a failed deployment as successful.                                                                                |
| P-15 | Cancel during pull, startup, or connection; repeat with the provisioning tab closed. Inspect Background Tasks and engine resources afterward.       | Cancellation is responsive and correctly reflected. Closing the tab must not leave unobservable work or a permanently loading task. Record any continuing background work or remaining resources; cancellation is not a promise to delete a created container. |
| P-16 | Provision using a nondefault port, blank profile name, and both Save Password settings in separate runs. Disconnect, reload VS Code, and reconnect. | The correct port/name/group persists. Saved credentials are handled securely; an unsaved password is requested again when needed. No other profile is overwritten.                                                                                             |
| P-17 | Stop and restart only the test container while connected. Reconnect and run a query.                                                                | Connection failure is visible and bounded. After restart, reconnect succeeds and a new query returns fresh results. Data remains after stop/start of the same container; removal/recreation without a volume is not a persistence guarantee.                   |

## Create a disposable feature-test database

Use `master` only for database provisioning and cleanup. The preview has different
master/provisioning and user-database session behavior. Running every test on `master`
can conceal Azure SQL incompatibilities.

1. On the initial connection, create a database you own. This example name must be
   unique within your container; replace it consistently if it already exists:

    ```sql
    CREATE DATABASE [AzSqlContainerBugBash];
    ```

2. Create/select a connection whose **Database name** is `AzSqlContainerBugBash`,
   using the same endpoint, SQL Login, and trusted local certificate. Open a **new**
   query on that connection. Do not use `USE` to change databases.
3. Rerun the metadata query. Confirm `database_name = AzSqlContainerBugBash` and
   `engine_edition = 5` before testing features.
4. Seed this fixture once in that fresh database:

    ```sql
    CREATE TABLE dbo.BugBashCustomer
    (
        CustomerId int NOT NULL PRIMARY KEY,
        DisplayName nvarchar(100) NOT NULL,
        Notes nvarchar(max) NULL
    );
    CREATE TABLE dbo.BugBashOrder
    (
        OrderId int NOT NULL PRIMARY KEY,
        CustomerId int NOT NULL,
        Amount decimal(12, 2) NOT NULL CHECK (Amount >= 0),
        CONSTRAINT FK_BugBashOrder_Customer FOREIGN KEY (CustomerId)
            REFERENCES dbo.BugBashCustomer(CustomerId)
    );
    INSERT dbo.BugBashCustomer VALUES
        (1, N'Ada', N'He said "hello", next' + NCHAR(10) + N'line two'),
        (2, N'caf' + NCHAR(233) + N' ' + NCHAR(26085) + NCHAR(26412), NULL),
        (3, N'  Leading spaces', REPLICATE(CAST(N'x' AS nvarchar(max)), 12000));
    INSERT dbo.BugBashOrder VALUES (1, 1, 12.50), (2, 1, 7.25), (3, 2, 0.00);
    GO
    CREATE VIEW dbo.BugBashOrderSummary AS
        SELECT CustomerId, COUNT(*) AS OrderCount, SUM(Amount) AS TotalAmount
        FROM dbo.BugBashOrder
        GROUP BY CustomerId;
    GO
    CREATE PROCEDURE dbo.BugBashGetCustomers AS
        SELECT CustomerId, DisplayName, Notes
        FROM dbo.BugBashCustomer
        ORDER BY CustomerId;
    GO
    SELECT * FROM dbo.BugBashOrderSummary ORDER BY CustomerId;
    EXEC dbo.BugBashGetCustomers;
    ```

Expected baseline: two tables with three rows each, one foreign key, one view, and one
procedure. The summary returns customer `1` with count `2` and total `19.75`, and
customer `2` with count `1` and total `0.00`. The procedure returns three customers,
including Unicode, NULL, embedded newline/quotes, leading spaces, and a 12,000-character value.
Use separate disposable copies for destructive cases; reset the fixture before comparing
results across features or engines.

## Feature compatibility checklist

All rows are **Not run** until executed and recorded. Where cloud comparison is available,
use the same fixture and database-scoped operation, with comparable permissions and settings.
Expected behavior below is the acceptance target, not a claim that every preview feature
already passes.

| ID   | Feature and actions                                                                                                                                                                                                       | Expected behavior                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 | **Engine detection and feature gates:** compare available commands on the container, cloud Azure SQL Database, and SQL Server. Repeat with `localhost` and an IP endpoint.                                                | Azure SQL-compatible features are available regardless of hostname. SQL Server-only actions are hidden/disabled or explain their unavailability promptly. Cloud management actions do not attempt to manage a local endpoint as an Azure resource.                                                                                                                       |
| F-02 | **Connections/groups:** add, edit, rename, move, disconnect, and reconnect profiles; use two containers on different ports.                                                                                               | Operations affect the selected connection only. Duplicate display names do not mix identities, passwords, databases, or query targets. Incorrect credentials produce a useful error.                                                                                                                                                                                     |
| F-03 | **Object Explorer, filtering, search, scripting:** expand and refresh the fixture database; find a table/view/procedure, apply filters, and script create/select operations.                                              | The correct objects/schema appear, updates are reflected, and scripts target the selected user database with Azure SQL-compatible syntax.                                                                                                                                                                                                                                |
| F-04 | **Query execution:** run the fixture queries, multiple result sets, PRINT, a deliberate SQL error, a commit/rollback, and an empty result.                                                                                | Exact values and all result sets/messages are represented. Errors retain useful SQL details; rollback leaves data unchanged. A subsequent valid query succeeds without stale results.                                                                                                                                                                                    |
| F-05 | **Cancellation and timeout:** execute `SELECT 1; WAITFOR DELAY '00:02:00'; SELECT 2;`, cancel after the first result, then run `SELECT 42;`. Separately test the configured query timeout.                                | Cancellation/timeout is reported and bounded; the follow-up query returns `42`. Late results/cancellation do not overwrite the next execution. Test timeout separately from manual cancellation.                                                                                                                                                                         |
| F-06 | **IntelliSense/editor tools:** complete names from the fixture, create a new column/table and refresh metadata, inspect diagnostics, format SQL, and switch database connections.                                         | Suggestions/diagnostics match the active database and Azure SQL dialect. Supported SQL is not rejected merely because the endpoint is local or reports a 12.x Azure engine version.                                                                                                                                                                                      |
| F-07 | **Results grids, classic and preview:** query the fixture; sort/filter, select/copy, open full values, export CSV/JSON/Excel/INSERT, and switch editors. Include a large rowset; record fetch/export value-length limits. | Values, NULL versus empty text, Unicode, decimal precision, whitespace, multiline text, and long values survive within the configured limits without additional loss. Export/copy uses the selected/visible data as specified. Display truncation does not silently truncate full-value operations. Virtualization and editor-state restoration work without stale data. |
| F-08 | **View & Edit Data / Table Explorer:** insert/update/delete fixture rows, cancel an edit, violate the foreign key/check constraint, and refresh.                                                                          | Committed changes are verified by a separate SELECT. Canceled/invalid edits do not persist, errors are actionable, and paging/filtering does not edit the wrong source row.                                                                                                                                                                                              |
| F-09 | **Table Designer:** create a separate table; add/change columns, a key, index, default, and constraint; preview and publish changes; reopen.                                                                              | Generated changes are valid for Azure SQL Database, publication changes the actual schema, and reopening shows persisted definitions. No SQL Server database-file/filegroup validation artifacts appear. Canceling leaves the schema unchanged.                                                                                                                          |
| F-10 | **Schema Designer:** load related tables, navigate relationships, add a table/column/relationship, preview changes, publish, and reload.                                                                                  | The diagram matches catalog metadata; Azure SQL-compatible changes publish and persist. Unsupported edits are explained before misleading success.                                                                                                                                                                                                                       |
| F-11 | **Schema Compare:** compare two owned databases or a database and DACPAC with one controlled difference; deploy selected differences and compare again.                                                                   | Only selected changes are applied using Azure SQL-compatible deployment options. The second comparison confirms convergence, without overwriting excluded objects/data.                                                                                                                                                                                                  |
| F-12 | **SQL Database Projects, Publish, Code Analysis:** extract/import a fixture schema, target Azure SQL Database, build/analyze, publish to a new test database, then publish an incremental change.                         | The Azure SQL target platform is retained; diagnostics are relevant; supported builds/deployments succeed and match catalog metadata. The local hostname does not change the target to SQL Server.                                                                                                                                                                       |
| F-13 | **DACPAC/BACPAC:** extract/deploy a DACPAC and export/import a BACPAC into disposable databases.                                                                                                                          | Supported operations preserve schema and, for BACPAC, the expected data. File paths and errors are usable. Unsupported image/tooling combinations report an explicit limitation, not endless loading.                                                                                                                                                                    |
| F-14 | **Flat File Import:** import a small owned CSV containing Unicode, quoted delimiters, empty fields, and a malformed value; inspect type preview and final table.                                                          | Preview and inferred/selected types are correct; successful imports match expected counts/values. Invalid input is explained without reporting incomplete data as a successful full import.                                                                                                                                                                              |
| F-15 | **Execution plans and live statistics where offered:** generate estimated/actual plans from a real fixture query; inspect properties, warnings, XML, and comparison.                                                      | Plans describe the executed query and objects, supported interactions work, and failures are surfaced. Opening a saved plan alone does not satisfy this case. Live statistics follows Azure SQL/image capability rather than SQL Server major-version assumptions.                                                                                                       |
| F-16 | **Query Profiler:** start an Azure SQL-compatible, database-scoped session; execute `SELECT 'AZSQL_BUGBASH_PROFILER' AS marker;`, locate the event, inspect details, then stop.                                           | The intended database/query is captured with usable details. Unsupported templates are gated/explained; stopping ends the session without leaving a collecting session behind.                                                                                                                                                                                           |
| F-17 | **Create/rename/drop database:** perform supported operations on a spare database you own, using a master/provisioning connection where required; refresh Object Explorer.                                                | Supported operations really change the database and update the UI without a post-success error. Unsupported operations fail clearly. User-database application workflows do not rely on cross-database `USE`.                                                                                                                                                            |
| F-18 | **Backup/restore:** try to access backup/restore on the container using both localhost and an IP; compare with cloud Azure SQL Database and SQL Server.                                                                   | Native SQL Server backup/restore is unavailable for Azure SQL Database, including the container. Show a prompt explanation or gate the action; never leave a loading dialog. Ordinary SQL Server backup/restore remains available. Azure managed backup/PITR is not emulated locally.                                                                                    |
| F-19 | **SQL notebooks:** select the user-database connection, execute multiple cells including an error, render results, save/reopen, and rerun.                                                                                | Cells target the chosen database, preserve execution ordering/results, and recover after errors. No accidental fallback to master or another connection occurs.                                                                                                                                                                                                          |
| F-20 | **Data API builder:** for a SQL Login connection, configure selected fixture entities and test a supported local REST/GraphQL read and write.                                                                             | Configuration targets the local port/user database and supported requests return/persist expected data. Credentials are protected. Container networking must resolve the host endpoint; cloud deployment is a separate scenario.                                                                                                                                         |
| F-21 | **Copilot integrations, if licensed/enabled:** ask about the fixture schema, generate a read-only query, and exercise supported designer assistance. Review SQL before running.                                           | Context refers to the selected user database, generated SQL is Azure SQL-compatible, and supported operations work. Judge correctness rather than exact AI wording; do not send passwords or confidential data in prompts.                                                                                                                                               |
| F-22 | **Azure SQL semantics:** from a direct user-database connection attempt `USE [master];`, and compare supported/unsupported syntax with cloud Azure SQL Database.                                                          | Cross-database `USE` is rejected in the Azure-faithful user session. Record any image-specific differences. Do not interpret master/provisioning-session permissiveness as evidence of cloud compatibility.                                                                                                                                                              |
| F-23 | **Accessibility, themes, and errors:** navigate provisioning and key feature dialogs by keyboard; test light/dark/high-contrast themes, zoom, and error details.                                                          | Controls have labels/focus, progress and errors are perceivable, and dialogs remain usable. Passwords/registry credentials are absent from ordinary logs, copied errors, notifications, and screenshots.                                                                                                                                                                 |

For schema-changing features, verify the result independently:

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE N'BugBash%'
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;

SELECT name, OBJECT_NAME(parent_object_id) AS parent_table
FROM sys.foreign_keys
WHERE name LIKE N'%BugBash%';

SELECT * FROM dbo.BugBashOrderSummary ORDER BY CustomerId;
```

### Parity boundaries and triage

- **Match Azure SQL:** database-scoped SQL, designer/deployment target, object metadata,
  query/results behavior, supported tools, and unsupported SQL Server feature gating.
- **Do not require local emulation:** Azure portal/ARM operations, resource groups,
  firewall rules, elastic pools, service tiers, billing, auto-pause, managed backup/PITR,
  or cloud availability/network isolation.
- **Authentication:** this provisioning wizard currently configures `sa` SQL Login only.
  Do not report missing Entra choices here as a regression in an implemented flow.
  Separately configured container Entra support is outside this baseline.
- **Preview gaps:** check current image limitations for PaaS restriction enforcement,
  defaults, GUI compatibility, and advanced engine capabilities. Do not assume vector
  support from SQL Server major-version comparisons; Azure SQL versioning differs.
- **Classify evidence:** if equivalent SQL succeeds directly against the container but
  fails through the feature, investigate the extension/tooling. If it fails in the
  container but succeeds in cloud Azure SQL, record an engine/image parity gap. Keep
  the UI/error-handling defect separate when both are present.

## Record results and file bugs

Use **Not run**, **Pass**, **Fail**, or **Blocked** for every assigned ID. No results are
pre-populated. A known limitation is linked and recorded as blocked/failed as appropriate,
not silently counted as a pass.

| Test ID | Status  | Build / image digest / host and engine | Observed behavior and SQL evidence | Cloud/SQL Server comparison | Issue / sanitized attachments |
| ------- | ------- | -------------------------------------- | ---------------------------------- | --------------------------- | ----------------------------- |
| P-01    | Not run |                                        |                                    |                             |                               |
| F-01    | Not run |                                        |                                    |                             |                               |

Copy rows for all assigned cases. For each failure, include the case ID, minimal repro,
expected versus actual behavior, user database versus master, endpoint shape
(localhost/IP; redact sensitive names), duration/failing stage, and sanitized
screenshots/logs. Record relevant grid mode, settings, permissions, and fixture changes.
Do not include passwords, registry tokens, credential-bearing connection strings, or
full container-inspection output. Do not claim cloud parity without a comparison run.

## Cleanup

1. Stop Profiler sessions and any local Data API builder deployment created for testing.
2. Disconnect feature-test queries and close editors using the test database. If keeping
   the container, connect separately to master and drop only databases you created for
   this bug bash. Remove owned connection profiles/groups if no longer needed.
3. Remove only your recorded disposable container. For Docker, first verify the name:

    ```text
    docker ps -a --filter name=YOUR_CONTAINER_NAME
    docker rm -f YOUR_CONTAINER_NAME
    ```

    Use the equivalent command for the selected engine. Never bulk-delete containers,
    volumes, or shared registry credentials. Deleting this container deletes its unmounted
    local data; retain evidence or export needed fixtures first.

4. Remove only owned fixture/export files and any cloud comparison resources created
   specifically for this session.
