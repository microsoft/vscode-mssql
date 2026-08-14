/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL compatibility and engine feature profiles", () => {
    // Verifies SQL Server 2022 named WINDOW syntax is gated while its superset tree stays intact.
    test("gates named WINDOW by compatibility level", () => {
        const sql = "SELECT SUM(v) OVER w FROM dbo.t WINDOW w AS (ORDER BY id);";
        const old = parse(sql, profile(15, 150, "sql-server"));
        const current = parse(sql, profile(16, 160, "sql-server"));

        assert.equal(old.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(old.diagnostics, [near(sql, "WINDOW")]);
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
            old.diagnostics.map((diagnostic) => diagnostic.message),
            [
                "Incorrect syntax near 'JSON'.",
                "Incorrect syntax near 'VECTOR'.",
                "Incorrect syntax near 'JSON'.",
                "Incorrect syntax near 'VECTOR'.",
            ],
        );
        assert.deepEqual(current.diagnostics, []);
    });

    // Verifies server-instance HADR and media operations are rejected for Azure SQL profiles.
    test("gates server-instance statements by engine flavor", () => {
        const sql = `BACKUP DATABASE db TO DISK = 'db.bak';
RESTORE FILELISTONLY FROM DISK = 'db.bak';
DROP AVAILABILITY GROUP ag;`;
        const azure = parse(sql, profile(17, 170, "azure-sql"));
        const server = parse(sql, profile(17, 170, "sql-server"));

        assert.equal(azure.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            azure.diagnostics.map((diagnostic) => diagnostic.message),
            [
                "Incorrect syntax near 'BACKUP'.",
                "Incorrect syntax near 'RESTORE'.",
                "Incorrect syntax near 'AVAILABILITY'.",
            ],
        );
        assert.deepEqual(server.diagnostics, []);
    });

    // Verifies profile diagnostics preserve exact, case-insensitive keyword spans.
    test("reports feature gates at exact UTF-16 keyword ranges", () => {
        const sql = "select sum(v) over w from t window w as (order by id);";
        const snapshot = parse(sql, profile(15, 150, "sql-server"));

        assert.deepEqual(snapshot.diagnostics, [near(sql, "window")]);
    });
});

function profile(serverMajorVersion, compatibilityLevel, engineFlavor) {
    return { serverMajorVersion, compatibilityLevel, engineFlavor, previewFeatures: false };
}

function near(sql, word) {
    const start = sql.toLowerCase().indexOf(word.toLowerCase());
    return {
        code: "syntax",
        message: `Incorrect syntax near '${word.toUpperCase()}'.`,
        severity: "error",
        range: { start, end: start + word.length },
    };
}

function parse(sql, selectedProfile) {
    return new LezerSyntaxService(undefined, selectedProfile).parse(
        new ImmutableTextSnapshot("file:///profile.sql", 1, sql),
    );
}
