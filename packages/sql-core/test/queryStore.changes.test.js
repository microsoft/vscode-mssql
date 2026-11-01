/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { sessionPreamble } = require("../dist/index.js");
const qs = require("../dist/queryStore/index.js");
const {
    capabilities,
    platforms,
    resultSet,
    scriptedReader,
    stateSet,
} = require("../test-fixtures/fakeReader.js");

const planColumns = [
    "plan_id",
    "query_id",
    "query_plan_hash",
    "is_forced_plan",
    "force_failure_count",
    "last_force_failure_reason_desc",
    "last_execution_time",
    "plan_forcing_type_desc",
    "plan_type_desc",
];

const planRow = ({
    planId = "7",
    queryId = "42",
    forced = false,
    failures = 0,
    forcingType = "NONE",
    planType = "Compiled Plan",
} = {}) => [planId, queryId, "0xAB", forced, failures, "NONE", null, forcingType, planType];

/** The result sets of the plan forcing state batch. */
function forcingState({ state = 2, plan = planRow(), forced = [] } = {}) {
    return [
        stateSet(state),
        resultSet(["server_time"], [["2026-10-08T06:00:00Z"]]),
        resultSet(planColumns, plan ? [plan] : []),
        resultSet(planColumns, forced),
    ];
}

const forceTarget = { kind: "forcePlan", queryId: "42", planId: "7" };

suite("plan forcing", () => {
    test("prepares a force with the exact batch it runs", async () => {
        const reader = scriptedReader([forcingState()]);
        const result = await qs.preparePlanChange(reader, capabilities(), forceTarget);

        assert.equal(result.status, "ready");
        assert.deepEqual(result.data.blockers, []);
        assert.deepEqual(result.data.warnings, []);
        assert.equal(
            result.data.sql,
            [
                sessionPreamble(platforms.sql2022, "change"),
                "DECLARE @query_id bigint = CAST(42 AS bigint);",
                "DECLARE @plan_id bigint = CAST(7 AS bigint);",
                "EXEC sys.sp_query_store_force_plan @query_id = @query_id, @plan_id = @plan_id;",
            ].join("\n"),
        );
        assert.equal(result.data.prior.serverTimeUtc, "2026-10-08T06:00:00.000Z");
    });

    test("blocks changes that must not run, and warns about the rest", async () => {
        const cases = [
            [{ state: 1 }, forceTarget, ["queryStoreNotReadWrite"], []],
            [{ plan: null }, forceTarget, ["planNotFound"], []],
            [{ plan: planRow({ queryId: "43" }) }, forceTarget, ["planNotForQuery"], []],
            [{ plan: planRow({ forced: true }) }, forceTarget, ["planAlreadyForced"], []],
            [
                { plan: planRow({ planType: "Dispatcher Plan" }) },
                forceTarget,
                ["dispatcherPlan"],
                [],
            ],
            [
                { forced: [planRow({ planId: "8", forced: true, forcingType: "AUTO" })] },
                forceTarget,
                ["autoForcedPlan"],
                ["replacesForcedPlan"],
            ],
            [{ plan: planRow({ failures: 2 }) }, forceTarget, [], ["previousForceFailures"]],
            [{}, { ...forceTarget, kind: "unforcePlan" }, ["planNotForced"], []],
        ];
        for (const [state, target, blockers, warnings] of cases) {
            const result = await qs.preparePlanChange(
                scriptedReader([forcingState(state)]),
                capabilities(),
                target,
            );
            assert.deepEqual(result.data.blockers, blockers, JSON.stringify(state));
            assert.deepEqual(result.data.warnings, warnings, JSON.stringify(state));
        }
    });

    test("applies a prepared change after it reads the state again", async () => {
        const prepared = (
            await qs.preparePlanChange(
                scriptedReader([forcingState()]),
                capabilities(),
                forceTarget,
            )
        ).data;
        const reader = scriptedReader([forcingState(), []]);
        const result = await qs.applyPlanChange(reader, capabilities(), prepared);

        assert.deepEqual(result.data, {
            applied: true,
            blockers: [],
            appliedAtUtc: "2026-10-08T06:00:00.000Z",
        });
        assert.equal(reader.calls[1], prepared.sql);
    });

    test("refuses a change whose state or SQL changed", async () => {
        const prepared = (
            await qs.preparePlanChange(
                scriptedReader([forcingState()]),
                capabilities(),
                forceTarget,
            )
        ).data;

        const other = scriptedReader([
            forcingState({ forced: [planRow({ planId: "8", forced: true })] }),
        ]);
        const changed = await qs.applyPlanChange(other, capabilities(), prepared);
        assert.deepEqual(changed.data, { applied: false, blockers: ["stateChanged"] });
        assert.equal(other.calls.length, 1);

        const edited = { ...prepared, sql: `${prepared.sql}\nDROP TABLE dbo.Orders;` };
        const mismatch = await qs.applyPlanChange(
            scriptedReader([forcingState()]),
            capabilities(),
            edited,
        );
        assert.deepEqual(mismatch.data, { applied: false, blockers: ["preparedSqlMismatch"] });
    });

    test("rejects a target that is not a plan change", async () => {
        const reader = scriptedReader([]);
        await assert.rejects(
            qs.preparePlanChange(reader, capabilities(), { ...forceTarget, kind: "drop" }),
            RangeError,
        );
        await assert.rejects(
            qs.preparePlanChange(reader, capabilities(), { ...forceTarget, planId: "7 OR 1=1" }),
            RangeError,
        );
        assert.equal(reader.calls.length, 0);
    });

    test("verifies whether new executions use the forced plan", async () => {
        const verification = (executions, serverTime = "2026-10-08T08:00:00Z") =>
            scriptedReader([
                [
                    stateSet(),
                    resultSet(
                        ["counted_from", "server_time"],
                        [["2026-10-08T07:00:00Z", serverTime]],
                    ),
                    resultSet(planColumns, [planRow({ forced: true })]),
                    resultSet(["plan_id", "query_plan_hash", "executions"], executions),
                ],
            ]);
        const request = { queryId: "42", planId: "7", sinceUtc: "2026-10-08T06:30:00Z" };

        const inUse = await qs.verifyForcedPlan(
            verification([
                ["7", "0xAB", 3],
                ["9", "0xab", 2],
            ]),
            capabilities(),
            request,
        );
        assert.equal(inUse.data.outcome, "forcedPlanInUse");
        assert.deepEqual(
            inUse.data.executions.map((execution) => execution.match),
            ["forcedPlan", "samePlanShape"],
        );
        assert.equal(inUse.data.countedFromUtc, "2026-10-08T07:00:00.000Z");

        const other = await qs.verifyForcedPlan(
            verification([["10", "0xCD", 1]]),
            capabilities(),
            request,
        );
        assert.equal(other.data.outcome, "otherPlansInUse");

        const waiting = await qs.verifyForcedPlan(
            verification([], "2026-10-08T06:45:00Z"),
            capabilities(),
            request,
        );
        assert.equal(waiting.data.outcome, "waitingForNextInterval");
    });
});

