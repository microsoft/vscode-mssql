/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { ImmutableTextSnapshot, LezerSyntaxService } from "../../../../src/index.ts";
import { createSemanticHarness } from "../../support/semanticHarness.ts";
import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

// SQL Server parses a schema header with an optional name and an optional AUTHORIZATION owner, then
// requires at least one of them.
const { analyze } = createSemanticHarness({ uri: "file:///statement-shape-semantics.sql" });

const { parse } = createSyntaxHarness("statement-shape.sql");

suite("T-SQL CREATE SCHEMA header validation", () => {
    // The empty header parses as a schema statement and is reported across the whole statement.
    test("requires a name or AUTHORIZATION with exact output", () => {
        const sql = "CREATE SCHEMA;";
        const diagnostics = parse(sql).diagnostics;

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "NameOrAuthorizationKeywordRequired",
                    message:
                        "The CREATE SCHEMA statement should be followed by a name or authorization keyword.",
                    severity: "error",
                    text: "CREATE SCHEMA",
                },
            ],
        );
    });

    // Each supported header form parses and stays silent, including the owner-only spelling that
    // the previous grammar could not represent at all.
    test("accepts every supported header form", () => {
        for (const sql of [
            "CREATE SCHEMA Sales;",
            "CREATE SCHEMA Sales AUTHORIZATION dbo;",
            "CREATE SCHEMA AUTHORIZATION dbo;",
            "CREATE SCHEMA [my schema] AUTHORIZATION [some owner];",
        ]) {
            assert.deepEqual(parse(sql).diagnostics, [], sql);
        }
    });

    // The rule is statement-local: a later valid schema statement is unaffected by an earlier one.
    test("keeps the rule local to one statement", () => {
        const diagnostics = parse("CREATE SCHEMA; CREATE SCHEMA Sales;").diagnostics;

        assert.deepEqual(
            diagnostics.map(({ code }) => code),
            ["NameOrAuthorizationKeywordRequired"],
        );
    });

    // A header damaged after AUTHORIZATION still has no name, so the rule reports alongside the
    // recovery diagnostic rather than deferring to it.
    test("diagnoses a damaged header alongside recovery", () => {
        const diagnostics = parse("CREATE SCHEMA AUTHORIZATION;").diagnostics;

        assert.ok(diagnostics.some(({ code }) => code === "syntax"));
        assert.ok(diagnostics.some(({ code }) => code === "NameOrAuthorizationKeywordRequired"));
    });

    // Incremental reparse must produce the identical diagnostic set.
    test("keeps incremental and full diagnostics equivalent", () => {
        const service = new LezerSyntaxService();
        const beforeText = "CREATE SCHEMA Sales;";
        const before = service.parse(
            new ImmutableTextSnapshot("file:///schema.sql", 1, beforeText),
        );
        const afterText = "CREATE SCHEMA;";
        const afterDocument = new ImmutableTextSnapshot("file:///schema.sql", 2, afterText);
        const incremental = service.update(before, afterDocument, [
            { start: "CREATE SCHEMA".length, end: "CREATE SCHEMA Sales".length, text: "" },
        ]);
        const fresh = service.parse(afterDocument);

        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual(
            incremental.diagnostics.map(({ code }) => code),
            ["NameOrAuthorizationKeywordRequired"],
        );
    });
});

