/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../dist/index.js");

suite("SQL Server vector semantic validation", () => {
    // Verifies a complete VECTOR_SEARCH and approximate distance order produce no semantic errors.
    test("accepts a valid approximate vector query", async () => {
        const diagnostics = await analyze(`
SELECT TOP 10 WITH APPROX ann.distance
FROM VECTOR_SEARCH(
  TABLE = dbo.Products,
  COLUMN = Embedding,
  SIMILAR_TO = @query,
  METRIC = 'cosine',
  TOP_N = 10
) AS ann
ORDER BY ann.distance ASC;`);

        assert.deepEqual(diagnostics, []);
    });

    // Verifies named-parameter mistakes remain precise semantic diagnostics on a usable tree.
    test("diagnoses vector parameter contracts", async () => {
        const diagnostics = await analyze(`
SELECT * FROM VECTOR_SEARCH(
  TABL = dbo.Products,
  SIMILAR_TO = (SELECT @query),
  COLUMN = dbo.Embedding,
  METRIC = @metric,
  COLUMN = OtherEmbedding,
  FOR INDEX CREATE
) AS ann;`);
        const messages = diagnostics
            .filter(({ code }) => code === "VEC002")
            .map(({ message }) => message);

        assert.ok(messages.some((message) => message.includes("requires the TABLE")));
        assert.ok(messages.some((message) => message.includes("'TABL' is not a valid")));
        assert.ok(messages.some((message) => message.includes("must appear in that order")));
        assert.ok(messages.some((message) => message.includes("specified more than once")));
        assert.ok(messages.some((message) => message.includes("one-part column")));
        assert.ok(messages.some((message) => message.includes("METRIC parameter")));
        assert.ok(messages.some((message) => message.includes("subquery is not allowed")));
        assert.ok(messages.some((message) => message.includes("internal use")));
    });

    // Verifies optional ANN tuning parameters retain their documented order, pairing, and value domains.
    test("diagnoses ANN tuning parameter contracts", async () => {
        const diagnostics = await analyze(`
SELECT * FROM VECTOR_SEARCH(
  TABLE = dbo.Products,
  COLUMN = Embedding,
  SIMILAR_TO = @query,
  METRIC = 'cosine',
  M = 0,
  START_ID = -1
) ann;`);
        const messages = diagnostics
            .filter(({ code }) => code === "VEC002")
            .map(({ message }) => message);

        assert.ok(messages.some((message) => message.includes("L and M parameters")));
        assert.ok(messages.some((message) => message.includes("TOP_N is required")));
        assert.ok(
            messages.some((message) => message.includes("M parameter must be a positive integer")),
        );
        assert.ok(
            messages.some((message) =>
                message.includes("START_ID parameter must be a non-negative integer"),
            ),
        );
    });

    // Verifies APPROX requires VECTOR_SEARCH and the one ascending distance ordering contract.
    test("diagnoses invalid approximate retrieval", async () => {
        const missingSource = await analyze(
            "SELECT TOP 5 WITH APPROX id FROM dbo.Products ORDER BY id;",
        );
        assert.ok(
            missingSource.some(
                ({ code, message }) =>
                    code === "VEC003" && message.includes("requires VECTOR_SEARCH"),
            ),
        );

        const invalidOrder = await analyze(`
SELECT TOP 5 PERCENT WITH APPROX ann.id
FROM VECTOR_SEARCH(TABLE=dbo.Products, COLUMN=Embedding, SIMILAR_TO=@query, METRIC='dot') ann
ORDER BY ann.id DESC, ann.distance;`);
        const messages = invalidOrder
            .filter(({ code }) => code === "VEC003")
            .map(({ message }) => message);
        assert.ok(messages.some((message) => message.includes("cannot be combined with PERCENT")));
        assert.ok(messages.some((message) => message.includes("exactly one item")));
    });

    // Verifies vector scalar arity and vector-index METRIC requirements survive the architecture change.
    test("diagnoses vector functions and indexes", async () => {
        const diagnostics = await analyze(`
SELECT VECTOR_DISTANCE('cosine', @left), VECTOR_NORM(@left), VECTOR_NORMALIZE(@left, 'norm2', 1);
CREATE VECTOR INDEX ix_embedding ON dbo.Products(Embedding);`);

        assert.equal(diagnostics.filter(({ code }) => code === "VEC001").length, 3);
        assert.ok(
            diagnostics.some(
                ({ code, message }) => code === "IDX001" && message.includes("METRIC"),
            ),
        );
    });
});

async function analyze(sql) {
    const metadata = new InMemoryMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open("file:///vector-semantics.sql", 1, sql);
    assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics;
}
