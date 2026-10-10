# Connection Sharing Sample Extension

A VS Code extension that demonstrates how to use the **MSSQL extension's authenticated connection-sharing API** to work with SQL Server connections from your own extension.

## How it works

The MSSQL extension registers a VS Code authentication provider. Before your extension uses a connection, it requests a session from that provider. The first time, VS Code asks the user whether to allow your extension, and the user can revoke access later from the **Accounts** menu. Pass the session's access token to every API call.

```ts
const mssqlExtension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
const api = (await mssqlExtension.activate()).authenticatedConnectionSharing;

const session = await vscode.authentication.getSession(api.authenticationProviderId, [], {
    createIfNone: true,
});

const connectionId = await api.getActiveEditorConnectionId(session.accessToken);
const connectionUri = await api.connect(session.accessToken, connectionId);
const result = await api.executeSimpleQuery(session.accessToken, connectionUri, "SELECT 1");
await api.disconnect(session.accessToken, connectionUri);
```

Methods that take a connection URI accept only URIs that `connect` returned for the same session. If the user signs out, the connections the session opened are closed and the token stops working; request a new session to continue.

## Migrating from the older API

`IExtension.connectionSharing` and the `mssql.connectionSharing.*` commands are deprecated. They identify the caller by an extension ID that the caller passes in, which the MSSQL extension can't verify. To migrate:

1. Request a session as shown above. Use `{ createIfNone: true }` when the user starts an action, or `{ silent: true }` to check for access without prompting.
2. Replace `connectionSharing` with `authenticatedConnectionSharing`.
3. Pass `session.accessToken` where you passed your extension ID, and add it as the first argument to the methods that take a connection URI (`disconnect`, `isConnected`, `executeSimpleQuery`, `getServerInfo`, `listDatabases`, `scriptObject`).
4. `disconnect`, `isConnected`, and `getServerInfo` now return promises.
5. Remove calls to `editConnectionSharingPermissions`. The user manages access from the **Accounts** menu.

The new API has no command equivalents, because commands can't identify the calling extension.

## To run

1. Compile the mssql extension by running from the repository root:

```bash
npm install
npm run watch -- --target mssql
```

2. Open this sample extension in VS Code
3. In the Run and Debug view, select the "Run Extension" configuration
4. It should launch a new VS Code window with the extension activated

## 🆘 Support

If you encounter any issues or have questions, please open issues on Github.
