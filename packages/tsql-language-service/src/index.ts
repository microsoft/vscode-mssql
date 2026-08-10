/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SaralSqlAnalysisEngine } from "./adapters/saral.js";
import { TsqlLanguageService, type TsqlLanguageServiceOptions } from "./core/languageService.js";

export * from "./adapters/index.js";
export * from "./analysis/index.js";
export * from "./core/index.js";
export * from "./langium/index.js";
export * from "./metadata/index.js";
export * from "./parser/index.js";
export * from "./semantic/index.js";

/** Default package-owned incremental T-SQL facade used by vscode-mssql. */
export function createTsqlLanguageService<T extends object = Record<never, never>>(
    options: TsqlLanguageServiceOptions<T> = {},
): TsqlLanguageService<T> {
    return new TsqlLanguageService(new SaralSqlAnalysisEngine(), options);
}

/** Explicit alias for consumers selecting the vendored parser strategy. */
export function createSaralLanguageService<T extends object = Record<never, never>>(
    options: TsqlLanguageServiceOptions<T> = {},
): TsqlLanguageService<T> {
    return new TsqlLanguageService(new SaralSqlAnalysisEngine(), options);
}
