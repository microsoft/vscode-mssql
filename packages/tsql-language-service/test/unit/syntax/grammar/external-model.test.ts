/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("external-model.sql");

suite("T-SQL external model grammar", () => {
    // Verifies an authorized model retains endpoint, API, embedding, JSON, and local-runtime options.
    test("parses CREATE EXTERNAL MODEL options", () => {
        const snapshot = parse(`
CREATE EXTERNAL MODEL [model_name] AUTHORIZATION dbo
WITH (
  LOCATION = 'https://models.example.com/advanced',
  API_FORMAT = 'Azure OpenAI',
  MODEL_TYPE = EMBEDDINGS,
  MODEL = 'text-embedding-ada-002',
  PARAMETERS = '{"batch_size":32}',
  LOCAL_RUNTIME_PATH = 'C:\\models\\runtime'
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CreateExternalModelStatement\(/);
    });

    // Verifies ALTER accepts a partial setting list and DROP retains the external-model object kind.
    test("parses ALTER and DROP EXTERNAL MODEL", () => {
        const snapshot = parse(`
ALTER EXTERNAL MODEL model_name SET (
  LOCATION = '/new/model/path',
  MODEL_TYPE = EMBEDDINGS,
  PARAMETERS = '{"temperature":0.7}'
);
DROP EXTERNAL MODEL model_name;`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /AlterExternalModelStatement\(/);
        assert.match(tree, /DropExternalModelStatement\(/);
    });

    // Verifies model type is not accepted as an arbitrary string or unrelated identifier.
    test("reports an unsupported model type", () => {
        const snapshot = parse("CREATE EXTERNAL MODEL m WITH (MODEL_TYPE = CLASSIFIER);");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies option assignment values cannot be omitted.
    test("reports a missing external model option value", () => {
        const snapshot = parse("ALTER EXTERNAL MODEL m SET (MODEL = );");
        assert.ok(snapshot.diagnostics.length > 0);
    });

    test("reports the ALTER WITH recovery contract without cascading", () => {
        const sql = `ALTER EXTERNAL MODEL model_name WITH (
  LOCATION = '/new/model/path',
  MODEL_TYPE = EMBEDDINGS
);`;
        const snapshot = parse(sql);
        assert.deepEqual(
            snapshot.diagnostics.map(({ message, range }) => ({
                message,
                text: sql.slice(range.start, range.end),
            })),
            [
                { message: "Incorrect syntax near 'WITH'.  Expecting SET.", text: "WITH" },
                {
                    message:
                        "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    text: "(",
                },
                {
                    message: "Incorrect syntax near 'LOCATION'.  Expecting '(', or SELECT.",
                    text: "LOCATION",
                },
            ],
        );
    });

    test("accepts empty CREATE and ALTER option lists", () => {
        for (const sql of [
            "CREATE EXTERNAL MODEL m AUTHORIZATION dbo WITH ();",
            "ALTER EXTERNAL MODEL m SET ();",
        ]) {
            assert.deepEqual(parse(sql).diagnostics, [], sql);
        }
    });

    test("reports misspelled external-model statement headers without cascades", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "CREATE EXTERNAL MODLE m WITH (LOCATION='x');",
                [
                    "Incorrect syntax near 'MODLE'.",
                    "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    "Incorrect syntax near 'LOCATION'.  Expecting '(', or SELECT.",
                ],
            ],
            [
                "ALTER EXTERNAL MODLE m SET (LOCATION='x');",
                [
                    "Incorrect syntax near 'MODLE'.  Expecting DATASOURCE, LANGUAGE, LIBRARY, MODEL, or RESOURCE.",
                    "Incorrect syntax near 'SET'.",
                    "Incorrect syntax near 'LOCATION'.  Expecting '(', or SELECT.",
                ],
            ],
            ["DROP EXTERNAL MODLE m;", ["Incorrect syntax near 'MODLE'."]],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });

    test("reports unsupported ALTER authorization without cascades", () => {
        const sql = "ALTER EXTERNAL MODEL m AUTHORIZATION dbo SET (LOCATION='x');";
        assert.deepEqual(
            parse(sql).diagnostics.map(({ message }) => message),
            [
                "Incorrect syntax near 'AUTHORIZATION'.  Expecting SET.",
                "Incorrect syntax near 'SET'.",
                "Incorrect syntax near 'LOCATION'.  Expecting '(', or SELECT.",
            ],
        );
    });

    test("reports external-model option value domains", () => {
        const cases: readonly [string, readonly string[]][] = [
            [
                "ALTER EXTERNAL MODEL m SET (API_FORMAT=AzureOpenAI);",
                ["Incorrect syntax near 'AzureOpenAI'.  Expecting STRING, or TEXT_LEX."],
            ],
            [
                "ALTER EXTERNAL MODEL m SET (MODEL_TYPE='EMBEDDINGS');",
                ["Incorrect syntax near ''EMBEDDINGS''.  Expecting EMBEDDINGS."],
            ],
            [
                "CREATE EXTERNAL MODEL m WITH (MODEL_TYPE=EMBEDDIS);",
                ["Incorrect syntax near 'EMBEDDIS'.  Expecting EMBEDDINGS."],
            ],
            [
                "CREATE EXTERNAL MODEL m WITH (LOCATION='x', LOCALRUNTIMEPATH='y');",
                ["Incorrect syntax near 'LOCALRUNTIMEPATH'."],
            ],
        ];
        for (const [sql, expected] of cases) {
            assert.deepEqual(
                parse(sql).diagnostics.map(({ message }) => message),
                expected,
                sql,
            );
        }
    });
});
