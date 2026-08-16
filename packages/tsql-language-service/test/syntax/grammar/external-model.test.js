/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
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
});
