/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";

const redactConnectionStringSecrets = (connectionString?: string): string => {
    if (!connectionString) {
        return "";
    }

    return connectionString.replace(
        /((?:password|pwd|access token)\s*=\s*)(?:'[^']*'|"[^"]*"|\{[^}]*\}|[^;]*)/gi,
        "$1<redacted>",
    );
};

export const getConnectionCardKey = (connection: IConnectionDialogProfile): string => {
    return [
        connection.id ?? "",
        connection.server ?? "",
        connection.database ?? "",
        connection.authenticationType ?? "",
        connection.profileName ?? "",
        connection.user ?? "",
        connection.accountId ?? "",
        redactConnectionStringSecrets(connection.connectionString),
    ].join("|");
};

export const getConnectionsListKey = (connections: IConnectionDialogProfile[]): string => {
    return connections.map(getConnectionCardKey).join("::");
};
