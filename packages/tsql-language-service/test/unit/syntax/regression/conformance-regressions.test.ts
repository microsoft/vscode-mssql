/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { ImmutableTextSnapshot, LezerSyntaxService } from "../../../../src/index.ts";
import type { SqlEngineProfile } from "../../../../src/common/engineProfile.ts";
import type { SyntaxSnapshot } from "../../../../src/syntax/contracts.ts";
import { syntaxTree } from "../../support/syntaxHarness.ts";

suite("T-SQL corpus baseline grammar regressions", () => {
    // XML and CLR instance methods remain available when the receiver is a local variable.
    test("parses variable member calls", () => {
        assertValid("RETURN @document.value('(/root/id)[1]', 'int');");
    });

    // Scalar DECLARE elements accept the same explicit nullability modifiers as module parameters.
    test("parses nullable variable declarations", () => {
        assertValid("DECLARE @nullable int NULL, @required int NOT NULL = 4;");
    });

    // Legacy DROP shapes stay structural so later validation can diagnose invalid names/options.
    test("parses schema options and multiple DROP INDEX items", () => {
        assertValid(`
DROP SCHEMA s1 RESTRICT;
DROP SCHEMA i1.i2 CASCADE;
DROP INDEX i1 ON t1 WITH (MAXDOP = 2), authors.au_id_ind;
DROP INDEX i1 ON t1 WITH (ONLINE = ON, MOVE TO fg1), i2 ON t2 WITH (ONLINE = OFF);
CREATE INDEX i1 ON dbo.t1 (c1) WITH (DATA_COMPRESSION = ROW) FILESTREAM_ON stream_data;
`);
    });

    // Service Broker conversation endings remain ordinary statements inside procedural blocks.
    test("parses END CONVERSATION forms", () => {
        assertValid(`
BEGIN TRY
  END CONVERSATION @handle;
END TRY
BEGIN CATCH
  END CONVERSATION @handle WITH ERROR = 50000 DESCRIPTION = N'failed';
END CATCH;
END CONVERSATION @handle WITH CLEANUP;
`);
    });

    // Distributed grouping and nested ROLLUP entries retain explicit grouping nodes.
    test("parses distributed and nested grouping elements", () => {
        assertValid(`
SELECT c1, c2, c3 FROM t1 GROUP BY c1 WITH (DISTRIBUTED_AGG), c2, c3;
SELECT c1, c2, c3 FROM t1 GROUP BY ROLLUP (c1, (c2, c3));
`);
    });

    // TABLE HINT query hints preserve their target and nested table-hint list.
    test("parses TABLE HINT query hints", () => {
        assertValid(`
INSERT INTO t2 DEFAULT VALUES
OPTION (FAST 5, TABLE HINT (t2, READCOMMITTED, INDEX (i1)));
`);
    });

    // INSERT accepts OPENROWSET as a rowset target, including an explicit target-column list.
    test("parses OPENROWSET insert targets", () => {
        assertValid(`
INSERT OPENROWSET('provider', 'connection', 'query') DEFAULT VALUES;
INSERT OPENROWSET(provider_name, @connection) (c1, c2) VALUES (1, 2);
`);
    });

    // Service Broker RECEIVE supports projections, assignment, INTO, and queue filtering.
    test("parses RECEIVE statements", () => {
        assertValid(`
RECEIVE TOP (1) conversation_handle, message_body FROM dbo.ExpenseQueue;
RECEIVE @handle = conversation_handle, CASE WHEN status = 1 THEN message_body END AS body
FROM ExpenseQueue INTO @messages WHERE conversation_group_id = @group;
`);
    });

    // SELECT INTO retains its filegroup before FROM, including delimited filegroup names.
    test("parses SELECT INTO filegroup placement", () => {
        assertValid(`
SELECT Id INTO dbo.Copy ON data_files FROM dbo.Source;
SELECT Id INTO dbo.Copy ON [default] FROM dbo.Source;
(SELECT Id INTO dbo.Copy ON [data files] FROM dbo.Source)
UNION ALL SELECT Id FROM dbo.Other;
`);
    });

    // ODBC outer-join escapes remain table sources and can nest or join ordinary sources.
    test("parses ODBC outer join table sources", () => {
        assertValid(`
SELECT * FROM {oj {oj t1 INNER JOIN t2 ON t1.Id = t2.Id}};
SELECT * FROM t1 INNER JOIN {oj t2 CROSS JOIN t3} ON t1.Id = t2.Id;
`);
    });

    // Legacy GROUP BY ALL remains valid on SQL Server; Fabric additionally supports ORDER BY ALL.
    test("parses and gates ALL clauses", () => {
        const sql = `
SELECT City, COUNT(*) FROM dbo.Employees GROUP BY ALL City HAVING COUNT(*) > 1 ORDER BY ALL DESC
OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY;`;
        assert.deepEqual(parse(sql, "fabric-warehouse").diagnostics, []);
        assert.deepEqual(
            parse(sql, "sql-server").diagnostics.map(({ message }) => message),
            [
                "ORDER BY ALL (near 'ALL') is not available on SQL Server 2025 (compatibility level 170). It is available on Fabric Data Warehouse.",
            ],
        );
    });

    // Shift operators associate at the bitwise additive precedence level without recovery nodes.
    test("parses chained shift operators", () => {
        const snapshot = parse("SELECT value << 1 >> 2 FROM dbo.t;");
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(syntaxTree(snapshot), /ShiftLeft/);
        assert.match(syntaxTree(snapshot), /ShiftRight/);
    });

    // TRIM accepts character-set and positional SQL Server 2022 forms in RETURN expressions.
    test("parses TRIM character and positional forms", () => {
        assertValid(`
RETURN TRIM('x' FROM @value);
RETURN TRIM(LEADING NCHAR(12288) FROM @value);
RETURN TRIM(TRAILING 'x' FROM @value);
RETURN TRIM(BOTH 'x' FROM @value);
`);
    });

    // A missing exponent digit is retained structurally while still producing an exact diagnostic.
    test("reports incomplete exponent literals without raw recovery", () => {
        const sql = "IF (1 < 2e) PRINT 'invalid';";
        const snapshot = parse(sql);

        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'e'.",
                severity: "error",
                range: { start: sql.indexOf("e"), end: sql.indexOf("e") + 1 },
            },
        ]);
    });

    // Incremental diagnostics and trees remain equivalent after editing a newly covered form.
    test("keeps incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const beforeText = "RETURN TRIM(LEADING 'x' FROM @value);";
        const before = service.parse(document(1, beforeText));
        const start = beforeText.indexOf("LEADING");
        const afterText = beforeText.replace("LEADING", "TRAILING");
        const afterDocument = document(2, afterText);
        const incremental = service.update(before, afterDocument, [
            { start, end: start + "LEADING".length, text: "TRAILING" },
        ]);
        const fresh = service.parse(afterDocument);

        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
    });
});

function assertValid(sql: string) {
    const snapshot = parse(sql);
    assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
    assert.deepEqual(snapshot.diagnostics, []);
}

function parse(sql: string, engineProfile: SqlEngineProfile = "sql-server"): SyntaxSnapshot {
    return new LezerSyntaxService(undefined, {
        serverMajorVersion: 17,
        compatibilityLevel: 170,
        engineProfile,
        previewFeatures: false,
    }).parse(document(1, sql));
}

function document(version: number, text: string): ImmutableTextSnapshot {
    return new ImmutableTextSnapshot("file:///corpus-baseline-regression.sql", version, text);
}
