/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import * as mssql from "vscode-mssql";

/**
 * Request to generate SqlPackage command string
 */
export namespace GenerateSqlPackageCommandRequest {
    export const type = new RequestType<
        mssql.SqlPackageCommandParams,
        mssql.SqlPackageCommandResult,
        void,
        void
    >("sqlpackage/generateCommand");
}
