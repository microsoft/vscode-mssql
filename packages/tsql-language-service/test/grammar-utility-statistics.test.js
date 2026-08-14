/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { applyTextChanges, ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL statistics, bulk, and server utility grammar", () => {
    // Verifies the CREATE, UPDATE, and DROP STATISTICS forms used by query-plan maintenance.
    test("parses statistics lifecycle statements", () => {
        const snapshot = parse(`
CREATE STATISTICS st_orders ON sales.Orders (CustomerId, OrderDate DESC)
WHERE IsActive = 1 WITH SAMPLE 25 PERCENT, NORECOMPUTE;
UPDATE STATISTICS sales.Orders (st_orders, st_other) WITH FULLSCAN;
DROP STATISTICS sales.Orders.st_orders, sales.Orders.st_other;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateStatisticsStatement\(/);
        assert.match(tree, /UpdateStatisticsStatement\(/);
        assert.match(tree, /DropStatisticsStatement\(/);
    });

    // Verifies file-based BULK INSERT and client-driven INSERT BULK retain their options and row shape.
    test("parses bulk loading statements", () => {
        const snapshot = parse(`
BULK INSERT staging.Orders FROM 'orders.csv'
WITH (FORMAT = 'CSV', FIRSTROW = 2, TABLOCK);
INSERT BULK staging.Orders (OrderId bigint, Name nvarchar(100))
WITH (KEEPNULLS, ROWS_PER_BATCH = 5000);
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /BulkInsertStatement\(/);
        assert.match(tree, /InsertBulkStatement\(/);
    });

    // Verifies ownership transfer, trigger state, and key-open state use explicit statement nodes.
    test("parses authorization, trigger, and key state statements", () => {
        const snapshot = parse(`
ALTER AUTHORIZATION ON SCHEMA::sales TO dbo;
DISABLE TRIGGER ALL ON sales.Orders;
ENABLE TRIGGER sales.tr_audit ON sales.Orders;
OPEN SYMMETRIC KEY DataKey DECRYPTION BY CERTIFICATE DataCertificate;
CLOSE SYMMETRIC KEY DataKey;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /AlterAuthorizationStatement\(/);
        assert.equal((tree.match(/EnableDisableTriggerStatement\(/g) ?? []).length, 2);
        assert.equal((tree.match(/KeyAccessStatement\(/g) ?? []).length, 2);
    });

    // Verifies instance utility commands retain their arguments and modifiers.
    test("parses server utility statements", () => {
        const snapshot = parse(`
KILL 57 WITH STATUSONLY;
RECONFIGURE WITH OVERRIDE;
SHUTDOWN WITH NOWAIT;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /KillStatement\(/);
        assert.match(tree, /ReconfigureStatement\(/);
        assert.match(tree, /ShutdownStatement\(/);
    });

    // Verifies malformed bulk input reports the SqlParser-style error at the missing source value.
    test("reports an incomplete bulk source", () => {
        const sql = "BULK INSERT staging.Orders FROM";
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'End Of File'.",
                severity: "error",
                range: { start: sql.length, end: sql.length },
            },
        ]);
    });

    // Verifies native fragment reuse produces the same utility tree and diagnostics as a fresh parse.
    test("keeps utility incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const before = new ImmutableTextSnapshot(
            "file:///utility.sql",
            1,
            "UPDATE STATISTICS sales.Orders WITH SAMPLE 10 PERCENT;\nRECONFIGURE;",
        );
        const previous = service.parse(before);
        const start = before.text.indexOf("10");
        const change = { start, end: start + 2, text: "25" };
        const after = applyTextChanges(before, 2, [change]);
        const incremental = service.update(previous, after, [change]);
        const fresh = service.parse(after);

        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.equal(incremental.statistics.rawErrorNodeCount, 0);
    });
});

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///utility-statistics.sql", 1, sql),
    );
}
