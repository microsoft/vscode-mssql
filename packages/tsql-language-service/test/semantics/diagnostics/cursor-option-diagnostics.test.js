/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// DECLARE CURSOR carries an ISO option list before CURSOR and a T-SQL extended list after it. The
// ISO list accepts only INSENSITIVE and SCROLL, the extended list accepts everything but
// INSENSITIVE, and a declaration may not use both lists.
const { createSemanticHarness } = require("../../support/semanticHarness.js");
const { analyze, open } = createSemanticHarness({ uri: "file:///cursor-options.sql" });

suite("T-SQL cursor option validation", () => {
    // An extended option in the ISO list is a usage error, ranged at that option.
    test("rejects an extended option before CURSOR with exact output", async () => {
        const sql = "DECLARE c LOCAL CURSOR FOR SELECT 1;";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "InvalidUsageOfCursorOption",
                    message: "Invalid usage of the option 'LOCAL' in the DECLARE CURSOR statement.",
                    severity: "error",
                    text: "LOCAL",
                },
            ],
        );
    });

    // INSENSITIVE is the one option the extended list rejects.
    test("rejects INSENSITIVE after CURSOR", async () => {
        assert.deepEqual(
            (await analyze("DECLARE c CURSOR INSENSITIVE FOR SELECT 1;")).map(
                ({ code, message }) => [code, message],
            ),
            [
                [
                    "InvalidUsageOfCursorOption",
                    "Invalid usage of the option 'INSENSITIVE' in the DECLARE CURSOR statement.",
                ],
            ],
        );
    });

    // Both lists populated is the mixing error, reported across the declaration.
    test("rejects a declaration that uses both option lists", async () => {
        const sql = "DECLARE c SCROLL CURSOR STATIC FOR SELECT 1;";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, range }) => [
                code,
                message,
                sql.slice(range.start, range.end),
            ]),
            [
                [
                    "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
                    "Mixing old and new syntax to specify cursor options is not allowed.",
                    "c SCROLL CURSOR STATIC FOR SELECT 1",
                ],
            ],
        );
    });

    // An unknown name is unrecognized rather than misplaced, in either list.
    test("reports unrecognized option names in both lists", async () => {
        for (const sql of [
            "DECLARE c BANANA CURSOR FOR SELECT 1;",
            "DECLARE c CURSOR BANANA FOR SELECT 1;",
        ]) {
            assert.deepEqual(
                (await analyze(sql)).map(({ code, message }) => [code, message]),
                [["UnrecognizedCursorOption", "'BANANA' is not a recognized CURSOR option."]],
                sql,
            );
        }
    });

    // Every legal declaration form stays silent, in either syntax family.
    test("accepts each valid cursor declaration form", async () => {
        for (const sql of [
            "DECLARE c CURSOR FOR SELECT 1;",
            "DECLARE c INSENSITIVE CURSOR FOR SELECT 1;",
            "DECLARE c SCROLL CURSOR FOR SELECT 1;",
            "DECLARE c INSENSITIVE SCROLL CURSOR FOR SELECT 1;",
            "DECLARE c CURSOR LOCAL FORWARD_ONLY STATIC READ_ONLY TYPE_WARNING FOR SELECT 1;",
            "DECLARE c CURSOR GLOBAL SCROLL KEYSET SCROLL_LOCKS FOR SELECT 1;",
            "DECLARE c CURSOR global scroll dynamic optimistic FOR SELECT 1;",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Conflicting options belong to the extended list, where SQL Server checks them.
    test("keeps conflict detection on the extended list", async () => {
        assert.deepEqual(
            (await analyze("DECLARE c CURSOR GLOBAL LOCAL FOR SELECT 1;")).map(({ code }) => code),
            ["ConflictingCursorOption"],
        );
        assert.deepEqual(
            (await analyze("DECLARE c SCROLL CURSOR FORWARD_ONLY FOR SELECT 1;")).map(
                ({ code }) => code,
            ),
            ["MixingOldAndNewSyntaxForCursorOptionsNotAllowed"],
        );
    });

    // A delimited spelling is not a cursor option name in SQL Server's token lookup.
    test("treats a delimited option name as unrecognized", async () => {
        assert.deepEqual(
            (await analyze("DECLARE c CURSOR [STATIC] FOR SELECT 1;")).map(({ code }) => code),
            ["UnrecognizedCursorOption"],
        );
    });

    // Option state stays inside one declaration.
    test("does not leak option state across declarations", async () => {
        assert.deepEqual(
            await analyze(`DECLARE a INSENSITIVE CURSOR FOR SELECT 1;
DECLARE b CURSOR STATIC FOR SELECT 1;`),
            [],
        );
    });

    // A damaged query keeps cursor option validation from making a secondary semantic claim.
    test("does not classify options in a damaged cursor declaration", async () => {
        const snapshot = await open("DECLARE c CURSOR MADE_UP FOR;");
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) =>
                [
                    "UnrecognizedCursorOption",
                    "InvalidUsageOfCursorOption",
                    "MixingOldAndNewSyntaxForCursorOptionsNotAllowed",
                    "ConflictingCursorOption",
                ].includes(code),
            ),
            [],
        );
    });
});
