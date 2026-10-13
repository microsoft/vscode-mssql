# Connection Sharing Sample Extension

A VS Code extension that demonstrates how to use the **MSSQL extension's authenticated connection-sharing API** to work with SQL Server connections from your own extension.

## How it works

The MSSQL extension registers a VS Code authentication provider. Before your extension uses a connection, it requests a session from that provider. The first time, VS Code asks the user whether to allow your extension, and the user can revoke access later from the **Accounts** menu. Pass the session's access token to every API call.

Access tokens expire an hour after they're issued, so request the session each time your extension uses the API instead of storing the token. Once the user has allowed your extension, VS Code returns a new token without prompting.

```ts
const mssqlExtension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
if (!mssqlExtension) {
    return; // The MSSQL extension isn't installed.
}
const api = (await mssqlExtension.activate()).authenticatedConnectionSharing;

const session = await vscode.authentication.getSession(api.authenticationProviderId, [], {
    createIfNone: true,
});

const connectionId = await api.getActiveEditorConnectionId(session.accessToken);
if (!connectionId) {
    return; // The active editor isn't connected.
}
const connectionUri = await api.connect(session.accessToken, connectionId);
const result = await api.executeSimpleQuery(session.accessToken, connectionUri, "SELECT 1");
await api.disconnect(session.accessToken, connectionUri);
```

Methods that take a connection URI accept only URIs that `connect` returned for the same session. If the user signs out, the connections the session opened are closed and the token stops working; request a new session to continue.

### Using commands

Each method is also available as a command named `mssql.authenticatedConnectionSharing.<method>`, which takes the same arguments, access token first. Commands let you use the API without depending on the MSSQL extension's exports or typings, and calling one activates the MSSQL extension if needed. Request the session from the `mssql-connection-sharing` provider:

```ts
const session = await vscode.authentication.getSession("mssql-connection-sharing", [], {
    createIfNone: true,
});

const connectionId = await vscode.commands.executeCommand<string | undefined>(
    "mssql.authenticatedConnectionSharing.getActiveEditorConnectionId",
    session.accessToken,
);
```

## Migrating from the older API

`IExtension.connectionSharing` and the `mssql.connectionSharing.*` commands are deprecated. They identify the caller by an extension ID that the caller passes in, which the MSSQL extension can't verify. To migrate:

1. Request a session as shown above. Use `{ createIfNone: true }` when the user starts an action, or `{ silent: true }` to check for access without prompting.
2. Replace `connectionSharing` with `authenticatedConnectionSharing`, or the `mssql.connectionSharing.*` commands with `mssql.authenticatedConnectionSharing.*`. The `scriptOperation` command is now `scriptObject`, matching the method.
3. Pass `session.accessToken` where you passed your extension ID, and add it as the first argument to the methods that take a connection URI (`disconnect`, `isConnected`, `executeSimpleQuery`, `getServerInfo`, `listDatabases`, `scriptObject`).
4. `disconnect`, `isConnected`, and `getServerInfo` now return promises.
5. Remove calls to `editConnectionSharingPermissions`. The user manages access from the **Accounts** menu.

## To run

1. Build the MSSQL extension by running from the repository root:

```bash
npm install
npm run watch -- --target mssql
```

2. Install and build this sample by running from `samples/connection-sharing-sample`:

```bash
npm install
npm run compile
```

3. Open the `samples/connection-sharing-sample` folder in VS Code.
4. In the Run and Debug view, select the "Run Extension" configuration. It opens a new VS Code window with both the MSSQL extension and this sample loaded.
5. Connect a query editor to a database, then run **ConnSharing: Connection sharing using APIs** from the Command Palette. The first time, VS Code asks whether to allow the sample to use your SQL Server connections.

## 🆘 Support

If you encounter any issues or have questions, please open issues on Github.
