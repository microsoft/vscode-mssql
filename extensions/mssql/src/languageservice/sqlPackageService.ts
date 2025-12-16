/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as sqlPackageContracts from "../models/contracts/sqlPackage/sqlPackageContracts";
import * as mssql from "vscode-mssql";

/**
 * Service for SqlPackage operations
 */
export class SqlPackageService {
    constructor(private _client: SqlToolsServiceClient) {}

    /**
     * Generate a SqlPackage command based on the provided parameters
     */
    public async generateSqlPackageCommand(
        params: mssql.SqlPackageCommandParams,
    ): Promise<mssql.SqlPackageCommandResult> {
        return this._client.sendRequest(
            sqlPackageContracts.GenerateSqlPackageCommandRequest.type,
            params,
        );
    }
}
