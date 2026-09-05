/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// SQL queries for copilot tools
// WARNING: These queries are tightly coupled with their corresponding tool implementations.
// The result parsing logic assumes that the target items (tables, views, functions)
// are returned in the FIRST COLUMN of the result set. Do not modify these queries in a way
// that changes the column order or structure without updating the corresponding parsing methods
// in the tool classes (getTableNamesFromResult, getViewNamesFromResult, getFunctionNamesFromResult).

export const listTablesQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS TableName FROM sys.tables ORDER BY SCHEMA_NAME(schema_id), name";

export const listViewsQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS ViewName FROM sys.views ORDER BY SCHEMA_NAME(schema_id), name";

export const listFunctionsQuery =
    "SELECT CONCAT(SCHEMA_NAME(schema_id), '.', name) AS FunctionName FROM sys.objects WHERE type IN ('FN', 'IF', 'TF') ORDER BY SCHEMA_NAME(schema_id), name";
