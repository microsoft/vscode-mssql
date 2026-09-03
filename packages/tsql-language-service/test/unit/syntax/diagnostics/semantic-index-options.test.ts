/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("semantic-index-options.sql");

const messages = (sql: string): readonly string[] =>
    parse(sql).diagnostics.map(({ message }) => message);

const model = "WITH (EXTERNAL_MODEL = embedding_model)";

suite("semantic index option diagnostics", () => {
    test("accepts the documented column and option shapes", () => {
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title) ${model}`);
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title, Body) ${model}`);
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title SEARCH_TYPE vector) ${model}`);
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title SEARCH_TYPE hybrid) ${model}`);
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title LANGUAGE 'English') ${model}`);
        assertValid(`CREATE SEMANTIC INDEX ix ON tbl (Title LANGUAGE 1033) ${model}`);
        assertValid(
            "CREATE SEMANTIC INDEX ix ON tbl (\n" +
                "  Title SEARCH_TYPE fulltext TYPE COLUMN Ext LANGUAGE 1033\n" +
                "    CHUNK_USING(TYPE = paragraph, SIZE = 2023, OVERLAP = 30),\n" +
                "  Body LANGUAGE 1033 TYPE COLUMN Ext SEARCH_TYPE vector\n" +
                "    CHUNK_USING(TYPE = chapter, SIZE = 5000, OVERLAP = 30))\n" +
                `${model}`,
        );
        assertValid(
            "CREATE SEMANTIC INDEX ix ON tbl (Title, Body) WITH (\n" +
                "  EXTERNAL_MODEL = embedding_model (PARAMETERS = '{}')\n" +
                "  VECTOR_INDEX (METRIC = 'cosine' TYPE = 'diskann')\n" +
                "  FULLTEXT_STOPLIST = SYSTEM\n" +
                "  MAXDOP = 8\n" +
                "  DROP_EXISTING = ON)\n" +
                "ON DEFAULT",
        );
    });

    test("reports a search type outside the modeled vocabulary", () => {
        assert.deepEqual(
            messages(`CREATE SEMANTIC INDEX ix ON tbl (Title SEARCH_TYPE vctr) ${model}`),
            ["Incorrect syntax near 'vctr'."],
        );
        assert.deepEqual(
            messages(`CREATE SEMANTIC INDEX ix ON tbl (Title SEARCH_TYPE paragraph) ${model}`),
            ["Incorrect syntax near 'paragraph'."],
        );
    });

    test("reports chunk settings outside their vocabulary or sign", () => {
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title" +
                    ` CHUNK_USING(TYPE = pararaph, SIZE = 500, OVERLAP = 50)) ${model}`,
            ),
            ["Incorrect syntax near 'pararaph'."],
        );
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title" +
                    ` CHUNK_USING(TYPE = paragraph, SIZE = -1, OVERLAP = 30)) ${model}`,
            ),
            ["Incorrect syntax near '-'.  Expecting INTEGER, or NUMERIC."],
        );
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title" +
                    ` CHUNK_USING(TYPE = paragraph, SIZE = 500, OVERLAP = -1)) ${model}`,
            ),
            ["Incorrect syntax near '-'.  Expecting INTEGER, or NUMERIC."],
        );
    });

    test("requires the model binding to lead the option list", () => {
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title, Body)" +
                    " WITH (VECTOR_INDEX (METRIC = 'cosine'))",
            ),
            [
                "Incorrect syntax near 'VECTOR_INDEX'.  Expecting SIW_EXTERNAL_MODEL.",
                "Incorrect syntax near 'METRIC'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("requires the vector option list to lead with its metric", () => {
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title, Body) WITH (" +
                    " EXTERNAL_MODEL = embedding_model VECTOR_INDEX (TYPE = 'diskann'))",
            ),
            ["Incorrect syntax near 'TYPE'.  Expecting IO_VECTORINDEXMETRIC."],
        );
    });

    test("requires DROP_EXISTING to be a switch", () => {
        assert.deepEqual(
            messages(
                "CREATE SEMANTIC INDEX ix ON tbl (Title, Body) WITH (" +
                    " EXTERNAL_MODEL = embedding_model DROP_EXISTING = DEFAULT)",
            ),
            ["Incorrect syntax near 'DEFAULT'.  Expecting OFF, or ON."],
        );
    });

    test("keeps each statement's option checks to itself", () => {
        const sql =
            `CREATE SEMANTIC INDEX a ON tbl (Title) ${model};\n` +
            "GO\n" +
            `CREATE SEMANTIC INDEX b ON tbl (Title SEARCH_TYPE vctr) ${model};\n`;
        assert.deepEqual(messages(sql), ["Incorrect syntax near 'vctr'."]);
    });
});

suite("resource governor option diagnostics", () => {
    test("accepts numeric and named resource settings", () => {
        assertValid(
            "CREATE RESOURCE POOL p WITH (MAX_CPU_PERCENT = 20, MAX_MEMORY_PERCENT = 25," +
                " AFFINITY CPU = AUTO)",
        );
        assertValid(
            "CREATE WORKLOAD GROUP g WITH (GROUP_MAX_TEMPDB_DATA_MB = 5," +
                " GROUP_MAX_TEMPDB_DATA_PERCENT = 50)",
        );
    });

    test("rejects a quoted resource setting", () => {
        for (const verb of ["CREATE", "ALTER"]) {
            assert.deepEqual(
                messages(
                    `${verb} WORKLOAD GROUP g WITH (GROUP_MAX_TEMPDB_DATA_MB = '5',` +
                        " GROUP_MAX_TEMPDB_DATA_PERCENT = '50')",
                ),
                ["Incorrect syntax near ''5''.  Expecting ID, INTEGER, or NUMERIC."],
                verb,
            );
        }
    });
});

suite("principal option diagnostics", () => {
    test("accepts the documented CREATE USER option lists", () => {
        assertValid("CREATE USER [u] WITH SID = 0x77BAA427B4081E449CD851C470DDEA85, TYPE = E");
        assertValid("CREATE USER [u] FROM EXTERNAL PROVIDER WITH DEFAULT_SCHEMA = s");
        assertValid("CREATE USER u WITH PASSWORD='p', DEFAULT_SCHEMA = s, DEFAULT_LANGUAGE = 1033");
    });

    test("reports the first option contract the list breaks", () => {
        assert.deepEqual(messages("CREATE USER [u] WITH SID = 'not a sid'"), [
            "Incorrect syntax near 'SID'.",
        ]);
        assert.deepEqual(messages("CREATE USER u WITH DEFAULT_SCHEMA = s1, DEFAULT_SCHEMA = s1"), [
            "Incorrect syntax near 's1'.",
        ]);
        assert.deepEqual(messages("CREATE USER u WITH PASSWORD = 'a', PASSWORD = 'a'"), [
            "Incorrect syntax near ''a''.",
        ]);
        assert.deepEqual(messages("CREATE USER u WITH PASSWORD = identifier"), [
            "Incorrect syntax near 'identifier'.  Expecting STRING, or TEXT_LEX.",
        ]);
    });
});
