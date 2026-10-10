/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { sessionPreamble } = require("../dist/index.js");
const perf = require("../dist/performance/index.js");
const { platforms, resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

const options = { now: new Date(Date.UTC(2026, 9, 8, 6)) };
const info = platforms.sql2022;

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
    days = 30,
    capture = 2,
    waits = 1,
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
                days,
                1,
                capture,
                200,
                waits,
            ],
        ]),
        resultSet(["can_alter"], [[canAlter]]),
    ];
}

suite("Query Store settings", () => {
    test("reads the settings and the ALTER permission", async () => {
        const reader = scriptedReader([settingsSets()]);
        const result = await perf.readQueryStoreSettings(reader, info, options);

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
        assert.ok(reader.calls[0].startsWith(sessionPreamble(info, "read")));
        assert.match(reader.calls[0], /HAS_PERMS_BY_NAME\(DB_NAME\(\), 'DATABASE', 'ALTER'\)/);
    });

    test("reads the read-only reason, and leaves out wait statistics on SQL Server 2016", async () => {
        const reader = scriptedReader([settingsSets({ actualState: 1, readOnlyReason: 0x10000 })]);
        const result = await perf.readQueryStoreSettings(reader, platforms.sql2016, options);

        assert.equal(result.data.settings.readOnlyReason, "diskSizeLimit");
        assert.equal(result.data.settings.waitStatsCapture, undefined);
        assert.equal(result.data.hasWaitStats, false);
        assert.doesNotMatch(reader.calls[0], /wait_stats_capture_mode/);
    });

    test("allows changes only on SQL Server, Managed Instance, and Azure SQL Database", async () => {
        for (const [platform, canChange] of [
            ["managedInstance", true],
            ["azureSql", true],
            ["fabricSqlDatabase", false],
        ]) {
            const reader = scriptedReader([settingsSets()]);
            const result = await perf.readQueryStoreSettings(reader, platforms[platform], options);
            assert.equal(result.data.canChange, canChange, platform);
        }
        for (const platform of ["sql2014", "synapseDedicated", "fabricWarehouse", "unknown"]) {
            const reader = scriptedReader([]);
            const result = await perf.readQueryStoreSettings(reader, platforms[platform], options);
            assert.equal(result.status, "unsupported", platform);
            assert.equal(reader.calls.length, 0, platform);
        }
    });

    test("prepares only the values that change", async () => {
        const reader = scriptedReader([settingsSets()]);
        const result = await perf.prepareQueryStoreSettingsChange(
            reader,
            info,
            {
                operationMode: "readWrite",
                captureMode: "auto",
                maxStorageMb: 2048,
                staleQueryThresholdDays: 30,
                intervalLengthMinutes: 60,
                waitStatsCapture: "off",
            },
            options,
        );

        assert.equal(result.status, "ready");
        assert.deepEqual(result.data.change, {
            maxStorageMb: 2048,
            intervalLengthMinutes: 60,
            waitStatsCapture: "off",
        });
        assert.deepEqual(result.data.blockers, []);
        assert.deepEqual(result.data.warnings, []);
        assert.equal(
            result.data.sql,
            `${sessionPreamble(info, "change")}\nALTER DATABASE CURRENT SET QUERY_STORE (\n    MAX_STORAGE_SIZE_MB = 2048,\n    INTERVAL_LENGTH_MINUTES = 60,\n    WAIT_STATS_CAPTURE_MODE = OFF\n);`,
        );
        assert.equal(result.data.prior.maxStorageMb, 1024);
    });

    test("turns Query Store on when it is off", async () => {
        const reader = scriptedReader([settingsSets({ actualState: 0 })]);
        const result = await perf.prepareQueryStoreSettingsChange(
            reader,
            info,
            { operationMode: "readWrite", captureMode: "auto" },
            options,
        );

        assert.deepEqual(result.data.change, { operationMode: "readWrite" });
        assert.deepEqual(result.data.warnings, ["turnsQueryStoreOn"]);
        assert.match(
            result.data.sql,
            /ALTER DATABASE CURRENT SET QUERY_STORE = ON \(\n {4}OPERATION_MODE = READ_WRITE\n\);$/,
        );
    });

    test("warns about changes that stop or limit the capture", async () => {
        const reader = scriptedReader([settingsSets()]);
        const result = await perf.prepareQueryStoreSettingsChange(
            reader,
            info,
            {
                operationMode: "readOnly",
                captureMode: "none",
                maxStorageMb: 100,
                intervalLengthMinutes: 5,
            },
            options,
        );

        assert.deepEqual(result.data.warnings, [
            "readOnlyStopsCapture",
            "captureNoneStopsNewQueries",
            "maxSizeBelowCurrentSize",
            "shorterIntervalUsesMoreStorage",
        ]);
    });

    test("blocks a change without a difference, a permission, or platform support", async () => {
        const noChange = await perf.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets({ canAlter: 0 })]),
            info,
            { maxStorageMb: 1024 },
            options,
        );
        assert.deepEqual(noChange.data.blockers, ["noChange", "permissionMissing"]);

        const fabric = await perf.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            platforms.fabricSqlDatabase,
            { maxStorageMb: 2048 },
            options,
        );
        assert.deepEqual(fabric.data.blockers, ["platformUnsupported"]);

        const sql2016 = await perf.prepareQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            platforms.sql2016,
            { waitStatsCapture: "on" },
            options,
        );
        assert.deepEqual(sql2016.data.blockers, ["waitStatsUnsupported"]);
    });

    test("applies a prepared change after it reads the settings again", async () => {
        const prepared = (
            await perf.prepareQueryStoreSettingsChange(
                scriptedReader([settingsSets()]),
                info,
                { maxStorageMb: 2048 },
                options,
            )
        ).data;
        const reader = scriptedReader([settingsSets({ currentMb: 250 }), []]);
        const result = await perf.applyQueryStoreSettingsChange(reader, info, prepared, options);

        assert.deepEqual(result.data, { applied: true, blockers: [] });
        assert.equal(reader.calls[1], prepared.sql);
        assert.ok(reader.calls[1].startsWith(sessionPreamble(info, "change")));
    });

    test("refuses a change when the settings changed or the SQL is not the change", async () => {
        const prepared = (
            await perf.prepareQueryStoreSettingsChange(
                scriptedReader([settingsSets()]),
                info,
                { maxStorageMb: 2048 },
                options,
            )
        ).data;

        const changed = scriptedReader([settingsSets({ interval: 60 })]);
        const refused = await perf.applyQueryStoreSettingsChange(changed, info, prepared, options);
        assert.deepEqual(refused.data, { applied: false, blockers: ["settingsChanged"] });
        assert.equal(changed.calls.length, 1);

        const edited = { ...prepared, sql: `${prepared.sql}\nDROP TABLE dbo.Orders;` };
        const mismatch = await perf.applyQueryStoreSettingsChange(
            scriptedReader([settingsSets()]),
            info,
            edited,
            options,
        );
        assert.deepEqual(mismatch.data, { applied: false, blockers: ["preparedSqlMismatch"] });

        const done = scriptedReader([settingsSets({ maxMb: 2048 })]);
        const already = await perf.applyQueryStoreSettingsChange(done, info, prepared, options);
        assert.deepEqual(already.data.blockers, ["noChange"]);
    });

    test("rejects values that are not valid", async () => {
        const reader = scriptedReader([]);
        for (const change of [
            { operationMode: "paused" },
            { captureMode: "sometimes" },
            { maxStorageMb: 0 },
            { maxStorageMb: 1.5 },
            { staleQueryThresholdDays: 0 },
            { intervalLengthMinutes: 7 },
            { waitStatsCapture: "yes" },
        ]) {
            await assert.rejects(
                perf.prepareQueryStoreSettingsChange(reader, info, change, options),
                RangeError,
                JSON.stringify(change),
            );
        }
        assert.equal(reader.calls.length, 0);
    });
});
