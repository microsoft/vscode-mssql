/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { mergePresentationLayoutEdits } from "../../src/webviews/pages/RunbookStudio/presentationDraft";
import { PresentationLayoutEdit } from "../../src/sharedInterfaces/runbookPresentation";

function edit(nodeId: string, order: number, hidden = false): PresentationLayoutEdit {
    return {
        nodeId,
        defaultView: "grid",
        sectionId: "primary",
        placement: { order, span: { compact: 1, medium: 3, wide: 6 } },
        hidden,
    };
}

suite("presentationDraft", () => {
    test("retains prior nodes while replacing the latest intent for one node", () => {
        const merged = mergePresentationLayoutEdits(
            [edit("query", 0), edit("tests", 1)],
            [edit("query", 2, true)],
        );
        expect(merged).to.deep.equal([edit("query", 2, true), edit("tests", 1)]);
    });

    test("keeps both sides of an atomic reorder in one staged batch", () => {
        const merged = mergePresentationLayoutEdits(
            [edit("summary", 2)],
            [edit("query", 1), edit("tests", 0)],
        );
        expect(
            merged.map((candidate) => [candidate.nodeId, candidate.placement.order]),
        ).to.deep.equal([
            ["summary", 2],
            ["query", 1],
            ["tests", 0],
        ]);
    });
});
