/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sqlBigIntLiteral, sqlIntLiteral } from "../common/literals";
import {
    SqlReader,
    SqlRecord,
    readDateTime,
    readId,
    readNumber,
    readString,
    toRecords,
} from "../common/sqlReader";
import { QueryStoreCapabilities } from "./capabilities";
import {
    QueryStoreMetric,
    QueryStoreRanking,
    QueryStoreRuntimeStats,
    QueryStoreStatistic,
    definitionOf,
    isQueryStoreStatistic,
} from "./metrics";
import {
    readRuntimeStats,
    resolveMetrics,
    rollupColumns,
    rollupStatisticExpression,
    runtimeStatsColumnNames,
    runtimeStatsColumns,
    runtimeStatsTableColumns,
    windowedRuntimeStats,
} from "./runtimeStats";
import {
    QueryStoreReadOptions,
    QueryStoreResult,
    TimeWindow,
    runQueryStoreRead,
    windowDeclarations,
} from "./state";

/** A query in Query Store, with its runtime stats in a window. */
export interface QueryStoreQuery extends QueryStoreRuntimeStats {
    /** The Query Store `query_id`, a `bigint` as decimal text. */
    readonly queryId: string;
    /** The query text. Lists have the first {@link queryTextPreviewLength} characters. */
    readonly queryText: string;
    /** `schema.name` of the module that has the query. Absent for ad hoc queries. */
    readonly objectName?: string;
    /** The plans that ran in the window. */
    readonly planCount: number;
    /** The last execution of any plan, over all time. ISO 8601 UTC. */
    readonly lastExecutionTimeUtc?: string;
    /**
     * True when the query reads only system catalog views, such as `sys.objects`. Tools that
     * browse a database, such as an object explorer, send these queries, not the application.
     */
    readonly readsOnlySystemCatalog: boolean;
}

/** A query with the facts that a query page shows. */
export interface QueryStoreQueryDetails extends QueryStoreQuery {
    /** The plans of the query in Query Store, over all time. */
    readonly totalPlanCount: number;
    /** The forced plan, if a plan of the query is forced. */
    readonly forcedPlanId?: string;
}

/** The characters of query text in a query list. */
export const queryTextPreviewLength = 4000;

export interface TopQueriesRequest extends TimeWindow {
    readonly rankBy: QueryStoreRanking;
    /** Default `total`. Ignored for `executionCount`. */
    readonly statistic?: QueryStoreStatistic;
    /** From 1 to 1000. */
    readonly top: number;
    /** The metrics that each query has. Default: the ranked metric. */
    readonly metrics?: readonly QueryStoreMetric[];
}

export interface TopQueries {
    /** Highest first. */
    readonly queries: readonly QueryStoreQuery[];
    /**
     * Every query in the window together, for the share of each query. Only `total` and the
     * execution count are meaningful parts of a whole.
     */
    readonly workload: QueryStoreRuntimeStats;
}

/**
 * Reads the queries with the highest statistic of a metric in the window. One batch: the plan
 * sums of the window go into a table variable, and the totals and the top queries come from it,
 * so Query Store's views are read once. Only the top queries' text is read. `noData` when no
 * query ran in the window.
 */
export async function getTopQueries(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: TopQueriesRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<TopQueries>> {
    const statistic = request.statistic ?? "total";
    if (!isQueryStoreStatistic(statistic)) {
        throw new RangeError(`"${String(statistic)}" is not a Query Store statistic.`);
    }
    if (request.rankBy !== "executionCount") {
        definitionOf(request.rankBy);
        if (!capabilities.metrics.includes(request.rankBy)) {
            return { status: "unsupported" };
        }
    }
    const top = sqlIntLiteral(request.top, 1, 1000);
    const metrics = resolveMetrics(capabilities, [
        ...(request.rankBy === "executionCount" ? [] : [request.rankBy]),
        ...(request.metrics ?? []),
    ]);
    const rank = rollupStatisticExpression(request.rankBy, statistic, "pl");
    const columns = runtimeStatsColumnNames(metrics);
    const body = `DECLARE @plans TABLE (
    plan_id bigint NOT NULL PRIMARY KEY,
    query_id bigint NOT NULL,
    ${runtimeStatsTableColumns(metrics)}
);
INSERT INTO @plans (plan_id, query_id, ${columns.join(", ")})
SELECT p.plan_id, p.query_id, ${columns.map((column) => `s.${column}`).join(", ")}
FROM (
    SELECT
    rs.plan_id,
    ${runtimeStatsColumns(metrics)}
${windowedRuntimeStats(capabilities)}
    GROUP BY rs.plan_id
) AS s
    JOIN sys.query_store_plan AS p ON p.plan_id = s.plan_id;
SELECT
    ${rollupColumns(metrics, "pl")}
FROM @plans AS pl;
SELECT
    t.*,
    LEFT(qt.query_sql_text, ${queryTextPreviewLength}) AS query_text,
    OBJECT_SCHEMA_NAME(q.object_id) AS object_schema_name,
    OBJECT_NAME(q.object_id) AS object_name,
    q.last_execution_time
FROM (
    SELECT TOP (${top})
        pl.query_id,
        COUNT(*) AS plan_count,
        ${rank} AS rank_value,
        ${rollupColumns(metrics, "pl")}
    FROM @plans AS pl
    GROUP BY pl.query_id
    ORDER BY rank_value DESC, pl.query_id
) AS t
    JOIN sys.query_store_query AS q ON q.query_id = t.query_id
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
ORDER BY t.rank_value DESC, t.query_id;`;
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: windowDeclarations(request),
        body,
        map: ([workloadSet, querySet]) => {
            const queries = toRecords(querySet).map((record) => toQuery(record, metrics));
            if (queries.length === 0) {
                return undefined;
            }
            return {
                queries,
                workload: readRuntimeStats(toRecords(workloadSet)[0] ?? {}, metrics),
            };
        },
    });
}

