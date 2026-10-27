# Developer Guide

## Prerequisites

- Node.js `>= 24`
- npm `>= 11`
- VS Code `>= 1.98.0`

## Build and Test

Run MSSQL extension development commands from the repository root:

```bash
npm install
npm run build -- --target mssql
npm run build -- --target mssql --prod
npm run watch -- --target mssql
npm run lint -- --target mssql
npm run test -- --target mssql
npm run test -- --target mssql [--reporter spec] # uses a failure-only reporter by default; add "--reporter spec" to show full output
npm run smoketest -- --target mssql
npm run package -- --target mssql --online
npm run package -- --target mssql --offline
```

See the [root README](../../README.md) for shared monorepo commands and other workspace targets.

## Local-to-Cloud Deployment Wizard

Enable `mssql.preview.azureSqlContainers`, then open **MS SQL: New Deployment** >
**Create an Azure SQL Database** > **Deploy a local database**.
The Source page lists saved, recent, and active connections to localhost or loopback addresses
that specify a database. Cards show the database name above the connection name and server address;
server-level connections without a selected database are excluded.
Search matches the database, connection profile name, or server; refresh reloads connections.
The list is virtualized and supports Arrow Up/Down and Home/End navigation.
Selecting a database opens its connection details and schema/data options; **Change** returns to
the search results. Selecting a disconnected database connects using its saved profile and retrieves
the SQL Server version; an existing active connection is reused. Failed attempts show an unavailable
version and a red **Not connected** status. SQL Server versions display the release year extracted
from `SELECT @@VERSION AS version;` (for example, 2025). Azure SQL Database containers (engine
edition ID `-978196525`) display **SQL Azure** and retain their reported build version.
The wizard header and step indicator remain visible while the content scrolls.
Source, Compatibility, Azure, Review, and Deploy are implemented. Continue opens Compatibility after the selected source
connects successfully. The check extracts schema scripts into an extension-owned temporary
SDK-style SQL project, builds it against `SqlAzureV12`, and displays real errors, warnings, and
model-object counts. It requires .NET SDK 8 or later and may restore Microsoft.Build.Sql from NuGet.
The loading card follows backend progress through schema capture, Azure-targeted build/validation,
and package verification; completed steps show checkmarks and pending steps remain dimmed.
Passed and warning results offer a **Show/Hide validation details** link. The separate neutral
details card shows the source, actual DACPAC filename, Azure SQL target, object count, reference
status, and **Open output**. The final **SQL Code Analysis** row summarizes the compatibility result
as **Compatible** or the actual warning count; it does not run a separate SQL code-analysis pass.
The details card has a subtly contrasting neutral background.
Passed, warning, and details cards use a compact 640px maximum width
and 16px padding. The database name in result descriptions uses the SQL editor font.
Warning cards show the actual warning count and diagnostics immediately in a yellow-tinted,
virtualized table with warning code, warning text, issue, and source file/line columns.
Like the error table, it supports column resizing/reordering and bounded internal scrolling.
Both diagnostics tables offer right-click actions to copy a value or selection, copy headers
or values with headers, select all, and export all rows to CSV or JSON through a save dialog.
Copy and export follow the current column order. Ctrl/Cmd+C copies the selection, and Ctrl/Cmd+A
selects the whole table. CSV preserves multiline diagnostics and escapes spreadsheet formulas.
Expanding validation details shows metadata without duplicating the diagnostics.
The retained package is named `<database>.dacpac`, escaping invalid filename characters with the
existing platform filename helper. Filename validation or renaming failures are surfaced as errors.
Blocking results show SQL diagnostics directly in a virtualized, scrollable table with error code,
error text, issue type, and source file/line columns, with actions to open
the shared MSSQL output channel or rerun the check. The compact FluentSlickGrid has an opaque
red-tinted header and rows, resizable/reorderable columns, and internal scrolling without expanding
the card. Error cards use a narrower, compact layout. Short results fit their rows, columns fill
unused width, and the table stays beneath the sticky wizard header when the page scrolls.
Column widths are managed without SlickGrid's automatic
column fitting so scrollbar and height changes do not resize columns again.
Compatibility does not create a separate
output channel. Its extraction creates no Tasks-panel entry or completion toast.
Back, retry, cancellation, and closing the wizard invalidate or clean up the appropriate artifacts.
The successful schema package is retained only while its validation remains current.
Passed and warning results enable **Continue to Azure**, which opens the same form as the free
Azure SQL Database deployment flow, including advanced options and tags. Opening it initializes
the Azure form and loads its selectors; it does not start deployment.
Previous returns to Compatibility without rerunning validation or discarding its retained package.
Reopening the Azure step preserves form values and tags.
The Azure form's **Next** opens Review after the same required-field/authentication and duplicate-tag
checks used by the free database wizard. Review shows the real source/target names, deployment
content, validated object count, compatibility warnings, free-limit behavior, and Azure destination.
**View object list** opens a searchable, virtualized list of names from the validated DACPAC model.
No row-count or data-size estimates are currently collected or fabricated.
Previous returns to the Azure form without losing its settings, tags, or validation.
**Create and Deploy** provisions a new free-offer database on the selected existing logical server.
Schema-only publishes a private copy of the exact validated DACPAC. Schema and data exports a
BACPAC and imports it into the newly created, empty database, without publishing schema first.
Review has no data-export notice, acknowledgment checkbox, or additional deployment gate.
Export is not live replication; matching row counts do not prove transactional
consistency if writes continue. Sources using more than 32 GB of data-file space are rejected.
Deploy uses real operation stages, verifies named schema objects and (for data migration) exact
table row counts, then saves and connects the target profile. Success appears only after these finish.
Existing target databases and nonempty targets are rejected. No logical server is created in Deploy.
After success, **Copy connection string** copies a password-free connection string and **Open in
Azure portal** opens the deployed database in the configured Azure cloud. **Download deployment
scripts** previews ARM, Bicep, or Terraform templates and offers download or save-to-workspace.
Templates use the captured deployment settings and existing server, including region and tags;
they recreate infrastructure only, not schema or data. Terraform uses the AzAPI provider to
preserve the free-offer settings.
Cancellation is cooperative; ARM operations may still complete remotely. Created Azure resources,
including any narrow client-IP firewall rule, are never automatically deleted after cancellation or
failure. Inspect the target and use a new database name before retrying.
Temporary deployment packages are independent of Compatibility cleanup and removed after operations
settle; the original validation package remains available for navigation/retry.
Deploy registers **Deploying \<database\> to Azure** in Background Tasks with real stage updates,
completion/failure status, cancellation, and a link to the MSSQL output. Closing the wizard does
not cancel deployment or remove packages it still needs. Compatibility cleanup waits for the
background deployment to finish. Use **Cancel** in the wizard or Background Tasks to stop it;
the extension host must remain running.
See [AzureLocalToCloud.md](AzureLocalToCloud.md) for the endpoint inventory and limits.

