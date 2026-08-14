/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { suite, test } = require("node:test");
const path = require("node:path");

const corpusRoot = path.join(__dirname, "corpus", "tsql-conformance");

suite("vendored T-SQL conformance corpus inventory", () => {
    // The inventory protects attribution and prevents accidental fixture loss or silent edits.
    test("matches the pinned byte-for-byte manifest", async () => {
        const manifest = JSON.parse(await readFile(path.join(corpusRoot, "manifest.json"), "utf8"));
        assert.equal(manifest.source.commit, "9aec6298a36d6e27ca0f2ad574bb3fd80aea30f5");
        assert.equal(manifest.source.license, "MIT");
        assert.equal(manifest.inventory.files, 489);
        assert.equal(manifest.inventory.bytes, 494560);

        const inventoryLines = [];
        for (const file of manifest.files) {
            const bytes = await readFile(path.join(corpusRoot, file.path));
            assert.equal(bytes.byteLength, file.bytes, file.path);
            const hash = createHash("sha256").update(bytes).digest("hex");
            assert.equal(hash, file.sha256, file.path);
            inventoryLines.push(`${file.path}\0${hash}\n`);
        }

        assert.equal(
            createHash("sha256").update(inventoryLines.join("")).digest("hex"),
            manifest.inventory.sha256,
        );
    });

    // Recovery fixtures are explicit so a valid-corpus report never counts them as regressions.
    test("classifies the intentional malformed fixtures separately", async () => {
        const manifest = JSON.parse(await readFile(path.join(corpusRoot, "manifest.json"), "utf8"));
        assert.deepEqual(
            manifest.files
                .filter((file) => file.expectation === "recovery")
                .map((file) => path.basename(file.path)),
            [
                "BeginEndStatementErrorTests.sql",
                "CreateSchemaStatementErrorTests.sql",
                "CreateTriggerStatementErrorTests.sql",
                "MultipleErrorTests.sql",
            ],
        );
    });
});
