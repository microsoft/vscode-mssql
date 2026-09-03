/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} from "../../../../src/index.ts";
import type { SyntaxService, SyntaxSnapshot } from "../../../../src/syntax/contracts.ts";
import type { TextChange, TextSnapshot } from "../../../../src/text/contracts.ts";
import { syntaxTree } from "../../support/syntaxHarness.ts";

suite("T-SQL incremental batch parsing", () => {
    // Verifies native Lezer fragments preserve the canonical grammar tree after a local edit.
    test("uses native fragments and remains equivalent to a full parse", () => {
        const service = new LezerSyntaxService();
        const sql = Array.from(
            { length: 1_500 },
            (_, index) => `SELECT ${index} AS value;\nGO\n`,
        ).join("");
        const firstDocument = new ImmutableTextSnapshot("file:///large-batches.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("750 AS");
        const change = { start, end: start + 3, text: "751" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(incremental.statistics.reusedChunkCount, first.statistics.chunkCount - 1);
        assert.equal(incremental.statistics.reparsedChunkCount, 1);
        assert.ok(incremental.statistics.parsedCharacterCount <= 10 * 1024);
        assert.equal(incremental.statistics.rawErrorNodeCount, 0);
        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });

    // Verifies deleting GO invalidates only the neighboring safe groups and preserves equivalence.
    test("merges neighboring cache groups when a GO boundary is removed", () => {
        const service = new LezerSyntaxService();
        const sql = largeBatchScript();
        const firstDocument = new ImmutableTextSnapshot("file:///remove-go.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("\nGO\n", Math.floor(sql.length / 2)) + 1;
        const change = { start, end: start + 2, text: "  " };
        assertIncrementalEquivalent(service, firstDocument, first, change);
    });

    // Verifies adding a legal line-leading GO splits one cached group without cascading reparses.
    test("splits a cache group when a GO boundary is added", () => {
        const service = new LezerSyntaxService();
        const sql = largeBatchScript().replace("\nGO\n", "\n  \n");
        const firstDocument = new ImmutableTextSnapshot("file:///add-go.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("\n  \n") + 1;
        const change = { start, end: start + 2, text: "GO" };
        assertIncrementalEquivalent(service, firstDocument, first, change);
    });

    // Changing a GO repeat count into an identifier invalidates that separator even though the edit
    // is fixed-width and identifier-shaped.
    test("rescans a GO line when its repeat count becomes invalid", () => {
        const service = new LezerSyntaxService();
        const sql = largeBatchScript().replace("\nGO\n", "\nGO 1\n");
        const firstDocument = new ImmutableTextSnapshot("file:///go-repeat.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("GO 1") + 3;
        const change = { start, end: start + 1, text: "X" };

        assertIncrementalEquivalent(service, firstDocument, first, change);
    });

    // Verifies native reuse is effective without GO, removing the old topology-dependent worst case.
    test("incrementally reparses a large single batch", () => {
        const service = new LezerSyntaxService();
        const sql = Array.from({ length: 2_000 }, (_, index) => `SELECT ${index};`).join("\n");
        const firstDocument = new ImmutableTextSnapshot("file:///single-batch.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.indexOf("1000;");
        const change = { start, end: start + 4, text: "1001" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.equal(incremental.statistics.batchCount, 1);
        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
    });

    // Verifies tracked line state handles indentation beyond Lezer's 25-code-unit lookbehind limit.
    test("tracks a deeply indented GO across line-leading edits", () => {
        const service = new LezerSyntaxService();
        const sql = "SELECT 1;\n                              GO 10 -- repeat\nSELECT 2;";
        const firstDocument = new ImmutableTextSnapshot("file:///indented-go.sql", 1, sql);
        const first = service.parse(firstDocument);
        assert.equal(first.statistics.batchCount, 2);
        const start = sql.indexOf("                              ");
        const change = { start, end: start + 1, text: "x" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
        assert.doesNotMatch(syntaxTree(incremental), /BatchSeparator\(Go/);
    });

    // Verifies GO-looking lines inside strings and nested comments never become batch separators.
    test("recognizes GO only in the line-leading lexical state", () => {
        const sql = `SELECT 'first
GO
last' AS value;
/* outside
   /* nested GO */
GO
*/
GO
SELECT 2;`;
        const snapshot = parse(sql);
        const separators = syntaxTree(snapshot).match(/BatchSeparator\(Go\)/gu) ?? [];

        assert.equal(separators.length, 1);
        assert.deepEqual(snapshot.diagnostics, []);
    });

    // Verifies cached batch diagnostics are shifted back to exact document UTF-16 offsets.
    test("reports diagnostics at document offsets after GO boundaries", () => {
        const sql = "SELECT 1;\nGO\nSELECT FROM dbo.t;";
        const from = sql.indexOf("FROM");

        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'FROM'.",
                severity: "error",
                range: { start: from, end: from + 4 },
            },
        ]);
    });
});

function parse(sql: string): SyntaxSnapshot {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///incremental.sql", 1, sql),
    );
}

function largeBatchScript() {
    return Array.from({ length: 1_500 }, (_, index) => `SELECT ${index};\nGO\n`).join("");
}

function assertIncrementalEquivalent(
    service: SyntaxService,
    document: TextSnapshot,
    snapshot: SyntaxSnapshot,
    change: TextChange,
) {
    const nextDocument = applyTextChanges(document, 2, [change]);
    const incremental = service.update(snapshot, nextDocument, [change]);
    const fresh = service.parse(nextDocument);

    assert.ok(incremental.statistics.reusedChunkCount > 0);
    assert.ok(incremental.statistics.reparsedChunkCount <= 2);
    assert.equal(syntaxTree(incremental), syntaxTree(fresh));
    assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
    assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
}
