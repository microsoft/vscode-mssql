/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional mutation smoke for the disposable localhost database protocol.
 * The connection string is parsed in-host and is never logged or persisted.
 * CI without the STS2 lane skips this suite. */

import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { expect } from "chai";
import {
    buildCreateLocalSandboxSql,
    buildDropLocalSandboxSql,
    buildProbeLocalSandboxSql,
    localSandboxDatabaseName,
    localSandboxOwnershipPropertyName,
} from "../../src/runbookStudio/runtime/localSandboxOperations";

const CONNECTION_STRING =
    process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING ?? process.env.STS2_SQLSERVER_CONNSTRING;

suite("Runbook Studio local sandbox live smoke (gated)", function () {
    this.timeout(90_000);

    suiteSetup(function () {
        if (!CONNECTION_STRING || !isLoopbackConnectionString(CONNECTION_STRING)) {
            this.skip();
        }
        const probe = spawnSync("sqlcmd", ["-?"], { encoding: "utf8", timeout: 15_000 });
        if (probe.error) {
            this.skip();
        }
    });

    test("creates, proves ownership, refuses marker drift, and cleans up", () => {
        const effectId = `effect-${randomBytes(32).toString("hex")}`;
        const databaseName = localSandboxDatabaseName(effectId);
        const createSql = buildCreateLocalSandboxSql(databaseName, effectId);
        const probeSql = buildProbeLocalSandboxSql(databaseName);
        const dropSql = buildDropLocalSandboxSql(databaseName, effectId);
        let created = false;
        try {
            expect(runSqlcmd(createSql).status).to.equal(0);
            created = true;
            expect(runSqlcmd(probeSql).stdout).to.include(`1|${effectId}`);
            const sqlTest = runSqlcmd(sqlAssertionSql(databaseName));
            expect(sqlTest.status).to.equal(0);
            expect(sqlTest.stdout).to.include("ownership marker|1|marker present");

            expect(runSqlcmd(updateMarkerSql(databaseName, "tampered")).status).to.equal(0);
            const refused = runSqlcmd(dropSql);
            expect(refused.status).to.not.equal(0);
            expect(runSqlcmd(probeSql).stdout).to.include("1|tampered");

            expect(runSqlcmd(updateMarkerSql(databaseName, effectId)).status).to.equal(0);
            expect(runSqlcmd(dropSql).status).to.equal(0);
            created = false;
            expect(runSqlcmd(probeSql).stdout).to.match(/0\|(?:NULL)?/);
        } finally {
            if (created) {
                // Only reclaim a database carrying one of this test's two
                // known marker values. Unknown ownership remains untouched.
                runSqlcmd(safeTestCleanupSql(databaseName, effectId, dropSql));
            }
        }
    });
});

function runSqlcmd(sql: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync("sqlcmd", [...sqlcmdArgs(CONNECTION_STRING!), "-Q", sql], {
        encoding: "utf8",
        timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sqlcmdArgs(connectionString: string): string[] {
    const values = parseConnectionString(connectionString);
    const args = [
        "-S",
        values.get("server") ?? values.get("data source") ?? "localhost",
        "-d",
        "master",
        "-I",
        "-b",
        "-h",
        "-1",
        "-W",
        "-s",
        "|",
    ];
    const user = values.get("user id") ?? values.get("uid");
    if (user !== undefined) {
        args.push("-U", user, "-P", values.get("password") ?? values.get("pwd") ?? "");
    } else {
        args.push("-E");
    }
    if ((values.get("trustservercertificate") ?? "").toLowerCase() === "true") {
        args.push("-C");
    }
    return args;
}

function parseConnectionString(connectionString: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const part of connectionString.split(";")) {
        const separator = part.indexOf("=");
        if (separator > 0) {
            values.set(
                part.slice(0, separator).trim().toLowerCase(),
                part.slice(separator + 1).trim(),
            );
        }
    }
    return values;
}

function isLoopbackConnectionString(connectionString: string): boolean {
    const values = parseConnectionString(connectionString);
    const server = (values.get("server") ?? values.get("data source") ?? "")
        .replace(/^tcp:/i, "")
        .toLowerCase();
    return /^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\\,].+)?$/.test(server);
}

function updateMarkerSql(databaseName: string, marker: string): string {
    const property = localSandboxOwnershipPropertyName(databaseName);
    return `EXEC sys.sp_updateextendedproperty @name = N'${property}', @value = N'${marker}';`;
}

function sqlAssertionSql(databaseName: string): string {
    return [
        "SELECT N'ownership marker' AS test_name,",
        `CAST(CASE WHEN EXISTS (SELECT 1 FROM [${databaseName}].sys.extended_properties WHERE [class] = 0 AND [name] = N'RunbookStudioLeaseId') THEN 1 ELSE 0 END AS bit) AS passed,`,
        "N'marker present' AS message;",
    ].join(" ");
}

function safeTestCleanupSql(databaseName: string, effectId: string, dropSql: string): string {
    const property = localSandboxOwnershipPropertyName(databaseName);
    return [
        `IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N'${property}' AND CAST([value] AS nvarchar(4000)) IN (N'${effectId}', N'tampered'))`,
        "BEGIN",
        `    EXEC sys.sp_updateextendedproperty @name = N'${property}', @value = N'${effectId}';`,
        dropSql,
        "END;",
    ].join("\n");
}
