/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getConnectionDisplayName } from "../../models/connectionInfo";
import { ConnectionInfo } from "../../controllers/connectionManager";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { IConnectionProfile } from "../../models/interfaces";
import { removeUndefinedProperties } from "../../utils/utils";

/**
 * Gets a user-friendly display name for a connection, or a fallback placeholder if connection info is not available.
 * This is used in Copilot tool messages to show meaningful information to users while keeping connection IDs for debugging.
 *
 * @param connInfo The connection info object (can be undefined if connection not found)
 * @returns The display name - either the formatted connection name or "Unknown Connection"
 */
export function getDisplayNameForTool(connInfo: ConnectionInfo | undefined): string {
    if (connInfo) {
        // We have connection info - return the formatted display name
        return getConnectionDisplayName(connInfo.credentials);
    } else {
        // Connection info not available - use a placeholder that makes it clear
        // This will show as "Unknown Connection (ID: connection-123)" which is better than
        // "connection-123 (ID: connection-123)"
        return loc.unknownConnection;
    }
}

export function buildChatAgentConnectPrompt(connectionProfile: IConnectionProfile): string {
    const connectTarget = removeUndefinedProperties({
        profileId: connectionProfile.id,
        profileName:
            connectionProfile.profileName && connectionProfile.profileName.trim() !== ""
                ? connectionProfile.profileName
                : undefined,
        serverName: connectionProfile.server,
        database: connectionProfile.database || undefined,
    });

    return `Connect to ${JSON.stringify(connectTarget)}`;
}
