/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { ImmutableTextSnapshot, applyTextChanges } from "../../../src/text/textSnapshot.ts";

suite("text snapshots", () => {
    test("applies sequential UTF-16 edits and converts positions", () => {
        const first = new ImmutableTextSnapshot("file:///a.sql", 1, "SELECT 😀\r\nFROM t");
        assert.deepEqual(first.positionAt(9), { line: 0, character: 9 });
        const second = applyTextChanges(first, 2, [{ start: 0, end: 6, text: "select" }]);
        assert.equal(second.text, "select 😀\r\nFROM t");
        assert.equal(second.offsetAt({ line: 1, character: 4 }), 15);
    });
});