export interface QueryDetailsRequest extends TimeWindow {
    /** The Query Store `query_id`. A `bigint`. */
    readonly queryId: string;
    readonly metrics: readonly QueryStoreMetric[];
}

/**
 * Reads one query: its full text, module, plans, forced plan, and runtime stats in the window.
 * `noData` when Query Store does not have the query.
 */
export async function getQueryDetails(
    reader: SqlReader,
    capabilities: QueryStoreCapabilities,
    request: QueryDetailsRequest,
    options?: QueryStoreReadOptions,
): Promise<QueryStoreResult<QueryStoreQueryDetails>> {
    const metrics = resolveMetrics(capabilities, request.metrics);
    const body = `SELECT
    qt.query_sql_text AS query_text,
    OBJECT_SCHEMA_NAME(q.object_id) AS object_schema_name,
    OBJECT_NAME(q.object_id) AS object_name,
    q.last_execution_time,
    (SELECT COUNT(*) FROM sys.query_store_plan AS p WHERE p.query_id = q.query_id) AS total_plan_count,
    (SELECT TOP (1) p.plan_id FROM sys.query_store_plan AS p
        WHERE p.query_id = q.query_id AND p.is_forced_plan = 1
        ORDER BY p.plan_id) AS forced_plan_id
FROM sys.query_store_query AS q
    JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
WHERE q.query_id = @query_id;
SELECT
    COUNT(DISTINCT rs.plan_id) AS plan_count,
    ${runtimeStatsColumns(metrics)}
${windowedRuntimeStats(capabilities, "rs.plan_id IN (SELECT p.plan_id FROM sys.query_store_plan AS p WHERE p.query_id = @query_id)")};`;
    const queryId = sqlBigIntLiteral(request.queryId);
    return runQueryStoreRead(reader, capabilities, options, {
        declarations: [...windowDeclarations(request), `DECLARE @query_id bigint = ${queryId};`],
        body,
        map: ([querySet, statsSet]) => {
            const query = toRecords(querySet)[0];
            if (!query) {
                return undefined;
            }
            const forcedPlanId = readId(query, "forced_plan_id");
            return {
                ...toQuery(
                    { ...(toRecords(statsSet)[0] ?? {}), ...query, query_id: request.queryId },
                    metrics,
                ),
                totalPlanCount: readNumber(query, "total_plan_count") ?? 0,
                ...(forcedPlanId ? { forcedPlanId } : {}),
            };
        },
    });
}

function toQuery(record: SqlRecord, metrics: readonly QueryStoreMetric[]): QueryStoreQuery {
    const schema = readString(record, "object_schema_name");
    const name = readString(record, "object_name");
    const lastExecutionTimeUtc = readDateTime(record, "last_execution_time");
    const queryText = readString(record, "query_text") ?? "";
    return {
        queryId: readId(record, "query_id") ?? "",
        queryText,
        readsOnlySystemCatalog: readsOnlySystemCatalog(queryText),
        ...(name ? { objectName: schema ? `${schema}.${name}` : name } : {}),
        planCount: readNumber(record, "plan_count") ?? 0,
        ...(lastExecutionTimeUtc ? { lastExecutionTimeUtc } : {}),
        ...readRuntimeStats(record, metrics),
    };
}

/** The schemas of the system catalog views. */
const catalogSchemas = new Set(["sys", "information_schema"]);
/** The keywords that a table or view follows. */
const objectKeywords = new Set(["from", "join", "apply", "update", "into", "merge"]);

/**
 * True when the query reads at least one system catalog view, such as `sys.objects` or
 * `INFORMATION_SCHEMA.TABLES`, and no other table or view. Temporary tables, table variables, and
 * common table expressions do not count. A heuristic over the text: it can miss a user object
 * that the query reads through a function.
 */
