/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { systemDatabases } from "../constants/constants";
import { FormItemOptions } from "../sharedInterfaces/form";

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

export interface DatabaseGroups {
    userDatabases: string[];
    systemDatabases: string[];
}

export interface DatabaseGroupNames {
    userDatabases: string;
    systemDatabases: string;
}

export function groupDatabases(databases: string[]): DatabaseGroups {
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });

    return {
        userDatabases: databases
            .filter((database) => !isSystemDatabase(database))
            .sort((left, right) => collator.compare(left, right)),
        systemDatabases: databases
            .filter((database) => isSystemDatabase(database))
            .sort((left, right) => collator.compare(left, right)),
    };
}

export function buildDatabaseOptions(
    databases: string[],
    groupNames: DatabaseGroupNames,
): FormItemOptions[] {
    const { userDatabases, systemDatabases } = groupDatabases(databases);

    return [
        ...userDatabases.map((database) => ({
            displayName: database,
            value: database,
            groupName: groupNames.userDatabases,
        })),
        ...systemDatabases.map((database) => ({
            displayName: database,
            value: database,
            groupName: groupNames.systemDatabases,
        })),
    ];
}
