/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL trigger action diagnostics", () => {
    // Reports the second member of each repeated DML action pair with the complete public shape.
    test("reports repeated actions with exact messages, severity, and ranges", () => {
        const sql = `CREATE TRIGGER test_trigger ON Sales.Customer
AFTER INSERT, INSERT, UPDATE, UPDATE, DELETE, DELETE
AS BEGIN RETURN; END;`;
        const diagnostics = parse(sql).diagnostics;

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            ["INSERT", "UPDATE", "DELETE"].map((action) => ({
                code: "DuplicateTriggerActionType",
                message: `Duplicate specification of the action "${action}" in the trigger declaration.`,
                severity: "error",
                text: action,
            })),
        );
    });

    // Accepts the first occurrence and reports every subsequent occurrence independently.
    test("reports every occurrence after the first", () => {
        const sql = "CREATE TRIGGER t ON dbo.c AFTER INSERT, INSERT, INSERT AS BEGIN RETURN; END;";
        const diagnostics = parse(sql).diagnostics;

        assert.equal(diagnostics.length, 2);
        assert.deepEqual(
            diagnostics.map(({ range }) => range.start),
            [sql.indexOf("INSERT", sql.indexOf("INSERT") + 1), sql.lastIndexOf("INSERT")],
        );
    });

    // Treats action keywords case-insensitively while keeping canonical names in messages.
    test("matches actions case-insensitively", () => {
        const diagnostics = parse(
            "CREATE TRIGGER t ON dbo.c FOR insert, InSeRt AS BEGIN RETURN; END;",
        ).diagnostics;

        assert.deepEqual(
            diagnostics.map(({ message }) => message),
            ['Duplicate specification of the action "INSERT" in the trigger declaration.'],
        );
    });

    // Covers every statement spelling that constructs a DML trigger definition.
    test("applies to CREATE, CREATE OR ALTER, and ALTER TRIGGER", () => {
        for (const prefix of ["CREATE", "CREATE OR ALTER", "ALTER"]) {
            const diagnostics = parse(
                `${prefix} TRIGGER t ON dbo.c AFTER UPDATE, UPDATE AS BEGIN RETURN; END;`,
            ).diagnostics;
            assert.deepEqual(
                diagnostics.map(({ code }) => code),
                ["DuplicateTriggerActionType"],
                prefix,
            );
        }
    });

    // Exercises the alternative FOR and INSTEAD OF DML trigger activation forms.
    test("applies to FOR and INSTEAD OF action lists", () => {
        for (const activation of ["FOR", "INSTEAD OF"]) {
            const diagnostics = parse(
                `CREATE TRIGGER t ON dbo.c ${activation} DELETE, DELETE AS BEGIN RETURN; END;`,
            ).diagnostics;
            assert.deepEqual(
                diagnostics.map(({ code }) => code),
                ["DuplicateTriggerActionType"],
            );
        }
    });

    // Leaves a valid list of distinct DML actions untouched.
    test("accepts distinct actions", () => {
        assert.deepEqual(
            parse("CREATE TRIGGER t ON dbo.c AFTER INSERT, UPDATE, DELETE AS BEGIN RETURN; END;")
                .diagnostics,
            [],
        );
    });

    // Does not mistake repeated DDL event names for repeated DML actions.
    test("ignores DDL trigger event groups", () => {
        assert.deepEqual(
            parse(
                "CREATE TRIGGER t ON DATABASE AFTER CREATE_TABLE, CREATE_TABLE AS BEGIN RETURN; END;",
            ).diagnostics,
            [],
        );
    });

    // Avoids a secondary duplicate-action diagnostic when recovery owns the damaged list.
    test("does not diagnose a syntax-damaged action list", () => {
        const diagnostics = parse(
            "CREATE TRIGGER t ON dbo.c AFTER INSERT, , INSERT AS",
        ).diagnostics;

        assert.ok(diagnostics.some(({ code }) => code === "syntax"));
        assert.ok(diagnostics.every(({ code }) => code !== "DuplicateTriggerActionType"));
    });

    // Keeps duplicate state local to one trigger declaration and one batch.
    test("does not leak action state across statements or batches", () => {
        assert.deepEqual(
            parse(`CREATE TRIGGER t1 ON dbo.c AFTER INSERT AS BEGIN RETURN; END;
GO
CREATE TRIGGER t2 ON dbo.c AFTER INSERT AS BEGIN RETURN; END;`).diagnostics,
            [],
        );
    });

    // Keeps incrementally recomputed diagnostics identical to a fresh parse after an action edit.
    test("keeps incremental and full diagnostics equivalent", () => {
        const service = new LezerSyntaxService();
        const beforeText = "CREATE TRIGGER t ON dbo.c AFTER INSERT, UPDATE AS BEGIN RETURN; END;";
        const before = service.parse(
            new ImmutableTextSnapshot("file:///trigger.sql", 1, beforeText),
        );
        const updateStart = beforeText.indexOf("UPDATE");
        const afterText = `${beforeText.slice(0, updateStart)}INSERT${beforeText.slice(updateStart + 6)}`;
        const afterDocument = new ImmutableTextSnapshot("file:///trigger.sql", 2, afterText);
        const incremental = service.update(before, afterDocument, [
            { start: updateStart, end: updateStart + 6, text: "INSERT" },
        ]);
        const fresh = service.parse(afterDocument);

        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual(
            incremental.diagnostics.map(({ code }) => code),
            ["DuplicateTriggerActionType"],
        );
    });
});

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///syntax-trigger-actions.sql", 1, sql),
    );
}
