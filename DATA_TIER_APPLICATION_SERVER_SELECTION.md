# Data-tier Application: Server Selection Feature

## Overview

This document explains the server selection feature added to the Data-tier Application form, allowing users to select and connect to any available SQL Server connection.

## Problem Statement

Previously, the Data-tier Application form could only be launched from Object Explorer by right-clicking on a database. This meant:

1. Users had to be connected to a server before opening the form
2. Users couldn't switch between different server connections
3. The form would fail if launched without an active connection

## Solution

Added a **Server** dropdown that:

-   Lists all available connections from the connection store (recent connections)
-   Shows the connection status (● indicator for connected servers)
-   Automatically connects to a server when selected if not already connected
-   Allows users to switch between different servers without closing the form

## Implementation Details

### 1. Shared Interfaces (`src/sharedInterfaces/dataTierApplication.ts`)

#### New Interface: ConnectionProfile

```typescript
export interface ConnectionProfile {
    displayName: string; // Friendly name shown in UI
    server: string; // Server name
    database?: string; // Database name (if specified)
    authenticationType: string; // "Integrated", "SQL Login", "Azure MFA"
    userName?: string; // User name (for SQL Auth)
    isConnected: boolean; // Whether connection is active
    profileId: string; // Unique identifier
}
```

#### New State Fields

```typescript
export interface DataTierApplicationWebviewState {
    // ... existing fields ...
    selectedProfileId?: string; // Currently selected profile ID
    availableConnections?: ConnectionProfile[]; // List of available connections
}
```

#### New RPC Requests

```typescript
// List all available connections
ListConnectionsWebviewRequest.type: Request<void, { connections: ConnectionProfile[] }, void>

// Connect to a server
ConnectToServerWebviewRequest.type: Request<
    { profileId: string },
    { ownerUri: string; isConnected: boolean; errorMessage?: string },
    void
>
```

### 2. Controller (`src/controllers/dataTierApplicationWebviewController.ts`)

#### New Methods

**listConnections()**

-   Gets recent connections from ConnectionStore
-   Checks active connections to determine connection status
-   Builds display names with server, database, authentication info
-   Returns simplified ConnectionProfile array for UI

**connectToServer(profileId)**

-   Finds the connection profile by ID
-   Checks if already connected (returns existing ownerUri)
-   If not connected, calls ConnectionManager.connect()
-   Returns ownerUri and connection status
-   Handles errors gracefully with user-friendly messages

**buildConnectionDisplayName(profile)**

-   Creates friendly display names like:
    -   "ServerName (DatabaseName) - Username"
    -   "myserver.database.windows.net (mydb) - admin"

**getAuthenticationTypeString(authType)**

-   Converts numeric auth type to readable string
-   Handles: Integrated (1), SQL Login (2), Azure MFA (3)

### 3. React Form (`src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx`)

#### New State Variables

```typescript
const [availableConnections, setAvailableConnections] = useState<ConnectionProfile[]>([]);
const [selectedProfileId, setSelectedProfileId] = useState<string>("");
const [ownerUri, setOwnerUri] = useState<string>(initialOwnerUri || "");
const [isConnecting, setIsConnecting] = useState(false);
```

#### New useEffect Hook

```typescript
// Load available connections when component mounts
useEffect(() => {
    void loadConnections();
}, []);
```

#### loadConnections() Function

-   Sends ListConnectionsWebviewRequest on component mount
-   Populates availableConnections state
-   Auto-selects connection if initialOwnerUri is provided

#### handleServerChange() Function

1. Updates selectedProfileId state
2. Finds selected connection in availableConnections
3. If not connected:
    - Sets isConnecting = true (shows spinner)
    - Sends ConnectToServerWebviewRequest
    - Updates ownerUri on success
    - Updates connection status in availableConnections
    - Shows error message on failure
4. If already connected:
    - Sends request to get ownerUri
    - Updates ownerUri state

#### Server Dropdown UI

