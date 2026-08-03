/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ConnectionManager, { ConnectionInfo } from "../../controllers/connectionManager";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { sqlToolsMcpConnectionRegistry } from "../../sqlToolsMcp/sqlToolsMcpConnectionRegistry";

export interface ToolConnectionReference {
    connectionId?: string;
    connectionName?: string;
}

export interface ResolvedToolConnection {
    ownerUri: string;
    connectionInfo: ConnectionInfo;
}

export interface ToolConnectionResolutionError {
    reason: "invalid_request";
    message: string;
}

export function resolveToolConnectionReference(
    connectionReference: ToolConnectionReference,
    connectionManager: ConnectionManager,
): ResolvedToolConnection | ToolConnectionResolutionError {
    const connectionId = connectionReference.connectionId;
    const connectionName = connectionReference.connectionName;

    if (connectionId && connectionName) {
        return {
            reason: "invalid_request",
            message: loc.toolAmbiguousConnectionReference,
        };
    }

    if (!connectionId && !connectionName) {
        return {
            reason: "invalid_request",
            message: loc.toolMissingConnectionReference,
        };
    }

    if (connectionName) {
        const ownerUri = sqlToolsMcpConnectionRegistry.get(connectionName)?.ownerUri;
        if (!ownerUri) {
            return {
                reason: "invalid_request",
                message: loc.noSqlToolsMcpConnectionName(connectionName),
            };
        }

        return resolveNativeConnection(ownerUri, connectionManager);
    }

    const nativeConnection = resolveNativeConnection(connectionId!, connectionManager);
    if (!("reason" in nativeConnection)) {
        return nativeConnection;
    }

    // Compatibility shim: model-generated calls may pass the MCP returned
    // ConnectionId as connectionId. MCP stores that value as connectionName.
    const mcpOwnerUri = sqlToolsMcpConnectionRegistry.get(connectionId!)?.ownerUri;
    if (!mcpOwnerUri) {
        return nativeConnection;
    }

    return resolveNativeConnection(mcpOwnerUri, connectionManager);
}

function resolveNativeConnection(
    ownerUri: string,
    connectionManager: ConnectionManager,
): ResolvedToolConnection | ToolConnectionResolutionError {
    const connectionInfo = connectionManager.getConnectionInfo(ownerUri);
    if (!connectionInfo?.credentials) {
        return {
            reason: "invalid_request",
            message: loc.noConnectionError(ownerUri),
        };
    }

    return { ownerUri, connectionInfo };
}
