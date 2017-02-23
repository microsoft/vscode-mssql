[![Travis CI](https://travis-ci.org/Microsoft/vscode-mssql.svg?branch=dev)](https://travis-ci.org/Microsoft/vscode-mssql)
[![AppVeyor](https://ci.appveyor.com/api/projects/status/github/Microsoft/vscode-mssql?svg=true&retina=true&branch=dev)](https://ci.appveyor.com/project/kburtram/vscode-mssql)
[![Coverage Status](https://coveralls.io/repos/github/Microsoft/vscode-mssql/badge.svg?branch=dev)](https://coveralls.io/github/Microsoft/vscode-mssql?branch=dev)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-blue.svg)](https://gitter.im/Microsoft/mssql)


# mssql for Visual Studio Code

Welcome to **mssql** <sup>preview</sup> for Visual Studio Code! An extension for developing Microsoft SQL Server, Azure SQL Database and SQL Data Warehouse everywhere with a rich set of functionalities, including:

* Connect to Microsoft SQL Server, Azure SQL Database and SQL Data Warehouses.
* Create and manage connection profiles and most recently used connections.
* Write T-SQL script with IntelliSense, Go to Definition, T-SQL snippets, syntax colorizations, T-SQL error validations and ```GO``` batch separator.
* Execute your scripts and view results in a simple to use grid.
* Save the result to json or csv file format and view in the editor.
* Customizable extension options including command shortcuts and more.

See [the mssql extension tutorial] for the step by step guide.

See [the SQL developer tutorial] to develop an app with C#, Java, Node.js, PHP, Python and R with SQL Server databases.

<img src="https://github.com/Microsoft/vscode-mssql/raw/master/images/mssql-demo.gif" alt="demo" style="width:480px;"/>

## What's new in 0.3.0
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

## What's new in 0.2.1
* HotFix for issue [#669] "Results Panel not Refreshing Automatically". This issue impacts users on VSCode 1.9.0 or greater.

## What's new in 0.2.0
* Peek Definition and Go To Definition support for Tables, Views and Stored Procedures.
  * For a query such as `select * from dbo.Person` you can right-click on `Person` and see it as a `CREATE TABLE` script.
  * Note: you must be connected to a database to use this feature.
* Support for additional operating systems including Linux Mint and Elementary OS. See [Operating Systems] for the list of supported OSes.
* Multiple improvements & fixes to the results view, Intellisense handling, and service installation notification.
* Improved logging to the Output window. Errors and status notifications can be viewed in the SqlToolsService or MSSQL channels.
* For a full list see the [change log].

## Using

* First, install [Visual Studio Code] then install **mssql** extension by pressing **F1** or **ctrl+shift+p** to open command palette, select **Install Extension** and type **mssql**.
    * For macOS, you will need to install OpenSSL. Follow the install pre-requisite steps from [DotNet Core instructions].
* Open an existing file with a .sql file extension or open a new text file (**ctrl+n**) and change the language mode to SQL by pressing **ctrl+k,m** and select **SQL**. **mssql** commands and functionalities are enabled in the SQL language mode in Visual Studio Code editor.
* Create a new connection profile using command palette by pressing **F1**, type **sqlman** to run **MS SQL: Manage Connection Profile** command. Select **Create**. See [manage connection profiles] for more information about how to create and edit connection profiles in your User Settings (settings.json) file.
* Connect to a database by pressing **F1** and type **sqlcon** to run **MS SQL: Connnect** command, then select a connection profile. You can also use a shortcut (**ctrl+shift+c**).
* Write T-SQL script in the editor using IntelliSense and Snippets. Type **sql** in the editor to list T-SQL Snippets.
* Execute T-SQL script or selection of statements in the script by pressing **F1** and type **sqlex** to run **MS SQL: Execute Query** command. You can also use a shortcut (**ctrl+shift+e**). See [customize shortcuts] to learn about change shortcut key bindings to **mssql** commands.
* View the T-SQL script execution results and messages in result view.

## Commands
The extension provides several commands in the Command Palette for working with ```.sql``` files:
* **MS SQL: Connect** to SQL Server, Azure SQL Database or SQL Data Warehouse using connection profiles or recent connections.
    * **Create Connection Profile** to create a new connection profile and connect.
* **MS SQL: Disconnect** from SQL Server, Azure SQL Database or SQL Data Warehouse in the editor session.
* **MS SQL: Use Database** to switch the database connection to another database within the same connected server in the editor session.
* **MS SQL: Execute Query** script, T-SQL statements or batches in the editor.
* **MS SQL: Cancel Query** execution in progress in the editor session.
* **MS SQL: Manage Connection Profiles**
    * **Create** a new connection profile using command palette's step-by-step UI guide.
    * **Edit** user settings file (settings.json) in the editor to manually create, edit or remove connection profiles.
    * **Remove** an existing connection profile using command palette's step-by-step UI guide.
    * **Clear Recent Connection List** to clear the history of recent connections.

## Options
The following Visual Studio Code settings are available for the mssql extension. These can be set in user preferences (cmd+,) or workspace settings ```(.vscode/settings.json)```.
See [customize options] and [manage connection profiles] for more details.

```javascript
{
    "mssql.maxRecentConnections": 5,
    "mssql.connections":[],
    "mssql.shortcuts": {
        "event.toggleResultPane": "ctrl+alt+r",
        "event.toggleMessagePane": "ctrl+alt+y",
        "event.prevGrid": "ctrl+up",
        "event.nextGrid": "ctrl+down",
        "event.copySelection": "ctrl+c",
        "event.maximizeGrid": "",
        "event.selectAll": "",
        "event.saveAsJSON": "",
        "event.saveAsCSV": ""
    },
    "mssql.messagesDefaultOpen": true,
    "mssql.logDebugInfo": false,
    "mssql.saveAsCSV.includeHeaders": true,
    "mssql.enableIntelliSense": true,
    "mssql.intelliSense.enableErrorChecking": true,
    "mssql.intelliSense.enableSuggestions": true,
    "mssql.intelliSense.enableQuickInfo": true,
    "mssql.intelliSense.lowerCaseSuggestions": false,
    "mssql.resultsFontFamily": "-apple-system,BlinkMacSystemFont,Segoe WPC,Segoe UI,HelveticaNeue-Light,Ubuntu,Droid Sans,sans-serif",
    "mssql.resultsFontSize": 13,
    "mssql.copyIncludeHeaders": false,
    "mssql.copyRemoveNewLine" : true,
    "mssql.splitPaneSelection": "next",
    "mssql.format.alignColumnDefinitionsInColumns": false,
    "mssql.format.datatypeCasing": "none",
    "mssql.format.keywordCasing": "none",
    "mssql.format.placeCommasBeforeNextStatement": false,
    "mssql.format.placeSelectStatementReferencesOnNewLine": false,
    "mssql.applyLocalization": false,
    "mssql.query.displayBitAsNumber": true
}
```

## Change Log
The current version is ```0.2.0```. See the [change log] for a detailed list of changes in each version.

## Supported Operating Systems

Currently this extension supports the following operatings systems:

* Windows (64-bit only)
* macOS
* Ubuntu 14.04 / Linux Mint 17 / Linux Mint 18 / Elementary OS 0.3
* Ubuntu 16.04 / Elementary OS 0.4
* Debian 8.2
* CentOS 7.1 / Oracle Linux 7
* Red Hat Enterprise Linux (RHEL)
* Fedora 23
* OpenSUSE 13.2

## Offline Installation
The extension will download and install a required SqlToolsService package during activation. For machines with no Internet access, you can still use the extension by choosing the
`Install from VSIX...` option in the Extension view and installing a bundled release from our [Releases](https://github.com/Microsoft/vscode-mssql/releases) page.
Each operating system has a .vsix file with the required service included. Pick the file for your OS, download and install to get started.
We recommend you choose a full release and ignore any alpha or beta releases as these are our daily builds used in testing.

## Support
Support for this extension is provided on our [GitHub Issue Tracker]. You can submit a [bug report], a [feature suggestion] or participate in [discussions].

## Contributing to the Extension
See the [developer documentation] for details on how to contribute to this extension.

## Code of Conduct
This project has adopted the [Microsoft Open Source Code of Conduct]. For more information see the [Code of Conduct FAQ] or contact [opencode@microsoft.com] with any additional questions or comments.

## Privacy Statement
The [Microsoft Enterprise and Developer Privacy Statement] describes the privacy statement of this software.

## License
This extension is [licensed under the MIT License]. Please see the [third-party notices] file for additional copyright notices and license terms applicable to portions of the software.

[the mssql extension tutorial]:https://aka.ms/mssql-getting-started
[the SQL Developer tutorial]: http://aka.ms/sqldev
[Visual Studio Code]: https://code.visualstudio.com/#alt-downloads
[DotNet Core instructions]:https://www.microsoft.com/net/core
[manage connection profiles]:https://github.com/Microsoft/vscode-mssql/wiki/manage-connection-profiles
[customize shortcuts]:https://github.com/Microsoft/vscode-mssql/wiki/customize-shortcuts
[customize options]:https://github.com/Microsoft/vscode-mssql/wiki/customize-options
[change log]: https://github.com/Microsoft/vscode-mssql/blob/master/CHANGELOG.md
[GitHub Issue Tracker]:https://github.com/Microsoft/vscode-mssql/issues
[bug report]:https://github.com/Microsoft/vscode-mssql/issues/new
[feature suggestion]:https://github.com/Microsoft/vscode-mssql/issues/new
[developer documentation]:https://github.com/Microsoft/vscode-mssql/wiki/contributing
[Microsoft Enterprise and Developer Privacy Statement]:https://go.microsoft.com/fwlink/?LinkId=786907&lang=en7
[licensed under the MIT License]: https://github.com/Microsoft/vscode-mssql/blob/master/LICENSE.txt
[third-party notices]: https://github.com/Microsoft/vscode-mssql/blob/master/ThirdPartyNotices.txt
[Microsoft Open Source Code of Conduct]:https://opensource.microsoft.com/codeofconduct/
[Code of Conduct FAQ]:https://opensource.microsoft.com/codeofconduct/faq/
[opencode@microsoft.com]:mailto:opencode@microsoft.com
[#669]:https://github.com/Microsoft/vscode-mssql/issues/669

