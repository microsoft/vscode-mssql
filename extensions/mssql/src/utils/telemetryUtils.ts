/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryEventOptions } from "extension-toolkit/vscode";
import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";

/**
 * Resolves telemetry context from an explicit profile or owner URI using only cached metadata.
 * No active-editor fallback is used when the supplied connection is unavailable.
 */
export function getConnectionTelemetryInfo(
    connectionManager: ConnectionManager | undefined,
    connection: string | IConnectionInfo | undefined,
): TelemetryEventOptions {
    const connectionInfo =
        typeof connection === "string"
            ? connectionManager?.getConnectionInfo(connection)?.credentials
            : connection;
    return {
        connectionInfo,
        serverInfo: connectionInfo ? connectionManager?.getServerInfo(connectionInfo) : undefined,
    };
}
