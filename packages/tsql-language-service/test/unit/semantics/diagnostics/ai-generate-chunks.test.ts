/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";

const { analyze } = createSemanticHarness({ uri: "file:///ai-generate-chunks-semantics.sql" });

suite("AI_GENERATE_CHUNKS semantic diagnostics", () => {
    test("recognizes the one-part rowset as built in", async () => {
        const diagnostics = await analyze(`
SELECT chunks.chunk
FROM AI_GENERATE_CHUNKS(
    SOURCE = 'some text',
    CHUNK_TYPE = fixed,
    CHUNK_SIZE = 5,
    OVERLAP = 1,
    ENABLE_CHUNK_SET_ID = 1
) AS chunks;`);

        assert.deepEqual(diagnostics, []);
    });

    test("continues resolving qualified spellings through metadata", async () => {
        const diagnostics = await analyze("SELECT * FROM dbo.AI_GENERATE_CHUNKS(3);");

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "MSSQL208",
                    message: "Invalid object name 'dbo.AI_GENERATE_CHUNKS'.",
                },
            ],
        );
    });
});
