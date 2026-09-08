/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { capabilitiesFrom } from "../../src/core/platform";
import { gate } from "../../src/core/catalog";
import {
    highVariationQueries,
    planForQueryStorePlan,
    plansForQueryStoreQuery,
    queryStoreHints,
    queryStoreStateSql,
    regressedQueries,
    topResourceConsumers,
    allQueries,
    forcedPlans,
    workloadHistory,
    waitStats,
} from "../../src/diagnostics/querystore/catalog";

const sqlServer = capabilitiesFrom({ engineEditionId: 3, majorVersion: 16 });

void test("Query Store plan catalog queries require positive safe integer identities", () => {
    const plans = plansForQueryStoreQuery.sql({ queryId: 42 });
    assert.match(
        plans,
        /WHERE p\.query_id = 42\s+ORDER BY e\.last_execution_time DESC, p\.last_compile_start_time DESC, p\.plan_id DESC$/,
    );
    assert.match(plans, /COUNT\(DISTINCT rsi\.runtime_stats_interval_id\)/);
    assert.match(
        planForQueryStorePlan.sql({ queryId: 42, planId: 7 }),
        /WHERE query_id = 42 AND plan_id = 7$/,
    );
    for (const params of [
        {},
        { queryId: 0, planId: 1 },
        { queryId: -1, planId: 1 },
        { queryId: 1.5, planId: 1 },
        { queryId: Number.MAX_SAFE_INTEGER + 1, planId: 1 },
        { queryId: "42", planId: 1 },
        { queryId: 42, planId: 0 },
        { queryId: 42, planId: 1.5 },
        { queryId: 42, planId: Number.MAX_SAFE_INTEGER + 1 },
        { queryId: 42, planId: "7" },
    ]) {
        assert.throws(() => planForQueryStorePlan.sql(params));
    }
    assert.throws(() => plansForQueryStoreQuery.sql({ queryId: "42" }));
    assert.throws(() => queryStoreHints.sql({ queryId: "42" }));
});

void test("Query Store catalog uses the selected metric, filters, and explicit windows", () => {
    const sql = topResourceConsumers.sql({
        aggregation: "maximum",
        endAt: "2026-09-07T12:00:00Z",
        executionType: "all",
        metric: "cpu",
        queryId: 42,
        startAt: "2026-09-07T10:00:00Z",
        text: "select 100%",
    });
    assert.match(sql, /rs\.execution_type IN \(0, 1, 2\)/);
    assert.match(sql, /MAX\(rs\.max_cpu_time\) AS selected_metric_maximum/);
    assert.match(sql, /rsi\.start_time >= CONVERT\(datetimeoffset, N'2026-09-07T10:00:00\.000Z'/);
    assert.match(sql, /rsi\.start_time < CONVERT\(datetimeoffset, N'2026-09-07T12:00:00\.000Z'/);
    assert.match(sql, /q\.query_id = 42/);
    assert.match(sql, /LIKE N'.*select 100\\%.*'/);

    const comparison = regressedQueries.sql({
        baselineEndAt: "2026-09-07T10:00:00Z",
        baselineStartAt: "2026-09-07T06:00:00Z",
        endAt: "2026-09-07T12:00:00Z",
        metric: "reads",
        startAt: "2026-09-07T10:00:00Z",
        text: "select 100%",
    });
    assert.match(comparison, /rs\.avg_logical_io_reads/);
    assert.match(comparison, /2026-09-07T06:00:00\.000Z/);
    assert.equal((comparison.match(/qt\.query_sql_text LIKE/g) ?? []).length, 2);
});

void test("Query Store source filters use the engine's internal-query classification", () => {
    const userSql = topResourceConsumers.sql({ source: "user" });
    const internalSql = regressedQueries.sql({ source: "internal" });
    const variationSql = highVariationQueries.sql({ source: "user" });
    assert.match(userSql, /q\.is_internal_query = 0/);
    assert.match(internalSql, /q\.is_internal_query = 1/);
    assert.match(variationSql, /q\.is_internal_query = 0/);
    assert.match(
        userSql,
        /CASE WHEN q\.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source/,
    );
});

void test("Query Store source-aware projections preserve result identity", () => {
    const variationSql = highVariationQueries.sql({ source: "internal" });
    assert.match(variationSql, /SELECT TOP \(50\)\s+p\.query_id, p\.source/);
    assert.match(variationSql, /GROUP BY m\.query_id, m\.source/);
    assert.match(variationSql, /s\.query_id = m\.query_id AND s\.source = m\.source/);

    const forcedSql = forcedPlans.sql({ source: "user" });
    assert.match(
        forcedSql,
        /q\.query_id, CASE WHEN q\.is_internal_query = 1 THEN 'internal' ELSE 'user' END AS source/,
    );
    assert.match(forcedSql, /q\.is_internal_query = 0/);
});

void test("Query Store history aggregates each retained interval without smoothing gaps", () => {
    const sql = workloadHistory.sql({
        aggregation: "weightedMean",
        hours: 24,
        metric: "duration",
        source: "user",
    });
    assert.match(sql, /GROUP BY rsi\.runtime_stats_interval_id, rsi\.start_time/);
    assert.match(sql, /SUM\(rs\.avg_duration \* rs\.count_executions\)/);
    assert.match(
        sql,
        /COUNT\(DISTINCT rsi\.runtime_stats_interval_id\) AS observed_interval_count/,
    );
    assert.match(sql, /rsi\.end_time AS interval_end/);
    assert.match(sql, /q\.is_internal_query = 0/);
});

void test("Query Store waits keep execution denominators separate from wait categories", () => {
    const sql = waitStats.sql({
        source: "internal",
        waitCategory: "Lock",
        executionType: "all",
        queryId: 42,
        text: "select",
    });
    assert.match(sql, /WITH execution_counts AS/);
    assert.match(sql, /FROM sys\.query_store_wait_stats AS ws/);
    assert.match(sql, /ws\.wait_category_desc = N'Lock'/);
    assert.match(sql, /rs\.execution_type IN \(0, 1, 2\)/);
    assert.match(sql, /q\.is_internal_query = 1/);
    assert.match(sql, /qt\.query_sql_text LIKE/);
    assert.match(sql, /COUNT\(DISTINCT w\.runtime_stats_interval_id\)/);
});

void test("Query Store all-query view keeps the high-cap query-level evidence", () => {
    const sql = allQueries.sql({ source: "user" });
    assert.match(sql, /SELECT TOP \(1000\)/);
    assert.match(sql, /GROUP BY q\.query_id, q\.is_internal_query/);
    assert.match(sql, /q\.is_internal_query = 0/);
});

void test("Query Store catalogs expose capability and permission requirements", () => {
    const noQueryStore = { ...sqlServer, hasQueryStore: false };
    assert.equal(gate(plansForQueryStoreQuery, sqlServer, true).allowed, true);
    assert.equal(gate(plansForQueryStoreQuery, noQueryStore, true).allowed, false);
    assert.equal(plansForQueryStoreQuery.requiresPermission, "VIEW DATABASE STATE");
    assert.equal(
        gate(queryStoreHints, capabilitiesFrom({ engineEditionId: 3, majorVersion: 15 }), true)
            .allowed,
        false,
    );
    assert.equal(gate(highVariationQueries, sqlServer, false).allowed, false);
    assert.match(queryStoreStateSql, /VIEW DATABASE STATE/);
});
