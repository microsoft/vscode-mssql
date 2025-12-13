/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as sqlPackageContracts from "../models/contracts/sqlPackage/sqlPackageContracts";

/**
 * Service for interacting with SqlPackage functionality in SQL Tools Service
 */
export class SqlPackageService {
    constructor(private _client: SqlToolsServiceClient) {}

    /**
     * Generates a SqlPackage CLI command string based on the provided parameters
     * @param params Parameters containing DACPAC path, server, database, and deployment options
     * @returns Promise resolving to the generated command result
     */
    public async generateSqlPackageCommand(
        params: sqlPackageContracts.GenerateSqlPackageCommandParams,
    ): Promise<sqlPackageContracts.SqlPackageCommandResult> {
        return this._client.sendRequest(
            sqlPackageContracts.GenerateSqlPackageCommandRequest.type,
            params,
        );
    }
}
