/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { xmlDataTypeMember, xmlDataTypeMembers } from "../../../src/index.ts";

suite("language-defined type member registry", () => {
    // XML completion, validation, and type inference share this exact five-member language surface.
    test("owns every XML method and its result shape", () => {
        assert.deepEqual(
            xmlDataTypeMembers.map((member) => member.name),
            ["value", "query", "exist", "nodes", "modify"],
        );
        assert.equal(xmlDataTypeMember("QUERY")?.returnType, "xml");
        assert.equal(xmlDataTypeMember("exist")?.returnType, "bit");
        assert.equal(xmlDataTypeMember("value")?.result, "dynamic-scalar");
        assert.equal(xmlDataTypeMember("nodes")?.result, "rowset");
        assert.equal(xmlDataTypeMember("missing"), undefined);
    });
});
