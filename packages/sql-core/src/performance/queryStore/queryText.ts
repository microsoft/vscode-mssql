/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlResultSet } from "../../common/sqlReader";
import { queryStoreParameters } from "./common/queryGeneratorUtils";
import { formatBigInt, prependSqlParameters } from "./common/sqlParameters";

/*
 * Port of Utils.GetQueryText, Utils.AlterFromCreateScript, Utils.CalculateCaretPosition,
 * Utils.GetShowPlanXML, and SelectedTextCoordinates from SQL Tools Service. The C# functions run
 * the queries. Here, the caller runs them and passes the results to the mapping functions.
 */

/** The variables of the query text queries. */
export const queryTextParameters = {
    queryId: "@Query_ID",
    objectId: "@Object_ID",
} as const;

/** Where the query text is in the definition of its module. Lines and columns start at 0. */
export interface SelectedTextCoordinates {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
}

export type QueryTextResult =
    /** The query is not in a module. */
    | { readonly kind: "queryText"; readonly text: string }
    /** The module of the query does not exist anymore. */
    | { readonly kind: "containingObjectNotFound"; readonly queryText: string }
    /** The module of the query changed and does not have the query text anymore. */
    | { readonly kind: "queryNotInContainingObject"; readonly queryText: string }
    /** An `ALTER` script for the module, and where the query is in it. */
    | {
          readonly kind: "containingObject";
          readonly script: string;
          readonly coordinates: SelectedTextCoordinates;
      };

export interface QueryTextRow {
    /** A decimal string. "0" when the query is not in a module. */
    readonly objectId: string;
    readonly queryText: string;
}

/**
 * Returns the module ID and text of the query, with the declaration of its ID. Map the result
 * with {@link mapQueryTextRow}.
 */
export function getQueryTextQuery(queryId: number | bigint | string): string {
    // The C# query text, with its indentation and trailing space.
    const sql = [
        "SELECT q.object_id, qt.query_sql_text",
        "                        FROM sys.query_store_query q, sys.query_store_query_text qt",
        `                        WHERE q.query_id = ${queryTextParameters.queryId} AND q.query_text_id = qt.query_text_id `,
    ].join("\n");
    return prependSqlParameters(sql, [
        { name: queryTextParameters.queryId, type: "bigint", value: queryId },
    ]);
}

/** Maps the first row of {@link getQueryTextQuery}. No row means no module and no text. */
export function mapQueryTextRow(resultSets: readonly SqlResultSet[]): QueryTextRow {
    const row = resultSets[0]?.rows[0];
    if (!row) {
        return { objectId: "0", queryText: "" };
    }
    const [objectId, queryText] = row;
    return {
        objectId:
            typeof objectId === "string" || typeof objectId === "number"
                ? formatBigInt(objectId)
                : "0",
        queryText: typeof queryText === "string" ? queryText : "",
    };
}

/**
 * Returns the definition of the module, with the declaration of its ID. Run it when the object ID
 * is not 0.
 */
export function getContainingObjectDefinitionQuery(objectId: number | bigint | string): string {
    return prependSqlParameters(
        `select definition from sys.sql_modules where object_id = ${queryTextParameters.objectId}`,
        [{ name: queryTextParameters.objectId, type: "bigint", value: objectId }],
    );
}

/**
 * Returns what to show for a query, from the row of {@link getQueryTextQuery} and the result of
 * {@link getContainingObjectDefinitionQuery}. C# `Utils.GetQueryText`, which returns localized
 * text for the two error kinds.
 */
export function resolveQueryText(
    row: QueryTextRow,
    definitionResultSets?: readonly SqlResultSet[],
): QueryTextResult {
    if (formatBigInt(row.objectId) === "0") {
        return { kind: "queryText", text: row.queryText };
    }
    const definition = definitionResultSets?.[0]?.rows[0]?.[0];
    if (typeof definition !== "string") {
        return { kind: "containingObjectNotFound", queryText: row.queryText };
    }
    const parentObject = definition;
    if (!parentObject.includes(row.queryText)) {
        return { kind: "queryNotInContainingObject", queryText: row.queryText };
    }
    return {
        kind: "containingObject",
        script: alterFromCreateScript(parentObject),
        coordinates: calculateCaretPosition(parentObject, row.queryText),
    };
}

/**
 * Replaces the first `create`, in any case, with `ALTER`. C# `Utils.AlterFromCreateScript`.
 */
export function alterFromCreateScript(objectString: string): string {
    const location = objectString.search(/create/i);
    if (location < 0) {
        return objectString;
    }
    return `${objectString.slice(0, location)}ALTER${objectString.slice(location + "create".length)}`;
}

/**
 * Returns where the query text starts and ends in the module definition. The caller checks that
 * the definition has the text. C# `Utils.CalculateCaretPosition`, with two changes: a line break
 * is "\n", which also finds "\r\n" breaks (the C# code looks only for `Environment.NewLine`), and
 * text on the first line has the column of its first character (the C# code throws).
 */
export function calculateCaretPosition(
    parentObject: string,
    queryText: string,
): SelectedTextCoordinates {
    let matched = 0;
    let startingPos = 0;
    let lineFeedsInsideQueryText = 0;
    // Line feeds are found in increasing order, like the insertion order of the C# HashSet.
    const lineFeeds: number[] = [];
    const seen = new Set<number>();
    let index = 0;

    while (index < parentObject.length) {
        if (matched === queryText.length) {
            break;
        }
        if (parentObject[index] === "\n" && !seen.has(index)) {
            seen.add(index);
            lineFeeds.push(index);
            lineFeedsInsideQueryText++;
        }
        if (parentObject[index] === queryText[matched]) {
            matched++;
            index++;
            continue;
        }
        index = startingPos + 1;
        matched = 0;
        lineFeedsInsideQueryText = 0;
        startingPos = index;
    }

    const lineFeedBeforeStart = lineFeeds[lineFeeds.length - 1 - lineFeedsInsideQueryText] ?? -1;
    const lastLineFeed = lineFeeds[lineFeeds.length - 1] ?? -1;
    return {
        startLine: lineFeeds.length - lineFeedsInsideQueryText,
        startColumn: startingPos - lineFeedBeforeStart - 1,
        endLine: lineFeeds.length,
        endColumn: index - lastLineFeed - 1,
    };
}

/**
 * Returns the showplan XML of a plan, with the declaration of its ID. C# `Utils.GetShowPlanXML`.
 */
export function getShowPlanXmlQuery(planId: number | bigint | string): string {
    return prependSqlParameters(
        `select query_plan from sys.query_store_plan where plan_id = ${queryStoreParameters.planId}`,
        [{ name: queryStoreParameters.planId, type: "bigint", value: planId }],
    );
}
