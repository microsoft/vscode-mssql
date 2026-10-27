/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlatformInfo } from "./platform";
import { sessionPreamble } from "./session";
import { SqlReadOptions, SqlReader, readString, toRecords } from "./sqlReader";

/**
 * The online databases in `sys.databases`, by name. In Azure SQL Database, a user database sees
 * only itself and `master`; `master` sees every database of the logical server.
 */
export const listDatabasesQuery = `SELECT name
FROM sys.databases
WHERE state = 0
ORDER BY name;`;

/** Returns the names of the online databases that the connection can see. */
export async function listDatabases(
    reader: SqlReader,
    info: PlatformInfo,
    options?: SqlReadOptions,
): Promise<string[]> {
    const [resultSet] = await reader.read(
        `${sessionPreamble(info, "read")}\n${listDatabasesQuery}`,
        options,
    );
    return toRecords(resultSet)
        .map((record) => readString(record, "name"))
        .filter((name): name is string => !!name);
}
