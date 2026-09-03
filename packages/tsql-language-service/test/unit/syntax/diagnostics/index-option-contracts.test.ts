/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("index-option-contracts.sql");

const messages = (sql: string): readonly string[] =>
    parse(sql).diagnostics.map(({ message }) => message);

const allRelationalOptions =
    "pad_index = on, fillfactor = 20, sort_in_tempdb = on, ignore_dup_key = on," +
    " statistics_norecompute = on, statistics_incremental = on, drop_existing = on," +
    " online = on, resumable = on, max_duration = 5, allow_row_locks = on," +
    " allow_page_locks = on, optimize_for_sequential_key = on, maxdop = 4," +
    " data_compression = page, xml_compression = on, compression_delay = 10";

suite("index option contracts", () => {
    test("accepts the documented index option lists", () => {
        assertValid(`create index i on t (c) with (${allRelationalOptions})`);
        assertValid("create index i on t (c) with ([drop_existing] = on)");
        assertValid(
            "alter index i on t rebuild with (online = on (wait_at_low_priority" +
                " (max_duration = 5 minutes, abort_after_wait = self)))",
        );
        assertValid("alter index i on t resume with (maxdop = 4, max_duration = 40 minutes)");
        assertValid(
            "alter index i on t rebuild partition = 3" +
                " with (data_compression = columnstore_archive on partitions (1, 3 to 5))",
        );
        assertValid("drop index i on t with (online = on, maxdop = 2, move to fg1)");
        assertValid("create json index j on t (c) for ('$') with (optimize_for_array_search = on)");
        assertValid(
            "create table t (a int primary key with (pad_index = on, fillfactor = 20," +
                " ignore_dup_key = on, statistics_norecompute = on, allow_row_locks = on," +
                " allow_page_locks = on, data_compression = none))",
        );
    });

    test("reports an option word the list does not define", () => {
        const sql = "alter index ind on t1 rebuild with (RESUMABLED = ON, ONLINE = ON)";
        const start = sql.indexOf("RESUMABLED");
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'RESUMABLED'.",
                severity: "error",
                range: { start, end: start + "RESUMABLED".length },
            },
        ]);
        assert.deepEqual(
            messages("create json index idx1 on t1 (c1) for ('$') with (CHANGE_TRACKING = ON)"),
            ["Incorrect syntax near 'CHANGE_TRACKING'."],
        );
        assert.deepEqual(messages("create table t (c1 int primary key with (FOO = ON))"), [
            "Incorrect syntax near 'FOO'.",
        ]);
    });

    test("reports the first word of a list that an unknown option word introduced", () => {
        assert.deepEqual(
            messages(
                "drop index ind on t1 with (online = on," +
                    " WAIT_AT_LOW_PRIORITYZ (max_duration = 5 minutes, abort_after_wait = all))",
            ),
            [
                "Incorrect syntax near 'WAIT_AT_LOW_PRIORITYZ'.",
                "Incorrect syntax near 'max_duration'.  Expecting '(', or SELECT.",
            ],
        );
        assert.deepEqual(
            messages(
                "alter index ind on t1 resume with (wait_at_low_priority" +
                    " (MAX_DURATIOND = 10 minutes, abort_after_wait = blockers))",
            ),
            ["Incorrect syntax near 'MAX_DURATIOND'.  Expecting '(', or SELECT."],
        );
    });

    test("reports a value the option does not accept", () => {
        assert.deepEqual(
            messages(
                "alter index ind on t1 rebuild with (online = on, max_duration = randomstring)",
            ),
            ["Incorrect syntax near 'randomstring'.  Expecting INTEGER."],
        );
        assert.deepEqual(messages("create index i2 on p.a (city) with (online = 4)"), [
            "Incorrect syntax near '4'.  Expecting OFF, or ON.",
        ]);
        assert.deepEqual(
            messages("create json index i on t (c) for ('$') with (allow_page_locks = NOT_ON_OFF)"),
            ["Incorrect syntax near 'NOT_ON_OFF'.  Expecting '-', INTEGER, NUMERIC, OFF, or ON."],
        );
        assert.deepEqual(
            messages(
                "create index i on t (c) with (data_compression = foobar" +
                    " on partitions (10, 12 to 15))",
            ),
            ["Incorrect syntax near 'foobar'."],
        );
        assert.deepEqual(messages("alter index ind on t1 resume with (maxdop = P)"), [
            "Incorrect syntax near 'P'.  Expecting '-', INTEGER, or NUMERIC.",
        ]);
    });

    test("reports each malformed statement in a multi-statement document", () => {
        const sql =
            "create index a on t (c) with (allow_page_locks = on);\n" +
            "go\n" +
            "create index b on t (c) with (BOGUS = on);\n" +
            "go\n" +
            "create index c on t (c) with (online = 7);\n";
        assert.deepEqual(messages(sql), [
            "Incorrect syntax near 'BOGUS'.",
            "Incorrect syntax near '7'.  Expecting OFF, or ON.",
        ]);
    });

    test("leaves an option list a syntax error already owns alone", () => {
        assert.ok(
            messages("alter index ind on t1 rebuild with (RESUMABLED = ").every(
                (message) => !message.includes("RESUMABLED"),
            ),
            "a recovered option list must not add option-word diagnostics",
        );
    });

    test("does not constrain the vector index option list", () => {
        assert.deepEqual(
            messages(
                "create vector index v on t (c) with (MTERIC = 'cosine', type = 'DiskANN'," +
                    " maxdop = 1, drop_existing = on)",
            ),
            [],
        );
    });
});
