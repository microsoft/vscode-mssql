# Change Log

## Version 1.35.0
* Release date: August 20, 2025
* Release status: GA
### What’s new in 1.35.0
* Released general availability of Schema Designer, Schema Compare, and Local SQL Server Container
* Fixed an issue where Microsoft Entra ID sign-in in the Connection Dialog could result in empty account or tenant dropdowns
* Improved performance and usability of query results grid, including fixes for export and display bugs
* Improved localization in Object Explorer and other UI components
* Fixed multiple accessibility issues affecting error messages and visual feedback across the UI
* Fixed edge case issues where GitHub Copilot Agent responses could misbehave when switching database connections

## Version 1.34.1
* Release date: August 13, 2025
* Release status: GA
### What’s new in 1.34.1
* Fixed bug in GitHub Copilot Ask Mode related to explicit GPT-4o model selection
* Fixed bug in Local Container Deployment where Apple Silicon Mac users may be unable to pull SQL Server images

## Version 1.34.0
* Release date: July 23, 2025
* Release status: GA
### What’s new in 1.34.0
* Expanded GitHub Copilot Agent Mode to support running T-SQL queries, listing database objects, switching databases, and retrieving connection details
* Fixed GitHub Copilot chat participant repeating previous prompts when switching database connections
* Added connection group support to Local SQL Server container wizard
* Fixed missing key icons for foreign keys and improved filter behavior to reflect table relationships in Schema Designer
* Enhanced connection status bar with optional group-based coloring and configurable length — Thanks to @bathetrade for the configurable length contribution!
* Added connection-sharing permissions API for other VS Code extensions that wish to use MSSQL connections
* Added support for multiple Azure account sign-in to browsing Azure and firewall rule management dialogs
* Fixed an issue where Always Encrypted columns protected by AKV-based master keys could not be queried
* Fixed several accessibility issues in the connection dialog, schema designer, and schema compare features

## Version 1.33.0
* Release date: June 18, 2025
* Release status: GA
### What’s new in 1.33.0
* Introduced Local SQL Server Containers (Public Preview) for local development — spin up SQL Server containers in seconds inside VS Code with SQL Server 2025 by default, no Docker commands needed
* Introduced GitHub Copilot Agent Mode (Public Preview) to connect, disconnect, or switch databases, and explore and visualize schemas with smart, context-aware suggestions
* Added Connection Groups for organized connection management — group local, staging, and production connections for clearer structure and faster switching
* Fixed query execution issues with GitHub Copilot
* Improved connection pooling behavior for serverless databases
* Fixed JSON export handling for decimal values in Query Results
* Fixed Schema Compare dropdown selection
* Enhanced Schema Designer usability — faster loading, better filters, improved auto-arrange, clearer export options, and UI refinements

## Version 1.32.1
* Release date: June 2, 2025
* Release status: GA
### What's new in 1.32.1
* Fixed an issue where Group By Schema was not working in some cases
* Added server connection status labels to MSSQL integration with GitHub Copilot

## Version 1.32.0
* Release date: May 19, 2025
* Release status: GA
### What’s new in 1.32.0
* Released general availability of the modern UI—new Connection dialog, Object Explorer filtering, Table Designer, Query Results pane, and Query Plan Visualizer
* Introduced GitHub Copilot integration (Preview) for AI‑powered SQL assistance—generate T‑SQL and ORM code, explore schemas, optimize queries, and streamline database development workflows
* Introduced Schema Designer (Preview) for visual database schema modeling and editing—code‑free
* Added vector datatype support in Object Explorer, scripting operations, and Table Designer
* Fixed Schema Compare (Preview) issues related to comparison and scripting
* Improved connection reliability by resolving login failure errors and VPN-related hangs
* Enhanced Query Results stability by fixing white screen when moving panels and results disappearing on save
* Fixed Object Explorer scripting errors in various scenarios

## Version 1.31.1
* Release date: May 2, 2025
* Release status: GA
### What’s new in 1.31.1
* Resolved an issue related to tokens with local logging in some instances

## Version 1.31.0
* Release date: April 30, 2025
* Release status: GA
### What’s new in 1.31.0
* Introduced Schema Compare (Preview) to visually compare and script out schema differences
* Enhanced Query Results experience with live execution timing summary metrics and stability improvements on large result sets
* Improved connection workflow with smarter retries streamlined error handling and seamless AAD sign-in support
* Resolved Fabric SQL Database connectivity issues for more reliable cloud access
* UI/UX enhancements including removal of duplicate saved connections and elimination of console errors in the results pane

## Version 1.30.0
* Release date: March 31, 2025
* Release status: GA
### What’s new in 1.30.0
* Enabled new UI enhancements by default for improved development experience
* Improved reliability in Connection Dialog and Connections view
* Enhanced usability in Query Results pane
* Fixed Azure subscription loading issues
* Accessibility improvements across the extension

