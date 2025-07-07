/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// SQL queries for copilot tools
export const listTablesQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS TableName FROM sys.tables ORDER BY SCHEMA_NAME(schema_id), name";

export const listViewsQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS ViewName FROM sys.views ORDER BY SCHEMA_NAME(schema_id), name";

export const listSchemasQuery =
    "SELECT name AS SchemaName FROM sys.schemas WHERE name NOT IN ('sys', 'information_schema') ORDER BY name";

export const listFunctionsQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS FunctionName FROM sys.objects WHERE type IN ('FN', 'IF', 'TF') ORDER BY SCHEMA_NAME(schema_id), name";
