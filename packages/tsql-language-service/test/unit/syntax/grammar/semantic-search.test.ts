/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { LezerSyntaxService } from "../../../../src/index.ts";
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, document, parse } = createSyntaxHarness("semantic-search.sql");

suite("SEMANTIC_SEARCH grammar and diagnostics", () => {
    test("parses required and optional parameter forms", () => {
        for (const sql of [
            `SELECT * FROM SEMANTIC_SEARCH(
                TABLE = dbo.Documents AS source,
                COLUMN = (title),
                SEARCH_STRING = 'query') AS results;`,
            `SELECT * FROM SEMANTIC_SEARCH(
                TABLE = db.dbo.Documents,
                COLUMN = (title, body, summary),
                SEARCH_STRING = @query,
                RERANKING_STRATEGY = RERANKER(RRF),
                TOP_N = @top_n,
                WEIGHT = @weight) results;`,
            `SELECT * FROM SEMANTIC_SEARCH(
                TABLE = Documents,
                COLUMN = (body),
                SEARCH_STRING = 'query',
                RERANKING_STRATEGY = RERANKER(RRF, CONFIG(SMOOTHING_FACTOR = 5)),
                TOP_N = 50);`,
        ]) {
            const snapshot = assertValid(sql);
            assert.match(snapshot.tree.toString(), /SemanticSearchTableSource\(/);
        }
    });

    test("reports malformed parameter contracts without cascades", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "TABLE=t AS s, SEARCH_STRING='q', COLUMN=(c)",
                [
                    "Incorrect syntax near 'SEARCH_STRING'.  Expecting COLUMN.",
                    "Incorrect syntax near 'COLUMN'.",
                    "Incorrect syntax near 'c'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "TABLE=t, COLUMN=c, SEARCH_STRING='q'",
                ["Incorrect syntax near 'c'.  Expecting '('.", "Incorrect syntax near '='."],
            ],
            [
                "COLUMN=(c), SEARCH_STRING='q'",
                ["Incorrect syntax near '='.  Expecting ID.", "Incorrect syntax near '='."],
            ],
            [
                "TABEL=t AS s, COLUMN=(c), SEARCH_STRING='q'",
                [
                    "Incorrect syntax near '='.",
                    "Incorrect syntax near '='.  Expecting ID.",
                    "Incorrect syntax near '='.",
                ],
            ],
            [
                "TABLE=t, COLUMN=(c), SEARCH_STRING='q', RERANKING_STRATEGY=RERANKER(KTF), TOP_N=5",
                ["Incorrect syntax near 'KTF'."],
            ],
            [
                "TABLE=t, COLUMN=(c), SEARCH_STRING='q', RERANKING_STRATEGY=RERANKER(RRF, CONFIG(SMOTHING_FACTOR=5))",
                ["Incorrect syntax near 'SMOTHING_FACTOR'."],
            ],
            [
                "TABLE=t, COLUMN=(c1, c2, SEARCH_STRING='q'",
                ["Incorrect syntax near '='.  Expecting ')', or ','."],
            ],
        ];
        for (const [arguments_, expected] of cases) {
            const sql = `SELECT * FROM SEMANTIC_SEARCH(${arguments_});`;
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("keeps diagnostics equivalent after incremental repair", () => {
        const sql =
            "SELECT * FROM SEMANTIC_SEARCH(TABLE=t, COLUMN=(c), SEARCH_STRING='q', RERANKING_STRATEGY=RERANKER(KTF));\nGO\nSELECT 1;";
        const start = sql.indexOf("KTF");
        const service = new LezerSyntaxService();
        const previousDocument = document(1, sql);
        const previousSnapshot = service.parse(previousDocument);
        assert.deepEqual(
            previousSnapshot.diagnostics.map(({ message }) => message),
            ["Incorrect syntax near 'KTF'."],
        );
        const { incremental } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + 3, text: "RRF" }],
            assertReuse: false,
        });
        assert.deepEqual(incremental.diagnostics, []);
    });
});
