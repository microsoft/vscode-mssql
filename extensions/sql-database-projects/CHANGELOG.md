# Change Log

## Version 1.7.0

- Release date: August 19, 2026
- Release status: GA

### What's new in 1.7.0

- Added support for using **Move to Schema** on sequences and DML triggers
- Added a **Restore Packages** command to the SQL project context menu for restoring the project's NuGet packages.
- Added support for **Move to Schema** now automatically moves the `.sql` file to the target schema folder.
- Added support for creating SQL objects with the schema corresponding to the selected folder instead of defaulting to `dbo`.
- Added support for custom code analysis rules. Rules contributed by referenced NuGet analyzer packages now appear in the **Code Analysis Settings** dialog alongside the built-in rules.
- Fixed an issue where the **Rename Symbol** feature was incorrectly enabled on SQL alias identifiers (column aliases, table aliases, subquery aliases, and CTE names), which could generate an invalid `.refactorlog` entry.

## Version 1.6.2

- Release date: July 15, 2026
- Release status: GA

### What's new in 1.6.2

- Added **Rename Symbol** refactoring support for SQL project files.
- Added **Move to Schema** refactoring support for SQL project files.
- Adds support for Microsoft.Build.Sql version to 2.2.0.
- Removed the preview feature **"Generate SQL Projects from OpenAPI/Swagger spec"**.
- Fixed an issue where database projects created objects with wrong path delimiter on Linux/macOS.

## Version 1.6.1

- Release date: June 3, 2026
- Release status: GA

### What's new in 1.6.1

- Fixed an issue where SQL Database projects would fail when being built into a dacpac

## Version 1.6.0

- Release date: June 2, 2026
- Release status: GA

### What's new in 1.6.0

- Improved Publish Project dialog performance for faster initial loading, and improved port number validation in Publish Project dialog to correctly show available port.
- Improved SQL project loading performance.
- Added IntelliSense support for SQL projects, including:
    - Go to Definition and Peek Definition for SQL objects across project files
    - Hover information for SQL objects (tables, views, stored procedures, functions, etc.)
    - Code completions for SQL objects within the project
    - Diagnostics (red squiggles) for SQL errors and warnings
    - Cross-file duplicate naming detection

## Version 1.5.9

- Release date: April 22, 2026
- Release status: GA

### What's new in 1.5.9

- Added automatic folder creation (e.g. `dbo/Tables/`) when adding SQL objects to a project. Can be disabled via the `sqlDatabaseProjects.autoCreateFolders` setting.
- Added quick access to the [SQL Database Projects documentation](https://aka.ms/sqlprojects) from the project context menu and panel toolbar.
- Fixed an issue where SQL object templates (table, view, stored procedure) did not reflect the schema specified in the object name.
- Fixed an issue where SQL projects with a missing `ProjectGuid` were silently modified on load with an invalid all-zeros GUID, causing unexpected git dirty state. The extension now prompts the user and generates a valid unique GUID only upon acceptance.

## Version 1.5.8

- Release date: March 18, 2026
- Release status: GA

### What's new in 1.5.8

- Adds support for Microsoft.Build.Sql 2.1.0
- Code Analysis settings dialog is now generally available (GA).
- Added HTTP(S) proxy support for downloading build DLLs, enabling the extension to work in environments behind a corporate proxy

## Version 1.5.7

- Release date: February 27, 2026
- Release status: GA

### What's new in 1.5.7

- Publish dialog is now generally available (GA).
- Added five new SQL object templates: Schema, Table-Valued Function, Trigger, Database Trigger, and Sequence.
- Fixed an issue where the SQL project build task was being created at the project level instead of the workspace level.
- Fixed an issue where system dacpac files were missing from the BuildDirectory, causing build failures for projects with system database references.
- Fixed an issue where adding a DbFabric/FabricDw NuGet package reference through the database reference incorrectly displayed the master system database as msdb.
- Fixed an issue where deleting DbFabric/FabricDw master NuGet package references from the SQL project database references failed.

## Version 1.5.6

- Release date: January 28, 2026
- Release status: GA

### What's new in 1.5.6

- Added a new 'Target platform' selector when creating an Azure SQL database project.
- Added an icon and 'Publish Project' header to the Publish (preview) dialog.
- Added both 'Publish' and 'Publish (Preview)' options to the context menu, allowing users to choose between the classic quickpick flow and the new dialog experience.
- Resolved an issue where SQL project telemetry events were not being captured consistently.
- Fixed a macOS issue where the new Publish (preview) dialog could not locate the DACPAC file.
- Fixed a problem where selecting 'View changes in schema compare' from 'Update project from database' did not automatically launch Schema Compare.
- Resolved a build failure that occurred when the Windows terminal default profile was set to Git Bash.

## Version 1.5.5

- Release date: November 18, 2025
- Release status: GA

### What's new in 1.5.5

- Adds support for targeting SQL Server 2025 in SQL projects.
- Adds support for Microsoft.Build.Sql 2.0.0
- Adds preview support for publishing SQL projects in VS Code with an enhanced publish dialog.
- Fixed excessive build output by removing the verbosity parameter from the dotnet build command, preventing output from exceeding terminal scroll limits.

## Version 1.5.4

- Release date: September 11, 2025
- Release status: GA

### What's new in 1.5.4

- Adds support for updating a SQL project from an existing database with 'Update project from database' option.

## Version 1.5.3

- Release date: June 18, 2025
- Release status: GA

### What's new in 1.5.3

- Adds support for SQL project build as a VS Code task.

## Version 1.5.2

- Release date: May 19, 2025
- Release status: GA

### What's new in 1.5.2

- Fixed an issue where the menu item for creating a project from an OpenAPI definition was appearing in multiple places.

## Version 1.5.1

- Release date: April 30, 2025
- Release status: GA

### What's new in 1.5.1

- Fixed an issue where the license for the extension was not being displayed correctly in the marketplace.
- Fixed an issue where projects created from SQL database in Fabric had the target platform incorrectly configured.

## Version 1.5.0

- Release date: March 31, 2025
- Release status: GA

### What's new in 1.5.0

- Bumped the minimum required version of the .NET SDK to 8.0.0.
- Bumped the axios and @babel/runtime dependencies.
- Fixed download path for Microsoft.Build.Sql binaries to ensure proper installation and compatibility.
- Fixed labels for the container created during deployment of a local development environment with a SQL project.
- Modified the behavior of creating a new SQL project to specify a default SDK version from the extension. [#25797](https://github.com/microsoft/azuredatastudio/issues/25797)
- Updated the label on the `SqlDbFabric` target platform to match the product name "SQL database in Fabric".
- Updated the default Microsoft.Build.Sql version to 1.0.0 for new projects and building original-style projects.

## Version 1.4.6

- Release date: February 21, 2025
- Release status: GA

### What's new in 1.4.6

- Fixed an issue where the SQL Database Projects extension was not correctly uninstalling in VS Code. [#26215](https://github.com/microsoft/vscode-mssql/issues/18822)

## Version 1.4.5

- Release date: December 18, 2024
- Release status: GA

### What's new in 1.4.5

- Fixed an issue where the extension in VS Code was not correctly setting the target platform for SQL projects created from existing databases and defaulted to SQL Server 2022 for all projects.
- Updated the default Microsoft.Build.Sql version to 0.2.5-preview for new projects and building original-style projects.
