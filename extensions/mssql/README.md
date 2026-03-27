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

## Features

The MSSQL extension provides a rich set of capabilities for SQL development. Each capability links to its detailed documentation on Microsoft Learn.

### General Availability

| Capability                                                                                                                                                  | Description                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Connection Dialog](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#connection-dialog)         | Connect using parameters, connection strings, or Azure/Fabric browse. Organize connections with color-coded groups |
| [Object Explorer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#object-explorer-filtering)   | Browse and filter database objects with type-aware search                                                          |
| [Query Results](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#query-results-pane)            | View, sort, copy, and export query results                                                                         |
| [Query Plan Visualizer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#query-plan-visualizer) | Analyze execution plans with interactive node navigation                                                           |
| [Table Designer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#table-designer)               | Create and manage tables with a visual interface                                                                   |
| [Schema Designer](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-designer)                                          | Visual schema modeling with drag-and-drop, auto-layout, and T-SQL script generation                                |
| [Schema Compare](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-compare)                                            | Compare and synchronize schemas between databases or DACPACs                                                       |
| [GitHub Copilot integration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/github-copilot/overview)                                   | AI-assisted SQL development with natural language chat and agent mode                                              |
| [Local SQL Server containers](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-local-container)                              | Create and manage SQL Server containers locally                                                                    |
| [View & Edit Data](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code#view--edit-data)            | Browse and modify table data inline without writing T-SQL                                                          |
| [Data-tier Application (DACPAC)](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-tier-application)                     | Deploy, extract, import, and export DACPAC and BACPAC files                                                        |
| [Fabric integration](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-fabric-integration)                                    | Browse Fabric workspaces and provision SQL databases                                                               |
| [SQL Database Projects](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-extension-visual-studio-code)                       | Build, publish with the visual Publish Dialog, and analyze SQL projects with Code Analysis                         |

### Public Preview

| Capability                                                                                                                                     | Description                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Schema Designer with GitHub Copilot](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-schema-designer-copilot) | Natural language schema design within the visual Schema Designer       |
| [Data API builder](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-api-builder)                           | Create REST, GraphQL, and MCP endpoints for SQL databases              |
| [GitHub Copilot in Data API builder](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-data-api-builder)         | Generate Data API builder configs using natural language               |
| [SQL Notebooks](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-sql-notebooks)                                 | Jupyter-based SQL notebooks with rich results and multi-kernel support |
| [Query Profiler](https://learn.microsoft.com/sql/tools/visual-studio-code-extensions/mssql/mssql-query-profiler)                               | Real-time database activity monitoring with Extended Events            |

## Using the MSSQL Extension

Follow these steps to get started with the MSSQL extension:

1. Install [Visual Studio Code](https://code.visualstudio.com/#alt-downloads) and then install the **MSSQL extension** from the Extensions view or via the command palette (`F1`, then type `Install Extensions`).
2. Open or create a `.sql` file. To manually set language mode, press `Ctrl+K M` and select **SQL**.
3. Press `F1`, type `MS SQL: Manage Connection Profile`, and follow the prompts to create a profile. See [manage connection profiles](https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles) for advanced options.
4. Connect to a database using `F1` > `MS SQL: Connect` or the shortcut `Ctrl+Shift+C`.
5. Write your T-SQL script using IntelliSense and snippets. Type `sql` to explore available snippets.
6. Run queries by selecting **MS SQL: Execute Query** from the Command Palette (`F1`), or use the shortcut:

- **Windows/Linux**: `Ctrl+Shift+E`
- **macOS**: `Cmd+Shift+E`

7. Customize shortcuts via the command palette or in your `settings.json`. See [customize shortcuts](https://github.com/Microsoft/vscode-mssql/wiki/customize-shortcuts) for help.

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
- **MS SQL: Data-tier Application** — deploy, extract, import, or export DACPAC/BACPAC files

**Copilot**

- **MS SQL: Explain Query** — get an AI explanation of the current query
- **MS SQL: Analyze Query Performance** — AI-powered query performance analysis
- **MS SQL: Rewrite Query** — let Copilot rewrite and optimize your query

</details>

## Extension Settings

Configure the MSSQL extension in user preferences (`Cmd+,`) or workspace settings (`.vscode/settings.json`). For the complete reference with descriptions for all 60+ settings, see [Customize Options](https://github.com/microsoft/vscode-mssql/wiki/customize-options) on the wiki.

<details>
<summary><strong>View all settings</strong></summary>

```javascript
// General Settings
{
  "mssql.enableExperimentalFeatures": false,                // Enable experimental features for early testing
  "mssql.enableRichExperiences": true,                     // Enable rich UI experiences (tables, schema designer)
  "mssql.logDebugInfo": false,                             // Enable debug logging for troubleshooting
  "mssql.messagesDefaultOpen": true,                       // Show messages panel by default after query execution
  "mssql.autoRevealResultsPanel": false,                    // Auto-reveal results panel when queries execute
  "mssql.statusBar.connectionInfoMaxLength": -1,           // Max characters to display in status bar (-1 = unlimited)
  "mssql.statusBar.enableConnectionColor": true,            // Color-code status bar by connection group
  "mssql.schemaDesigner.enableExpandCollapseButtons": true, // Show expand/collapse buttons in Schema Designer UI for entity relationships
  "mssql.showChangelogOnUpdate": true                       // Show changelog when extension updates
}

// Connectivity
{
  "mssql.maxRecentConnections": 5,                         // Number of recent connections to display (0-50)
  "mssql.connectionManagement.rememberPasswordsUntilRestart": true,  // Keep passwords in memory until VS Code restarts
  "mssql.enableConnectionPooling": false,                  // Enable connection pooling for improved performance
  "mssql.azureActiveDirectory": "AuthCodeGrant"            // Azure AD auth method: "AuthCodeGrant" or "DeviceCode"
}

// Query Formatting
{
  "mssql.format.alignColumnDefinitionsInColumns": false,   // Align column definitions in CREATE TABLE statements
  "mssql.format.datatypeCasing": "none",                   // Datatype casing: "none" | "uppercase" | "lowercase"
  "mssql.format.keywordCasing": "none",                    // SQL keyword casing: "none" | "uppercase" | "lowercase"
  "mssql.format.placeCommasBeforeNextStatement": false,    // Place commas before next item (procedural style)
  "mssql.format.placeSelectStatementReferencesOnNewLine": false  // Put SELECT references on new lines
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
  "mssql.logRetentionMinutes": 10080,                      // Log retention period in minutes (10080 = 7 days)
  "mssql.logFilesRemovalLimit": 100                        // Maximum number of log files to keep before cleanup
}
```

</details>

## Keyboard Shortcuts

Customize keyboard shortcuts for query results, grid operations, and other actions. For the complete reference, see [Customize Shortcuts](https://github.com/microsoft/vscode-mssql/wiki/customize-shortcuts) on the wiki.

> **Coming from SSMS or Azure Data Studio?** Install the [Database Management Keymap](https://marketplace.visualstudio.com/items?itemName=ms-mssql.mssql-database-management-keymap) companion extension to use familiar keyboard shortcuts like `Ctrl+R` (toggle results) and `F5` (execute query) in VS Code.

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

- Windows 10/11 (x64, arm64)
- macOS (Intel & Apple Silicon)
- Linux (x64, arm64) - including Ubuntu, Debian, RHEL, Fedora, and other major distributions

## Offline Installation

The extension will download and install a required SqlToolsService package during activation. For machines with no Internet access, you can still use the extension by choosing the `Install from VSIX...` option in the extension view and installing a bundled release from our [Releases](https://github.com/Microsoft/vscode-mssql/releases) page.

Each operating system has a `.vsix` file with the required service included. Pick the file for your OS, download and install to get started. We recommend you choose a full release and ignore any alpha or beta releases as these are our daily builds used in testing.

## Change Log

View the change log in the extension via the **MS SQL: Show Change Log** command, or browse the full [change log on GitHub](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/CHANGELOG.md). The change log is also shown automatically on first install and after updates.

## Support

Support for this extension is provided via [GitHub issues](https://github.com/Microsoft/vscode-mssql/issues). You can submit a [bug report](https://aka.ms/vscode-mssql-bug), a [feature suggestion](https://aka.ms/vscode-mssql-feature-request) or participate in [discussions](https://aka.ms/vscode-mssql-discussions).

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Telemetry

This extension collects telemetry data, which is used to help understand how to improve the product. For example, this usage data helps to debug issues, such as slow start-up times, and to prioritize new features. While we appreciate the insights this data provides, we also know that not everyone wants to send usage data and you can disable telemetry as described in the VS Code [disable telemetry reporting](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting) documentation.

Administrators can set or disable telemetry across their entire organization/tenant with the same mechanism. Learn more [here](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting).

## Privacy Statement

The [Microsoft Enterprise and Developer Privacy Statement](https://go.microsoft.com/fwlink/?LinkId=521839) describes the privacy statement of this software.

## License

This extension is [licensed under the MIT License](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/LICENSE.txt). Please see the [third-party notices](https://github.com/Microsoft/vscode-mssql/blob/main/mssql/ThirdPartyNotices.txt) file for additional copyright notices and license terms applicable to portions of the software.
