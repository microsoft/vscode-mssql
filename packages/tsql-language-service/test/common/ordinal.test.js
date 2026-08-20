/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { compareOrdinal, createMetadataNameComparison } = require("../../dist/index.js");

suite("locale-independent name policy", () => {
    // Turkish dotted and dotless I are deliberately distinct ordinal code points. Host locale
    // must never change cache keys or ordering shared between Node and a browser worker.
    test("uses ordinal folding and ordering for metadata identities", () => {
        const comparison = createMetadataNameComparison(false);
        assert.equal(comparison.key("identifier"), "IDENTIFIER");
        assert.equal(comparison.equals("identifier", "IDENTIFIER"), true);
        assert.equal(comparison.equals("identifier", "İDENTİFİER"), false);
        assert.equal(compareOrdinal("I", "İ"), -1);
        assert.equal(compareOrdinal("İ", "I"), 1);
        assert.equal(compareOrdinal("same", "same"), 0);
    });
});
