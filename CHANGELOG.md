# Change Log

## Version 0.1.5
* Release date: Nov 16, 2016
* Release status: Public Preview

## What's new in this version

SQL Tools team is excited to announce that the first public preview release of **mssql** for Visual Studio Code is available in the Visual Studio Code Marketplace. Try it and provide your feedback or report any issue to [GitHub Issue Tracker].

If you are new to VS Code and the mssql extension, see the [getting started tutorial] for step-by-step guides. For more about how-to guides see [the mssql extension wiki].

**Quick summary of the mssql extension features**

* Create and manage your frequent connections to SQL Server, Azure SQL Database and Azure SQL Data Warehouse as a profile. The mssql extension keeps the recent history of your connection activities and save password in a secure store for easy connection experience. Explorer its sub tasks; Create, Edit, Remove and Clear Recent Connections List. See [manage connection profiles] for more details.

* Easy connection experience to SQL Server databases, Azure SQL Database and SQL Data Warehouse.

* Prodcutive TSQL editor features including IntelliSense with suggestions and auto-completion, syntax colorizations and the real-time TSQL error checks and reporting.

* TSQL script execution and view results in a modern look and feel and functionality. Try out the new experience to view the query results in slick grids and messages.

* Save the query result in CSV and JSON.

* Customize shortcuts, color themes and options to meet your preference.

* Open Source Project under MIT license. Go check out how to [contribute].

## Upcoming changes and features

* Top customer reported issues in [GitHub Issue Tracker].

* Faster performance: Progressive query result. As soon as the SQL Server returns the first set of result, the mssql extension will start rendering.

* Devlivery of more TSQL editor features. For example Go To Definition and Find All References.

* More bugs fixes and fine tuning of features.

## Fixed Issues

Report issues to [Github Issue Tracker] and provie your feedback.

## Known Issues

* An mssql extension process may crash due to a bug in the prodcut. It requires to restart VS Code to recover. Before restarting VS Code, save your files.

* There are some DotNet Core dependencies on macOS and older version of Windows that requires user to install pre-requisites. See [OpenSSL requirement on macOS] and [Windows 10 Universal C Runtime requirement] for Windows 8.1, Windows Server 2012 or lower.

[getting started tutorial]:https://aka.ms/mssql-getting-started
[the mssql extension wiki]:https://github.com/Microsoft/vscode-mssql/wiki
[contribute]:https://github.com/Microsoft/vscode-mssql/wiki/contributing
[GitHub Issue Tracker]:https://github.com/Microsoft/vscode-mssql/issues
[manage connection profiles]:https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles