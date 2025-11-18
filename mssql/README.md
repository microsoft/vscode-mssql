[![Build and Test (Unit + E2E)](https://github.com/microsoft/vscode-mssql/actions/workflows/build-and-test.yml/badge.svg?branch=main)](https://github.com/microsoft/vscode-mssql/actions/workflows/build-and-test.yml)
![GitHub Discussions](https://img.shields.io/github/discussions/microsoft/vscode-mssql)
[![codecov](https://codecov.io/github/microsoft/vscode-mssql/graph/badge.svg?token=NXLNAwJgRB)](https://codecov.io/github/microsoft/vscode-mssql)

# MSSQL extension for Visual Studio Code

The [**MSSQL Extension for Visual Studio Code**](https://www.aka.ms/vscode-mssql) is designed to empower developers by providing a seamless and modern database development experience. Our goal is to make SQL development more productive and intuitive by integrating essential features such as schema management, query execution, and AI-powered assistance.

## Explore and Learn

[![MSSQL Extension Demo Playlist](images/yt-thumbnail.png)](https://aka.ms/vscode-mssql-demos)

-   [Watch the demos](https://aka.ms/vscode-mssql-demos): Explore key features through our YouTube playlist
-   [Read our blog posts](https://aka.ms/vscode-mssql-blogs): Learn from use cases, walkthroughs, and product updates
-   [View the documentation](https://aka.ms/vscode-mssql-docs): Get started or go deep with our official docs
-   [Explore GitHub Copilot integration](https://aka.ms/vscode-mssql-copilot-docs): Learn how to use GitHub Copilot to write, explain, and refactor your database schema
-   [Check out roadmap](https://aka.ms/vscode-mssql-roadmap): See what's coming next, including upcoming features and improvements

## General Availability Features

-   **Connect to your databases**: Seamlessly manage your database connections
    -   Connect to **SQL database in Fabric, Azure SQL, and SQL Server** using a user-friendly interface
    -   Use an intuitive Connection Dialog to enter parameters, paste a connection string, or browse Azure resources
    -   Access recent connections quickly from a dedicated panel
    -   Use Microsoft Entra ID authentication for secure access
    -   Manage multiple connection profiles for different environments
    -   Reconnect to frequently used databases in just a few clicks
    -   Organize your connections into color-coded groups to manage local, staging, and production environments side by side.
-   **Execute queries and View Results**: Run your scripts and view results in a simple, yet powerful, grid with improved data visualization features:
    -   View results in a unified interface alongside the integrated terminal and output panels or in their own tab.
    -   Sort results by clicking on column headers.
    -   Easily copy results with or without headers for use in other applications.
    -   Export results to multiple formats, including JSON, Excel, and CSV.
    -   Enhanced experience with live execution timing summary metrics and stability improvements on large result sets
    -   View estimated plan and actual plan for T-SQL queries.
-   **Enhanced T-SQL Editing Experience**: Write T-SQL scripts with a range of powerful features, including:
    -   IntelliSense for faster and more accurate coding.
    -   Go to Definition for exploring database objects.
    -   T-SQL snippets to speed up repetitive tasks.
    -   Syntax colorizations and T-SQL error validations.
    -   Support for the `GO` batch separator.
-   **Object Explorer**: Navigate and manage your database structure with ease
    -   Browse databases, tables, views, and programmability objects
    -   Expand or collapse objects to explore hierarchy visually
    -   Use enhanced filters to quickly locate items by name, owner, or creation date
    -   Streamline development in large databases with fast object access
-   **Table Designer**: A visual tool for creating and managing tables in your databases. Design every aspect of the table's structure, including:
    -   Adding columns, setting data types, and specifying default values.
    -   Defining primary keys and managing indexes to improve query performance.
    -   Setting up foreign keys to maintain data integrity across tables.
    -   Configuring advanced options like check constraints.
    -   Automatically generate T-SQL scripts for your table design and apply changes directly to the database.
-   **Query Plan Visualizer**: Analyze SQL query performance with detailed execution plans. Key features include:
    -   Interact with each step in the execution plan, including collapsing or expanding nodes for a simplified view.
    -   Zoom in or out to adjust the level of detail, or use "zoom to fit" for a complete view of the plan.
    -   Highlight key performance indicators, such as elapsed time or subtree cost, to identify bottlenecks in query execution.
-   **Local SQL Server Containers**
    -   Create and manage SQL Server containers locally without Docker commands
    -   Use SQL Server 2025 by default with vector and AI-ready features
    -   Auto-connect with a ready-to-use connection profile
    -   Start, stop, restart, or delete containers from the connection panel
    -   Automatic port conflict detection and resolution
    -   Customize container name, hostname, port, and version
-   **Schema Designer**: Visual schema modeling and editing—code-free
    -   Design, view, and manage database schemas using an intuitive drag-and-drop GUI
    -   Add or modify tables, columns, primary keys, and foreign key relationships without writing T-SQL
    -   Preview schema changes instantly as read-only T-SQL in the built-in code pane
    -   Navigate large schemas easily with search, mini-map, zoom, and auto-layout
    -   Filter by table name or relationship to focus on specific areas of your schema
    -   Export diagrams to share with your team or include in documentation
    -   Push updates to your database using the built-in deployment
-   **Schema Compare**: Effortless schema synchronization and management
    -   Compare schemas between two databases, DACPAC files, or SQL projects and see additions, removals, and modifications at a glance
    -   Filter and exclude specific differences before syncing
    -   Apply changes directly or generate a deployment script for later use
    -   Save comparisons to rerun or audit schema changes
-   **GitHub Copilot Integration**: Boost your productivity with AI‑assisted SQL development
    -   Chat with `@mssql` using natural language to generate queries, explain stored procedures, scaffold schemas, and debug SQL issues with database-aware context
    -   Intelligent code completions and inline suggestions while coding, with support for popular ORMs and T-SQL
    -   Query optimization with AI recommendations to refactor slow queries, fine-tune indexes, and understand execution plans
    -   Generate mock and test data automatically with sample data and seeding scripts
    -   Identify risky patterns such as SQL injection and over-permissive roles, with suggestions for safer alternatives
    -   Explain complex stored procedures, views, and functions in plain language—perfect for onboarding and code reviews
-   **GitHub Copilot Agent Mode**: Let Copilot perform database tasks on your behalf
    -   Securely executes actions like connecting, switching databases, or running queries directly from chat
    -   Surfaces schema details and connection info without manual navigation
    -   Provides a confirmable, AI-driven assistant for common database workflows
    -   Access all approved Agent tools from the Tools panel
-   **GitHub Copilot Slash Commands**: Quick, discoverable shortcuts in chat
    -   Type `/` to see commands like `/connect`, `/changeDatabase`, `/runQuery`, `/explain`, `/fix`, `/optimize`, and more
    -   Connection commands open the MSSQL connection panel; query commands accept input and return results in chat
-   **Customizable Extension Options**: Configure command shortcuts, appearance, and other settings to personalize your development experience.

## Public Preview Features

-   **Fabric Integration (`Preview`)**: Browse workspaces and provision SQL databases in Fabric directly from VS Code
    -   Sign in with Microsoft Entra ID, browse workspaces, search, and connect to SQL databases or SQL analytics endpoints from the Connection dialog (includes **Open in MSSQL** from the Fabric extension)
    -   Create a SQL database from the Deployments page; capacity‑aware and **auto‑connects** when complete
-   **View & Edit Data (`Preview`)**: Browse and modify table data directly within the editor without writing Transact-SQL data manipulation language (DML) statements
    -   Inline editing with real-time validation that highlights errors and displays helpful messages for incorrect inputs
    -   Add and delete rows, navigate large datasets with pagination controls, and save all changes together with a read-only DML script preview
-   **Data-tier Application Export/Import (`Preview`)**: Easy-to-use wizard experience to deploy and extract dacpac files and import and export bacpac files
    -   Deploy dacpac files to SQL Server instances, extract instances to dacpac files, and create databases or export schema and data to bacpac files
    -   Simplifies development and deployment workflows for data-tier applications supporting your application
-   **SQL Database Projects Publish Dialog (`Preview`)**: Streamlined deployment workflow for SQL Database Projects
    -   Streamlined Deployment Flow – Redesigned to guide users through connection setup, script generation, and deployment in fewer steps.
    -   Consistent Experience – Unified UI for SQL Server and Azure SQL projects, reducing confusion and improving discoverability.
    -   Preview and Validate – Easily review generated scripts before deployment to ensure accuracy and control.
    -   Integrated in VS Code – Manage the full build-and-publish workflow within the SQL Database Projects extension, without switching tools.

![Demo](https://github.com/Microsoft/vscode-mssql/raw/main/images/mssql-demo.gif)

## Resources

-   [Get started with the MSSQL extension](https://aka.ms/mssql-getting-started): Step-by-step tutorial to connect and query your first database
-   [SQL Developer tutorial](https://aka.ms/sqldev): Build full-stack apps using SQL Server with C#, Java, Node.js, Python, and more
-   [Local development with Azure SQL](https://learn.microsoft.com/azure/azure-sql/database/local-dev-experience-overview): Learn how to develop locally with Azure SQL Database
-   [Dev Containers for Azure SQL](https://aka.ms/azuresql-devcontainers-docs): Set up repeatable dev environments using Dev Containers
-   [Join the Discussion](https://aka.ms/vscode-mssql-discussions): Ask questions, suggest features, and engage with the community

## Using the MSSQL Extension

Follow these steps to get started with the MSSQL extension:

1. Install [Visual Studio Code](https://code.visualstudio.com/#alt-downloads) and then install the **MSSQL extension** from the Extensions view or via the command palette (`F1`, then type `Install Extensions`).
2. Open or create a `.sql` file. To manually set language mode, press `Ctrl+K M` and select **SQL**.
3. Press `F1`, type `MS SQL: Manage Connection Profile`, and follow the prompts to create a profile. See [manage connection profiles](https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles) for advanced options.
4. Connect to a database using `F1` > `MS SQL: Connect` or the shortcut `Ctrl+Shift+C`.
5. Write your T-SQL script using IntelliSense and snippets. Type `sql` to explore available snippets.
6. Run queries by selecting **MS SQL: Execute Query** from the Command Palette (`F1`), or use the shortcut:

-   **Windows/Linux**: `Ctrl+Shift+E`
-   **macOS**: `Cmd+Shift+E`

8. Customize shortcuts via the command palette or in your `settings.json`. See [customize shortcuts](https://github.com/Microsoft/vscode-mssql/wiki/customize-shortcuts) for help.

## Command Palette Commands

The extension provides several commands in the Command Palette for working with `.sql` files. Here are some of the most commonly used commands:

-   **MS SQL: Connect** to Azure SQL, SQL database in Fabric or SQL Server using connection profiles or recent connections.
-   **MS SQL: Create Container Group** to set up a new SQL Server container locally with customizable settings (name, port, version).
-   **MS SQL: Disconnect** from Azure SQL, SQL database in Fabric or SQL Server in the editor session.
-   **MS SQL: New Query** to open a new SQL query file with your selected connection.
-   **MS SQL: Use Database** to switch the database connection to another database within the same connected server in the editor session.
-   **MS SQL: Execute Query** script, T-SQL statements or batches in the editor.
-   **MS SQL: Run Current Statement** to execute only the current T-SQL statement or batch under the cursor.
-   **MS SQL: Cancel Query** execution in progress in the editor session.
-   **MS SQL: Manage Connection Profiles**
    -   **Create** a new connection profile using command palette's step-by-step UI guide.
    -   **Edit** user settings file (settings.json) in the editor to manually create, edit or remove connection profiles.
    -   **Remove** an existing connection profile using command palette's step-by-step UI guide.
    -   **Clear Recent Connection List** to clear the history of recent connections.
-   **MS SQL: Show Estimated Execution Plan** to view the estimated query execution plan without running the query.

## Extension Settings

Configure the MSSQL extension using these settings. Set them in user preferences (cmd+,) or workspace settings `(.vscode/settings.json)`.

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
  "mssql.schemaDesigner.enableExpandCollapseButtons": true  // Show expand/collapse buttons in Schema Designer UI for entity relationships
}

// Connectivity
{
  "mssql.maxRecentConnections": 5,                         // Number of recent connections to display (0-50)
  "mssql.connectionManagement.rememberPasswordsUntilRestart": true,  // Keep passwords in memory until VS Code restarts
  "mssql.enableConnectionPooling": false,                  // Enable connection pooling for improved performance
  "mssql.enableSqlAuthenticationProvider": true,           // Enable SQL authentication support
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
  "mssql.intelliSense.enableQuickInfo": true,              // Show quick info tooltips on hover
  "mssql.intelliSense.lowerCaseSuggestions": false         // Display suggestions in lowercase (false = match case)
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
  "mssql.query.noExec": false                              // Parse only without executing (SET NOEXEC ON)
}

// Query Results & Grid
{
  "mssql.openQueryResultsInTabByDefault": false,           // Open query results in a tab instead of side panel
  "mssql.resultsFontFamily": null,                         // Font family for results grid (null = VS Code default)
  "mssql.resultsFontSize": null,                           // Font size for results grid in pixels (null = VS Code default)
  "mssql.defaultQueryResultsViewMode": "Grid",             // Default results view: "Grid" or "Text"
  "mssql.showBatchTime": false,                            // Show batch execution time in results pane
  "mssql.resultsGrid.autoSizeColumns": true,               // Auto-size result grid columns to fit content
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

### Keyboard Shortcuts

Customize keyboard shortcuts for query results, grid operations, and other actions:

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
    "event.resultGrid.moveToRowStart": "ctrlcmd+left",
    "event.resultGrid.moveToRowEnd": "ctrlcmd+right",
    "event.resultGrid.selectColumn": "ctrl+space",
    "event.resultGrid.selectRow": "shift+space",
    "event.resultGrid.toggleSort": "alt+shift+o"
  }
}

// Status bar
{
  "mssql.statusBar.connectionInfoMaxLength": -1,
  "mssql.enableConnectionColor": true,
}
```

See [customize options](https://github.com/Microsoft/vscode-mssql/wiki/customize-options) and [manage connection profiles](https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles) for more details.

## Change Log

See the [change log](https://github.com/Microsoft/vscode-mssql/blob/main/CHANGELOG.md) for a detailed list of changes in each version.

## Supported Operating Systems

* Windows 10/11 (x64, arm64)
* macOS (Intel & Apple Silicon)
* Linux (x64, arm64) - including Ubuntu, Debian, RHEL, Fedora, and other major distributions

## Offline Installation

The extension will download and install a required SqlToolsService package during activation. For machines with no Internet access, you can still use the extension by choosing the `Install from VSIX...` option in the extension view and installing a bundled release from our [Releases](https://github.com/Microsoft/vscode-mssql/releases) page.

Each operating system has a `.vsix` file with the required service included. Pick the file for your OS, download and install to get started. We recommend you choose a full release and ignore any alpha or beta releases as these are our daily builds used in testing.

## Support

Support for this extension is provided via [GitHub issues](https://github.com/Microsoft/vscode-mssql/issues). You can submit a [bug report](https://aka.ms/vscode-mssql-bug), a [feature suggestion](https://aka.ms/vscode-mssql-feature-request) or participate in [discussions](https://aka.ms/vscode-mssql-discussions).

## Contributing to the Extension

See the [developer documentation](https://github.com/Microsoft/vscode-mssql/wiki/contributing) for details on how to contribute to this extension.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Telemetry

This extension collects telemetry data, which is used to help understand how to improve the product. For example, this usage data helps to debug issues, such as slow start-up times, and to prioritize new features. While we appreciate the insights this data provides, we also know that not everyone wants to send usage data and you can disable telemetry as described in the VS Code [disable telemetry reporting](https://code.visualstudio.com/docs/getstarted/telemetry#_disable-telemetry-reporting) documentation.

## Privacy Statement

The [Microsoft Enterprise and Developer Privacy Statement](https://go.microsoft.com/fwlink/?LinkId=786907&lang=en7) describes the privacy statement of this software.

## License

This extension is [licensed under the MIT License](https://github.com/Microsoft/vscode-mssql/blob/main/LICENSE.txt). Please see the [third-party notices](https://github.com/Microsoft/vscode-mssql/blob/main/ThirdPartyNotices.txt) file for additional copyright notices and license terms applicable to portions of the software.
