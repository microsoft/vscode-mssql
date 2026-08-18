/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("profile.sql");

suite("T-SQL compatibility and engine feature profiles", () => {
    // Verifies SQL Server 2022 named WINDOW syntax is gated while its superset tree stays intact.
    test("gates named WINDOW by compatibility level", () => {
        const sql = "SELECT SUM(v) OVER w FROM dbo.t WINDOW w AS (ORDER BY id);";
        const old = parse(sql, profile(15, 150, "sql-server"));
        const current = parse(sql, profile(16, 160, "sql-server"));

        assert.equal(old.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(old.diagnostics, [
            unavailable(sql, "WINDOW", {
                featureId: "clause.named-window",
                displayName: "The named WINDOW clause",
                family: "query",
                kind: "version",
                profile: "sql-server",
                requirement:
                    "It requires SQL Server 2022 or later with database compatibility level 160 or higher.",
            }),
        ]);
        assert.deepEqual(current.diagnostics, []);
    });

    // Verifies native JSON/VECTOR types and indexes are all gated before SQL Server 2025.
    test("gates SQL Server 2025 JSON and VECTOR syntax", () => {
        const sql = `CREATE TABLE dbo.Modern (j json, v vector(3));
CREATE JSON INDEX ixj ON dbo.Modern(j);
CREATE VECTOR INDEX ixv ON dbo.Modern(v);`;
        const old = parse(sql, profile(16, 160, "sql-server"));
        const current = parse(sql, profile(17, 170, "sql-server"));

        assert.equal(old.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            old.diagnostics.map((diagnostic) => diagnostic.availability.featureId),
            [
                "type.json",
                "type.vector",
                "statement.create-json-index",
                "statement.create-vector-index",
            ],
        );
        assert.deepEqual(
            old.diagnostics.map((diagnostic) => diagnostic.code),
            Array(4).fill("FeatureNotAvailable"),
        );
        assert.deepEqual(current.diagnostics, []);
    });

    // Verifies server-instance HADR and media operations are rejected for Azure SQL Database while
    // Managed Instance, which is instance-scoped, keeps them.
    test("gates server-instance statements by engine profile", () => {
        const sql = `BACKUP DATABASE db TO DISK = 'db.bak';
RESTORE FILELISTONLY FROM DISK = 'db.bak';
DROP AVAILABILITY GROUP ag;`;
        const azure = parse(sql, profile(17, 170, "azure-sql-database"));
        const managedInstance = parse(sql, profile(17, 170, "azure-sql-managed-instance"));
        const server = parse(sql, profile(17, 170, "sql-server"));

        assert.equal(azure.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            azure.diagnostics.map((diagnostic) => diagnostic.availability.featureId),
            ["statement.backup", "statement.restore", "statement.availability-group"],
        );
        assert.deepEqual(
            azure.diagnostics.map((diagnostic) => diagnostic.message),
            [
                "The BACKUP statement (near 'BACKUP') is not available on Azure SQL Database (compatibility level 170). It is available on SQL Server and Azure SQL Managed Instance.",
                "The RESTORE statement (near 'RESTORE') is not available on Azure SQL Database (compatibility level 170). It is available on SQL Server and Azure SQL Managed Instance.",
                "Availability group statements is not available on Azure SQL Database (compatibility level 170). It is available on SQL Server.",
            ],
        );
        // Managed Instance keeps media operations and loses only the instance-clustering statement.
        assert.deepEqual(
            managedInstance.diagnostics.map((diagnostic) => diagnostic.availability.featureId),
            ["statement.availability-group"],
        );
        assert.deepEqual(server.diagnostics, []);
    });

    // Verifies an unidentified engine defers every platform decision instead of guessing one.
    test("defers platform availability while the engine is unknown", () => {
        const sql = `BACKUP DATABASE db TO DISK = 'db.bak';
SELECT * FROM t ORDER BY ALL;`;
        const unknown = parse(sql, {
            engineProfile: "unknown",
            previewFeatures: false,
        });

        assert.equal(unknown.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(unknown.diagnostics, []);
    });

    // Verifies a version gate also defers when the engine reported no level at all.
    test("defers version availability when no level was reported", () => {
        const sql = "SELECT SUM(v) OVER w FROM dbo.t WINDOW w AS (ORDER BY id);";
        const snapshot = parse(sql, { engineProfile: "unknown", previewFeatures: false });

        assert.deepEqual(snapshot.diagnostics, []);
    });

    // Verifies profile diagnostics preserve exact, case-insensitive keyword spans.
    test("reports feature gates at exact UTF-16 keyword ranges", () => {
        const sql = "select sum(v) over w from t window w as (order by id);";
        const snapshot = parse(sql, profile(15, 150, "sql-server"));

        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.range),
            [{ start: sql.indexOf("window"), end: sql.indexOf("window") + "window".length }],
        );
    });
});

function profile(serverMajorVersion, compatibilityLevel, engineProfile) {
    return { serverMajorVersion, compatibilityLevel, engineProfile, previewFeatures: false };
}

function unavailable(sql, word, availability) {
    const start = sql.toLowerCase().indexOf(word.toLowerCase());
    return {
        code: "FeatureNotAvailable",
        message: `${availability.displayName} (near '${word.toUpperCase()}') is not available on SQL Server 2019 (compatibility level 150). ${availability.requirement}`,
        severity: "error",
        range: { start, end: start + word.length },
        availability,
    };
}