const settingsColumns = [
    "actual_state",
    "desired_state",
    "readonly_reason",
    "current_storage_size_mb",
    "max_storage_size_mb",
    "flush_interval_seconds",
    "interval_length_minutes",
    "stale_query_threshold_days",
    "size_based_cleanup_mode",
    "query_capture_mode",
    "max_plans_per_query",
    "wait_stats_capture_mode",
];

/** The result sets of the settings batch: read-write, 246 of 1,024 MB, AUTO capture. */
function settingsSets({
    actualState = 2,
    readOnlyReason = 0,
    currentMb = 246,
    maxMb = 1024,
    interval = 15,
    capture = 2,
    canAlter = 1,
} = {}) {
    return [
        resultSet(settingsColumns, [
            [
                actualState,
                actualState,
                readOnlyReason,
                currentMb,
                maxMb,
                900,
                interval,
                30,
                1,
                capture,
                200,
                1,
            ],
        ]),
        resultSet(["can_alter"], [[canAlter]]),
    ];
}

const sql2016 = capabilities({
    platform: platforms.sql2016,
    hasWaitStatsCapture: false,
    hasCapturePolicy: false,
});

suite("Query Store settings", () => {
    test("reads the settings and the ALTER permission", async () => {
        const reader = scriptedReader([settingsSets()]);
        const result = await qs.readQueryStoreSettings(reader, capabilities());

        assert.equal(result.status, "ready");
        assert.deepEqual(result.data, {
            settings: {
                actualState: "readWrite",
                desiredState: "readWrite",
                currentStorageMb: 246,
                maxStorageMb: 1024,
                intervalLengthMinutes: 15,
                staleQueryThresholdDays: 30,
                captureMode: "auto",
                sizeBasedCleanup: "auto",
                waitStatsCapture: "on",
                maxPlansPerQuery: 200,
                flushIntervalSeconds: 900,
            },
            canAlter: true,
            canChange: true,
            hasWaitStats: true,
            hasCapturePolicy: true,
            canTurnOff: true,
        });
        assert.match(reader.calls[0], /HAS_PERMS_BY_NAME\(DB_NAME\(\), 'DATABASE', 'ALTER'\)/);
    });

    test("reads the read-only reason, and leaves out what SQL Server 2016 does not have", async () => {
        const reader = scriptedReader([settingsSets({ actualState: 1, readOnlyReason: 0x10000 })]);
        const result = await qs.readQueryStoreSettings(reader, sql2016);

        assert.equal(result.data.settings.readOnlyReason, "sizeLimit");
        assert.equal(result.data.settings.waitStatsCapture, undefined);
        assert.equal(result.data.hasWaitStats, false);
        assert.doesNotMatch(reader.calls[0], /wait_stats_capture_mode|capture_policy/);
    });

    test("allows changes only on SQL Server, Managed Instance, and Azure SQL Database", async () => {
        for (const [platform, canChange, canTurnOff] of [
            ["managedInstance", true, true],
            ["azureSql", true, false],
            ["fabricSqlDatabase", false, true],
        ]) {
            const result = await qs.readQueryStoreSettings(
                scriptedReader([settingsSets()]),
                capabilities({ platform: platforms[platform] }),
            );
            assert.equal(result.data.canChange, canChange, platform);
            assert.equal(result.data.canTurnOff, canTurnOff, platform);
        }
        const reader = scriptedReader([]);
        const unsupported = await qs.readQueryStoreSettings(
            reader,
            capabilities({ platform: platforms.fabricWarehouse, supported: false }),
        );
        assert.equal(unsupported.status, "unsupported");
        assert.equal(reader.calls.length, 0);
    });

    test("prepares only the values that change", async () => {
        const result = await qs.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            capabilities(),
            {
                operationMode: "readWrite",
                captureMode: "auto",
                maxStorageMb: 2048,
                intervalLengthMinutes: 60,
                waitStatsCapture: "off",
            },
        );

        assert.deepEqual(result.data.change, {
            maxStorageMb: 2048,
            intervalLengthMinutes: 60,
            waitStatsCapture: "off",
        });
        assert.deepEqual(result.data.blockers, []);
        assert.equal(
            result.data.sql,
            `${sessionPreamble(platforms.sql2022, "change")}\nALTER DATABASE CURRENT SET QUERY_STORE (\n    MAX_STORAGE_SIZE_MB = 2048,\n    INTERVAL_LENGTH_MINUTES = 60,\n    WAIT_STATS_CAPTURE_MODE = OFF\n);`,
        );
    });

    test("turns Query Store on when it is off", async () => {
        const result = await qs.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets({ actualState: 0 })]),
            capabilities(),
            { operationMode: "readWrite", captureMode: "auto" },
        );

        assert.deepEqual(result.data.change, { operationMode: "readWrite" });
        assert.deepEqual(result.data.warnings, ["turnsQueryStoreOn"]);
        assert.match(
            result.data.sql,
            /SET QUERY_STORE = ON \(\n {4}OPERATION_MODE = READ_WRITE\n\);$/,
        );
    });

    test("blocks a change without a difference, a permission, or support", async () => {
        const noChange = await qs.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets({ canAlter: 0 })]),
            capabilities(),
            { maxStorageMb: 1024 },
        );
        assert.deepEqual(noChange.data.blockers, ["noChange", "permissionMissing"]);

        const waits = await qs.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            sql2016,
            { waitStatsCapture: "on" },
        );
        assert.deepEqual(waits.data.blockers, ["waitStatsUnsupported"]);
    });

    test("applies a prepared change, and refuses one whose settings changed", async () => {
        const prepared = (
            await qs.prepareQueryStoreSettingsChange(
                scriptedReader([settingsSets()]),
                capabilities(),
                { maxStorageMb: 2048 },
            )
        ).data;

        const reader = scriptedReader([settingsSets({ currentMb: 250 }), []]);
        const applied = await qs.applyQueryStoreSettingsChange(reader, capabilities(), prepared);
        assert.deepEqual(applied.data, { applied: true, blockers: [] });
        assert.equal(reader.calls[1], prepared.sql);

        const changed = await qs.applyQueryStoreSettingsChange(
            scriptedReader([settingsSets({ interval: 60 })]),
            capabilities(),
            prepared,
        );
        assert.deepEqual(changed.data, { applied: false, blockers: ["settingsChanged"] });

        const mismatch = await qs.applyQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            capabilities(),
            { ...prepared, sql: `${prepared.sql}\nDROP TABLE dbo.Orders;` },
        );
        assert.deepEqual(mismatch.data, { applied: false, blockers: ["preparedSqlMismatch"] });
    });

    test("rejects values that are not valid", async () => {
        const reader = scriptedReader([]);
        for (const change of [
            { operationMode: "paused" },
            { captureMode: "sometimes" },
            { maxStorageMb: 0 },
            { intervalLengthMinutes: 7 },
            { waitStatsCapture: "yes" },
        ]) {
            await assert.rejects(
                qs.prepareQueryStoreSettingsChange(reader, capabilities(), change),
                RangeError,
                JSON.stringify(change),
            );
        }
        assert.equal(reader.calls.length, 0);
    });
});
