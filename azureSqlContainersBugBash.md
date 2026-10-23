# Azure SQL Containers in MSSQL - Bug Bash Guide

## Reporting Bugs

- **Existing bugs:** [Azure SQL Containers issues](https://github.com/microsoft/vscode-mssql/issues?q=is%3Aissue%20label%3A%22Area%20-%20Azure%20SQL%20Containers%22)
- **File a bug:** [Create an issue](https://github.com/microsoft/vscode-mssql/issues/new?template=1-mssql-bug-report.yml)

When filing a bug, apply the **Area - Azure SQL Containers** label.

## Prerequisites

### Visual Studio Code

Install [Visual Studio Code](https://code.visualstudio.com/download).
You will install the MSSQL extension from a bug bash VSIX during setup.

### Container Engine

Install and start one of the following container engines before beginning:

- [Docker](https://docs.docker.com/get-started/get-docker/)
- [Podman](https://podman.io/docs/installation)
- [containerd](https://containerd.io/docs/getting-started/)
- [Apple Containers](https://github.com/apple/container#initial-install)
- [WSL Containers](https://learn.microsoft.com/windows/wsl/tutorials/wsl-containers)

> **Docker on Windows:** Ensure Docker is running Linux containers with the WSL backend.

### Container Registry Access

The container is in private preview, so registry authentication is required.
Use the setup path that matches your access:

- **SQL Linux entitlement:** Use the daily-build VSIX and sign in with your authorized Azure account.
  Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) for this path.
- **Private-preview reader access:** Use the regular VSIX and obtain the registry-reader password
  through the approved private-preview access channel.

Do not include passwords, tokens, or other credentials in this guide or in bug reports.

## Setup

### 1. Download the Appropriate VSIX

| Access                 | VSIX to use                     |
| ---------------------- | ------------------------------- |
| SQL Linux entitlement  | **TODO: Add daily VSIX link**   |
| Private-preview reader | **TODO: Add regular VSIX link** |

### 2. Authenticate to the Container Registry

Run the commands on the machine where you will provision the container.
The examples below use Docker. For another engine, use its registry-login command
and authenticate the engine you will select in the MSSQL provisioning wizard.

#### Daily Build: SQL Linux Entitlement

Sign in with the Azure account that has access to the build registry:

```bash
az login
az acr login --name sqlbuilds
```

#### Regular Build: Private-Preview Reader

Run the following command and enter the registry-reader password when prompted:

```bash
docker login -u private-preview-reader -p B416TEfMwMpK1pGMtOEWELivqSKBKCpKYgn8kG0rZm3MhinxUGBGJQQJ99CIACMsfrFEqg7NAAABAZCRY33V sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io
```

Confirm that registry sign-in succeeds before continuing.

### 3. Install the MSSQL Extension

1. Open Visual Studio Code.
2. Open the **Extensions** view.
3. Select the **...** menu, then **Install from VSIX...**.
4. Choose the VSIX downloaded in step 1.
5. Reload VS Code if prompted.

## Test Scenarios

### How to Use This Guide

Use your own schema, data, and supported entry points.

### Scenario 1: Provision an Azure SQL Database Container

**Goal:** Provision and connect to a local Azure SQL container.

**Examples to try:**

- Choose **Azure SQL Database** > **Local container (Preview)** using mouse and keyboard.
- Provision with defaults, then customize the container/profile name, port, and group.
- Try invalid passwords, invalid/occupied ports, and duplicate container names; correct and retry.
- Try a stopped engine or missing registry authentication; resolve and retry.
- Cancel provisioning, inspect remaining resources, and retry.

**Expected:** Guidance is actionable; progress tracks image pull, creation, readiness,
and connection. The container accepts queries and appears in Object Explorer.
Failures/cancellation show accurate state without hanging or exposing passwords.

![Demo](https://github.com/user-attachments/assets/4addb31c-b80c-4218-be97-287d7f6f3ab0)

### Scenario 2: Query a Database (SQL-04)

**Goal:** Verify everyday SQL development.

**Examples to try:**

- Create a table, add a column, and insert, query, update, and delete rows.
- Query related tables using joins, filters, grouping, and aggregates.
- Commit and roll back separate changes; verify persisted values.
- Run selected SQL, multiple `GO` batches, multiple result sets, and empty results.
- Generate a message and SQL error, then run a valid query.

**Expected:** Data, transaction outcomes, results, row counts, empty-result columns,
messages, and errors are correct. Queries recover after errors. Finish or roll back
open transactions.

### Scenario 3: Verify Connection Identity and Capabilities

**Goal:** Verify Azure SQL container identity and capability detection.

**Examples to try:**

- Check server, database, profile, and icon using `localhost` and a supported loopback IP.
- Query `DB_NAME()`, `SERVERPROPERTY('EngineEdition')`, `SERVERPROPERTY('Edition')`,
  and `@@VERSION`.
- Compare menus with image capabilities; try an unsupported operation.

**Expected:** Context and metadata match the image; unsupported operations are explicit.
Record icon/capability mismatches. Distinguish permission errors from unsupported features.

### Scenario 4: Explore Database Objects

**Goal:** Verify Object Explorer navigation and refresh.

**Examples to try:**

- Expand tables, views, columns, keys, and other supported objects.
- Create/rename a test object and refresh its folder.
- Apply/clear filters, collapse/reopen folders, and reconnect.
- Verify actions target the correct connection when several are open.

**Expected:** Objects stay accurate after refresh, filters clear, and navigation
works after reconnecting.

### Scenario 5: Find and Script Objects

**Goal:** Find objects and verify generated SQL.

**Examples to try:**

- Search tables, views, and procedures by full/partial name, including similar
  names and identical names in different schemas.
- Generate SELECT/CREATE scripts; check schema qualification and database context.
- Run a read-only script or adapt CREATE to use a new test-object name.

**Expected:** Search finds the intended object; scripts work against the correct database.

### Scenario 6: Cancel Work and Recover

**Goal:** Recover cleanly from query cancellation and timeout.

**Examples to try:**

- Cancel a safe query that returns a marker, runs `WAITFOR DELAY '00:02:00'`,
  then returns another marker.
- Immediately run a query with a new marker without reconnecting.
- Test automatic query timeout separately; restore the timeout setting afterward.

**Expected:** Cancellation/timeout is accurate, remaining batch work stops, and the
next query shows only its own results. Check database context and open transactions.

### Scenario 7: Use IntelliSense and Editor Tools

**Goal:** Verify schema-aware editor assistance.

**Examples to try:**

- Complete table, column, and schema names.
- Add/rename a column, refresh IntelliSense, and check suggestions.
- Introduce/fix a syntax error, inspect diagnostics, and format SQL.
- Switch database connections and compare suggestions and results.

**Expected:** Suggestions and diagnostics match the current schema/database;
formatting preserves meaning and switching leaves no stale context.

### Scenario 8: Inspect, Copy, and Export Results

**Goal:** Verify grid display, selection, copying, and export.

**Examples to try:**

- Query mixed types, NULLs, empty strings, literal `NULL`, Unicode/emoji, quotes,
  commas, tabs, and line breaks.
- Include precise decimals and long text with a recognizable ending.
- Scroll, sort, resize, and select cells/ranges/rows/all using mouse and keyboard.
- Copy with/without headers and inspect CSV, JSON, or Excel exports where supported.
- Repeat across supported grid modes; record modes, value-length limits, and formats.

**Expected:** Values retain precision; rows stay aligned without loss/duplication.
Viewing, copying, and export honor configured limits without unexplained truncation.
Check CSV in a text editor/parser and spreadsheet: no rounding or extra newline records.

### Scenario 9: View and Edit Table Data

**Goal:** Verify changes through View & Edit Data.

**Examples to try:**

- Insert, update, delete, and save rows in **View & Edit Data**; verify with SQL.
- Discard an edit and reopen the table.
- Try invalid values, duplicate keys, constraint violations, and read-only/computed columns.
- Change a row externally, then save an older edit to test conflicts.

**Expected:** Saved edits persist; discarded edits do not. Validation/concurrency
errors are actionable, with no false success.

_Screenshot: Table context menu with View & Edit Data; optionally, an unsaved sample
edit with save/discard controls._

### Scenario 10: Create and Alter a Table Visually

**Goal:** Create and alter tables through Table Designer.

**Examples to try:**

- Create required/nullable columns, a primary key, and defaults.
- Alter the table; add an index and relationship where supported.
- Review changes, save/publish, refresh, and reopen to verify the schema.

**Expected:** Valid changes persist; validation errors preserve the design.
Retest known failures and capture full messages for unsupported database/log-file elements.

### Scenario 11: Visualize and Change a Schema

**Goal:** Inspect and publish schema changes through Schema Designer.

**Examples to try:**

- Load related tables; inspect keys/relationships and arrange the diagram.
- Add a supported column or relationship.
- Preview/validate, publish, reload, and verify the schema independently.

**Expected:** The diagram is accurate and changes persist after reload.
Retest the historical validation failure; errors must be clear without endless loading.

### Scenario 12: Compare and Synchronize Schemas

**Goal:** Compare schemas and deploy selected differences.

**Examples to try:**

- Compare test databases or a database and project/DACPAC with an added column,
  changed definition, and one-sided object.
- Exclude one difference, deploy selected changes, refresh, and compare again.

**Expected:** Source/target are clear; only selected changes reach the target.
Recomparison reflects the deployed schema.

### Scenario 13: Develop with SQL Database Projects

**Goal:** Import, build, and publish a SQL database project.

**Examples to try:**

- Import/extract the test schema into a project and check its target platform.
- Build, add/modify an object, and rebuild.
- Publish to a disposable container database; verify objects and behavior.

**Expected:** The image's Azure SQL target is supported, diagnostics are actionable,
and the deployed schema matches the project.

### Scenario 14: Move Schema and Data with DACPAC/BACPAC

**Goal:** Verify DACPAC/BACPAC workflows.

**Examples to try:**

- Extract/publish a DACPAC to a test database; compare schemas.
- Export/import a BACPAC where supported; compare schemas, row counts, and sample values.
- Try an invalid package or inaccessible destination.

**Expected:** Schema/data and progress are accurate; unsupported operations and
file/path failures show explicit errors.

### Scenario 16: Observe Activity with Query Profiler

**Goal:** Capture query activity and stop profiling cleanly.

**Examples to try:**

- Start Query Profiler on the test connection.
- Run queries in another editor with `-- AzureSqlBugBashProfiler`; find their activity.
- Inspect details/filters, stop, and start a new session.

**Expected:** Activity matches the connection, the UI stays responsive, and stopping
releases the capture session.

### Scenario 17: Import a Flat File

**Goal:** Import CSV data accurately.

**Examples to try:**

- Import quoted commas, empty fields, Unicode, numbers, and dates into a test table.
- Review inferred types, adjust supported mappings, and query results.
- Try malformed input, incompatible values, and duplicate destination names.

**Optional sample file:**

```csv
Id,ItemName,Quantity,Notes
1,Notebook,5,"Blue, ruled"
2,Pencil,12,""
```

**Expected:** Types, row counts, and values match the file/options; invalid input
produces guidance without silent data loss.

### Scenario 18: Manage Disposable Databases

**Goal:** Verify database create, rename, and drop feedback.

**Examples to try:**

- Create a uniquely named database through the UI, refresh, and connect directly.
- Rename an unused test database where supported; reconnect with its new name.
- Drop only a bug bash database; refresh and verify removal.

**Expected:** Feedback matches database state; unsupported operations are clear.
Retest errors previously shown after successful operations and record exact messages.

### Scenario 19: Check Backup and Restore Availability

**Goal:** Verify recovery support and unsupported-operation feedback.

**Examples to try:**

- Open Backup and Restore using `localhost` and a supported loopback IP.
- Inspect unsupported-operation guidance; close/reopen the UI.
- Complete supported workflows with disposable data and verify results.
  Distinguish host paths from container paths.

**Expected:** Unsupported Restore reports Azure SQL Database unavailability without
hanging, even for local hostnames. Supported workflows complete correctly.
Record Backup and Restore separately. See the
[Restore regression reference](https://github.com/microsoft/vscode-mssql/issues/23042).

### Scenario 20: Expose Sample Data with Data API Builder

**Goal:** Verify API access to container data.

**Prerequisite:** Required Data API builder tools/runtime.

**Examples to try:**

- Configure a sample table, review mappings/permissions, and deploy.
- Read through REST or GraphQL; test permitted create/update/delete operations.
- Verify changes with SQL, try a disallowed operation, and check engine networking.

**Expected:** Configuration targets the correct database; API and SQL results agree.
Permission/network errors are clear. Never expose an unauthenticated API publicly.

### Scenario 21: Work in a SQL Notebook

**Goal:** Verify notebook execution and reconnection.

**Prerequisite:** A compatible SQL notebook extension/kernel; record its version.

**Examples to try:**

- Run cells with varied queries/results and an intentional error.
- Rerun a cell and check output replacement/retention.
- Restart the container through its engine, reconnect, and rerun.

**Expected:** Cells target the correct database and show their own results/errors.
Reconnection restores execution without presenting stale output as new.

### Scenario 22: Develop with Copilot

**Goal:** Verify Copilot uses the connected database context.

**Prerequisite:** Copilot access and any required sign-in.

**Examples to try:**

- Request a schema-specific query, query explanation, or help with an intentional error.
- Request a related-table design or Data API builder configuration; review objects,
  relationships, mappings, and permissions.
- Switch databases and check context. Review generated SQL before running on test data.

**Expected:** SQL/configuration fits the image and selected schema/database.
Report incorrect assumptions without sensitive prompts, data, or credentials.

### Scenario 23: Reconnect and Recover Across Container Sessions

**Goal:** Verify saved connections and recovery across sessions.

**Examples to try:**

- Disconnect/reconnect, reload VS Code, and reopen the saved connection.
- Stop/start through the engine and reconnect; check any extension lifecycle
  controls target the correct container/engine.
- Check the container icon/name and saved engine. Use extension start/stop/delete
  controls for each engine; verify same-named containers in other engines are untouched.
- Add a second container with a different port/profile; check query and Explorer targets.
- For Podman and WSL Containers, reconnect without changing engine networking settings.
  Reuse a Docker container's name/port and verify queries still reach the selected engine.
- Connect while stopped, resolve, and retry. Test saved/prompted passwords where offered.

**Expected:** Profiles remain correct and recover without recreation; failures are
actionable. Stop/start preserves data according to storage configuration.
Deleting/recreating a container does not guarantee persistence.

Podman and WSL connections use an extension-managed loopback relay through the selected
engine. Saved names/ports stay unchanged; a generated relay connection string works only
while that VS Code extension host is running. Other clients can use the engine's published
port when their host forwarding works.
