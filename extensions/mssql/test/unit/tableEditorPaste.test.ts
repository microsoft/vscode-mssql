/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { parseTableEditorPasteValue } from "../../src/sharedInterfaces/tableEditor";

suite("Table editor paste values", () => {
    test("accepts boolean literals without changing their meaning", () => {
        const column = { editorKind: "boolean" as const, isNullable: false };

        expect(parseTableEditorPasteValue(" TRUE ", column)).to.equal("true");
        expect(parseTableEditorPasteValue("false", column)).to.equal("false");
    });

    test("rejects invalid boolean literals instead of converting them to false", () => {
        const column = { editorKind: "boolean" as const, isNullable: false };

        expect(parseTableEditorPasteValue("maybe", column)).to.equal(undefined);
    });

    test("accepts NULL only for nullable columns", () => {
        expect(
            parseTableEditorPasteValue("NULL", { editorKind: "boolean", isNullable: true }),
        ).to.equal(null);
        expect(
            parseTableEditorPasteValue("NULL", { editorKind: "boolean", isNullable: false }),
        ).to.equal(undefined);
    });

    test("preserves non-boolean text values", () => {
        expect(
            parseTableEditorPasteValue("  00123  ", { editorKind: "scalar", isNullable: false }),
        ).to.equal("  00123  ");
    });
});
