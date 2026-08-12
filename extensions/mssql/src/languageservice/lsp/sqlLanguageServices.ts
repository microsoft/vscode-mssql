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
 * Composes the package-owned incremental T-SQL engine with its document and LSP services.
 */
export function createTsqlSqlLanguageServices(): TsqlSqlLanguageServices {
    return createPackageLanguageServices({ engine: new SaralSqlAnalysisEngine() });
}
