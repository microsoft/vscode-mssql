/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional mutation smoke for the user-named localhost development lease.
 * The test creates an absent random database, applies the same reviewed
 * transactional CREATE TABLE wrapper used by the activity, proves marker
 * tamper refusal, and removes only the database carrying its exact marker. */

import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { expect } from "chai";
import {
    buildCreateLocalDevelopmentDatabaseSql,
    buildDropLocalDevelopmentDatabaseSql,
    buildProbeLocalDevelopmentDatabaseSql,
    localDevelopmentDatabaseOwnershipPropertyName,
} from "../../src/runbookStudio/runtime/localDevelopmentDatabaseOperations";
import {
    buildTransactionalCreateTableSql,
    validateLocalCreateTableSql,
} from "../../src/runbookStudio/schemaMutationPolicy";

const CONNECTION_STRING =
    process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING ?? process.env.STS2_SQLSERVER_CONNSTRING;

suite("Runbook Studio named development database live smoke (gated)", function () {
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

    test("creates an absent named lease, applies reviewed DDL, refuses drift, and cleans up", () => {
        const effectId = `effect-${randomBytes(32).toString("hex")}`;
        const databaseName = `RbsLive${randomBytes(8).toString("hex")}`;
        const createSql = buildCreateLocalDevelopmentDatabaseSql(databaseName, effectId);
        const probeSql = buildProbeLocalDevelopmentDatabaseSql(databaseName);
        const dropSql = buildDropLocalDevelopmentDatabaseSql(databaseName, effectId);
        const policy = validateLocalCreateTableSql(
            "CREATE TABLE [dbo].[RunbookSmoke] ([Id] int NOT NULL PRIMARY KEY);",
        );
        expect(policy).not.to.equal(undefined);
        let created = false;
        try {
            expect(runSqlcmd(createSql).status).to.equal(0);
            created = true;
            expect(runSqlcmd(probeSql).stdout).to.include(`1|${effectId}`);

            const apply = runSqlcmd(buildTransactionalCreateTableSql(policy!), databaseName);
            expect(apply.status).to.equal(0);
            expect(apply.stdout).to.match(/(?:^|\r?\n)1(?:\r?\n|$)/);
            expect(runSqlcmd(tableProbeSql(databaseName)).stdout).to.include("1");

            expect(runSqlcmd(updateMarkerSql(databaseName, "tampered")).status).to.equal(0);
            expect(runSqlcmd(dropSql).status).to.not.equal(0);
            expect(runSqlcmd(probeSql).stdout).to.include("1|tampered");

            expect(runSqlcmd(updateMarkerSql(databaseName, effectId)).status).to.equal(0);
            expect(runSqlcmd(dropSql).status).to.equal(0);
            created = false;
            expect(runSqlcmd(probeSql).stdout).to.match(/0\|(?:NULL)?/);
        } finally {
            if (created) {
                runSqlcmd(safeTestCleanupSql(databaseName, effectId, dropSql));
            }
        }
    });
});

function runSqlcmd(
    sql: string,
    database = "master",
): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync("sqlcmd", [...sqlcmdArgs(CONNECTION_STRING!, database), "-Q", sql], {
        encoding: "utf8",
        timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sqlcmdArgs(connectionString: string, database: string): string[] {
    const values = parseConnectionString(connectionString);
    const args = [
        "-S",
        values.get("server") ?? values.get("data source") ?? "localhost",
        "-d",
        database,
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
    const property = localDevelopmentDatabaseOwnershipPropertyName(databaseName);
    return `EXEC sys.sp_updateextendedproperty @name = N'${property}', @value = N'${marker}';`;
}

function tableProbeSql(databaseName: string): string {
    return `SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM [${databaseName}].sys.tables AS t INNER JOIN [${databaseName}].sys.schemas AS s ON s.[schema_id] = t.[schema_id] WHERE t.[name] = N'RunbookSmoke' AND s.[name] = N'dbo') THEN 1 ELSE 0 END AS int);`;
}

function safeTestCleanupSql(databaseName: string, effectId: string, dropSql: string): string {
    const property = localDevelopmentDatabaseOwnershipPropertyName(databaseName);
    return [
        `IF EXISTS (SELECT 1 FROM master.sys.extended_properties WHERE [class] = 0 AND [name] = N'${property}' AND CAST([value] AS nvarchar(4000)) IN (N'${effectId}', N'tampered'))`,
        "BEGIN",
        `    EXEC sys.sp_updateextendedproperty @name = N'${property}', @value = N'${effectId}';`,
        dropSql,
        "END;",
    ].join("\n");
}
