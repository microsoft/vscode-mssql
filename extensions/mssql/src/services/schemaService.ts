/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SimpleExecuteResult } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";

import SqlToolsServiceClient from "../languageservice/serviceclient";

const LIST_SCHEMAS_QUERY =
    "SELECT name AS SchemaName FROM sys.schemas WHERE name NOT IN ('sys', 'information_schema') ORDER BY name";

const ListSchemasRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

/**
 * Lists schemas in the database associated with the provided connection URI.
 */
export async function listSchemas(
    client: SqlToolsServiceClient,
    ownerUri: string,
): Promise<string[]> {
    const result = await client.sendRequest(ListSchemasRequest, {
        ownerUri,
        queryString: LIST_SCHEMAS_QUERY,
    });

    if (!result?.rows) {
        return [];
    }

    return result.rows
        .map((row) => row?.[0])
        .filter((cell) => cell && !cell.isNull)
        .map((cell) => cell.displayValue.trim())
        .filter((schemaName) => schemaName.length > 0);
}