## Version 1.29.1
* Release date: March 12, 2025
* Release status: GA
### What's new in 1.29.1
* Resolved an issue in the Azure Browse feature where subscriptions failed to load due to an outdated dependency

## Version 1.29.0
* Release date: February 26, 2025
* Release status: GA
### What's new in 1.29.0
* Fixed support for Always Encrypted - Secure Enclaves in the Connection Dialog
* Removed SQL editor actions from Git diff editor to improve usability
* Fixed Query Result pane issues related to copying data while sorting and filtering
* Fixed an issue with Query Result pane column filters in multiple result set scenarios where filter settings might get shared between result sets
* Fixed accessibility issues in Query Plan Visualizer
* Fixed indefinite hangs when connecting to paused Azure SQL Database Serverless databases
* Fixed issue where HTTPS-over-HTTP proxies were not getting handled correctly

## Version 1.28.0
* Release date: January 29, 2025
* Release status: GA
### What's new in 1.28.0
* Added support for `mssql.resultsFontSize` and `mssql.resultsFontFamily` in the new query results grid, to enable customization of font size and style.
* Added automatic detection of non T-SQL dialects, and disabling of error detection when found.
* Added auto-resize functionality to the new query results grid, enabling columns to automatically adjust their width based on the data they contain.
* Added support for Edge tables in the new Table Designer
* Fixed usability and accessibility issues in the Connection Dialog, Table Designer, and Query Results Pane.

## Version 1.27.0
* Release date: December 18, 2024
* Release status: GA
### What's new in 1.27.0
* Added the ability to filter query result rows by value
* Added the ability to maximize a specific result set from a query result with multiple sets
* Added a prompt for adding a firewall rule when using the new Connection Dialog to connect to an Azure SQL Database logical server
* Fixed usability bugs encountered when viewing query plans
* Improved performance when resizing the new query results pane with many result sets
* Fixed several bugs related to the query result message display

## Version 1.26.0
* Release date: November 20, 2024
* Release status: GA
### What's new in 1.26.0
* Added the ability to open query results in a tab for the new UI, replicating the functionality of the previous query results experience.
* Added the `mssql.openQueryResultsInTabByDefault` setting, allowing users to set this behavior as the default (applicable only when `mssql.enableRichExperiences` is enabled).
* Added ability to view the actual query plan for executed queries in the new UI.
* Added support for Visual Studio Code theming in the new UI.

