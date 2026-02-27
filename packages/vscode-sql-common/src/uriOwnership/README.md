# URI Ownership Coordination

URI ownership coordination enables multiple SQL extensions (MSSQL, PostgreSQL, MySQL, etc.) to coexist in VS Code while only one extension owns and shows query UI for a given SQL file.

## What It Handles

- **URI Ownership Coordination**: Ensures only one extension shows UI elements for a given SQL file
- **Dynamic Extension Discovery**: Extensions discover each other via `package.json` declarations
- **Automatic Conflict Resolution**: When two extensions accidentally connect to the same file, the conflict is resolved automatically

## Usage

### 1. Declare common features in package.json

Add this to your extension's `package.json`:

```json
{
    "displayName": "SQL Server (mssql)",
    "contributes": {
        "vscode-sql-common-features": {
            "uriOwnershipApi": true
        }
    }
}
```

The extension's `displayName` from package.json will be used for user-facing messages.

### 2. Set up the coordinator in your extension

```typescript
import { UriOwnershipCoordinator } from "@microsoft/vscode-sql-common";

// In your activate() function
export function activate(context: vscode.ExtensionContext) {
    const coordinator = new UriOwnershipCoordinator(context, {
        hideUiContextKey: "yourext.hideUIElements",
        ownsUri: (uri) => connectionManager.isConnected(uri) || connectionManager.isConnecting(uri),
        onDidChangeOwnership: connectionManager.onConnectionsChanged,
        releaseUri: (uri) => connectionManager.disconnect(uri),
    });

    // Export the API for other extensions to consume
    return {
        uriOwnershipApi: coordinator.uriOwnershipApi,
    };
}
```

### 3. Use context key in package.json for UI visibility

```json
{
    "contributes": {
        "menus": {
            "editor/title": [
                {
                    "command": "yourext.runQuery",
                    "when": "editorLangId == sql && !yourext.hideUIElements"
                }
            ]
        }
    }
}
```

### 4. Guard commands from running on other extensions' files

```typescript
function runQuery() {
    if (coordinator.isActiveEditorOwnedByOtherExtensionWithWarning()) {
        return; // Another extension owns this file
    }
    // Run your query...
}
```

## API Reference

### UriOwnershipCoordinator

The main class for coordination.

#### Constructor

```typescript
new UriOwnershipCoordinator(context: vscode.ExtensionContext, config: UriOwnershipConfig)
```

#### Methods

- `isOwnedByCoordinatingExtension(uri: vscode.Uri): boolean` - Check if another extension owns a URI
- `getOwningCoordinatingExtension(uri: vscode.Uri): string | undefined` - Get the owning extension ID
- `isActiveEditorOwnedByOtherExtensionWithWarning(): boolean` - Check and show warning if blocked
- `getCoordinatingExtensions(): ReadonlyArray<CoordinatingExtensionInfo>` - List discovered extensions

#### Properties

- `uriOwnershipApi: UriOwnershipApi` - The API to expose to other extensions
- `onCoordinatingOwnershipChanged: vscode.Event<void>` - Event when ownership changes

### UriOwnershipConfig

Configuration passed to the coordinator:

Note: the coordinator automatically uses `context.extension.id` as this extension's ID; it is not passed via config.

If your connection manager isn't available at activation time, you can omit `ownsUri`/`onDidChangeOwnership` in the constructor and call `coordinator.initialize(...)` later.

```typescript
interface UriOwnershipConfig {
    /** Context key to set when another extension owns the active URI */
    hideUiContextKey: string;

    /** Optional localized default warning message factory */
    fileOwnedByOtherExtensionMessage?: (owningExtensionDisplayName: string) => string;

    /** Function to check if your extension owns a URI */
    ownsUri?: (uri: string) => boolean;

    /** Event that fires when your extension's ownership changes */
    onDidChangeOwnership?: vscode.Event<void>;

    /** Optional callback to release/disconnect ownership of a URI */
    releaseUri?: (uri: string) => void | Promise<void>;
}
```

## How It Works

1. **Discovery**: On activation, the coordinator scans all installed extensions for the `vscode-sql-common-features` contribution in their `package.json`.

2. **API Exchange**: The coordinator activates discovered extensions and retrieves their `uriOwnershipApi` from their exports.

3. **Event Listening**: When a coordinating extension's ownership changes, all other extensions are notified via `onCoordinatingOwnershipChanged`.

4. **Context Keys**: Each extension sets a context key (e.g., `mssql.hideUIElements`) based on whether another extension owns the active editor's URI.

5. **Conflict Resolution**: Each extension handles conflict resolution independently by listening to `onCoordinatingOwnershipChanged` and disconnecting if needed.