export function readsOnlySystemCatalog(queryText: string): boolean {
    const tokens = tokenizeSql(queryText);
    const local = commonTableExpressionNames(tokens);
    let catalog = false;
    for (let index = 0; index < tokens.length; index++) {
        if (!objectKeywords.has(keywordOf(tokens[index]))) {
            continue;
        }
        // The object's name: up to four names joined by dots, such as `db.sys.objects`.
        const parts: string[] = [];
        let next = index + 1;
        while (tokens[next]?.kind === "name") {
            parts.push(tokens[next].text.toLowerCase());
            if (!isSymbol(tokens[next + 1], ".")) {
                break;
            }
            next += 2;
        }
        const objectName = parts[parts.length - 1];
        // A subquery, or a table variable, temporary table, or common table expression.
        if (
            objectName === undefined ||
            objectName.startsWith("@") ||
            objectName.startsWith("#") ||
            local.has(objectName)
        ) {
            continue;
        }
        const schemaName = parts.length > 1 ? parts[parts.length - 2] : undefined;
        // Without a schema, the compatibility views such as `sysobjects`.
        if (
            schemaName !== undefined
                ? catalogSchemas.has(schemaName)
                : objectName.startsWith("sys") && objectName.length > 3
        ) {
            catalog = true;
            continue;
        }
        return false;
    }
    return catalog;
}

/** The names of the common table expressions: `WITH name [(columns)] AS (`, and after a comma. */
function commonTableExpressionNames(tokens: readonly SqlToken[]): Set<string> {
    const names = new Set<string>();
    for (let index = 0; index < tokens.length; index++) {
        const name = tokens[index + 1];
        if (
            (keywordOf(tokens[index]) !== "with" && !isSymbol(tokens[index], ",")) ||
            name?.kind !== "name"
        ) {
            continue;
        }
        let next = index + 2;
        if (isSymbol(tokens[next], "(")) {
            while (next < tokens.length && !isSymbol(tokens[next], ")")) {
                next++;
            }
            next++;
        }
        if (keywordOf(tokens[next]) === "as" && isSymbol(tokens[next + 1], "(")) {
            names.add(name.text.toLowerCase());
        }
    }
    return names;
}

/** A name, quoted or not, or a character of punctuation. Literals are a `'` symbol. */
type SqlToken =
    | { readonly kind: "name"; readonly text: string; readonly quoted: boolean }
    | { readonly kind: "symbol"; readonly text: string };

/** The keyword of an unquoted name, in lower case, or an empty string. */
function keywordOf(token: SqlToken | undefined): string {
    return token?.kind === "name" && !token.quoted ? token.text.toLowerCase() : "";
}

function isSymbol(token: SqlToken | undefined, text: string): boolean {
    return token?.kind === "symbol" && token.text === text;
}

/**
 * Splits T-SQL into names and symbols. It skips whitespace, `--` comments, and `/* *\/` comments,
 * which T-SQL nests; a string literal becomes one `'` symbol, so its text is never a name.
 * `[name]` and `"name"` are quoted names, with `]]` and `""` for the quote character.
 */
function tokenizeSql(sql: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let position = 0;
    while (position < sql.length) {
        const character = sql[position];
        if (character.trim() === "") {
            position++;
        } else if (sql.startsWith("--", position)) {
            const lineEnd = sql.indexOf("\n", position);
            position = lineEnd < 0 ? sql.length : lineEnd + 1;
        } else if (sql.startsWith("/*", position)) {
            let depth = 0;
            do {
                if (sql.startsWith("/*", position)) {
                    depth++;
                    position += 2;
                } else if (sql.startsWith("*/", position)) {
                    depth--;
                    position += 2;
                } else {
                    position++;
                }
            } while (depth > 0 && position < sql.length);
        } else if (character === "'") {
            position = readQuoted(sql, position, "'").end;
            tokens.push({ kind: "symbol", text: "'" });
        } else if (character === "[" || character === '"') {
            const quoted = readQuoted(sql, position, character === "[" ? "]" : '"');
            tokens.push({ kind: "name", text: quoted.text, quoted: true });
            position = quoted.end;
        } else if (isNameCharacter(character)) {
            const start = position;
            while (position < sql.length && isNameCharacter(sql[position])) {
                position++;
            }
            tokens.push({ kind: "name", text: sql.slice(start, position), quoted: false });
        } else {
            tokens.push({ kind: "symbol", text: character });
            position++;
        }
    }
    return tokens;
}

/**
 * Reads the quoted text that starts at `start`, up to the closing quote, where two closing quotes
 * stand for one. Text without its closing quote runs to the end.
 */
function readQuoted(sql: string, start: number, close: string): { text: string; end: number } {
    let text = "";
    let position = start + 1;
    for (;;) {
        const quote = sql.indexOf(close, position);
        if (quote < 0) {
            return { text: text + sql.slice(position), end: sql.length };
        }
        text += sql.slice(position, quote);
        if (sql[quote + 1] !== close) {
            return { text, end: quote + 1 };
        }
        text += close;
        position = quote + 2;
    }
}

/** A letter, digit, `_`, `@`, `#`, or `$`, which T-SQL names are made of. */
function isNameCharacter(character: string): boolean {
    return (
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z") ||
        (character >= "0" && character <= "9") ||
        character === "_" ||
        character === "@" ||
        character === "#" ||
        character === "$" ||
        // Names can have letters of any language.
        character > "\u007f"
    );
}
