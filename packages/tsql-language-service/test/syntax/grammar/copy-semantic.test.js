/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("copy-semantic.sql");

suite("T-SQL COPY and semantic index grammar", () => {
    // Verifies COPY supports column mappings, multiple files, and nested credentials.
    test("parses COPY INTO external-load variants", () => {
        const snapshot = parse(`
COPY INTO dbo.Target (Id DEFAULT 0 1, Payload 2)
FROM 'https://storage/a.csv', 'https://storage/b.csv'
WITH (
    FILE_TYPE = 'CSV',
    CREDENTIAL = (IDENTITY = 'Managed Identity', SECRET = 'test'),
    FIRSTROW = 2
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CopyIntoStatement\(/);
        assert.match(tree, /CopyColumnMappingList\(/);
        assert.match(tree, /CopyWithClause\(/);
    });

    // Verifies COPY retains a syntax error when its required source location is absent.
    test("reports a missing COPY source", () => {
        assert.ok(parse("COPY INTO dbo.Target FROM;").diagnostics.length > 0);
    });

    // Verifies modern semantic indexes retain structured model, vector, and chunking options.
    test("parses CREATE SEMANTIC INDEX options", () => {
        const snapshot = parse(`
CREATE SEMANTIC INDEX SI_Documents ON dbo.Documents (
    Content SEARCH_TYPE = vector TYPE COLUMN ContentType LANGUAGE English
      CHUNK_USING(TYPE = sentence, SIZE = 1000),
    Title SEARCH_TYPE = fulltext
) WITH (
    EXTERNAL_MODEL = ModelA (PARAMETERS = '{"dimension":1536}'),
    VECTOR_INDEX (METRIC = 'cosine', TYPE = 'DiskANN'),
    FULLTEXT_STOPLIST = SYSTEM,
    MAXDOP = 8,
    DROP_EXISTING = OFF
) ON [PRIMARY];`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateSemanticIndexStatement\(/);
        assert.equal((tree.match(/SemanticIndexColumn\(/g) ?? []).length, 2);
        assert.match(tree, /SemanticExternalModel\(/);
    });

    // Verifies semantic indexes require an ON target and at least one indexed column.
    test("reports an incomplete semantic index", () => {
        assert.ok(parse("CREATE SEMANTIC INDEX SI_Documents;").diagnostics.length > 0);
    });
});
