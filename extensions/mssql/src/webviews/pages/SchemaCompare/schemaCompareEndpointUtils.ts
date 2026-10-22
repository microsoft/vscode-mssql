/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";

/**
 * An endpoint counts as chosen once it names a database server, a dacpac, or a project file.
 */
export const isEndpointEmpty = (endpoint: mssql.SchemaCompareEndpointInfo): boolean => {
    return !(
        endpoint &&
        (endpoint.serverDisplayName || endpoint.packageFilePath || endpoint.projectFilePath)
    );
};
