# Change Log

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