/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("ai-embedding.sql", profile(17, 170));

suite("T-SQL AI embedding grammar", () => {
    // Verifies SQL Server 2025 embedding calls preserve model and optional parameter expressions.
    test("parses AI_GENERATE_EMBEDDINGS expressions", () => {
        const snapshot = parse(`
SELECT AI_GENERATE_EMBEDDINGS(N'Input' USE MODEL dbo.MyModel);
SELECT AI_GENERATE_EMBEDDINGS(
  'Input' USE MODEL [My Model] PARAMETERS (TRY_CONVERT(JSON, N'{}'))
);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/AiGenerateEmbeddingsExpression\(/g) ?? []).length,
            2,
        );
    });

    // Verifies embedding expressions are gated to compatibility level 170.
    test("gates AI_GENERATE_EMBEDDINGS by compatibility level", () => {
        const sql = "SELECT AI_GENERATE_EMBEDDINGS('Input' USE MODEL m);";
        const old = parse(sql, profile(16, 160));
        const current = parse(sql, profile(17, 170));

        assert.equal(old.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(
            old.diagnostics.map((diagnostic) => diagnostic.message),
            [
                "AI_GENERATE_EMBEDDINGS (near 'AI_GENERATE_EMBEDDINGS') is not available on SQL Server 2022 (compatibility level 160). It requires SQL Server 2025 or later with database compatibility level 170 or higher.",
            ],
        );
        assert.deepEqual(current.diagnostics, []);
    });

    // Verifies a model name is required after USE MODEL.
    test("reports a missing embedding model", () => {
        const snapshot = parse("SELECT AI_GENERATE_EMBEDDINGS('Input' USE MODEL); ");
        assert.ok(snapshot.diagnostics.length > 0);
    });
});

function profile(serverMajorVersion, compatibilityLevel) {
    return {
        serverMajorVersion,
        compatibilityLevel,
        engineProfile: "sql-server",
        previewFeatures: false,
    };
}
