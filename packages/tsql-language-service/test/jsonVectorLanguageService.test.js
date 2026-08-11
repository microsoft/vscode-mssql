/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MappingCatalogProvider, SaralSqlAnalysisEngine } = require("../dist/index.js");

function catalog() {
    return new MappingCatalogProvider(
        {
            dbo: {
                Products: {
                    ProductId: "int",
                    Payload: "json",
                    Embedding: "vector(1536)",
                },
            },
        },
        1,
        "closed",
    );
}

function completeAfter(text, marker, sqlCatalog = catalog()) {
    const offset = text.indexOf(marker) + marker.length;
    const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog: sqlCatalog });
    return snapshot.completeAt(offset);
}

describe("JSON and vector language-service features", () => {
    it("projects the default and explicit OPENJSON rowsets into typed completion", () => {
        const defaultSql = "DECLARE @j nvarchar(max); SELECT j. FROM OPENJSON(@j) AS j;";
        const defaultItems = completeAfter(defaultSql, "j.").items;
        assert.deepEqual(
            defaultItems.map((item) => [item.label, item.detail]),
            [
                ["key", "nvarchar(4000)"],
                ["type", "int"],
                ["value", "nvarchar(max)"],
            ],
        );

        const explicitSql = `DECLARE @j nvarchar(max);
SELECT item. FROM OPENJSON(@j, '$.items')
WITH (Id int '$.id', Details json '$.details' AS JSON) AS item;`;
        const explicitItems = completeAfter(explicitSql, "item.").items;
        assert.deepEqual(
            explicitItems.map((item) => [item.label, item.detail]),
            [
                ["Details", "JSON"],
                ["Id", "INT"],
            ],
        );
    });

    it("provides JSON signatures, completions, return types, and clean modern syntax", () => {
        const text = `SELECT
    JSON_VALUE(Payload, '$.id' RETURNING int),
    JSON_QUERY(Payload, '$.items' WITH ARRAY WRAPPER),
    JSON_OBJECT('id': ProductId ABSENT ON NULL RETURNING json)
FROM dbo.Products;`;
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog: catalog() });

        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        assert.deepEqual(snapshot.semanticDiagnostics, []);
        const functions = snapshot.symbols().filter((symbol) => symbol.kind === "function");
        assert.deepEqual(
            functions.map((symbol) => [symbol.name, symbol.type?.display]),
            [
                ["JSON_VALUE", "int"],
                ["JSON_QUERY", "nvarchar(max)"],
                ["JSON_OBJECT", "json"],
            ],
        );
        const signature = snapshot.signatureAt(text.indexOf("'$.id'") + 1);
        assert.match(signature.signatures[0].label, /JSON_VALUE\(json_expression, path\)/i);

        const completion = completeAfter("SELECT JSON_", "JSON_", catalog());
        assert.equal(
            completion.items.some((item) => item.label === "json_value"),
            true,
        );
        assert.equal(
            completion.items.some((item) => item.label === "json_object"),
            true,
        );
        const rowset = completeAfter("SELECT * FROM OPEN", "OPEN", catalog());
        assert.equal(
            rowset.items.some((item) => item.label === "openjson"),
            true,
        );
    });

    it("returns vector source columns plus typed distance from VECTOR_SEARCH", () => {
        const text = `DECLARE @query vector(1536);
SELECT ann.
FROM VECTOR_SEARCH(
    TABLE = dbo.Products AS source,
    COLUMN = Embedding,
    SIMILAR_TO = @query,
    METRIC = 'cosine',
    TOP_N = 10
) AS ann;`;
        const completion = completeAfter(text, "ann.");
        assert.deepEqual(
            completion.items.map((item) => [item.label, item.detail]),
            [
                ["distance", "float"],
                ["Embedding", "vector(1536)"],
                ["Payload", "json"],
                ["ProductId", "int"],
            ],
        );
    });

    it("provides vector signatures, return types, and function completion", () => {
        const text = `DECLARE @left vector(1536), @right vector(1536);
SELECT VECTOR_DISTANCE('cosine', @left, @right), VECTOR_NORMALIZE(@left, 'norm2');`;
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text });
        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        const functions = snapshot.symbols().filter((symbol) => symbol.kind === "function");
        assert.deepEqual(
            functions.map((symbol) => [symbol.name, symbol.type?.display]),
            [
                ["VECTOR_DISTANCE", "float"],
                ["VECTOR_NORMALIZE", "vector"],
            ],
        );
        const signature = snapshot.signatureAt(text.indexOf("'cosine'") + 1);
        assert.match(
            signature.signatures[0].label,
            /VECTOR_DISTANCE\(distance_metric, vector1, vector2\)/i,
        );

        const completion = completeAfter("SELECT VECTOR_", "VECTOR_", catalog());
        assert.equal(
            completion.items.some((item) => item.label === "vector_distance"),
            true,
        );
        assert.equal(
            completion.items.some((item) => item.label === "vector_search"),
            true,
        );
        const rowset = completeAfter("SELECT * FROM VECTOR_", "VECTOR_", catalog());
        assert.equal(
            rowset.items.some((item) => item.label === "vector_search"),
            true,
        );
    });

    it("offers native json and vector data types", () => {
        const text = "CREATE TABLE dbo.T (Payload js";
        const json = completeAfter(text, "js", catalog());
        assert.equal(json.context.kind, "type");
        assert.equal(
            json.items.some((item) => item.label === "json" && item.kind === "type"),
            true,
        );

        const vectorText = "CREATE TABLE dbo.T (Embedding vec";
        const vector = completeAfter(vectorText, "vec", catalog());
        assert.equal(vector.context.kind, "type");
        assert.equal(
            vector.items.some((item) => item.label === "vector" && item.kind === "type"),
            true,
        );
    });

    it("keeps JSON and vector support correct across an incremental batch edit", () => {
        const engine = new SaralSqlAnalysisEngine();
        const firstText = `SELECT JSON_VALUE(Payload, '$.id') FROM dbo.Products;
GO
SELECT VECTOR_DISTANCE('cosine', Embedding, Embedding) FROM dbo.Products;`;
        const first = engine.createSnapshot({ text: firstText, catalog: catalog() });
        const secondText = firstText.replace("'$.id'", "'$.productId'");
        const second = engine.updateSnapshot(first, { text: secondText });

        assert.deepEqual(second.syntaxDiagnostics, []);
        assert.deepEqual(second.semanticDiagnostics, []);
        assert.equal(second.incrementalStatistics.reusedBatchCount, 1);
        assert.equal(second.incrementalStatistics.parsedBatchCount, 1);
    });
});
