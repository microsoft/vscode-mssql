/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio session options (SSMS parity): deterministic SET batch from
 * mssql.query.* settings, whitelisting/validation (settings text never rides
 * raw into SQL), and the per-query timeout mapping.
 */

import { expect } from "chai";
import {
    QUERY_SESSION_DEFAULTS,
    buildSessionOptionsBatch,
    executionTimeoutMs,
    readQuerySessionOptions,
} from "../../src/queryStudio/sessionOptions";

function reader(overrides: Record<string, unknown>) {
    return <T>(key: string, fallback: T): T =>
        key in overrides ? (overrides[key] as T) : fallback;
}

suite("queryStudio session options", () => {
    test("default settings produce the canonical SET batch", () => {
        const batch = buildSessionOptionsBatch(QUERY_SESSION_DEFAULTS);
        expect(batch.split("\n")).to.deep.equal([
            "SET QUOTED_IDENTIFIER ON;",
            "SET ANSI_NULL_DFLT_ON ON;",
            "SET ANSI_NULLS ON;",
            "SET ANSI_PADDING ON;",
            "SET ANSI_WARNINGS ON;",
            "SET IMPLICIT_TRANSACTIONS OFF;",
            "SET CURSOR_CLOSE_ON_COMMIT OFF;",
            "SET ARITHABORT ON;",
            "SET XACT_ABORT OFF;",
            "SET NOCOUNT OFF;",
            "SET STATISTICS TIME OFF;",
            "SET STATISTICS IO OFF;",
            "SET ROWCOUNT 0;",
            "SET TEXTSIZE 2147483647;",
            "SET LOCK_TIMEOUT -1;",
            "SET DEADLOCK_PRIORITY NORMAL;",
            "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;",
        ]);
        // Governor limit is unset by default (-1 -> omitted); NOEXEC never
        // appears unless explicitly ON.
        expect(batch).to.not.contain("QUERY_GOVERNOR_COST_LIMIT");
        expect(batch).to.not.contain("NOEXEC");
    });

    test("ANSI_DEFAULTS collapses the individual ANSI statements", () => {
        const options = readQuerySessionOptions(reader({ "mssql.query.ansiDefaults": true }));
        const batch = buildSessionOptionsBatch(options);
        expect(batch).to.contain("SET ANSI_DEFAULTS ON;");
        expect(batch).to.not.contain("SET ANSI_NULLS");
        expect(batch).to.not.contain("SET QUOTED_IDENTIFIER");
    });

    test("numeric and enum overrides flow through validated", () => {
        const options = readQuerySessionOptions(
            reader({
                "mssql.query.rowCount": 100,
                "mssql.query.textSize": 4096,
                "mssql.query.lockTimeout": 5000,
                "mssql.query.queryGovernorCostLimit": 300,
                "mssql.query.deadlockPriority": "Low",
                "mssql.query.transactionIsolationLevel": "snapshot",
                "mssql.query.noCount": true,
                "mssql.query.xactAbortOn": true,
            }),
        );
        const batch = buildSessionOptionsBatch(options);
        expect(batch).to.contain("SET ROWCOUNT 100;");
        expect(batch).to.contain("SET TEXTSIZE 4096;");
        expect(batch).to.contain("SET LOCK_TIMEOUT 5000;");
        expect(batch).to.contain("SET QUERY_GOVERNOR_COST_LIMIT 300;");
        expect(batch).to.contain("SET DEADLOCK_PRIORITY LOW;");
        expect(batch).to.contain("SET TRANSACTION ISOLATION LEVEL SNAPSHOT;");
        expect(batch).to.contain("SET NOCOUNT ON;");
        expect(batch).to.contain("SET XACT_ABORT ON;");
    });

    test("garbage values never reach the SQL text", () => {
        const options = readQuerySessionOptions(
            reader({
                "mssql.query.rowCount": "100; DROP TABLE x --",
                "mssql.query.deadlockPriority": "High'); DROP TABLE x --",
                "mssql.query.transactionIsolationLevel": "READ COMMITTED; SHUTDOWN",
                "mssql.query.lockTimeout": 1.5,
            }),
        );
        const batch = buildSessionOptionsBatch(options);
        expect(batch).to.not.contain("DROP TABLE");
        expect(batch).to.not.contain("SHUTDOWN");
        expect(batch).to.contain("SET ROWCOUNT 0;"); // fell back to default
        expect(batch).to.contain("SET DEADLOCK_PRIORITY NORMAL;");
        expect(batch).to.contain("SET LOCK_TIMEOUT -1;");
        // Unknown isolation level is dropped entirely rather than guessed.
        expect(batch).to.not.contain("ISOLATION LEVEL READ COMMITTED; SHUTDOWN");
    });

    test("NOEXEC is emitted last so it cannot mask other options", () => {
        const options = readQuerySessionOptions(reader({ "mssql.query.noExec": true }));
        const lines = buildSessionOptionsBatch(options).split("\n");
        expect(lines[lines.length - 1]).to.equal("SET NOEXEC ON;");
    });

    test("execution timeout maps seconds to ms; 0 means none", () => {
        expect(executionTimeoutMs(QUERY_SESSION_DEFAULTS)).to.equal(undefined);
        const withTimeout = readQuerySessionOptions(reader({ "mssql.query.executionTimeout": 30 }));
        expect(executionTimeoutMs(withTimeout)).to.equal(30000);
    });
});
