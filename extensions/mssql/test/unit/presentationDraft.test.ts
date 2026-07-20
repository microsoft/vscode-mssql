/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    mergePresentationLayoutEdits,
    presentationLayoutSnapshot,
    rebasePresentationLayoutEdits,
} from "../../src/webviews/pages/RunbookStudio/presentationDraft";
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

    test("three-way rebase preserves non-overlapping upstream fields", () => {
        const base = edit("query", 0);
        const local = { ...base, sectionId: "details" };
        const upstream = {
            ...base,
            placement: { ...base.placement, span: { compact: 1, medium: 4, wide: 8 } },
        };
        const result = rebasePresentationLayoutEdits([base], [upstream], [local]);
        expect(result.conflicts).to.deep.equal([]);
        expect(result.edits).to.deep.equal([
            {
                ...upstream,
                sectionId: "details",
            },
        ]);
    });

    test("three-way rebase reports only differently overlapping fields", () => {
        const base = edit("query", 0);
        const local = { ...base, sectionId: "details", hidden: true };
        const upstream = { ...base, sectionId: "appendix", hidden: true };
        const result = rebasePresentationLayoutEdits([base], [upstream], [local]);
        expect(result.conflicts).to.deep.equal([{ nodeId: "query", fields: ["sectionId"] }]);
        expect(result.edits[0]).to.include({ sectionId: "details", hidden: true });
    });

    test("three-way rebase refuses a widget removed upstream", () => {
        const base = edit("query", 0);
        const result = rebasePresentationLayoutEdits(
            [base],
            [],
            [{ ...base, sectionId: "details" }],
        );
        expect(result.conflicts).to.deep.equal([{ nodeId: "query", fields: ["node"] }]);
    });

    test("layout snapshot retains persisted hidden widgets", () => {
        const snapshot = presentationLayoutSnapshot(undefined, {
            query: {
                widgetId: "query-widget",
                views: ["grid"],
                defaultView: "grid",
                presentation: { mode: "single" },
                setByUser: true,
                sectionId: "details",
                placement: { order: 2 },
                hidden: true,
            },
        });
        expect(snapshot).to.deep.equal([
            {
                nodeId: "query",
                widgetId: "query-widget",
                defaultView: "grid",
                sectionId: "details",
                placement: { order: 2 },
                hidden: true,
            },
        ]);
    });
});
