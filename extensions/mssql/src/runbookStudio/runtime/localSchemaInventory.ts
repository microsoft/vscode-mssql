/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Closed, bounded metadata query used by database.schema.inventory@1. The
 * planner chooses the operation and target but never authors the SQL. */
export const LOCAL_SCHEMA_INVENTORY_ROW_LIMIT = 5000;

export const LOCAL_SCHEMA_INVENTORY_SQL = [
    `SELECT TOP (${LOCAL_SCHEMA_INVENTORY_ROW_LIMIT + 1})`,
    "    CASE o.[type]",
    "        WHEN N'U' THEN N'Table'",
    "        WHEN N'V' THEN N'View'",
    "        WHEN N'P' THEN N'Stored procedure'",
    "        WHEN N'PC' THEN N'Stored procedure'",
    "    END AS [ObjectType],",
    "    s.[name] AS [SchemaName],",
    "    o.[name] AS [ObjectName]",
    "FROM sys.objects AS o",
    "INNER JOIN sys.schemas AS s ON s.[schema_id] = o.[schema_id]",
    "WHERE o.[is_ms_shipped] = 0",
    "  AND o.[type] IN (N'U', N'V', N'P', N'PC')",
    "ORDER BY CASE o.[type] WHEN N'U' THEN 1 WHEN N'V' THEN 2 ELSE 3 END,",
    "    s.[name], o.[name];",
].join("\n");
