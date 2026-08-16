/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("lsp-compatibility.sql");

suite("T-SQL compatibility grammar", () => {
    // Verifies SQL Server 2025 vector rowsets retain every public named argument and ANN hint.
    test("parses VECTOR_SEARCH parameters and FORCE_ANN_ONLY", () => {
        const snapshot = parse(`
SELECT ann.distance
FROM VECTOR_SEARCH(
  TABLE = dbo.Products AS source,
  COLUMN = Embedding,
  SIMILAR_TO = @query,
  METRIC = 'cosine',
  TOP_N = 10,
  L = 20,
  M = 8,
  START_ID = 0
) WITH (FORCE_ANN_ONLY) AS ann
ORDER BY ann.distance;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(count(snapshot.tree.toString(), "VectorSearchParameter("), 8);
        assert.match(snapshot.tree.toString(), /VectorSearchHintClause/);
    });

    // Verifies both spellings of approximate TOP/FETCH and standalone FETCH pagination.
    test("parses TOP and FETCH approximate retrieval", () => {
        const snapshot = parse(`
SELECT TOP (10) WITH APPROX ann.distance
FROM VECTOR_SEARCH(TABLE=dbo.t, COLUMN=embedding, SIMILAR_TO=@q, METRIC='dot') ann
ORDER BY ann.distance;
SELECT ann.distance
FROM VECTOR_SEARCH(TABLE=dbo.t, COLUMN=embedding, SIMILAR_TO=@q, METRIC='euclidean') ann
ORDER BY ann.distance FETCH APPROXIMATE NEXT 20 ROWS ONLY;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(count(snapshot.tree.toString(), "ApproximateKeyword("), 2);
        assert.match(snapshot.tree.toString(), /ApproximateFetchClause/);
    });

    // Verifies cursor variables, nullable module parameters, and historical money signs.
    test("parses declaration and parameter compatibility forms", () => {
        const snapshot = parse(`
DECLARE @id INT, @cursor AS CURSOR, @amount MONEY = £10.00, @yen MONEY = ¥-20.5;
CREATE PROCEDURE dbo.p @a INT NULL = NULL, @b INT NOT NULL = 1 OUTPUT AS SELECT 1;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(count(snapshot.tree.toString(), "MoneyLiteral"), 2);
    });

    // Verifies transaction, THROW, and legacy SET forms retain real statement nodes.
    test("parses COMMIT WORK, variable THROW, and NO_BROWSETABLE", () => {
        const snapshot = parse(`
SET NO_BROWSETABLE ON;
THROW @error_number, @message, @state;
COMMIT WORK;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CommitTransactionStatement/);
    });

    // Verifies semicolon-less nested control flow stops each mounted body at the next control word.
    test("recovers ELSE IF and WHILE bodies without semicolons", () => {
        const snapshot = parse(`
IF @a > 10
  DECLARE @b INT
ELSE IF @a > 20
  DECLARE @c INT
WHILE @a < 30
  CREATE TABLE #work (id INT)
WHILE @a < 40
  SET @a += 1;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(count(snapshot.tree.toString(), "IfStatement("), 2);
        assert.equal(count(snapshot.tree.toString(), "WhileStatement("), 2);
    });

    // Verifies CLR/UDT method chains, expression collation, and OPENJSON column collation.
    test("parses chained methods and collated OPENJSON columns", () => {
        const snapshot = parse(`
SELECT value.MakePoint(@x).STBuffer(2).ToString() COLLATE Latin1_General_100_CI_AS
FROM OPENJSON(@json) WITH (
  value NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 '$.value' AS JSON
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(count(snapshot.tree.toString(), "FunctionMemberCall("), 2);
        assert.match(snapshot.tree.toString(), /ColumnSchemaElement/);
    });

    // Verifies SQL Server's callable UPDATE target and chained variable/column assignment.
    test("parses callable UPDATE targets and chained assignments", () => {
        const snapshot = parse("UPDATE dbo.target_rows(@id) SET @result = value.Total += 23;");

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /DmlTarget/);
        assert.match(snapshot.tree.toString(), /SetClause/);
    });

    // Verifies inline index key lists, memory-optimized HASH indexes, and ANSI type synonyms.
    test("parses inline indexes and multiword type synonyms", () => {
        const snapshot = parse(`
CREATE TABLE dbo.t (
  label NATIONAL CHAR(10),
  score DOUBLE PRECISION,
  payload NVARCHAR(100) INDEX ix_payload NONCLUSTERED (payload) INCLUDE (label),
  INDEX ix_hash NONCLUSTERED HASH (score) WITH (BUCKET_COUNT = 256),
  CONSTRAINT uq UNIQUE (label) WITH sorted_data fillfactor = 90
);
ALTER TABLE dbo.t ADD INDEX ix_more NONCLUSTERED HASH (score) WITH (BUCKET_COUNT = 512);
ALTER TABLE dbo.t ALTER INDEX ix_more REBUILD WITH (BUCKET_COUNT = 1024);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /DataTypeName\(National/);
        assert.match(snapshot.tree.toString(), /DataTypeName\(Double,Precision/);
    });

    // Verifies malformed vector syntax remains a parser error instead of being silently swallowed.
    test("reports truncated VECTOR_SEARCH syntax", () => {
        assert.ok(
            parse("SELECT * FROM VECTOR_SEARCH(TABLE = dbo.t, COLUMN =);").diagnostics.length > 0,
        );
    });
});

function count(text, pattern) {
    return text.split(pattern).length - 1;
}
