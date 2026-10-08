/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    QueryStoreColumnInfo,
    executionCountColumnInfo,
    simpleColumnInfo,
    statisticMetricColumnInfo,
} from "./columnInfo";
import { QueryStoreMetric, assertQueryStoreMetric } from "./metric";
import { QueryStoreStatistic } from "./statistic";
import { assertSqlAlias } from "./utils";

/*
 * The helper templates of C# QueryTemplates that several reports share. Each report module has
 * its own templates.
 */

/** Part of a select list, and its columns. */
export interface SelectList {
    readonly text: string;
    readonly columns: QueryStoreColumnInfo[];
}

/**
 * `    SUM({table}.count_executions) count_executions,`. Wait time uses `MAX`, because the wait
 * stats rows are per wait category, and each has the execution count of the plan.
 */
export function getExecutionCountText(metric: QueryStoreMetric, statsTableName: string): string {
    const aggregate = assertQueryStoreMetric(metric) === "waitTime" ? "MAX" : "SUM";
    return `    ${aggregate}(${assertSqlAlias(statsTableName)}.count_executions) ${executionCountColumnInfo().id},`;
}

/** `    COUNT(distinct p.plan_id) num_plans`. */
export function getPlanCountText(): string {
    return `    COUNT(distinct p.plan_id) ${simpleColumnInfo("numPlans").id}`;
}

/**
 * The select list of a detailed summary that joins runtime stats (`table1`) and wait stats
 * (`table2`): query ID, object ID, object name, query text, the statistic of each metric,
 * execution count, and plan count. The `GetDetailFinalSelects` function of the C# Top Resource
 * Consumers and High Variation generators.
 */
export function getDetailFinalSelects(
    statistic: QueryStoreStatistic,
    metrics: readonly QueryStoreMetric[],
    table1: string,
    table2: string,
): SelectList {
    assertSqlAlias(table1);
    assertSqlAlias(table2);
    const queryIdColumn = simpleColumnInfo("queryId");
    const objectIdColumn = simpleColumnInfo("objectId");
    const objectNameColumn = simpleColumnInfo("objectName");
    const queryTextColumn = simpleColumnInfo("queryText");
    const columns = [queryIdColumn, objectIdColumn, objectNameColumn, queryTextColumn];
    const lines = [
        `    ${table1}.query_id ${queryIdColumn.id},`,
        `    ${table1}.object_id ${objectIdColumn.id},`,
        `    ${table1}.object_name ${objectNameColumn.id},`,
        `    ${table1}.query_sql_text ${queryTextColumn.id},`,
    ];

    for (const metric of metrics) {
        const column = statisticMetricColumnInfo(statistic, metric);
        columns.push(column);
        if (metric === "waitTime") {
            lines.push(`    ISNULL(${table2}.${column.id},0) ${column.id},`);
            continue;
        }
        lines.push(`    ${table1}.${column.id} ${column.id},`);
    }

    const executionCountColumn = executionCountColumnInfo();
    const numPlansColumn = simpleColumnInfo("numPlans");
    columns.push(executionCountColumn, numPlansColumn);
    lines.push(`    ${table1}.${executionCountColumn.id} ${executionCountColumn.id},`);
    lines.push(`    ${table1}.${numPlansColumn.id} ${numPlansColumn.id}`);

    return { text: lines.join("\n").trimEnd(), columns };
}