The focused compatibility tests include an opt-in real SQL project build. From this extension's
directory, with the .NET SDK installed, run:

```powershell
npm run build:extension:emit
$env:MSSQL_COMPATIBILITY_BUILD_INTEGRATION = "1"
npx vscode-test --code-version stable --run out\test\unit\localDatabaseCompatibility.test.js --reporter spec
Remove-Item Env:\MSSQL_COMPATIBILITY_BUILD_INTEGRATION
```

The integration case builds a supported table into an Azure-targeted DACPAC and verifies that
FILESTREAM is rejected with an actual DacFx diagnostic. It does not require an Azure account or
a running SQL Server; extraction/cancellation orchestration is covered by the focused unit cases.
Deployment orchestration, both package modes, verification failures, and cancellation have focused
tests in `test/unit/localDatabaseDeployment.test.ts`. These stub Azure/STS calls and do not constitute
a live Azure deployment test.

Local-to-cloud telemetry uses the `LocalToCloudDeployment` view. It records wizard open/close
and visited steps; compatibility start, stages, outcome, duration, and diagnostic/object counts;
deployment start, stage outcomes/durations, final outcome, and verified object count; and
connection-string copy/portal action outcomes. Cancellation is an outcome, not an error.
Final outcomes include cleanup failures and repeated deployment IDs do not emit duplicate attempts.
Payloads contain only fixed categories, modes, booleans, counts, and timings: no connection,
database, server, Azure resource or account identifiers, tags, paths, SQL, diagnostics, raw error
messages, credentials, or connection strings. Existing telemetry opt-out behavior applies.

