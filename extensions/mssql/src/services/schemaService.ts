/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";

import SqlToolsServiceClient from "../languageservice/serviceclient";
import type ConnectionManager from "../controllers/connectionManager";
import * as LocConstants from "../constants/locConstants";

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

export async function ensureDesignerPublishingSupported(
    connectionManager: ConnectionManager,
    connection: string | IConnectionInfo | undefined,
): Promise<void> {
    const ownerUri =
        typeof connection === "string"
            ? connection
            : connection && connectionManager.getUriForConnection(connection);
    if (!ownerUri) {
        throw new Error(LocConstants.designerPublishingEditionCheckFailed);
    }

    const result = await connectionManager.sendRequest(ListSchemasRequest, {
        ownerUri,
        queryString: "SELECT CONVERT(int, SERVERPROPERTY('EditionID')) AS EditionID;",
    });
    const cell = result?.rows?.[0]?.[0];
    const editionIdText = cell && !cell.isNull ? cell.displayValue.trim() : undefined;
    const editionId = Number(editionIdText);
    if (!editionIdText || !Number.isInteger(editionId)) {
        throw new Error(LocConstants.designerPublishingEditionCheckFailed);
    }
    if (editionId === -978196525) {
        throw new Error(LocConstants.designerPublishingDisabled);
    }
}
