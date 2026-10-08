/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { prependSqlParameters } from "./common/sqlParameters";

/*
 * Port of QueryIDSearchQueryGenerator and the Tracked Queries function of
 * QueryStoreQueryGenerator from SQL Tools Service.
 */

/** The variable that has the search text. */
export const querySearchTextParameter = "@QuerySearchText";

/**
 * Returns the query that finds up to 500 queries whose text contains the search text, with the
 * declaration of the search text. `%` and `_` in the text are `LIKE` wildcards, like in the C#
 * code. C# `QueryStoreQueryGenerator.GetTrackedQueriesReportQuery`.
 */
export function getTrackedQueriesReportQuery(querySearchText: string): string {
    return prependSqlParameters(queryIdSearchQuery(), [
        { name: querySearchTextParameter, type: "nvarchar", value: querySearchText },
    ]);
}

/**
 * Returns the search query without the declaration. C# `QueryIDSearchQueryGenerator.GetQuery`.
 */
export function queryIdSearchQuery(): string {
    // The C# template has a space at the end of the first two lines.
    return `SELECT TOP 500 q.query_id, q.query_text_id, qt.query_sql_text${" "}
FROM sys.query_store_query_text qt JOIN sys.query_store_query q ON q.query_text_id = qt.query_text_id${" "}
WHERE qt.query_sql_text LIKE ('%' + ${querySearchTextParameter} + '%')`;
}
