/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { suite, test } = require("node:test");
const path = require("node:path");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

const corpusRoot = path.join(__dirname, "corpus", "tsql-conformance");

suite("vendored T-SQL broad-corpus regression", () => {
    // Every parseable fixture is checked locally; no neighboring ScriptDOM checkout is required.
    test("does not add raw recovery nodes to any fixture", async () => {
        const manifest = JSON.parse(await readFile(path.join(corpusRoot, "manifest.json"), "utf8"));
        const baseline = JSON.parse(await readFile(path.join(corpusRoot, "baseline.json"), "utf8"));
        const service = new LezerSyntaxService();
        let rawErrors = 0;

        assert.equal(baseline.sourceCommit, manifest.source.commit);
        for (const file of manifest.files.filter((entry) => entry.expectation === "parseable")) {
            const bytes = await readFile(path.join(corpusRoot, file.path));
            const text = decode(bytes, file.encoding);
            const snapshot = service.parse(
                new ImmutableTextSnapshot(`corpus:/${file.path}`, 1, text),
            );
            const actual = snapshot.statistics.rawErrorNodeCount;
            rawErrors += actual;
            assert.ok(
                actual <= baseline.files[file.path],
                `${file.path}: raw errors increased from ${baseline.files[file.path]} to ${actual}`,
            );
        }

        assert.ok(
            rawErrors <= baseline.rawErrors,
            `aggregate raw errors increased from ${baseline.rawErrors} to ${rawErrors}`,
        );
    });
});

function decode(bytes, encoding) {
    if (encoding === "utf16le") return bytes.subarray(2).toString("utf16le");
    if (encoding === "utf16be") {
        const body = Buffer.from(bytes.subarray(2));
        for (let index = 0; index + 1 < body.length; index += 2) {
            [body[index], body[index + 1]] = [body[index + 1], body[index]];
        }
        return body.toString("utf16le");
    }
    if (encoding === "utf8-bom") return bytes.subarray(3).toString("utf8");
    return bytes.toString("utf8");
}
