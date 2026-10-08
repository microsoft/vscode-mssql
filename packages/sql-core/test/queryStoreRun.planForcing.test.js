/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, sessionPreamble } = require("../dist/index.js");
const perf = require("../dist/performance/index.js");
const { platforms, probe, resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

const now = new Date(Date.UTC(2026, 9, 8, 6, 0, 0));
const options = { now };
const info = platforms.sql2022;
const allPlanColumns = { forcingType: true, planType: true };

const planColumnNames = [
    "plan_id",
    "query_id",
    "query_plan_hash",
    "is_forced_plan",
    "force_failure_count",
    "last_force_failure_reason_desc",
    "plan_forcing_type_desc",
    "plan_type_desc",
    "last_execution_time",
];

function planRow({
    planId = "9",
    queryId = "5",
    hash = "0x0A0B",
    forced = false,
    failures = 0,
    reason = "NONE",
    forcingType = forced ? "MANUAL" : "NONE",
    planType = "Compiled Plan",
    lastExecution = "2026-10-08 05:59:00.0000000 +00:00",
} = {}) {
    return [planId, queryId, hash, forced, failures, reason, forcingType, planType, lastExecution];
}

/** The result sets of the state batch: server time, the target plan, the forced plans. */
function stateSets({ plan = planRow(), forcedPlans = [], serverTime } = {}) {
    return [
        resultSet(["server_time"], [[serverTime ?? "2026-10-08 06:00:01.0000000 +00:00"]]),
        resultSet(planColumnNames, plan ? [plan] : []),
        resultSet(planColumnNames, forcedPlans),
    ];
}

function changeProbe(overrides = {}) {
    return probe({ planColumns: allPlanColumns, ...overrides });
}

const target = { queryId: 5, planId: 9 };

suite("prepare a plan change", () => {
    test("is unsupported outside the SQL Server engine platforms", async () => {
        for (const platform of [
            "synapseDedicated",
            "synapseServerless",
            "fabricWarehouse",
            "sqlAnalyticsEndpoint",
            "sql2014",
            "unknown",
        ]) {
            const reader = scriptedReader([]);
            for (const run of [
                perf.prepareForcePlan,
                perf.prepareUnforcePlan,
                perf.verifyForcedPlan,
            ]) {
                const result = await run(
                    reader,
                    platforms[platform],
                    { ...target, since: now },
                    options,
                );
                assert.equal(result.status, "unsupported", platform);
            }
            assert.equal(reader.calls.length, 0);
        }
    });

    test("prepares a force with the exact change batch and the prior state", async () => {
        const reader = scriptedReader([changeProbe(), stateSets()]);
        const result = await perf.prepareForcePlan(reader, info, target, options);

        assert.equal(result.status, "ready");
        const prepared = result.data;
        assert.equal(prepared.kind, "forcePlan");
        assert.deepEqual(prepared.target, { queryId: "5", planId: "9", replicaGroupId: "1" });
        assert.equal(
            prepared.sql,
            `${sessionPreamble(info, "change")}\n${perf.getForcePlanQuery(5, 9)}`,
        );
        assert.match(
            prepared.sql,
            /EXEC sys\.sp_query_store_force_plan @query_id = @query_id, @plan_id = @plan_id;$/,
        );
        assert.deepEqual(prepared.blockers, []);
        assert.deepEqual(prepared.warnings, []);
        assert.equal(prepared.prior.queryStoreStatus, "readWrite");
        assert.deepEqual(JSON.parse(JSON.stringify(prepared.prior.plan)), {
            planId: "9",
            queryId: "5",
            queryPlanHash: "0x0A0B",
            isForced: false,
            forcingType: "none",
            planType: "compiled",
            forceFailureCount: 0,
            lastForceFailureReason: "NONE",
            lastExecutionTime: "2026-10-08T05:59:00.000Z",
        });
        assert.deepEqual(prepared.prior.forcedPlans, []);
        assert.equal(prepared.prior.serverTimeUtc, "2026-10-08T06:00:01.000Z");

        assert.equal(reader.calls.length, 2);
        for (const sql of reader.calls) {
            assert.ok(sql.startsWith(sessionPreamble(info, "read")));
        }
        assert.match(reader.calls[0], /COL_LENGTH\('sys\.query_store_plan', 'plan_type_desc'\)/);
        assert.match(
            reader.calls[1],
            /DECLARE @query_id BIGINT = 5;\nDECLARE @plan_id BIGINT = 9;/,
        );
        assert.match(reader.calls[1], /p\.plan_forcing_type_desc,\n    p\.plan_type_desc,/);
        assert.match(
            reader.calls[1],
            /WHERE p\.query_id = @query_id\n    AND p\.is_forced_plan = 1;/,
        );
    });

    test("READ_ONLY Query Store is a blocker", async () => {
        const reader = scriptedReader([
            changeProbe({ state: 1, readOnlyReason: 0x20000 }),
            stateSets(),
        ]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.equal(result.status, "ready");
        assert.deepEqual(result.data.blockers, ["queryStoreNotReadWrite"]);
        assert.equal(result.data.prior.queryStoreStatus, "readOnly");
        assert.equal(result.data.prior.readOnlyReason, "stmtHashMapMemoryLimit");
    });

    test("OFF Query Store is a blocker", async () => {
        const reader = scriptedReader([changeProbe({ state: 0 }), stateSets()]);
        const result = await perf.prepareUnforcePlan(reader, info, target, options);
        assert.ok(result.data.blockers.includes("queryStoreNotReadWrite"));
    });

    test("a plan of another query is a blocker", async () => {
        const reader = scriptedReader([
            changeProbe(),
            stateSets({ plan: planRow({ queryId: "6" }) }),
        ]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.deepEqual(result.data.blockers, ["planNotForQuery"]);
    });

    test("a plan that is not in Query Store is a blocker", async () => {
        const reader = scriptedReader([changeProbe(), stateSets({ plan: null })]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.deepEqual(result.data.blockers, ["planNotFound"]);
        assert.equal(result.data.prior.plan, undefined);
    });

    test("a plan that automatic tuning forced is a blocker", async () => {
        const autoForced = planRow({ planId: "8", forced: true, forcingType: "AUTO" });
        const reader = scriptedReader([changeProbe(), stateSets({ forcedPlans: [autoForced] })]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.deepEqual(result.data.blockers, ["autoForcedPlan"]);
        assert.deepEqual(result.data.warnings, ["replacesForcedPlan"]);
        assert.equal(result.data.prior.forcedPlans[0].forcingType, "auto");

        const unforce = scriptedReader([
            changeProbe(),
            stateSets({
                plan: planRow({ forced: true, forcingType: "AUTO" }),
                forcedPlans: [planRow({ forced: true, forcingType: "AUTO" })],
            }),
        ]);
        const unforceResult = await perf.prepareUnforcePlan(unforce, info, target, options);
        assert.deepEqual(unforceResult.data.blockers, ["autoForcedPlan"]);
    });

    test("a manual forced plan for the query is replaced, with a warning", async () => {
        const other = planRow({ planId: "8", forced: true });
        const reader = scriptedReader([
            changeProbe(),
            stateSets({
                plan: planRow({ failures: 2, reason: "NO_INDEX" }),
                forcedPlans: [other],
            }),
        ]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.deepEqual(result.data.blockers, []);
        assert.deepEqual(result.data.warnings, ["replacesForcedPlan", "previousForceFailures"]);
    });

    test("flags dispatcher and variant plans", async () => {
        const dispatcher = scriptedReader([
            changeProbe(),
            stateSets({ plan: planRow({ planType: "Dispatcher Plan" }) }),
        ]);
        const dispatcherResult = await perf.prepareForcePlan(dispatcher, info, target, options);
        assert.deepEqual(dispatcherResult.data.blockers, ["dispatcherPlan"]);
        assert.equal(dispatcherResult.data.prior.plan.planType, "dispatcher");

        const variant = scriptedReader([
            changeProbe(),
            stateSets({ plan: planRow({ planType: "Query Variant Plan" }) }),
        ]);
        const variantResult = await perf.prepareForcePlan(variant, info, target, options);
        assert.deepEqual(variantResult.data.blockers, []);
        assert.deepEqual(variantResult.data.warnings, ["variantPlan"]);
    });

    test("forcing a forced plan or unforcing a plan that is not forced is a blocker", async () => {
        const forced = planRow({ forced: true });
        const force = scriptedReader([
            changeProbe(),
            stateSets({ plan: forced, forcedPlans: [forced] }),
        ]);
        assert.deepEqual(
            (await perf.prepareForcePlan(force, info, target, options)).data.blockers,
            ["planAlreadyForced"],
        );

        const unforce = scriptedReader([changeProbe(), stateSets()]);
        const result = await perf.prepareUnforcePlan(unforce, info, target, options);
        assert.deepEqual(result.data.blockers, ["planNotForced"]);
        assert.match(result.data.sql, /EXEC sys\.sp_query_store_unforce_plan/);
    });

    test("SQL Server 2016 does not have the forcing type and plan type columns", async () => {
        const sql2016 = platforms.sql2016;
        const reader = scriptedReader([
            changeProbe({ planColumns: { forcingType: false, planType: false } }),
            stateSets({ plan: planRow({ forcingType: null, planType: null }) }),
        ]);
        const result = await perf.prepareForcePlan(reader, sql2016, target, options);
        assert.match(reader.calls[1], /CAST\(NULL AS nvarchar\(60\)\) AS plan_forcing_type_desc/);
        assert.match(reader.calls[1], /CAST\(NULL AS nvarchar\(120\)\) AS plan_type_desc/);
        assert.doesNotMatch(reader.calls[1], /p\.plan_type_desc|p\.plan_forcing_type_desc/);
        assert.deepEqual(result.data.warnings, ["planForcingTypeUnknown"]);
        assert.equal(result.data.prior.plan.forcingType, undefined);
    });

    test("a secondary replica group reads the forcing locations", async () => {
        const reader = scriptedReader([changeProbe({ replicaColumn: true }), stateSets()]);
        const result = await perf.prepareForcePlan(
            reader,
            info,
            { ...target, replicaGroupId: 2 },
            options,
        );
        assert.match(reader.calls[1], /DECLARE @replica_group_id BIGINT = 2;/);
        assert.match(reader.calls[1], /sys\.query_store_plan_forcing_locations AS pfl/);
        assert.match(result.data.sql, /@replica_group_id = @replica_group_id;$/);
        assert.ok(result.data.warnings.includes("planForcingTypeUnknown"));

        const unavailable = scriptedReader([changeProbe({ replicaColumn: false })]);
        const unsupported = await perf.prepareForcePlan(
            unavailable,
            info,
            { ...target, replicaGroupId: 2 },
            options,
        );
        assert.equal(unsupported.status, "unsupported");
    });

    test("IDs that are not bigint values throw before a read", async () => {
        const reader = scriptedReader([]);
        await assert.rejects(
            perf.prepareForcePlan(reader, info, { queryId: "1 OR 1=1", planId: 1 }, options),
            RangeError,
        );
        assert.equal(reader.calls.length, 0);
    });

    test("a permission error gives permissionMissing", async () => {
        const reader = scriptedReader([new SqlReadError("denied", "server", 297)]);
        const result = await perf.prepareForcePlan(reader, info, target, options);
        assert.equal(result.status, "permissionMissing");
    });
});

suite("apply a prepared change", () => {
    async function prepare(state = {}) {
        const reader = scriptedReader([changeProbe(), stateSets(state)]);
        return (await perf.prepareForcePlan(reader, info, target, options)).data;
    }

    test("reads the state again and runs the prepared batch", async () => {
        const prepared = JSON.parse(JSON.stringify(await prepare()));
        const reader = scriptedReader([
            changeProbe(),
            stateSets({ serverTime: "2026-10-08 06:05:00.0000000 +00:00" }),
            [],
        ]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);

        assert.equal(result.status, "ready");
        assert.equal(result.data.applied, true);
        assert.deepEqual(result.data.blockers, []);
        assert.equal(result.data.appliedAtUtc, "2026-10-08T06:05:00.000Z");
        assert.equal(reader.calls.length, 3);
        assert.equal(reader.calls[2], prepared.sql);
        assert.ok(reader.calls[2].startsWith(sessionPreamble(info, "change")));
        assert.ok(reader.calls[1].startsWith(sessionPreamble(info, "read")));
    });

    test("refuses the change when the state changed after prepare", async () => {
        const prepared = await prepare();
        const reader = scriptedReader([
            changeProbe(),
            stateSets({ forcedPlans: [planRow({ planId: "8", forced: true })] }),
        ]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);
        assert.equal(result.status, "ready");
        assert.equal(result.data.applied, false);
        assert.deepEqual(result.data.blockers, ["stateChanged"]);
        assert.equal(result.data.current.forcedPlans.length, 1);
        assert.equal(reader.calls.length, 2);
    });

    test("ignores execution times and failure counts that change while the query runs", async () => {
        const prepared = await prepare();
        const reader = scriptedReader([
            changeProbe(),
            stateSets({ plan: planRow({ lastExecution: "2026-10-08 06:04:00 +00:00" }) }),
            [],
        ]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);
        assert.equal(result.data.applied, true);
    });

    test("refuses a change that has blockers now", async () => {
        const prepared = await prepare();
        const reader = scriptedReader([changeProbe({ state: 1 }), stateSets()]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);
        assert.equal(result.data.applied, false);
        assert.deepEqual(result.data.blockers, ["queryStoreNotReadWrite"]);
        assert.equal(reader.calls.length, 2);
    });

    test("refuses a prepared change with blockers", async () => {
        const prepared = await prepare({ plan: planRow({ queryId: "6" }) });
        assert.deepEqual(prepared.blockers, ["planNotForQuery"]);
        const reader = scriptedReader([
            changeProbe(),
            stateSets({ plan: planRow({ queryId: "6" }) }),
        ]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);
        assert.equal(result.data.applied, false);
        assert.deepEqual(result.data.blockers, ["planNotForQuery"]);
    });

    test("refuses SQL that is not the SQL for the target", async () => {
        const prepared = await prepare();
        const reader = scriptedReader([changeProbe(), stateSets()]);
        const result = await perf.applyPreparedChange(
            reader,
            info,
            { ...prepared, sql: `${prepared.sql}\nDROP TABLE dbo.Orders;` },
            options,
        );
        assert.equal(result.data.applied, false);
        assert.deepEqual(result.data.blockers, ["preparedSqlMismatch"]);
        assert.equal(reader.calls.length, 2);
    });

    test("maps a failure of the change", async () => {
        const prepared = await prepare();
        const reader = scriptedReader([
            changeProbe(),
            stateSets(),
            new SqlReadError("User does not have permission", "server", 297),
        ]);
        const result = await perf.applyPreparedChange(reader, info, prepared, options);
        assert.equal(result.status, "permissionMissing");
        assert.equal(result.error.errorNumber, 297);
    });
});

suite("verify a forced plan", () => {
    const executionColumns = [
        "plan_id",
        "query_plan_hash",
        "count_executions",
        "first_execution_time",
        "last_execution_time",
        "avg_duration_ms",
        "avg_cpu_time_ms",
    ];
    const since = "2026-10-08T06:05:00Z";

    /** The first result set: the end of the change interval, and the server time. */
    function windowSet({
        countedFrom = "2026-10-08 07:00:00.0000000 +00:00",
        serverTime = "2026-10-08 07:45:00.0000000 +00:00",
    } = {}) {
        return resultSet(["counted_from", "server_time"], [[countedFrom, serverTime]]);
    }

    test("reads the forced plan and the executions of each plan after the change interval", async () => {
        const reader = scriptedReader([
            changeProbe(),
            [
                windowSet(),
                resultSet(planColumnNames, [planRow({ forced: true })]),
                resultSet(executionColumns, [
                    [
                        "9",
                        "0x0A0B",
                        "40",
                        "2026-10-08 07:00:00 +00:00",
                        "2026-10-08 07:30:00 +00:00",
                        1.5,
                        1.25,
                    ],
                    ["12", "0x0a0b", 5, null, null, 2, 1],
                ]),
            ],
        ]);
        const result = await perf.verifyForcedPlan(reader, info, { ...target, since }, options);

        assert.equal(result.status, "ready");
        assert.equal(result.data.outcome, "forcedPlanInUse");
        assert.equal(result.data.since, "2026-10-08T06:05:00.000Z");
        assert.equal(result.data.countedFrom, "2026-10-08T07:00:00.000Z");
        assert.equal(result.data.plan.isForced, true);
        assert.deepEqual(
            result.data.executions.map((execution) => [
                execution.planId,
                execution.match,
                execution.executionCount,
            ]),
            [
                ["9", "forcedPlan", 40],
                ["12", "samePlanShape", 5],
            ],
        );
        assert.equal(result.data.executions[0].avgDurationMs, 1.5);
        assert.equal(result.data.executions[0].lastExecutionTime, "2026-10-08T07:30:00.000Z");
        const sql = reader.calls[1];
        assert.ok(sql.startsWith(sessionPreamble(info, "read")));
        assert.match(sql, /DECLARE @since DATETIMEOFFSET = '2026-10-08T06:05:00\.0000000\+00:00';/);
        assert.match(
            sql,
            /DECLARE @counted_from DATETIMEOFFSET = ISNULL\(\n {4}\(SELECT TOP \(1\) rsi\.end_time\n {4}FROM sys\.query_store_runtime_stats_interval AS rsi\n {4}WHERE rsi\.start_time <= @since\n {8}AND rsi\.end_time > @since\n/,
        );
        assert.match(
            sql,
            /SELECT @counted_from AS counted_from, SYSDATETIMEOFFSET\(\) AS server_time;/,
        );
        assert.match(
            sql,
            /JOIN sys\.query_store_runtime_stats_interval AS rsi\n {8}ON rsi\.runtime_stats_interval_id = rs\.runtime_stats_interval_id/,
        );
        assert.match(sql, /AND rsi\.start_time >= @counted_from/);
        assert.doesNotMatch(sql, /rs\.last_execution_time >= @since/);
        assert.match(sql, /GROUP BY p\.plan_id, p\.query_plan_hash;$/);
    });

    test("waits for the first interval after the change", async () => {
        const reader = scriptedReader([
            changeProbe(),
            [
                windowSet({ serverTime: "2026-10-08 06:20:00.0000000 +00:00" }),
                resultSet(planColumnNames, [planRow({ forced: true })]),
                resultSet(executionColumns),
            ],
        ]);
        const result = await perf.verifyForcedPlan(reader, info, { ...target, since }, options);
        assert.equal(result.status, "ready");
        assert.equal(result.data.outcome, "waitingForNextInterval");
        assert.equal(result.data.countedFrom, "2026-10-08T07:00:00.000Z");
    });

    test("counts from the time when no interval contains it", async () => {
        const reader = scriptedReader([
            changeProbe(),
            [
                windowSet({ countedFrom: "2026-10-08 06:05:00.0000000 +00:00" }),
                resultSet(planColumnNames, [planRow({ forced: true })]),
                resultSet(executionColumns),
            ],
        ]);
        const result = await perf.verifyForcedPlan(reader, info, { ...target, since }, options);
        assert.equal(result.data.countedFrom, "2026-10-08T06:05:00.000Z");
        assert.equal(result.data.outcome, "noExecutions");
    });

    test("reports executions of other plan shapes", async () => {
        const reader = scriptedReader([
            changeProbe(),
            [
                windowSet(),
                resultSet(planColumnNames, [
                    planRow({ forced: true, failures: 1, reason: "NO_INDEX" }),
                ]),
                resultSet(executionColumns, [["13", "0xFFFF", 7, null, null, 9, 9]]),
            ],
        ]);
        const result = await perf.verifyForcedPlan(reader, info, { ...target, since }, options);
        assert.equal(result.data.outcome, "otherPlansInUse");
        assert.equal(result.data.plan.lastForceFailureReason, "NO_INDEX");
        assert.equal(result.data.executions[0].match, "otherPlan");
    });

    test("reports a plan that is not forced, not found, or did not run", async () => {
        const notForced = scriptedReader([
            changeProbe(),
            [windowSet(), resultSet(planColumnNames, [planRow()]), resultSet(executionColumns)],
        ]);
        assert.equal(
            (await perf.verifyForcedPlan(notForced, info, { ...target, since }, options)).data
                .outcome,
            "notForced",
        );

        const noRuns = scriptedReader([
            changeProbe(),
            [
                windowSet(),
                resultSet(planColumnNames, [planRow({ forced: true })]),
                resultSet(executionColumns),
            ],
        ]);
        assert.equal(
            (await perf.verifyForcedPlan(noRuns, info, { ...target, since }, options)).data.outcome,
            "noExecutions",
        );

        const notFound = scriptedReader([
            changeProbe(),
            [
                windowSet(),
                resultSet(planColumnNames, [planRow({ queryId: "6" })]),
                resultSet(executionColumns),
            ],
        ]);
        const result = await perf.verifyForcedPlan(notFound, info, { ...target, since }, options);
        assert.equal(result.status, "noData");
        assert.equal(result.data.outcome, "planNotFound");
    });

    test("needs a valid time", async () => {
        await assert.rejects(
            perf.verifyForcedPlan(scriptedReader([]), info, { ...target, since: "yesterday" }),
            RangeError,
        );
    });

    test("filters the executions by the replica group", async () => {
        const reader = scriptedReader([
            changeProbe({ replicaColumn: true }),
            [windowSet(), resultSet(planColumnNames), resultSet(executionColumns)],
        ]);
        await perf.verifyForcedPlan(reader, info, { ...target, since }, options);
        assert.match(reader.calls[1], /DECLARE @replica_group_id BIGINT = 1;/);
        assert.match(reader.calls[1], /AND rs\.replica_group_id = @replica_group_id/);
    });
});