## SQL Tools Service (STS)

### Using locally built binaries (for debugging/testing)

For debugging or testing local changes it is easiest to use a locally built version of STS. There are two primary ways to accomplish this

- Use the `MSSQL_SQLTOOLSSERVICE` environment variable to direct the extension to use a custom version of STS
- Copy over the binaries manually into the installed STS location

Both of these require a few common initial steps. Note that these steps are all for the [Microsoft.SqlTools.ServiceLayer](https://github.com/microsoft/sqltoolsservice/tree/main/src/Microsoft.SqlTools.ServiceLayer) project, which is where much of the STS logic is put. There are additional projects though such as [Microsoft.SqlTools.Credentials](https://github.com/microsoft/sqltoolsservice/tree/main/src/Microsoft.SqlTools.Credentials) and [Microsoft.SqlTools.ResourceProvider](https://github.com/microsoft/sqltoolsservice/tree/main/src/Microsoft.SqlTools.ResourceProvider). To replace those just follow the same steps but do them from those folders instead.

### Common Initial Steps

1. Navigate to `src/Microsoft.SqlTools.ServiceLayer`
2. Run `dotnet build` from the command line (or use the build target in Visual Studio)

This should build the project to a folder similar to `$(Root)/src/Microsoft.SqlTools.ServiceLayer/bin/Debug/$(NetCoreVersion)/build`

#### Using MSSQL_SQLTOOLSSERVICE environment variable

1. In a terminal window set the `MSSQL_SQLTOOLSSERVICE` to the full path of the build folder from the steps above. e.g. using powershell it would look similar to this.

`$ENV:MSSQL_SQLTOOLSSERVICE="C:\src\sqltoolsservice\src\Microsoft.SqlTools.ServiceLayer\bin\Debug\net6.0\build"`

2. From the same terminal window launch VS Code. You can also open up the VSCode-MSSQL folder in VS Code and then use the debug launch targets there to launch the extension as normal if you're also debugging VSCode-MSSQL.

3. VSCode-MSSQL should pop up a notification indicating that it's using a custom path for STS. If this doesn't appear check you have the environment variable spelled correctly and then check the console logs to see if there were issues finding the expected EXEs

- Note that in order to build again (for example if you have a further change you want to test out) you will need to close any running instances of ADS before building - otherwise the files will be locked and unable to be updated.

#### Manually replacing binaries

1. Close down any running instances of VS Code

2. Copy over the files from `src/Microsoft.SqlTools.ServiceLayer/bin/Debug/$(NetCoreVersion)/build` to `$(VSCodeExtPath)/extensions/ms-mssql.mssql-#.##.#\sqltoolsservice\#.#.#-release.###\$(Platform)` and overwrite any existing files. The VSCodeExtPath will either be the source enlistment path or the path to the extensions directory of the installed version of VS Code, e.g. `%USERPROFILE/.vscode`
3. Launch VS Code
4. Open the STS project in VS Code or Visual Studio and :
    - VS Code - Click the debug button and press `.NET Core Attach`. Search for `MicrosoftSqlToolsServiceLayer` using the filter menu and attach to the process
    - Visual Studio - Under the debug menu choose `Attach to Process`. Search for `MicrosoftSqlToolsServiceLayer` using the filter menu and attach to the process
      and
5. You should now be able to debug STS and set breakpoints as needed