// The trigger scope tail parses after any DROP object list; only DROP TRIGGER accepts it.
suite("T-SQL DROP scope validation", () => {
    // The report covers the offending scope tail, which is the smallest useful range.
    test("rejects a trigger scope on a non-trigger DROP with exact output", () => {
        const sql = "DROP TABLE dbo.t ON DATABASE;";
        const diagnostics = parse(sql).diagnostics;

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "InvalidOnClause",
                    message: "The ON clause is not valid for this statement.",
                    severity: "error",
                    text: "ON DATABASE",
                },
            ],
        );
    });

    // Every DROP kind that parses the tail, and both scope spellings, are rejected.
    test("rejects the tail on every non-trigger DROP kind", () => {
        for (const [statement, scope] of [
            ["DROP TABLE dbo.t", "ON DATABASE"],
            ["DROP PROCEDURE dbo.p", "ON ALL SERVER"],
            ["DROP FUNCTION dbo.f", "ON DATABASE"],
            ["DROP VIEW dbo.v", "ON ALL SERVER"],
            ["DROP SYNONYM dbo.s", "ON DATABASE"],
            ["DROP SEQUENCE dbo.q", "ON DATABASE"],
            ["DROP RULE dbo.r", "ON DATABASE"],
            ["DROP DEFAULT dbo.d", "ON DATABASE"],
            ["DROP AGGREGATE dbo.a", "ON DATABASE"],
            ["DROP SECURITY POLICY dbo.sp", "ON DATABASE"],
        ]) {
            assert.deepEqual(
                parse(`${statement} ${scope};`).diagnostics.map(({ code }) => code),
                ["InvalidOnClause"],
                `${statement} ${scope}`,
            );
        }
    });

    // DROP TRIGGER owns the scope tail, and no DROP without a tail is affected.
    test("accepts DROP TRIGGER scopes and plain DROP statements", () => {
        for (const sql of [
            "DROP TRIGGER dbo.t ON DATABASE;",
            "DROP TRIGGER dbo.t ON ALL SERVER;",
            "DROP TRIGGER dbo.t;",
            "DROP TABLE dbo.t;",
            "DROP TABLE IF EXISTS dbo.t, dbo.u;",
            "DROP VIEW dbo.v;",
        ]) {
            assert.deepEqual(parse(sql).diagnostics, [], sql);
        }
    });

    // A multi-name list keeps one report for the statement, not one per dropped object.
    test("reports one diagnostic for a multi-object DROP", () => {
        assert.deepEqual(
            parse("DROP TABLE dbo.a, dbo.b, dbo.c ON DATABASE;").diagnostics.map(
                ({ code }) => code,
            ),
            ["InvalidOnClause"],
        );
    });

    // A damaged scope tail belongs to syntax recovery.
    test("does not diagnose a damaged scope tail", () => {
        const diagnostics = parse("DROP TABLE dbo.t ON;").diagnostics;

        assert.ok(diagnostics.some(({ code }) => code === "syntax"));
        assert.ok(diagnostics.every(({ code }) => code !== "InvalidOnClause"));
    });
});

// READONLY is a routine-declaration option; SQL Server parses it after an EXECUTE argument and
// rejects it there.
suite("T-SQL EXECUTE argument option validation", () => {
    // Reported at the option token, not at the whole argument.
    test("rejects READONLY on an EXECUTE argument with exact output", async () => {
        const sql = "EXEC dbo.p @x = 1 READONLY;";
        const diagnostics = (await analyze(sql)).filter(
            ({ code }) => code === "ReadonlyCannotBeUsed",
        );

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "ReadonlyCannotBeUsed",
                    message:
                        "The READONLY option cannot be used in an EXECUTE or CREATE AGGREGATE statement.",
                    severity: "error",
                    text: "READONLY",
                },
            ],
        );
    });

    // Positional arguments and every EXECUTE spelling carry the same rule.
    test("applies to positional arguments and both EXECUTE spellings", async () => {
        for (const sql of [
            "EXEC dbo.p 1 READONLY;",
            "DECLARE @v int; EXECUTE dbo.p @x = @v READONLY;",
            "EXEC dbo.p @a = 1, @b = 2 READONLY;",
        ]) {
            assert.deepEqual(
                (await analyze(sql))
                    .filter(({ code }) => code === "ReadonlyCannotBeUsed")
                    .map(({ code }) => code),
                ["ReadonlyCannotBeUsed"],
                sql,
            );
        }
    });

    // OUTPUT and OUT keep their existing meaning and produce no READONLY diagnostic.
    test("leaves OUTPUT and OUT arguments alone", async () => {
        for (const sql of [
            "DECLARE @v int; EXEC dbo.p @x = @v OUTPUT;",
            "DECLARE @v int; EXEC dbo.p @v OUT;",
            "EXEC dbo.p @x = 1;",
        ]) {
            assert.deepEqual(
                (await analyze(sql)).filter(({ code }) => code === "ReadonlyCannotBeUsed"),
                [],
                sql,
            );
        }
    });

    // A routine declaration still accepts READONLY; only the EXECUTE position is rejected.
    test("does not touch READONLY in a routine declaration", async () => {
        const diagnostics = await analyze(
            "CREATE PROCEDURE dbo.p @t dbo.MyTableType READONLY AS SELECT 1;",
        );

        assert.deepEqual(
            diagnostics.filter(({ code }) => code === "ReadonlyCannotBeUsed"),
            [],
        );
    });
});
