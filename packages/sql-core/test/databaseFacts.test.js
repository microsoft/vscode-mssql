/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, readDatabaseFacts, sessionPreamble } = require("../dist/index.js");
const { platforms, resultSet, scriptedReader } = require("../test-fixtures/fakeReader.js");

const editionColumns = ["server_edition", "database_edition", "service_objective"];
const denied = () => new SqlReadError("VIEW SERVER STATE permission was denied", "server", 300);

suite("database facts", () => {
    test("reads the service tier, objective, and vCores of Azure SQL Database", async () => {
        const info = platforms.azureSql;
        const reader = scriptedReader([
            [resultSet(editionColumns, [["SQL Azure", "GeneralPurpose", "GP_Gen5_8"]])],
            [resultSet(["cpu_limit"], [[8]])],
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, info), {
            edition: "GeneralPurpose",
            serviceObjective: "GP_Gen5_8",
            vCores: 8,
        });
        assert.equal(reader.calls.length, 2);
        for (const sql of reader.calls) {
            assert.ok(sql.startsWith(sessionPreamble(info, "read")));
        }
        assert.match(reader.calls[1], /sys\.dm_user_db_resource_governance/);
    });

    test("leaves out vCores on a DTU tier with less than one vCore", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["SQL Azure", "Basic", "Basic"]])],
            [resultSet(["cpu_limit"], [[0]])],
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, platforms.azureSql), {
            edition: "Basic",
            serviceObjective: "Basic",
        });
    });

    test("leaves out vCores without VIEW DATABASE STATE", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["SQL Azure", "Standard", "S2"]])],
            denied(),
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, platforms.azureSql), {
            edition: "Standard",
            serviceObjective: "S2",
        });
    });

    test("reads the edition and logical CPUs of SQL Server", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["Developer Edition (64-bit)", null, null]])],
            [resultSet(["cpu_count"], [[16]])],
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, platforms.sql2022), {
            edition: "Developer Edition (64-bit)",
            logicalCpus: 16,
        });
        assert.match(reader.calls[1], /sys\.dm_os_sys_info/);
    });

    test("reads the SKU and vCores of Azure SQL Managed Instance", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["SQL Azure", null, null]])],
            [resultSet(["sku", "virtual_core_count"], [["BusinessCritical", 16]])],
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, platforms.managedInstance), {
            edition: "BusinessCritical",
            vCores: 16,
        });
        assert.match(reader.calls[1], /master\.sys\.server_resource_stats/);
    });

    test("reads the service objective of a Synapse dedicated pool", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["SQL Azure", "DataWarehouse", "DW100c"]])],
        ]);

        assert.deepEqual(await readDatabaseFacts(reader, platforms.synapseDedicated), {
            edition: "DataWarehouse",
            serviceObjective: "DW100c",
        });
        assert.equal(reader.calls.length, 1);
    });

    test("reads nothing on platforms without a tier", async () => {
        for (const platform of [
            "fabricWarehouse",
            "sqlAnalyticsEndpoint",
            "synapseServerless",
            "unknown",
        ]) {
            const reader = scriptedReader([]);
            assert.deepEqual(await readDatabaseFacts(reader, platforms[platform]), {}, platform);
            assert.equal(reader.calls.length, 0, platform);
        }
    });

    test("fails when a read fails for another reason", async () => {
        const reader = scriptedReader([
            [resultSet(editionColumns, [["Developer Edition (64-bit)", null, null]])],
            new SqlReadError("Timeout expired", "timeout"),
        ]);

        await assert.rejects(readDatabaseFacts(reader, platforms.sql2022), SqlReadError);
    });
});
