/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { systemDatabases } from "../constants/constants";

/**
 * Checks whether a database name refers to a system database (or is empty/undefined).
 * The check is case-insensitive.
 *
 * @param databaseName - The database name to check
 * @returns `true` if the name is undefined, empty, or matches a system database
 */
export function isSystemDatabase(databaseName: string | undefined): boolean {
    if (!databaseName) {
        return true;
    }
    return systemDatabases.includes(databaseName.toLowerCase());
}
