/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { isNotebookCopyShortcut } from "../../../src/webviews/pages/NotebookRenderer/notebookKeyboard";

suite("Notebook copy shortcut", () => {
    const copyEvent = {
        key: "c",
        code: "KeyC",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
    };

    for (const modifier of ["ctrlKey", "metaKey"] as const) {
        test(`matches plain copy with ${modifier}, including non-US layouts`, () => {
            const event = { ...copyEvent, [modifier]: true };
            expect(isNotebookCopyShortcut(event)).to.equal(true);
            expect(isNotebookCopyShortcut({ ...event, code: "KeyI" })).to.equal(true);
            expect(isNotebookCopyShortcut({ ...event, key: "ψ" })).to.equal(true);
        });

        test(`rejects Shift-modified copy with ${modifier}`, () => {
            expect(
                isNotebookCopyShortcut({
                    ...copyEvent,
                    [modifier]: true,
                    key: "C",
                    shiftKey: true,
                }),
            ).to.equal(false);
        });

        test(`rejects Alt-modified copy with ${modifier}`, () => {
            expect(
                isNotebookCopyShortcut({
                    ...copyEvent,
                    [modifier]: true,
                    key: "ç",
                    altKey: true,
                }),
            ).to.equal(false);
        });
    }

    test("rejects an unmodified C and a different Latin key at the physical C position", () => {
        expect(isNotebookCopyShortcut(copyEvent)).to.equal(false);
        expect(isNotebookCopyShortcut({ ...copyEvent, ctrlKey: true, key: "j" })).to.equal(false);
    });
});
