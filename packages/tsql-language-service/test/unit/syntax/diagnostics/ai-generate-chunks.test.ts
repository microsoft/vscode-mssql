/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { LezerSyntaxService } from "../../../../src/index.ts";
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, document, parse } = createSyntaxHarness("ai-generate-chunks.sql");
const prefix = "SELECT * FROM AI_GENERATE_CHUNKS(";

suite("AI_GENERATE_CHUNKS syntax diagnostics", () => {
    test("accepts the supported argument forms", () => {
        for (const arguments_ of [
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5",
            "SOURCE = N'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = NULL",
            "SOURCE = @source, CHUNK_TYPE = fixed, CHUNK_SIZE = @chunk_size",
            "SOURCE = NULL, CHUNK_TYPE = fixed, CHUNK_SIZE = 5",
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5, OVERLAP = 10",
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5, OVERLAP = NULL",
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5, ENABLE_CHUNK_SET_ID = 50",
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5, OVERLAP = 10, ENABLE_CHUNK_SET_ID = NULL",
            "SOURCE = 'some text', CHUNK_TYPE = fixed, CHUNK_SIZE = 5, OVERLAP = 10, ENABLE_CHUNK_SET_ID = 1",
        ]) {
            assertValid(`${prefix}${arguments_});`);
        }
        assertValid(`
SELECT *
FROM t1
CROSS APPLY AI_GENERATE_CHUNKS(
    SOURCE = t1.c1,
    CHUNK_TYPE = fixed,
    CHUNK_SIZE = t1.size,
    OVERLAP = t1.overlap
);`);
    });

    test("does not reserve qualified user-defined routines with the same name", () => {
        assertValid("SELECT * FROM dbo.AI_GENERATE_CHUNKS(3);");
        assertValid("SELECT * FROM dbo.[AI_GENERATE_CHUNKS](source);");
    });

    test("reports ordering, required-argument, and value-domain failures", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "SOURCE=N'x', CHUNK_TYPE=fixed, OVERLAP=10, CHUNK_SIZE=1",
                [
                    "Incorrect syntax near 'OVERLAP'.  Expecting CHUNK_SIZE.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, ENABLE_CHUNK_SET_ID=1, OVERLAP=10",
                ["Incorrect syntax near ','.  Expecting ')'.", "Incorrect syntax near '='."],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE=fixed, ENABLE_CHUNK_SET_ID=1, CHUNK_SIZE=1, OVERLAP=10",
                [
                    "Incorrect syntax near 'ENABLE_CHUNK_SET_ID'.  Expecting CHUNK_SIZE.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                    "Incorrect syntax near 'OVERLAP'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE='x', CHUNK_SIZE=5, CHUNK_TYPE=fixed",
                [
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                    "Incorrect syntax near ')'.  Expecting ','.",
                ],
            ],
            ["SOURCE='x', CHUNK_TYPE=fixed", ["Incorrect syntax near ')'.  Expecting ','."]],
            ["SOURCE='x'", ["Incorrect syntax near ')'."]],
            [
                "SOURCE=N'x', CHUNK_TYPE=not_fixed, CHUNK_SIZE=5",
                [
                    "Incorrect syntax near 'not_fixed'.  Expecting FIXED.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE=NULL, CHUNK_SIZE=5",
                [
                    "Incorrect syntax near 'NULL'.  Expecting FIXED.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE='fixed', CHUNK_SIZE=5",
                [
                    "Incorrect syntax near ''fixed''.  Expecting FIXED.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE=@chunk_type, CHUNK_SIZE=5",
                [
                    "Incorrect syntax near '@chunk_type'.  Expecting FIXED.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', INVALID_PARAM=fixed, CHUNK_SIZE=1, OVERLAP=1",
                [
                    "Incorrect syntax near 'INVALID_PARAM'.  Expecting CHUNK_TYPE.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                    "Incorrect syntax near 'OVERLAP'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE=N'x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, SOMETHING=5",
                ["Incorrect syntax near 'SOMETHING'.  Expecting CHUNK_SET_ID."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, ENABLE_CHUNK_SET_ID=t1.c1",
                ["Incorrect syntax near 't1'.  Expecting INTEGER, or NULL."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, ENABLE_CHUNK_SET_ID=0.1",
                ["Incorrect syntax near '0.1'.  Expecting INTEGER, or NULL."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, ENABLE_CHUNK_SET_ID='1'",
                ["Incorrect syntax near ''1''.  Expecting INTEGER, or NULL."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, ENABLE_CHUNK_SET_ID=@enabled",
                ["Incorrect syntax near '@enabled'.  Expecting INTEGER, or NULL."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=1, OVERLAP=1, ENABLE_CHUNK_SET_ID=RAND()",
                [
                    "Incorrect syntax near 'RAND'.  Expecting INTEGER, or NULL.",
                    "Incorrect syntax near ')'.  Expecting '(', or SELECT.",
                ],
            ],
        ];

        for (const [arguments_, expected] of cases) {
            const messages = parse(`${prefix}${arguments_});`).diagnostics.map(
                ({ message }) => message,
            );
            assert.deepEqual(messages, expected, arguments_);
        }
    });

    test("keeps missing-expression and recovery diagnostics precise", () => {
        const cases: readonly [string, readonly string[]][] = [
            ["SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=", ["Incorrect syntax near ')'."]],
            ["SOURCE=, CHUNK_TYPE=fixed, CHUNK_SIZE=5", ["Incorrect syntax near ','."]],
            [
                "SOURCE='x', CHUNK_TYPE=, CHUNK_SIZE=5",
                [
                    "Incorrect syntax near ','.  Expecting FIXED.",
                    "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
                ],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=5, OVERLAP=",
                ["Incorrect syntax near ')'."],
            ],
            [
                "SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=5, OVERLAP=1, ENABLE_CHUNK_SET_ID=",
                ["Incorrect syntax near ')'.  Expecting INTEGER, or NULL."],
            ],
            [
                "(SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=5)",
                ["Incorrect syntax near '='.", "Incorrect syntax near ')'."],
            ],
        ];
        for (const [arguments_, expected] of cases) {
            assert.deepEqual(
                parse(`${prefix}${arguments_});`).diagnostics.map(({ message }) => message),
                expected,
                arguments_,
            );
        }
    });

    test("publishes the same diagnostics after an incremental edit", () => {
        const before = `${prefix}SOURCE='x', CHUNK_TYPE=fixed, CHUNK_SIZE=5);\nGO\nSELECT 1;`;
        const start = before.indexOf("fixed");
        const service = new LezerSyntaxService();
        const previousDocument = document(1, before);
        const previousSnapshot = service.parse(previousDocument);
        const { incremental } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 5, text: "false" }],
            assertReuse: false,
        });
        assert.deepEqual(
            incremental.diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'false'.  Expecting FIXED.",
                "Incorrect syntax near 'CHUNK_SIZE'.  Expecting CHUNK_TYPE.",
            ],
        );
    });
});
