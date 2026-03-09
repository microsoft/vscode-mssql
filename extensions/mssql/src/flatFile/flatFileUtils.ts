/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Strips authentication-related properties from a connection string that conflict with
 * setting an access token. SqlConnection in .NET does not allow AccessToken to be set
 * when UserID, UID, Password, PWD, or Authentication are present in the connection string.
 *
 * @param connectionString The connection string to sanitize
 * @returns The connection string with conflicting auth properties removed
 */
export function stripEntraAuthPropertiesFromConnectionString(
    connectionString: string | undefined,
): string | undefined {
    if (!connectionString) {
        return connectionString;
    }
    return connectionString
        .split(";")
        .filter(
            (prop) =>
                !["user", "uid", "password", "pwd", "authentication"].some((prefix) =>
                    prop.trim().toLowerCase().startsWith(prefix),
                ),
        )
        .join(";");
}