## Version 1.25.0
* Release date: October 23, 2024
* Release status: GA
### What's new in 1.25.0
* Added `mssql.enableRichExperiences` setting to enable modern experiences (public preview), including a connection dialog, table designer, new query results pane, query plan viewing, and object explorer filtering.  [Learn more](https://github.com/microsoft/vscode-mssql/blob/main/FEATURES.md#modern-features-in-mssql-for-visual-studio-code)
* Added multiple result set support in new query results pane
* Added browsing your Azure subscriptions to connect to a SQL database

## Version 1.24.0
* Release date: September, 4, 2024
* Release status: GA
### What's new in 1.24.0
* Fix [Query messages lost switching tabs](https://github.com/microsoft/azuredatastudio/issues/25525) bug
* Add `mssql.enableExperimentalFeatures` setting to enable early preview connection, query plan, and table design experiences
* Fix several accessibility bugs

## Version 1.23.0
* Release date: July, 31, 2024
* Release status: GA
### What's new in 1.23.0
* update STS dependency to address [Transaction Isolation Level](https://github.com/microsoft/azuredatastudio/issues/25525) bug

## Version 1.22.1
* Release date: January, 10, 2024
* Release status: GA
### What's new in 1.22.1
* update STS dependency to address [CVE-2024-0056](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2024-0056)

## Version 1.22.0
* Release date: November 8, 2023
* Release status: GA
### What's new in 1.22.0
* Azure Active Directory (Azure AD) is renamed to Entra Id - [#17824](https://github.com/microsoft/vscode-mssql/issues/17824)
* Added command for clearing Azure token cache - [#17807](https://github.com/microsoft/vscode-mssql/issues/17807)
* Added support for setting Firewall rule name in firewall rule - [#17803](https://github.com/microsoft/vscode-mssql/issues/17803)
* Removed Azure tenant config filter setting - [#17798](https://github.com/microsoft/vscode-mssql/issues/17798)

* Bug Fixes:
  - Fixed Firewall Rule creation issues when prompted - [#17607](https://github.com/microsoft/vscode-mssql/issues/17607)
  - Fixed proxy error 502 when downloading Sql Tools Service - [#17772](https://github.com/microsoft/vscode-mssql/issues/17772)
  - Fixed an issue where connection profile could not be saved after enabling trust server certificate [#17805](https://github.com/microsoft/vscode-mssql/issues/17805)

## Version 1.21.0
* Release date: September 20, 2023
* Release status: GA
### What's new in 1.21.0
* Enabled connection pooling by default and added command support to clear pooled connections - https://github.com/microsoft/vscode-mssql/pull/17786
* Added setting to configure `maxCharsToStore` to allow reading large data strings - https://github.com/microsoft/vscode-mssql/issues/1052
* Bug Fixes
  - Fixed status bar to show correct 'Encryption' option for connection - https://github.com/microsoft/vscode-mssql/issues/17671

## Version 1.20.1
* Release date: August 7, 2023
* Release status: GA
### What's new in 1.20.1
* Fixed an issue with not being able to download the SQL Tools Service Component in a proxy-enabled environment (https://github.com/microsoft/vscode-mssql/issues/17755)

## Version 1.20.0
* Release date: July 26, 2023
* Release status: GA
### What's new in 1.20.0
* Added new setting to support enabling connection pooling for performance improvement -  https://github.com/microsoft/vscode-mssql/pull/17733
* Bug Fixes:
  - Fixed issue where creating connection with connection string would fail -  https://github.com/microsoft/vscode-mssql/pull/17737
  - Fixed issue where Copy actions wouldn't work on Data Grid cells -  https://github.com/microsoft/vscode-mssql/pull/17722
  - Added missing DB Create syntax keyword colorization -  https://github.com/microsoft/vscode-mssql/pull/17732
  - Improved connection description when selecting connection from quick pick -  https://github.com/microsoft/vscode-mssql/pull/17737
  - Fixed authentication issue where user account could not be found in MSAL Cache in Linux - https://github.com/microsoft/vscode-mssql/pull/17747

## Version 1.19.1
* Release date: June 5, 2023
* Release status: GA
### What's new in 1.19.1
* Performance improvement in Query Editor language service by enabling connection pooling (https://github.com/microsoft/azuredatastudio/issues/22970)
* Fixed an issue where hyphenated user accounts failed to login to Azure SQL Server (https://github.com/microsoft/azuredatastudio/issues/23210)

## Version 1.19.0
* Release date: May 24, 2023
* Release status: GA
### What's new in 1.19.0
* Added support for Linux ARM64 runtime - https://github.com/microsoft/vscode-mssql/pull/17639
* Use preferred username instead of email for Azure accounts - https://github.com/microsoft/vscode-mssql/pull/17606
* Removed prompt to select tenant when SQL Auth Provider is enabled - https://github.com/microsoft/vscode-mssql/pull/17611
* Updated msal-node npm package to v1.16.0 - https://github.com/microsoft/vscode-mssql/pull/17605
* Bug Fixes
  - Added validation for servername before attempting connection https://github.com/microsoft/vscode-mssql/pull/17680
  - Fixed an issue when selecting "Add Azure Account" during profile creation prompts for profile name first https://github.com/microsoft/vscode-mssql/pull/17664
  - Fixed a bug where SQLCMD variables weren't getting JSONified https://github.com/microsoft/vscode-mssql/pull/17683

## Version 1.18.0
* Release date: March 22, 2023
* Release status: GA

### What's new in 1.18.0
* Upgraded AAD Azure account management to support MSAL authentication.
* Added native MacOS and Windows arm64 support - https://github.com/microsoft/vscode-mssql/issues/17614
* Added "Group by Schema" to Object Explorer - https://github.com/microsoft/vscode-mssql/pull/17543
* Add Object Explorer connection timeout setting - https://github.com/microsoft/vscode-mssql/pull/17548
* Accessibility Fixes
	- Screen Reader is not reading the full information related to the database name - https://github.com/microsoft/vscode-mssql/issues/17204
	- After pressing tab key from "More actions" keyboard focus is going to bottom status bar instead of going to the "messages" dropdown - https://github.com/microsoft/vscode-mssql/issues/17192
  - Message window does not expand and collapse with the help of keyboard and shortcut key - https://github.com/microsoft/vscode-mssql/issues/1687

## Version 1.17.0
* Release date: January 25, 2023
* Release status: GA

### What's new in 1.17.0
* BREAKING CHANGE - Connection Encryption is now Enabled by Default - https://github.com/microsoft/vscode-mssql/pull/17484
	- Moving to Microsoft.Data.SqlClient 5.0.1 dependency with STS Update
	- By default, saved connection profiles will connect with encryption and only accept trusted server certificates. This is a breaking change for some connections and some saved connection profiles may require updates to connect.
	- See https://aka.ms/vscodemssql-connection for more information.
* Introduced [HostNameInCertificate](https://learn.microsoft.com/dotnet/api/microsoft.data.sqlclient.sqlconnectionstringbuilder.hostnameincertificate#microsoft-data-sqlclient-sqlconnectionstringbuilder-hostnameincertificate) Connection Property.
* Exposed getServerInfo API to allow Target Platform to be set automatically when creating SQL Projects from database
	- https://github.com/microsoft/azuredatastudio/issues/20363
	- https://github.com/microsoft/azuredatastudio/issues/20576
* Accessibility Fixes
	- Fixed Screen Reader not reading status of "loading query" - https://github.com/microsoft/vscode-mssql/issues/17451
	- Fixed Screen Reader to announce messages table in a clearer manner - https://github.com/microsoft/vscode-mssql/issues/17450
	- Fixed issue where Results Table was not minimizable with keyboard - https://github.com/microsoft/vscode-mssql/issues/17452

### SQL Grammar Fixes & Updates
* Fix function syntax highlighting including non-function keywords https://github.com/microsoft/vscode-mssql/pull/17462
* Match "other" keywords last - https://github.com/microsoft/vscode-mssql/pull/17464
* Syntax Update (Mostly from SQL 2022) - https://github.com/microsoft/vscode-mssql/pull/17465
* Add SELECT ALL and FULL/NATURAL JOIN syntax to grammar - https://github.com/microsoft/vscode-mssql/pull/17508
	- Special thank you to https://github.com/hanohrs for their help with this!

## Version 1.16.0
* Release date: August 24, 2022
* Release status: GA

### What's new in 1.16.0
* Added support for creating Azure Functions with SQL Bindings from Views in the Object Explorer
* Fixed issues with Integrated authentication in Unix environments https://github.com/microsoft/vscode-mssql/issues/17333

## Version 1.15.0
* Release date: June 15, 2022
* Release status: GA

### What's new in 1.15.0
* Add support for dependent extensions
* [Fixed issues](https://github.com/microsoft/vscode-mssql/milestone/22?closed=1)

## Version 1.14.2
* Release date: May 20, 2022
* Release status: GA

### What's new in 1.14.2
* Adds extension APIs for managing Azure resources

## Version 1.14.1
* Release date: April 22, 2022
* Release status: GA

### What's new in 1.14.1
* Fix regression in Object Explorer that causes timeouts expanding the Tables folder. https://github.com/microsoft/azuredatastudio/issues/19166

## Version 1.14.0
* Release date: April 20, 2022
* Release status: GA

### What's new in 1.14.0
* All SQL bindings functionality released in 1.13 moved to SQL bindings extension in extension pack
* Fixed connection string generated for SQL bindings on connection to `<default>` database. https://github.com/microsoft/vscode-mssql/issues/17267
* Fixed error with heirarchyID data type in results pane. https://github.com/microsoft/sqltoolsservice/pull/1450

## Version 1.13.0
* Release date: February 24, 2022
* Release status: GA

### What's new in 1.13.0
* Adds context menu item for object explorer table nodes to create an Azure Function with SQL binding for that table
* Updated SqlParser to fix some intellisense issues
* Fixed decimal datatype handling https://github.com/microsoft/azuredatastudio/issues/275
* Fixed BatchParser execution error caused by missing resource files https://github.com/microsoft/vscode-mssql/issues/17221

## Version 1.12.0
* Release date: December 15, 2021
* Release status: GA

### What's new in 1.12.0
* Fix AAD token refresh bugs
* Fix Azure SQL DB connectivity bug
* Add support for SELECT * column expansion
* Add Untrusted Workspace support

## Version 1.11.1
* Release date: November 17, 2021
* Release status: GA

### What's new in 1.11.1
* Hotfix for credential keychain prompt on VS Code startup https://github.com/microsoft/vscode-mssql/issues/17064

## Version 1.11.0
* Release date: October 27, 2021
* Release status: GA

### What's new in 1.11.0
* SQL Project and Workspace preview extension pack
* Support Apple M1 with Rosetta2 enabled
* Fixed bugs in Azure Active Directory authentication
* Add support to script triggers
* Additional SQL query execution settings
* Colorization improvements

## Version 1.10.1
* Release date: January 20, 2021
* Release status: GA

### What's new in 1.10.1
* Fixed bug in AAD support causing Integrated Auth connections to fail

## Version 1.10.0
* Release date: December 10, 2020
* Release status: GA

### What's new in 1.10.0
* Azure Active Directory authentication support
* Accessibility improvements
* Fixes in SQL syntax colorization with comments
* Added new functions/keywords to SQL syntax highlighting
* Fixed keyboard shortcuts for results

### Contributions and "thank you"
* [@asottile](https://github.com/asottile) for `make SQL plist parseable xml (#1660)`
* [@KamasamaK](https://github.com/KamasamaK) for `Allow multiple whitespace between keywords (#1683)`
* [@sharechiwai ](https://github.com/sharechiwai) for `fixed README.md version 1.9.0 release date typo (#1757)`
* [@SJMakin](https://github.com/SJMakin ) for `Ammend sql.configuration.json to address syntax highlighting issue fo…`

## Version 1.9.0
* Release date: March 5, 2020
* Release status: GA

### What's new in 1.9.0
* Added new Query History feature
* Added Run Query and Cancel Query buttons on the editor
* Added rows affected count to status bar
* Added Object Explorer support for connection string based connections
* Removed redundant MSSQL output channel for logs
* Fixed leading tabs when copying multiple selections
* Fixed styling of NULL cells in query results
* Fixed leading tabs when copying multiple selections
* Fixed resizing messages pane causing double scrollbars to appear
* Fixed errors are not getting cleared when a file is closed

### Contributions and "thank you"
* [@sukano](https://github.com/sukano) for `fix string highlighting containing escaped characters (#1630)`
* [@testingcan](https://github.com/testingcan) for `added create and drop snippets for views (#1215)`

## Version 1.8.0
* Release date: December 16, 2019
* Release status: GA

### What's new in 1.8.0
* Added support for scripting context menu actions on the Object Explorer
* Added support for adding a new firewall rule to a server
* Added differentiation between database connections and server connections
* Reduced extension size from 10 MB to 6MB
* Open pinned doc when starting a new query
* Fixed scrolling and heights for multiple result sets
* Fixed bug to use the correct database for new query from Object Explorer

### Contributions and "thank you"
We would like to thank all our users who raised issues.

## Version 1.7.1
* Release date: November 11, 2019
* Release status: GA

### What's new in 1.7.1
* Fix missing row count and dropped Object Explorer connections bugs

## Version 1.7.0
* Release date: October 17, 2019
* Release status: GA

### What's new in 1.7.0
* Announcing IntelliCode support
* SQL Server Connections viewlet
* Added support for SQLCMD Mode
* Updated SqlClient driver
* Users can adjust size of SQL results window
* Users can navigate with keyboard away from SQL results screen
* Fixed copy paste with keyboard shortcut
* Added Copy Header option to results grid
* Fix "Save as CSV" exception

### Contributions and "thank you"
We would like to thank all our users who raised issues.

## Version 1.6.0
* Release date: April 22, 2019
* Release status: GA

### What's new in 1.6.0
* Extension install no longer requires reloading VS Code
* Update Query Results Webview API calls for compatibility with VS Code May release
* Fix "Save as CSV" exception

### Contributions and "thank you"
We would like to thank all our users who raised issues.

## Version 1.5.0
* Release date: March 22, 2019
* Release status: GA

### What's new in 1.5.0

* Update vscode-languageclient to fix issue [#1194 Refresh Intellisence cache option don't work](https://github.com/Microsoft/vscode-mssql/issues/1194)
* Import CSV export options such as setting delimiter, line separator, encoding and include headers
* Add missing SQL keywords to colorization list
* Fix Peek Definition\Go to Definition bug on SQL Server 2017

### Contributions and "thank you"
We would like to thank all our users who raised issues, and in particular the following users who helped contribute features or localization of the tool:

* [@praveenpi ](https://github.com/praveenpi) for `updated sql2016-crud-demo (#1156)`
* [@benrr101](https://github.com/benrr101) for `Fix for #1178 by replacing all whitespace with non-breaking spaces. (#1181)`
* [@eashi](https://github.com/eashi) for `Use correct tag for gulp package (#1154)`
* [@shaun-hume](https://github.com/shaun-hume) for `Fix spelling errors in README.md (#1148)`
* [@bruce-dunwiddie ](https://github.com/bruce-dunwiddie) for `Fixed typo on serverproperty. (#1147)`
* [@franciscocpg ](https://github.com/franciscocpg) for `Adding support for antergos platform (#1144)`
* [@SebastianPfliegel](https://github.com/SebastianPfliegel) for `Added more saveAsCsv options (#1128)`
* [@mattmc3](https://github.com/mattmc3) for `Add missing keywords (#1133)`
* [@ChiragRupani](https://github.com/ChiragRupani) for `Added support for specifying delimiter while exporting query results as CSV (#1120)`
* [@zackschuster](https://github.com/zackschuster) for `fix typo in CHANGELOG.md (#1119)`

## Version 1.4.0
* Release date: June 28, 2018
* Release status: GA

### What's new in 1.4.0
* Updated to .NET Core 2.1 to address [issues where some Mac users encountered connection errors](https://github.com/Microsoft/vscode-mssql/issues/1090)
* Added support for Deepin Linux
* Updated query results display to use VS Code's new webview API
* Added a new experimental setting "mssql.persistQueryResultTabs" which when set to true will save your scroll position and active selection when switching between query result tabs
  * Note that this option is false by default because it [may cause high memory usage](https://code.visualstudio.com/docs/extensions/webview#_retaincontextwhenhidden).
  * If you use this option and have feedback on it please share it on our [GitHub page](https://github.com/Microsoft/vscode-mssql/issues/916).

### Contributions and "thank you"
We would like to thank all our users who raised issues, and in particular the following users who helped contribute features or localization of the tool:
* [@ChristianGrimberg](https://github.com/ChristianGrimberg) for adding support for Deepin Linux
* [@nschonni](https://github.com/nschonni) for closing issue [#704](https://github.com/Microsoft/vscode-mssql/issues/704) by adding a new TSQL formatter issue template
* We would like to thank everyone who contributed to localization for this update and encourage more people to join our [open source community localization effort](https://github.com/Microsoft/Localization/wiki).

## Version 1.3.1
* Release date: April 10, 2018
* Release status: GA

### What's new in this version
* Fixed issue [#1036](https://github.com/Microsoft/vscode-mssql/issues/1036) where copy/pasting Unicode text can fail on Mac depending on the active locale environment variable
* Fixed issue [#1066](https://github.com/Microsoft/vscode-mssql/issues/1066) RAND() function using GO N produces the same result
* Syntax highlighting more closely matches SSMS for local variables, global system varaibles, unicode string literals, bracketed identifiers, and built in functions
* Show all error messages instead of just the first one when query execution results in multiple errors

### Contributions and "thank you"
We would like to thank all our users who raised issues, and in particular the following users who helped contribute features or localization of the tool:
* [@rhires](https://github.com/rhires) for updating and editing the Kerberos help documentation
* [@zackschuster](https://github.com/zackschuster) for cleaning up the VS Code API wrapper to remove a deprecated function call
* We would like to thank everyone who contributed to localization for this update and encourage more people to join our [open source community localization effort](https://github.com/Microsoft/Localization/wiki).

## Version 1.3.0
* Release date: December 11, 2017
* Release status: GA

### What's new in this version
* Fixed an issue where peek definition and go to definition failed for stored procedures.
* Improved performance for peek definition and go to definition.
* Added support for `GO N` syntax.
* Fixed issue [#1025](https://github.com/Microsoft/vscode-mssql/issues/1025) where query execution would fail when executing from file paths containing special characters
* Fixed issue [#785](https://github.com/Microsoft/vscode-mssql/issues/785) Inactive connection can't reconnect with out VS Code restart
* A community-contributed fix for snippets that failed on databases with case-sensitive collations.

### Contributions and "thank you"
* Thank you to Stefán Jökull Sigurðarson for contributing the fix for snippets that failed with case-sensitive collations, which was ported here from the SQL Operations Studio repository.
* We would like to thank everyone who contributed to localization for this update and encourage more people to join our [open source community localization effort](https://github.com/Microsoft/Localization/wiki).

## Version 1.2.1
* Release date: November 8, 2017
* Release status: GA

### What's new in this version
* Support for multi-root workspaces in preparation for the feature's release in Visual Studio Code. When running with multi-root workspaces, users will be able to set many configuration options at the folder level, including connection configurations.
* Exporting results as CSV, JSON, or Excel files now shows the operating system's save-as dialog instead of using text-based dialogs to name the saved file.
* Fixed issue [#998](https://github.com/Microsoft/vscode-mssql/issues/998) Intellisense against Azure SQL DBs very inconsistent.


## Version 1.2
* Release date: September 22, 2017
* Release status: GA


### What's new in this version
* Support for macOS High Sierra.
* VSCode-Insiders users will see their connections are now read from and saved to the Insiders settings file instead of the regular Visual Studio Code location. Fixes [#242](https://github.com/Microsoft/vscode-mssql/issues/242).
* Saving connections no longer affects comments in the settings file [#959](https://github.com/Microsoft/vscode-mssql/issues/959).
* Intellisense errors and suggestions can be disabled on a per-file basis [#978](https://github.com/Microsoft/vscode-mssql/issues/978). Use the `MS SQL: Choose SQL Handler for this file` action or click on the `MSSQL` status bar item when a .sql file is open to disable intellisense on that document.
* Fixed issue [#987](https://github.com/Microsoft/vscode-mssql/issues/987) Cannot change password of a saved profile.
* Fixed issue [#924](https://github.com/Microsoft/vscode-mssql/issues/924) Database name with $ is not showing up correctly in database list.
* Fixed issue [#949](https://github.com/Microsoft/vscode-mssql/issues/949) Drop database fails most of the time because the db is in used.
* Fixed issue `MS SQL: Execute Current Statement` where it did not handle 2 statements on a single line correctly.
* Improved support for SQL Server 2017 syntax by refreshing IntelliSense and SMO dependencies.

### Contributions and "thank you"
We would like to thank everyone who contributed to localization for this update and encourage more people to join our [open source community localization effort](https://github.com/Microsoft/Localization/wiki).
mssql for Visual Studio Code was opened for community localization since February 2017 for the following languages French, Italian, German, Spanish, Simplified or Traditional Chinese, Japanese, Korean, Russian, Brazilian Portuguese.
If you see a string untranslated in your language, you can make an impact and help with translation. You can find out how by checking https://aka.ms/crossplattoolsforsqlservercommunitylocalization.


## Version 1.1
* Release date: July 18, 2017
* Release status: GA

### What's new in this version
* Preview support for Integrated Authentication (aka Windows Authentication) on Mac and Linux. To use this you need to create a Kerberos ticket on your Mac or Linux machine - [see this guide](https://aka.ms/vscode-mssql-integratedauth) for the simple process. Once this is set up, you can say goodbye to SQL passwords when connecting to your servers!
  * This feature is in preview in .Net Core 2.0. The [corefx repository](https://github.com/dotnet/corefx) tracks issues related to SqlClient and we recommend issues setting up Kerberos tickets be raised there.
  * macOS "El Capitan" and older versions will not support this feature or any other features requiring a new SqlToolsService version. To benefit from Integrated Authentication, "Execute Current Statement" and other new features we recommend updating to the latest OS version.
* New code snippets:
  * `sqlGetSpaceUsed` shows space used by tables. Thanks to Rodolfo Gaspar for this contribution!
  * `sqlListColumns` shows columns for tables matching a `LIKE` query. Thanks to Emad Alashi for this contribution!
* Support for connecting using a connection string. When adding a connection profile you can now paste in an ADO.Net connection string instead of specifying server name, database name etc. individually. This makes it easy to get strings from the Azure Portal and use them in the tool.
* Support for empty passwords when connecting. Password is no longer required, though still recommended! This is useful in local development scenarios.
* Improved support for SQL Server 2017 syntax by refreshing IntelliSense and SMO dependencies.
* Fixed all code snippets so that tab ordering is improved and snippets no longer have syntax errors
* Fixed issue where snippets were not shown when `mssql.intelliSense.enableIntelliSense` was set to `false`.
* Fixed issue [#911](https://github.com/Microsoft/vscode-mssql/issues/911) where tools service crashed when Perforce source code provider is enabled in the workspace.
* Stability fixes to reduce the likelihood of SqlToolsService crashes.
* Fixed issue [#870](https://github.com/Microsoft/vscode-mssql/issues/870). Added an "Execute Current Statement" command that executes only the SQL statement where the cursor is currently located.
* Fix issue [#939](https://github.com/Microsoft/vscode-mssql/issues/939) "Show execution time for individual batches". To enable open your settings and set `mssql.showBatchTime` to `true`.
* Fix issue [#904](https://github.com/Microsoft/vscode-mssql/issues/904). Added a "Disconnect" option to the status bar server connection shortcut. Clicking on this now lists databases on the current server and a "Disconnect" option.
* Fix issue [#913](https://github.com/Microsoft/vscode-mssql/issues/913). OpenSuse Linux distributions are now supported.

## Version 1.0
* Release date: May 2, 2017
* Release status: GA

### What's new in this version
* We are please to announce the official GA of the MSSQL extension! This release focuses on stability, localization support, and top customer feedback issues
* The MSSQL extension is now localized. Use the `Configure Language` command in VSCode to change to your language of choice. Restart the application and the MSSQL extension will now support your language for all commands and messages.
* Community-added support for `Save as Excel`, which supports saving to .xlsx format and opening this in the default application for .xlsx files on your machine.
* Numerous bug fixes:
  * IntelliSense improvements to support configuration of Intellisense options from user settings, plus keyword fixes.
  * Query Execution fixes and improvements: [#832](https://github.com/Microsoft/vscode-mssql/issues/832), [#815](https://github.com/Microsoft/vscode-mssql/issues/815), [#803](https://github.com/Microsoft/vscode-mssql/issues/803), [#794](https://github.com/Microsoft/vscode-mssql/issues/794), [#772](https://github.com/Microsoft/vscode-mssql/issues/772)
  * Improved support for downloading and installing the tools service behind proxies
  * Improvements to `Go To Definition` / `Peek Definition` support [#769](https://github.com/Microsoft/vscode-mssql/issues/769)


## Contributions and "thank you"
We would like to thank all our users who raised issues, and in particular the following users who helped contribute features or localization of the tool:
* Wujun Zhou, for adding the `Save as Excel` feature
* The many contributors to our community localization. A full list is available on [this TechNet post](https://blogs.technet.microsoft.com/dataplatforminsider/2017/04/13/crossplatform-tools-for-sql-server-opened-for-community-localization/). Particular thanks to Mona Nasr for coordinating our community localization efforts.

## Version 0.3.0
* Release date: March 1, 2017
* Release status: Public Preview

### What's new in this version
* T-SQL formatting support is now included. This is a highly requested feature, and this release includes a basic parser
with configuration options for some of the most common T-SQL formatting styles.
  * To format a .sql file, right-click and choose `Format Document`.
  * To format part of a document, highlight a selection, right-click and choose `Format Selection`
  * To change the formatting settings, hit F1 and choose `Preferences: Open User Settings`. Type in `mssql.format` and
  change any of the options
* `Refresh Intellisense Cache` command added. This will rebuild the intellisense for a connected database to include any recent
schema changes
* `New Query` command added. This opens a new .sql file and connects to a server, making it quicker to get started with your queries
* Fixed support for SQL Data Warehouse connections.
* Prototype localization support added. We will be adding full localization support in a future update.
* Improved Peek Definition support. Multiple bug fixes, and additional supported types.
  * Supported types: Tables, Views, Procedures, User Defined Tables, User Defined Types, Synonyms, Scalar Functions, Table Valued Functions
* Support for Windows x86 machines
* Fix for issue #604 where results that included HTML were not rendered correctly
* Multiple fixes for syntax highlighting
* Fixed issues where query execution failed due to parser failures.

## Version 0.2.1
* Release date: February 2, 2017
* Release status: Public Preview

### What's new in this version
* HotFix for issue [#669] "Results Panel not Refreshing Automatically". This issue impacts users on VSCode 1.9.0 or greater.

## Version 0.2.0
* Release date: December, 2016
* Release status: Public Preview

### What's new in this version
* Peek Definition and Go To Definition support for Tables, Views and Stored Procedures. For a query such as `select * from dbo.Person` you can right-click on `dbo.Person` and see it as a `CREATE TABLE` script.
* Support for additional operating systems including Linux Mint and Elementary OS. See [Operating Systems] for the list of supported OSes.
* Output window now shows status of SQL tools service installation to make it easier to track install-time issues.
* Progressive Result Sets: when running multiple queries at once, you'll now see result sets appear as soon as they are done processing instead of waiting for all queries to complete.
The extension supports result set-level updates with per-row updates coming in a future update.
* Multiple results view improvements: improved keyboard navigation, configuration settings to alter default font style and size, support for copying with column headers.
* Multiple IntelliSense improvements: Support using  `[bracket].[syntax]`, handling of `"` at the end of a word, improved performance when connecting to same DB from a new file.

## Version 0.1.5
* Release date: Nov 16, 2016
* Release status: Public Preview

### What's new in this version

The SQL Tools team is excited to announce that the first public preview release of **mssql** for Visual Studio Code is available in the Visual Studio Code Marketplace. Try it and provide your feedback or report any issue to [GitHub Issue Tracker].

If you are new to VS Code and the mssql extension, see the [getting started tutorial] for step-by-step guides. For more about how-to guides see [the mssql extension wiki].

**Quick summary of the mssql extension features**

This extension makes it easy to connect to, query and modify your SQL Server, Azure SQL Database, and Azure SQL Data Warehouse instances.

* Create and manage your frequent connections to SQL Server, Azure SQL Database and Azure SQL Data Warehouse as a profile. The mssql extension keeps the recent history of your connection activities and saves passwords in a secure store, making connecting to your database easy. Create, Edit, Remove and Clear your recent connections. See [manage connection profiles] for more details.

* Productive T-SQL editor features including IntelliSense with suggestions and auto-completion, syntax highlighting and real-time T-SQL error checks and reporting.

* Execute T-SQL scripts and view results, all with a native Visual Studio Code look and feel. View query results and related messages without needing to tab between them.

* Save query results as CSV or JSON.

* Customize shortcuts, color themes and options to meet your preference.

* This is an open source project under the MIT license. Go check out how to [contribute].

## Upcoming changes and features

* Top customer reported issues in [GitHub Issue Tracker].

* Faster performance: Progressive query results. As soon as SQL Server returns results to the extension these should be shown to the user, even for large queries.

* Delivery of additional T-SQL editor features, for example support for Go To Definition and Find All References.

* More bugs fixes and fine tuning of features.

## Fixed Issues

Report issues to [Github Issue Tracker] and provide your feedback.

## Known Issues

* The mssql extension process may crash due to a bug in the product. It requires to restart VS Code to recover. Before restarting VS Code, please save your files.

* Installation Prerequisites: this extension requires the user to install some components needed by .Net Core applications, since this is used for connectivity to SQL Server.

    * For Mac OS, see [OpenSSL requirement on macOS]

    * For Windows 8.1, Windows Server 2012 or lower, see [Windows 10 Universal C Runtime requirement]

[getting started tutorial]:https://aka.ms/mssql-getting-started
[the mssql extension wiki]:https://github.com/Microsoft/vscode-mssql/wiki
[contribute]:https://github.com/Microsoft/vscode-mssql/wiki/contributing
[GitHub Issue Tracker]:https://github.com/Microsoft/vscode-mssql/issues
[manage connection profiles]:https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles
[OpenSSL requirement on macOS]:https://github.com/Microsoft/vscode-mssql/wiki/OpenSSL-Configuration
[Windows 10 Universal C Runtime requirement]:https://github.com/Microsoft/vscode-mssql/wiki/windows10-universal-c-runtime-requirement
[Operating Systems]:https://github.com/Microsoft/vscode-mssql/wiki/operating-systems
[#669]:https://github.com/Microsoft/vscode-mssql/issues/669
