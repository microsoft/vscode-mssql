# Default Connection Name Feature

## Overview

This feature allows you to configure a default connection that will be automatically used when executing queries in files that are not currently connected to a database server. This eliminates the need to manually select a connection every time you want to run a query.

## Configuration

### Setting up the default connection

1. First, create and save a connection profile in VS Code using the MSSQL extension as you normally would
2. Note the name you give to the connection profile
3. Add the following configuration to your workspace's `.vscode/settings.json` file:

```json
{
    "mssql.defaultConnectionName": "YourConnectionProfileName"
}
```

Replace `"YourConnectionProfileName"` with the exact name of your saved connection profile.

### Example Configuration

If you have a connection profile named "Development Server", your `.vscode/settings.json` should include:

```json
{
    "mssql.defaultConnectionName": "Development Server"
}
```

## How it works

1. When you try to execute a query (using F5 or the "Execute Query" command) without an active database connection
2. The extension will first check for the `mssql.defaultConnectionName` configuration in your workspace
3. If a default connection name is configured, it will try to find and connect to that saved connection profile
4. If the default connection is found and the connection succeeds, your query will execute
5. If no default connection is configured or the connection fails, the extension will prompt you to select a connection as usual

## Benefits

- **Faster workflow**: No need to manually select connections for each new file
- **Project-specific**: Each workspace can have its own default connection
- **Fallback behavior**: If the default connection fails, you still get the normal connection prompt
- **Non-intrusive**: Existing workflows continue to work unchanged

## Workspace-specific Configuration

Since the configuration uses `"scope": "resource"`, you can set different default connections for different workspaces by adding the setting to each workspace's `.vscode/settings.json` file.

This is particularly useful when working on multiple projects that connect to different databases.
