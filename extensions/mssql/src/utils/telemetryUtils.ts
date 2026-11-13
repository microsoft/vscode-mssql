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
 * A target database excludes database-scoped metadata belonging to another database.
 */
export function getConnectionTelemetryInfo(
    connectionManager: ConnectionManager | undefined,
    connection: string | IConnectionInfo | undefined,
    databaseName?: string,
): TelemetryEventOptions {
    if (typeof connection === "string") {
        const resolvedConnection = connectionManager?.getConnectionInfo(connection);
        return {
            connectionInfo: resolvedConnection?.credentials,
            serverInfo:
                databaseName !== undefined &&
                (!databaseName || resolvedConnection?.credentials?.database !== databaseName) &&
                resolvedConnection?.serverInfo
                    ? {
                          ...resolvedConnection.serverInfo,
                          databaseServiceTier: undefined,
                          databaseServiceObjective: undefined,
                      }
                    : resolvedConnection?.serverInfo,
        };
    }

    return {
        connectionInfo: connection,
        serverInfo: connection
            ? connectionManager?.getServerInfo(
                  connection,
                  databaseName ?? connection.database ?? "",
              )
            : undefined,
    };
}

/**
 * Combines telemetry options. Later options win for top-level fields; additional properties and
 * measurements are merged, and omitted when no option supplies them.
 */
export function mergeTelemetryOptions<T extends TelemetryEventOptions>(
    options: T,
    ...extra: (TelemetryEventOptions | undefined)[]
): T {
    let merged: T = options;
    for (const value of extra) {
        if (!value) {
            continue;
        }
        const { additionalProps, additionalMeasurements, ...rest } = value;
        merged = { ...merged, ...rest };
        if (additionalProps) {
            merged.additionalProps = { ...merged.additionalProps, ...additionalProps };
        }
        if (additionalMeasurements) {
            merged.additionalMeasurements = {
                ...merged.additionalMeasurements,
                ...additionalMeasurements,
            };
        }
    }
    return merged;
}
