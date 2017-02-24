# Change Log

## Version 0.3.0
* Release date: February 24, 2016
* Release status: Public Preview

## What's new in this version
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
* Release date: February 2, 2016
* Release status: Public Preview

## What's new in this version
* HotFix for issue [#669] "Results Panel not Refreshing Automatically". This issue impacts users on VSCode 1.9.0 or greater.

## Version 0.2.0
* Release date: December, 2016
* Release status: Public Preview

## What's new in this version
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

## What's new in this version

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