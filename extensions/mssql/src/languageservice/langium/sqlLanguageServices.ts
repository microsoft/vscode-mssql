/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTsqlSqlLanguageServices as createPackageLanguageServices,
    SaralSqlAnalysisEngine,
    type TsqlSqlLanguageServices,
} from "@vscode-mssql/tsql-language-service";

export type { TsqlSqlLanguageServices } from "@vscode-mssql/tsql-language-service";

/**
 * Composes the package-owned incremental T-SQL engine into the Langium document container.
 */
export function createTsqlSqlLanguageServices(): TsqlSqlLanguageServices {
    return createPackageLanguageServices({ engine: new SaralSqlAnalysisEngine() });
}
