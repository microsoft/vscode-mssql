/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export * from "./catalogSnapshot.js";
export * from "./analysisCatalogAdapter.js";
export * from "./contracts.js";
export * from "./databaseMetadataLoader.js";
export * from "./metadataRepository.js";
export * from "./mappingCatalog.js";

// connectionString.js and tediousQueryExecutor.js are deliberately absent: they import `tedious`,
// and re-exporting them here would drag the whole TDS driver into the extension bundle. Import
// them from "@vscode-mssql/tsql-language-service/metadata/tedious" instead.
