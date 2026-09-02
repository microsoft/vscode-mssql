/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { compareOrdinal } from "../../src/common/ordinal.ts";
import { createMetadataNameComparison } from "../../src/metadata/nameComparison.ts";

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
