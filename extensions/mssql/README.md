[![Roadmap 2026](https://img.shields.io/badge/Roadmap%202026-green?logo=github)](https://aka.ms/vscode-mssql-roadmap#2026)
[![Report Bug](https://img.shields.io/badge/Report%20Bug-red?logo=github)](https://aka.ms/vscode-mssql-bug)
[![Request Feature](https://img.shields.io/badge/Request%20Feature-blue?logo=github)](https://aka.ms/vscode-mssql-feature-request)
![GitHub Discussions](https://img.shields.io/github/discussions/microsoft/vscode-mssql)
[![Build and Test (Unit + E2E)](https://github.com/microsoft/vscode-mssql/actions/workflows/build-and-test.yml/badge.svg?branch=main)](https://github.com/microsoft/vscode-mssql/actions/workflows/build-and-test.yml)
[![codecov](https://codecov.io/github/microsoft/vscode-mssql/graph/badge.svg?token=NXLNAwJgRB)](https://codecov.io/github/microsoft/vscode-mssql)

# MSSQL extension for Visual Studio Code

The [**MSSQL Extension for Visual Studio Code**](https://www.aka.ms/vscode-mssql) is designed to empower developers by providing a seamless and modern database development experience. Our goal is to make SQL development more productive and intuitive by integrating essential features such as schema management, query execution, and AI-powered assistance.

## Explore and Learn

[![MSSQL Extension Demo Playlist](https://raw.githubusercontent.com/microsoft/vscode-mssql/main/images/yt-thumbnail.png)](https://aka.ms/vscode-mssql-demos)

- 🎬 [Watch the demos](https://aka.ms/vscode-mssql-demos): Explore key features through our YouTube playlist
- 🤖 [Watch the GitHub Copilot demos](https://aka.ms/vscode-mssql-copilot-demos): Learn how to use GitHub Copilot to write, explain, and refactor your database schema
- 📝 [Read the blog posts](https://aka.ms/vscode-mssql-blogs): Learn from use cases, walkthroughs, and product updates
- 📖 [Read the documentation](https://aka.ms/vscode-mssql-docs): Get started or go deep with our official docs
- 🗺️ [Check out the roadmap](https://aka.ms/vscode-mssql-roadmap#2026): See what's coming next, including upcoming features and improvements

## Python notebooks (Preview)

Enable `mssql.preview.pythonNotebooks` in a trusted, non-virtual workspace. When unset,
it follows `mssql.enableExperimentalFeatures`; an explicit `true` or `false` overrides
that umbrella setting without changing other Preview features. Right-click
an Object Explorer connection or database and select **New Python Notebook (Preview)**.
Alternatively, open or create a regular Python notebook and add a `%%tsql` cell.
MSSQL offers an actionable **Connect** notification; **Not Now** dismisses it without
granting access. Ordinary Python notebooks without T-SQL magic are not prompted.
The notebook remembers that connection's ID and the selected database, not the active SQL
editor's connection. The Command Palette command also lets you choose a saved connection.
When neither the notebook nor its saved profile names a database, the connection uses
the login's default database, not an implicit `master` override.
Existing SQL notebooks do not require Python or Jupyter and are unchanged.

### Set up and connect

1. Install Microsoft's **Python** (`ms-python.python`) and **Jupyter**
   (`ms-toolsai.jupyter`) VS Code extensions.
2. Choose **Connect** in the notification or **Connect SQL** in the notebook toolbar.
   A regular notebook first offers a saved-connection picker. Select a local Python 3.10+
   kernel when prompted. If necessary, MSSQL inserts or reuses a safe `pass` cell and runs
   only that cell to start the kernel; it never runs your SQL or other Python cells for setup.
3. Approve kernel access. If dependencies are missing, choose **Install Dependencies and Connect**.
   Installation requires separate explicit consent and uses the selected kernel's Python environment. Prefer a
   dedicated virtual environment. The reviewed dependencies are Microsoft's
   `mssql-python==1.16.0`, pandas 2.2.x or later within 2.x, and IPython 8.x or 9.x; see
   [requirements.txt](python/requirements.txt). Installing them does not install a separate
   system ODBC driver. After installation, approve **Restart Kernel**, then choose
   **Reconnect**. Restarting clears all Python variables, and no user cells are replayed.
   An already-loaded package that differs from its installed version also requires restart;
   package metadata alone is not treated as proof that the running kernel is ready.
4. Jupyter may also request permission for MSSQL to execute initialization code. After connecting,
   use `%%tsql` normally. The notebook toolbar offers **Disconnect SQL**, and the status bar
   displays the connected server and actual database.

After a kernel restart, choose **Reconnect** in the notification or **Connect SQL** in the
toolbar. Reopening a notebook also requires explicit connection approval. SQL is never
automatically replayed. Dismissing a notification leaves the toolbar action available.
The existing Command Palette commands remain available as optional shortcuts.

The selected kernel must run on the **same host as the MSSQL extension host**. Remote
Jupyter servers and cross-host credential forwarding are not supported. A remote VS Code
workspace works only when its MSSQL extension and Python kernel are colocated.

The execution bridge implements SQL login, Windows integrated authentication with a Windows
kernel, and Microsoft Entra MFA using the exact MSSQL account and tenant in Azure's
commercial cloud. No alternate identity or Azure CLI credential is selected automatically.
Missing accounts and unsupported advanced connection options require an explicit reconnect
or configuration change. Follow the Python driver's supported-platform requirements.
Live verification covers Windows x64 kernels with SQL Express using integrated authentication
and the Azure SQL Database container using SQL authentication. The container checks assert
`EngineEdition = 5` and execute a saved mixed SQL/Python notebook in a real kernel.

| Environment                                                   | Python notebook validation                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows x64, SQL Express, Windows authentication              | Live driver, mixed notebook, and installed-VSIX UI tests                                                                                   |
| Windows x64, Azure SQL Database container, SQL authentication | Live driver and saved mixed-notebook tests                                                                                                 |
| Linux x64/ARM64, macOS Intel/Apple silicon, Windows ARM64     | Pinned driver wheels exist; native runtime and VSIX launch checks are configured in CI but require successful runs before claiming support |
| Microsoft Entra MFA                                           | Credential-selection unit coverage only; live account/tenant verification is outstanding                                                   |
| Remote VS Code workspace with colocated kernel                | Host guards are unit tested; an end-to-end remote-workspace run is outstanding                                                             |

The pinned driver publishes macOS wheels requiring macOS 15 or later and Linux wheels for
glibc 2.28 or later (plus musl builds); see the
[driver distributions](https://pypi.org/project/mssql-python/1.16.0/#files).
Wheel availability and successful unit tests do not establish live authentication or
end-to-end platform support. Unverified rows above are release gates, not implied passes.

### Exchange results and Python values

```python
%%tsql --bind df
SELECT TOP (100) name, object_id FROM sys.objects;
```

A following Python cell can use `df`, for example `df["object_id"].max()`. Pass values
back to SQL through an existing Python list or tuple:

```python
query_values = ["example"]
```

```python
%%tsql --bind matches --params query_values
SELECT name FROM sys.objects WHERE name = ?;
```

Values are bound by the driver, never interpolated into SQL. Do not use Python f-strings
to construct SQL containing untrusted values. `mssql.query(sql, params)` returns the same
DataFrame types using the same live connection. `--all --bind results` returns an ordered
list for multiple tabular results. Duplicate column names and driver-returned Decimal,
integer, null, binary, and datetime values are preserved using pandas object dtypes.

Each result is limited to **10,000 rows** by default. `--max-rows N` explicitly raises
that bound. A result of 10,001 rows fails rather than silently truncating or replacing a
previously bound variable. This is a row bound, not a byte bound: large values or many
result sets can still consume substantial kernel memory. Non-tabular statements do not
manufacture an empty DataFrame.

### Database-aware SQL IntelliSense

Keep every code cell set to **Python** and put `%%tsql` on its own first line.
After **Connect Python Notebook (Preview)** succeeds, the SQL body supports:

- Catalog-aware database, schema, table, view, and column completion, including same-cell SQL
  aliases. Type `.` or invoke **Trigger Suggest** (`Ctrl+Space` on Windows/Linux).
- Hover for SQL object and type information.
- Function signature help on `(` and `,`, including the active parameter.

The magic header/options and ordinary Python cells remain outside the SQL provider;
Python/Jupyter tooling stays enabled. No cell execution is needed for suggestions.
Inside the SQL body, SQL suggestions rank ahead of competing Python kernel suggestions.
For example, complete tables after `FROM dbo.`, schemas after `FROM Northwind.`, or
database names after `USE `. Ordinary Python cells retain their normal completion ordering.
Server-qualified/four-part names follow SQL Tools Service support, just as in a regular
SQL editor; database enumeration after a server name is not guaranteed.
SQL diagnostics are deferred; independently supplied Python diagnostics may still appear.
SQL execution errors show localized programming, data-constraint, operational/timeout,
or driver-connection guidance where the driver provides that category. Raw driver text,
SQL, parameter values, and credentials are not included in those errors.

IntelliSense opens an additional metadata connection using the exact approved connection
and the actual database selected by the Python connection. It does not borrow an active
SQL editor's connection, execute cell SQL, or inspect Python variables. Temporary tables
created in other cells and later database changes made with `USE` are not reflected in
this metadata connection. Reconnect the notebook to change its authoring target.
Metadata-service failures produce a nonmodal warning without disabling SQL execution.

### Session, transactions, and privacy

- SQL magic and Python share their own driver session, including temporary tables. They
  do not share a SQL editor's session, transactions, or temporary tables.
- Create temporary tables in a separate, unparameterized batch before using them with
  `--params` or `mssql.query(sql, params)`. A temporary table created inside a
  parameterized batch belongs to that prepared-execution scope and does not survive
  into later cells.
- Statements use autocommit. For a cross-cell transaction, execute `BEGIN TRANSACTION` in
  a separate SQL cell or `mssql.query()` call, then execute parameterized statements,
  and explicitly `COMMIT` or `ROLLBACK`. Starting an open transaction inside a
  parameterized batch can produce SQL Server error 266 because of prepared-execution
  scope. Failed statements are never automatically replayed.
- Queries default to a 30-second timeout unless the connection profile configures one.
  Zero means unlimited. Use Jupyter's interrupt/restart controls for cancellation; the
  synchronous driver's interrupt responsiveness is not guaranteed. Cursors are closed
  when execution finishes, fails, or raises `KeyboardInterrupt`.
- Run **Disconnect Python Notebook (Preview)** to revoke future credential delivery and
  cancel pending connection initialization and close the helper's driver connection.
  Changing the approved profile's target or security settings requires fresh consent.
  Reconnect explicitly after reopening or restarting
  the kernel. Kernel changes, restarts, notebook close, disabling experimental features,
  and extension disposal revoke authorization.
- Notebook metadata contains a connection reference only. Bootstrap capabilities,
  passwords, and tokens are not written to cells or normal execution history. Notebook
  code is trusted code with database access and can read credentials in kernel memory.
  Revocation cannot erase credentials already delivered or retroactively invalidate a
  database session. Only authorize kernels and notebooks you trust.
- Saved query outputs may contain sensitive data. Review or clear outputs before
  sharing or committing notebooks.

Automatic DataFrame uploads and Spark execution are not included.
This opt-in Preview is not a claim of Microsoft internal release approval.

## Features

The MSSQL extension provides a rich set of capabilities for SQL development. Each capability links to its detailed documentation on Microsoft Learn.

### General Availability

| Capability                                                                                                                                                      | Description                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Connection Dialog](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#connection-dialog)             | Connect using parameters, connection strings, or Azure/Fabric browse. Organize connections with color-coded groups |
| [Object Explorer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#object-explorer-filtering)       | Browse and filter database objects with type-aware search                                                          |
| [Database Object Search](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-database-operations#database-object-search)            | Search for tables, views, stored procedures, and other objects across a database                                   |
| [Fabric integration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-fabric-integration)                                        | Browse Fabric workspaces and provision SQL databases                                                               |
| [Query Results](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#query-results-pane)                | View, sort, copy, and export query results                                                                         |
| [Query Plan Visualizer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#query-plan-visualizer)     | Analyze execution plans with interactive node navigation                                                           |
| [Query Profiler](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-query-profiler)                                                | Real-time database activity monitoring with Extended Events                                                        |
| [Table Designer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#table-designer)                   | Create and manage tables with a visual interface                                                                   |
| [Schema Designer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-designer)                                              | Visual schema modeling with drag-and-drop, auto-layout, and T-SQL script generation                                |
| [GitHub Copilot in Schema Designer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-designer-copilot)                    | Natural language schema design within the visual Schema Designer                                                   |
| [Schema Compare](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-compare)                                                | Compare and synchronize schemas between databases or DACPACs                                                       |
| [GitHub Copilot integration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/github-copilot/overview)                                       | AI-assisted SQL development with natural language chat and agent mode                                              |
| [Local SQL Server containers](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-local-container)                                  | Create and manage SQL Server containers locally                                                                    |
| [View & Edit Data](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#view--edit-data)                | Browse and modify table data inline without writing T-SQL                                                          |
| [Database Operations](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-database-operations)                                      | Rename, back up, restore, import data from flat files, and drop databases from Object Explorer                     |
| [Data-tier Application (DACPAC and BACPAC)](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-tier-application)              | Deploy, extract, import, and export DACPAC and BACPAC files                                                        |
| [Fabric integration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-fabric-integration)                                        | Browse Fabric workspaces and provision SQL databases                                                               |
| [SQL Database Projects](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code)                           | Build, publish with the visual Publish Dialog, and analyze SQL projects with Code Analysis                         |
| [Query Profiler](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-query-profiler)                                                | Real-time database activity monitoring with Extended Events                                                        |
| [Backup and Restore](https://aka.ms/vscode-mssql-backup-and-restore)                                                                                            | Back up and restore SQL Server databases                                                                           |
| [Flat File Import](https://aka.ms/vscode-mssql-import-data)                                                                                                     | Import flat files (CSV, TXT) as new database tables using a guided wizard                                          |
| [Object Search](https://aka.ms/vscode-mssql-object-search)                                                                                                      | Search for database objects by name across a server or database                                                    |
| [Database Management](https://aka.ms/vscode-mssql-database-management-ops)                                                                                      | Create, rename, and drop databases                                                                                 |
| [SQL Notebooks](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-sql-notebooks)                                                  | Jupyter-based SQL notebooks with rich results and multi-kernel support                                             |
| [Data API builder](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-api-builder)                                            | Create REST, GraphQL, and MCP endpoints for SQL databases                                                          |
| [GitHub Copilot in Data API builder](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-api-builder)                          | Generate Data API builder configs using natural language                                                           |
| [Azure SQL database provisioning](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-azure-integration)                            | Create and connect to free tier Azure SQL database                                                                 |
| [Shortcuts Configuration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#shortcuts-configuration) | Create and manage keyboard shortcuts for Quick Queries, Query Editor, and Results Grid                             |

### Public Preview

| Capability                                                                                                                                                                      | Description                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [New Query Results Grid](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code?view=sql-server-ver17#query-results-pane) | New results grid experience with more column customizations (freeze, show, hide) |
| [New SQL Formatter](https://aka.ms/vscode-mssql-formatter)                                                                                                                      | New T-SQL formatter, enabled by default, with more formatting options            |

## Using the MSSQL Extension

Follow these steps to get started with the MSSQL extension:

1. Install [Visual Studio Code](https://code.visualstudio.com/#alt-downloads) and then install the **MSSQL extension** from the Extensions view or via the command palette (`F1`, then type `Install Extensions`).
2. Open or create a `.sql` file. To manually set language mode, press `Ctrl+K M` and select **SQL**.
3. Press `F1`, type `MS SQL: Manage Connection Profile`, and follow the prompts to create a profile. See [manage connection profiles](https://github.com/microsoft/vscode-mssql/wiki/manage-connection-profiles) for advanced options.
4. Connect to a database using `F1` > `MS SQL: Connect` or the shortcut `Ctrl+Shift+C`.
5. Write your T-SQL script using IntelliSense and snippets. Type `sql` to explore available snippets.
6. Run queries by selecting **MS SQL: Execute Query** from the Command Palette (`F1`), or use the shortcut:

- **Windows/Linux**: `Ctrl+Shift+E`
- **macOS**: `Cmd+Shift+E`

7. Customize shortcuts via the command palette or in your `settings.json`. See [customize shortcuts](https://github.com/microsoft/vscode-mssql/wiki/customize-shortcuts) for help.

## Resources

- [Get started with the MSSQL extension](https://aka.ms/mssql-getting-started): Step-by-step tutorial to connect and query your first database
- [SQL Developer tutorial](https://aka.ms/sqldev): Build full-stack apps using SQL Server with C#, Java, Node.js, Python, and more
- [Local development with Azure SQL](https://learn.microsoft.com/azure/azure-sql/database/local-dev-experience-overview): Learn how to develop locally with Azure SQL Database
- [Dev Containers for Azure SQL](https://aka.ms/azuresql-devcontainers-docs): Set up repeatable dev environments using Dev Containers
- [Join the Discussion](https://aka.ms/vscode-mssql-discussions): Ask questions, suggest features, and engage with the community

## Command Palette Commands

Press `F1` and type `MS SQL` to see all available commands. Here are the most commonly used:

<details>
<summary><strong>View common commands</strong></summary>

**Connections**

- **MS SQL: Connect** — connect using connection profiles or recent connections
- **MS SQL: Disconnect** — disconnect the current editor session
- **MS SQL: Use Database** — switch to another database on the same server
- **MS SQL: Manage Connection Profiles** — create, edit, or remove connection profiles
- **MS SQL: Add Connection** — add a new connection to the Object Explorer

**Queries**

- **MS SQL: New Query** — open a new SQL query file with your selected connection
- **MS SQL: Execute Query** — run T-SQL scripts, statements, or batches
- **MS SQL: Execute Current Statement** — run only the statement under the cursor
- **MS SQL: Cancel Query** — cancel a running query
- **MS SQL: Estimated Plan** — view the estimated execution plan without running the query
- **MS SQL: Toggle Actual Plan** — enable or disable actual execution plan capture

**Local Development**

- **MS SQL: Create Container Group** — set up a new SQL Server container locally
- **MS SQL: Schema Designer** — open the visual schema designer
- **MS SQL: Schema Compare** — compare schemas between databases, DACPACs, or SQL projects

**Data**

- **MS SQL: Edit Data** — browse and edit table data inline
- **MS SQL: Select Top 1000** — quick-select rows from a table
- **MS SQL: DACPAC/BACPAC Operations** — deploy, extract, import, or export `.dacpac` and `.bacpac` files

**Copilot**

- **MS SQL: Explain Query** — get an AI explanation of the current query
- **MS SQL: Analyze Query Performance** — AI-powered query performance analysis
- **MS SQL: Rewrite Query** — let Copilot rewrite and optimize your query

</details>

## Extension Settings

Configure the MSSQL extension in user preferences (`Cmd+,`) or workspace settings (`.vscode/settings.json`). For the complete reference with descriptions for all settings, see [Customize Options](https://github.com/microsoft/vscode-mssql/wiki/customize-options) on the wiki.

<details>
<summary><strong>View all settings</strong></summary>

```javascript
// General
{
  "mssql.enableExperimentalFeatures": false,                // Enable experimental features for early testing
  "mssql.messagesDefaultOpen": true,                        // Show messages panel by default after query execution
  "mssql.autoRevealResultsPanel": false,                    // Auto-reveal results panel when queries execute
  "mssql.statusBar.connectionInfoMaxLength": -1,            // Max characters to display in status bar (-1 = unlimited)
  "mssql.statusBar.enableConnectionColor": true,            // Color-code status bar by connection group
  "mssql.schemaDesigner.enableExpandCollapseButtons": true, // Show expand/collapse buttons in Schema Designer UI for entity relationships
  "mssql.showChangelogOnUpdate": true,                      // Show changelog when extension updates
}

// Connectivity
{
  "mssql.maxRecentConnections": 5,                         // Number of recent connections to display (0-50)
  "mssql.connectionManagement.rememberPasswordsUntilRestart": true,  // Keep passwords in memory until VS Code restarts
  "mssql.enableConnectionPooling": false,                  // Enable connection pooling for improved performance
  "mssql.azureActiveDirectory": "AuthCodeGrant",           // Azure AD auth method: "AuthCodeGrant" or "DeviceCode"
  "mssql.useMsalEntraMfaAuth": false,                      // Whether to use MSAL for Microsoft Entra MFA authentication instead of accounts signed into VS Code
  "mssql.newEditorConnectionBehavior": "transferActive",   // How to connect a newly-opened .SQL file or query editor: "none" | "transferActive" | "defaultConnection"
  "mssql.defaultConnectionId": "",                         // Connection ID (GUID) of the connection to auto-connect new editors with. Only applicable when "mssql.newEditorConnectionBehavior" is set to "defaultConnection"
}

// Query Formatting (search Settings for "@ext:ms-mssql.mssql format" to see all options)
{
  "mssql.format.options.keywordCasing": "uppercase",        // SQL keyword casing: "uppercase" | "lowercase" | "pascalCase"
  "mssql.format.options.identifierCasing": "preserve",      // Identifier casing: "preserve" | "uppercase" | "lowercase" | "pascalCase"
  "mssql.format.options.commaPlacement": "trailing",        // Comma placement: "trailing" | "leading"
  "mssql.format.options.multilineSelectElementsList": true   // Put SELECT columns on separate lines
}

// IntelliSense
{
  "mssql.intelliSense.enableIntelliSense": true,           // Enable IntelliSense for T-SQL code completion
  "mssql.intelliSense.enableErrorChecking": true,          // Enable real-time syntax and semantic error checking
  "mssql.intelliSense.enableSuggestions": true,            // Enable code suggestions and autocompletion
  "mssql.intelliSense.enableQuickInfo": true               // Show quick info tooltips on hover
}

// Query Execution
{
  "mssql.query.displayBitAsNumber": true,                  // Display bit values as 0/1 instead of false/true
  "mssql.query.preventAutoExecuteScript": false,           // Prevent auto-execution of scripts on file open
  "mssql.query.maxCharsToStore": 65535,                    // Maximum characters to store per result cell
  "mssql.query.maxXmlCharsToStore": 2097152,               // Maximum characters for XML data in results
  "mssql.query.rowCount": 0,                               // SET ROWCOUNT value (0 = unlimited rows returned)
  "mssql.query.textSize": 2147483647,                       // SET TEXTSIZE for text/ntext columns (bytes)
  "mssql.query.executionTimeout": 0,                       // Query timeout in seconds (0 = no timeout)
  "mssql.query.noCount": false,                            // Execute SET NOCOUNT ON (suppresses row count message)
  "mssql.query.noExec": false,                             // Parse only without executing (SET NOEXEC ON)
  "mssql.query.showActiveConnectionAsCodeLensSuggestion": true // Show active connection as CodeLens suggestion
}

// Advanced Query Execution (T-SQL SET Options)
{
  "mssql.query.parseOnly": false,                          // Parse queries without executing (SET PARSEONLY ON)
  "mssql.query.arithAbort": true,                          // Terminate query on overflow/divide-by-zero (SET ARITHABORT ON)
  "mssql.query.statisticsTime": false,                     // Display execution time statistics (SET STATISTICS TIME ON)
  "mssql.query.statisticsIO": false,                       // Display I/O statistics (SET STATISTICS IO ON)
  "mssql.query.xactAbortOn": false,                        // Rollback transaction on error (SET XACT_ABORT ON)
  "mssql.query.transactionIsolationLevel": "READ COMMITTED", // Transaction isolation: "READ COMMITTED" | "READ UNCOMMITTED" | "REPEATABLE READ" | "SERIALIZABLE"
  "mssql.query.deadlockPriority": "Normal",                // Deadlock priority: "Normal" | "Low"
  "mssql.query.lockTimeout": -1,                           // Lock timeout in milliseconds (-1 = wait indefinitely)
  "mssql.query.queryGovernorCostLimit": -1,                // Query governor cost limit (-1 = no limit)
  "mssql.query.ansiDefaults": false,                       // Enable ANSI defaults (SET ANSI_DEFAULTS ON)
  "mssql.query.quotedIdentifier": true,                    // Use quoted identifiers (SET QUOTED_IDENTIFIER ON)
  "mssql.query.ansiNullDefaultOn": true,                   // New columns allow nulls by default (SET ANSI_NULL_DFLT_ON)
  "mssql.query.implicitTransactions": false,               // Enable implicit transactions (SET IMPLICIT_TRANSACTIONS ON)
  "mssql.query.cursorCloseOnCommit": false,                // Close cursors on commit (SET CURSOR_CLOSE_ON_COMMIT ON)
  "mssql.query.ansiPadding": true,                         // ANSI padding for char/varchar (SET ANSI_PADDING ON)
  "mssql.query.ansiWarnings": true,                        // ANSI warnings for aggregates/nulls (SET ANSI_WARNINGS ON)
  "mssql.query.ansiNulls": true,                           // ANSI null comparison behavior (SET ANSI_NULLS ON)
  "mssql.query.alwaysEncryptedParameterization": false     // Enable Always Encrypted parameterization
}

// Query Results & Grid
{
  "mssql.openQueryResultsInTabByDefault": false,           // Open query results in a tab instead of side panel
  "mssql.preview.betaResultsGrid": true,                   // (Preview) New results grid; set to false to use the legacy grid
  "mssql.resultsFontFamily": null,                         // Font family for results grid (null = VS Code default)
  "mssql.resultsFontSize": null,                           // Font size for results grid in pixels (null = VS Code default)
  "mssql.defaultQueryResultsViewMode": "Grid",             // Default results view: "Grid" or "Text"
  "mssql.showBatchTime": false,                            // Show batch execution time in results pane
  "mssql.resultsGrid.autoSizeColumnsMode": "headersAndData", // Auto-size columns: "headersAndData" | "dataOnly" | "headerOnly" | "off"
  "mssql.resultsGrid.inMemoryDataProcessingThreshold": 5000, // Rows threshold for in-memory processing
  "mssql.splitPaneSelection": "next",                      // Focus after split pane: "next" | "current" | "end"
  "mssql.persistQueryResultTabs": false,                   // Keep result tabs open after closing query file
  "mssql.copyIncludeHeaders": false,                       // Include column headers when copying results
  "mssql.copyRemoveNewLine": true,                         // Remove newline characters when copying
  "mssql.messages.copyIncludeTimestamps": false,           // Include message timestamps when using Copy All in the Messages pane
  "mssql.saveAsCsv.includeHeaders": true,                  // Include column headers when saving as CSV
  "mssql.saveAsCsv.delimiter": ",",                        // CSV delimiter: "," | "\\t" | ";" | "|"
  "mssql.saveAsCsv.lineSeparator": null,                   // CSV line separator (null = OS default)
  "mssql.saveAsCsv.textIdentifier": "\"",                  // CSV text identifier/quote character
  "mssql.saveAsCsv.encoding": "utf-8",                     // CSV encoding: "utf-8" | "utf-16le" | "ascii" etc.
  "mssql.enableQueryHistoryCapture": true,                 // Automatically capture all executed queries in history
  "mssql.enableQueryHistoryFeature": true,                 // Enable the Query History feature and UI
  "mssql.queryHistoryLimit": 20                            // Maximum number of queries to retain in history
}

// Object Explorer
{
  "mssql.objectExplorer.groupBySchema": false,             // Group database objects by schema (tables, views, etc.)
  "mssql.objectExplorer.collapseConnectionGroupsOnStartup": false,  // Auto-collapse connection groups on extension startup
  "mssql.objectExplorer.expandTimeout": 45                 // Timeout in seconds for expanding object explorer node children
}

// Diagnostics & Logging
{
  "mssql.tracingLevel": "Critical",                        // Logging level: "All" | "Off" | "Critical" | "Error" | "Warning" | "Information" | "Verbose"
  "mssql.logDebugInfo": false,                             // Enable debug logging for troubleshooting
  "mssql.logRetentionMinutes": 10080,                      // Log retention period in minutes (10080 = 7 days)
  "mssql.logFilesRemovalLimit": 100                        // Maximum number of log files to keep before cleanup
}
```

</details>

## Keyboard Shortcuts

Customize keyboard shortcuts for query results, grid operations, and other actions. For the complete reference, see [Customize Shortcuts](https://github.com/microsoft/vscode-mssql/wiki/customize-shortcuts) on the wiki.

> **Coming from SSMS or Azure Data Studio?** Install the [Database Management Keymap](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql-database-management-keymap) companion extension to use familiar keyboard shortcuts like `F5` (execute query) and `Ctrl+Shift+R` (toggle query result panel) in VS Code.

For full details on all extension settings and keyboard shortcuts, see the wiki:

- [Customize Options](https://github.com/microsoft/vscode-mssql/wiki/customize-options)
- [Customize Shortcuts](https://github.com/microsoft/vscode-mssql/wiki/customize-shortcuts)
- [Manage Connection Profiles](https://github.com/microsoft/vscode-mssql/wiki/manage-connection-profiles)

<details>
<summary><strong>View all shortcuts</strong></summary>

```javascript
// Shortcuts
{
  "mssql.shortcuts": {
    "event.queryResults.switchToResultsTab": "ctrl+alt+R",
    "event.queryResults.switchToMessagesTab": "ctrl+alt+Y",
    "event.queryResults.switchToQueryPlanTab": "ctrl+alt+E",
    "event.queryResults.prevGrid": "ctrlcmd+up",
    "event.queryResults.nextGrid": "ctrlcmd+down",
    "event.queryResults.switchToTextView": "",
    "event.queryResults.maximizeGrid": "",
    "event.queryResults.saveAsJSON": "",
    "event.queryResults.saveAsCSV": "",
    "event.queryResults.saveAsExcel": "",
    "event.queryResults.saveAsInsert": "",
    "event.resultGrid.copySelection": "ctrlcmd+c",
    "event.resultGrid.copyWithHeaders": "",
    "event.resultGrid.copyAllHeaders": "",
    "event.resultGrid.selectAll": "ctrlcmd+a",
    "event.resultGrid.copyAsCSV": "",
    "event.resultGrid.copyAsJSON": "",
    "event.resultGrid.copyAsInsert": "",
    "event.resultGrid.copyAsInClause": "",
    "event.resultGrid.changeColumnWidth": "alt+shift+s",
    "event.resultGrid.expandSelectionLeft": "shift+left",
    "event.resultGrid.expandSelectionRight": "shift+right",
    "event.resultGrid.expandSelectionUp": "shift+up",
    "event.resultGrid.expandSelectionDown": "shift+down",
    "event.resultGrid.openColumnMenu": "f3",
    "event.resultGrid.openFilterMenu": "",
    "event.resultGrid.moveToRowStart": "ctrlcmd+left",
    "event.resultGrid.moveToRowEnd": "ctrlcmd+right",
    "event.resultGrid.selectColumn": "ctrl+space",
    "event.resultGrid.selectRow": "shift+space",
    "event.resultGrid.toggleSort": "alt+shift+o"
  }
}
```

</details>

## Supported Operating Systems

- Windows 11 (x64, arm64)
- macOS (Intel & Apple Silicon)
- Linux (x64, arm64) — including Ubuntu, Debian, RHEL, Fedora, and other major distributions

## Offline Installation

The extension will download and install a required SqlToolsService package during activation. For machines with no Internet access, you can still use the extension by choosing the `Install from VSIX...` option in the extension view and installing a bundled release from our [Releases](https://github.com/Microsoft/vscode-mssql/releases) page.

Each operating system has a `.vsix` file with the required service included. Pick the file for your OS, download and install to get started. We recommend you choose a full release and ignore any alpha or beta releases as these are our daily builds used in testing.

## Change Log

View the change log in the extension via the **MS SQL: Show Change Log** command, or browse the full [change log on GitHub](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/CHANGELOG.md). The change log is also shown automatically on first install and after updates.

## Support

Support for this extension is provided via [GitHub issues](https://github.com/Microsoft/vscode-mssql/issues). You can submit a [bug report](https://aka.ms/vscode-mssql-bug), a [feature suggestion](https://aka.ms/vscode-mssql-feature-request) or participate in [discussions](https://aka.ms/vscode-mssql-discussions).

## Development & Contributing

See the [development guide](https://github.com/microsoft/vscode-mssql/blob/main/DEVELOPMENT.md) for
setup, build, test, localization, and debugging workflows. See the
[contributing guide](https://github.com/microsoft/vscode-mssql/wiki/contributing) for the
contribution process.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Telemetry

This extension collects telemetry data, which is used to help understand how to improve the product. For example, this usage data helps to debug issues, such as slow start-up times, and to prioritize new features. While we appreciate the insights this data provides, we also know that not everyone wants to send usage data and you can disable telemetry as described in the VS Code [disable telemetry reporting](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting) documentation.

To inspect the telemetry emitted by the extension, run **Developer: Show Telemetry** from the Command Palette, then review the **Telemetry** channel in the Output pane.

Administrators can set or disable feedback and telemetry collection across their entire organization/tenant with the same mechanism. Learn more about [setting feedback and telemetry collection policy](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting) and [centrally managing VS Code settings with policies](https://code.visualstudio.com/docs/enterprise/policies).

## Privacy Statement

The [Microsoft Enterprise and Developer Privacy Statement](https://go.microsoft.com/fwlink/?LinkId=521839) describes the privacy statement of this software.

## License

This extension is [licensed under the MIT License](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/LICENSE.txt). Please see the [third-party notices](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/ThirdPartyNotices.txt) file for additional copyright notices and license terms applicable to portions of the software.
