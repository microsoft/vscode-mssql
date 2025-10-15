# Developer Guide

## SQL Tools Service (STS)

### Using locally built binaries (for debugging/testing)

For debugging or testing local changes it is easiest to use a locally built version of STS. There are two primary ways to accomplish this

-   Use the `MSSQL_SQLTOOLSSERVICE` environment variable to direct the extension to use a custom version of STS
-   Copy over the binaries manually into the installed STS location

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

-   Note that in order to build again (for example if you have a further change you want to test out) you will need to close any running instances of ADS before building - otherwise the files will be locked and unable to be updated.

#### Manually replacing binaries

1. Close down any running instances of VS Code

2. Copy over the files from `src/Microsoft.SqlTools.ServiceLayer/bin/Debug/$(NetCoreVersion)/build` to `$(VSCodeExtPath)/extensions/ms-mssql.mssql-#.##.#\sqltoolsservice\#.#.#-release.###\$(Platform)` and overwrite any existing files. The VSCodeExtPath will either be the source enlistment path or the path to the extensions directory of the installed version of VS Code, e.g. `%USERPROFILE/.vscode`
3. Launch VS Code
4. Open the STS project in VS Code or Visual Studio and :
    - VS Code - Click the debug button and press `.NET Core Attach`. Search for `MicrosoftSqlToolsServiceLayer` using the filter menu and attach to the process
    - Visual Studio - Under the debug menu choose `Attach to Process`. Search for `MicrosoftSqlToolsServiceLayer` using the filter menu and attach to the process
      and
5. You should now be able to debug STS and set breakpoints as needed