```tsx
<Field label={locConstants.dataTierApplication.serverLabel} required>
    {isConnecting ? (
        <Spinner size="tiny" label="Connecting to server..." />
    ) : (
        <Dropdown
            placeholder="Select a server"
            value={selectedConnection?.displayName}
            selectedOptions={[selectedProfileId]}
            onOptionSelect={(_, data) => handleServerChange(data.optionValue)}
            disabled={isOperationInProgress || availableConnections.length === 0}>
            {availableConnections.map((conn) => (
                <Option key={conn.profileId} value={conn.profileId}>
                    {conn.displayName}
                    {conn.isConnected && " ●"} {/* Indicator for connected servers */}
                </Option>
            ))}
        </Dropdown>
    )}
</Field>
```

### 4. Localization (`src/reactviews/common/locConstants.ts`)

New strings added:

-   `serverLabel`: "Server"
-   `selectServer`: "Select a server"
-   `noConnectionsAvailable`: "No connections available. Please create a connection first."
-   `connectingToServer`: "Connecting to server..."
-   `connectionFailed`: "Failed to connect to server"

## User Experience Flow

### Scenario 1: Opening from Object Explorer

1. User right-clicks database → "Data-tier Application"
2. Form opens with server automatically selected and connected
3. Server dropdown shows the current server with ● indicator
4. User can switch to other servers if needed

### Scenario 2: No Active Connection

1. Form opens with no server selected
2. Server dropdown shows all recent connections
3. User selects a server
4. Spinner shows "Connecting to server..."
5. On success: ownerUri is set, databases load automatically
6. On failure: Error message explains what went wrong

### Scenario 3: Switching Servers

1. User selects different server from dropdown
2. If already connected: ownerUri updates, databases reload
3. If not connected: Connection attempt happens automatically
4. Database dropdown updates with new server's databases

## Benefits

1. **Flexibility**: Users can work with any server without closing the form
2. **Convenience**: No need to pre-connect before opening the form
3. **Transparency**: Connection status visible with ● indicator
4. **Error Handling**: Clear error messages if connection fails
5. **Auto-Connect**: Seamless experience when selecting disconnected servers

## Connection Status Indicator

The ● (bullet) indicator shows which servers are currently connected:

-   **With ●**: Active connection, ownerUri available immediately
-   **Without ●**: Not connected, will connect when selected

## Error Handling

### No Connections Available

-   Shows: "No connections available. Please create a connection first."
-   Dropdown is disabled
-   User needs to create a connection via Connection Manager

### Connection Failed

-   Shows specific error message from connection attempt
-   User can try different server or check connection settings
-   Form remains usable with other servers

### Missing ownerUri

-   Controller validates ownerUri before operations
-   Returns friendly error: "No active connection. Please ensure you are connected to a SQL Server instance."
-   Prevents cryptic backend errors

## Testing Scenarios

1. **Launch from Object Explorer**

    - Verify server is pre-selected and connected
    - Verify databases load automatically

2. **Select Disconnected Server**

    - Verify "Connecting to server..." spinner appears
    - Verify connection succeeds and databases load
    - Verify error message if connection fails

3. **Switch Between Connected Servers**

    - Verify databases reload for new server
    - Verify no connection delay (already connected)

4. **No Connections Available**

    - Verify appropriate message is shown
    - Verify dropdown is disabled

5. **Connection Status Indicator**
    - Verify ● appears for connected servers
    - Verify indicator updates after connecting

## Future Enhancements

1. Store ownerUri in ConnectionProfile to avoid redundant connection requests
2. Add "Refresh" button to reload connection list
3. Show server version or connection details in dropdown
4. Add "New Connection" button to create connection from form
5. Remember last selected server per session

## Related Files

-   `src/sharedInterfaces/dataTierApplication.ts` - RPC interfaces
-   `src/controllers/dataTierApplicationWebviewController.ts` - Backend logic
-   `src/reactviews/pages/DataTierApplication/dataTierApplicationForm.tsx` - UI component
-   `src/reactviews/common/locConstants.ts` - Localized strings
-   `src/models/connectionStore.ts` - Connection management
-   `src/controllers/connectionManager.ts` - Connection API

## Summary

The server selection feature makes the Data-tier Application form much more flexible and user-friendly. Users can now:

-   Select any available server connection
-   Switch between servers without closing the form
-   See connection status at a glance
-   Let the form handle connections automatically

This eliminates the requirement to launch the form from Object Explorer and provides a better overall user experience.
