/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { suite, test } from "node:test";

import { ImmutableTextSnapshot, LezerSyntaxService } from "../../../src/index.ts";
import { assertDefined } from "../support/assertions.ts";
import {
    corpusRoot,
    decodeCorpusFile,
    readCorpusBaseline,
    readCorpusManifest,
} from "./corpusData.ts";

suite("vendored T-SQL broad-corpus regression", () => {
    // Every checked-in parseable fixture is validated without relying on an external checkout.
    test("does not add raw recovery nodes to any fixture", async () => {
        const manifest = await readCorpusManifest();
        const baseline = await readCorpusBaseline();
        const service = new LezerSyntaxService();
        let rawErrors = 0;

        for (const file of manifest.files.filter((entry) => entry.expectation === "parseable")) {
            const bytes = await readFile(path.join(corpusRoot, file.path));
            const text = decodeCorpusFile(bytes, file.encoding);
            const snapshot = service.parse(
                new ImmutableTextSnapshot(`corpus:/${file.path}`, 1, text),
            );
            const actual = snapshot.statistics.rawErrorNodeCount;
            const expected = baseline.files[file.path];
            assertDefined(expected, `${file.path}: missing baseline`);
            rawErrors += actual;
            assert.ok(
                actual <= expected,
                `${file.path}: raw errors increased from ${expected} to ${actual}`,
            );
        }

        assert.ok(
            rawErrors <= baseline.rawErrors,
            `aggregate raw errors increased from ${baseline.rawErrors} to ${rawErrors}`,
        );
    });
});
