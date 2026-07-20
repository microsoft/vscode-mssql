/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    buildTopRowsDerivedSource,
    mergePresentationLayoutEdits,
    presentationLayoutSnapshot,
    pointerReorderPresentationLayoutEdits,
    pointerMovePresentationLayoutEdits,
    presentationLayoutStrategy,
    presentationSpanPresetAt,
    presentationSpanPresetOf,
    rebasePresentationLayoutEdits,
    rebasePresentationLayoutPolicy,
} from "../../src/webviews/pages/RunbookStudio/presentationDraft";
import {
    PresentationLayoutEdit,
    ResolvedPresentation,
} from "../../src/sharedInterfaces/runbookPresentation";

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

    test("pointer reorder emits one normalized atomic range", () => {
        const reordered = pointerReorderPresentationLayoutEdits(
            [edit("query", 0), edit("tests", 1), edit("report", 2), edit("evidence", 3)],
            "query",
            "report",
        );
        expect(
            reordered.map((candidate) => [candidate.nodeId, candidate.placement.order]),
        ).to.deep.equal([
            ["tests", 0],
            ["report", 1],
            ["query", 2],
        ]);
    });

    test("pointer reorder rejects missing and self targets", () => {
        const siblings = [edit("query", 0), edit("tests", 1)];
        expect(pointerReorderPresentationLayoutEdits(siblings, "query", "query")).to.deep.equal([]);
        expect(pointerReorderPresentationLayoutEdits(siblings, "query", "other")).to.deep.equal([]);
    });

    test("pointer move normalizes the source and target sections atomically", () => {
        const primary = [edit("query", 0), edit("tests", 1), edit("report", 2)];
        const details = [
            { ...edit("findings", 0), sectionId: "details" },
            { ...edit("evidence", 1), sectionId: "details" },
        ];
        const moved = pointerMovePresentationLayoutEdits([primary, details], "tests", "evidence");
        expect(
            moved.map((candidate) => [
                candidate.nodeId,
                candidate.sectionId,
                candidate.placement.order,
            ]),
        ).to.deep.equal([
            ["report", "primary", 1],
            ["tests", "details", 1],
            ["evidence", "details", 2],
        ]);
    });

    test("pointer move rejects missing identities and delegates same-section ordering", () => {
        const siblings = [edit("query", 0), edit("tests", 1)];
        expect(pointerMovePresentationLayoutEdits([siblings], "other", "tests")).to.deep.equal([]);
        expect(pointerMovePresentationLayoutEdits([siblings], "query", "tests")).to.deep.equal([
            edit("tests", 0),
            edit("query", 1),
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

    test("three-way rebase detects concurrent derived transform edits", () => {
        const base = {
            ...edit("derived:slow-tests", 0),
            source: { kind: "derived", sourceId: "slow-tests" } as const,
            derivedSource: {
                id: "slow-tests",
                from: { kind: "activity-output", nodeId: "query", slot: "primary" } as const,
                authoredContract: "rowset/1",
                pipeline: { steps: [{ op: "limit", count: 10 } as const] },
            },
        };
        const local = {
            ...base,
            derivedSource: {
                ...base.derivedSource,
                pipeline: { steps: [{ op: "limit", count: 20 } as const] },
            },
        };
        const upstream = {
            ...base,
            derivedSource: {
                ...base.derivedSource,
                pipeline: { steps: [{ op: "limit", count: 50 } as const] },
            },
        };
        const result = rebasePresentationLayoutEdits([base], [upstream], [local]);
        expect(result.conflicts).to.deep.equal([
            { nodeId: "derived:slow-tests", fields: ["derivedSource"] },
        ]);
        expect(result.edits[0].derivedSource?.pipeline.steps).to.deep.equal([
            { op: "limit", count: 20 },
        ]);
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
                authoredContractFingerprint: "rowset/1",
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

    test("layout snapshot retains hidden non-activity source identity", () => {
        const snapshot = presentationLayoutSnapshot(undefined, {}, [
            {
                layoutId: "run-field-widget",
                widgetId: "run-field-widget",
                source: { kind: "run-field", field: "status" },
                defaultView: "scalar-cards",
                sectionId: "summary",
                placement: { order: 1 },
                hidden: true,
            },
        ]);
        expect(snapshot).to.deep.equal([
            {
                nodeId: "run-field-widget",
                widgetId: "run-field-widget",
                source: { kind: "run-field", field: "status" },
                defaultView: "scalar-cards",
                sectionId: "summary",
                placement: { order: 1 },
                hidden: true,
            },
        ]);
    });

    test("layout strategy normalizes older definitions and rebases non-overlapping changes", () => {
        const presentation = {
            layout: { sectionFlow: "dashboard" },
        } as ResolvedPresentation;
        expect(presentationLayoutStrategy(presentation)).to.equal("grid");
        expect(
            rebasePresentationLayoutPolicy("flow", "flow", { strategy: "stacked" }),
        ).to.deep.equal({ policy: { strategy: "stacked" }, conflict: false });
        expect(rebasePresentationLayoutPolicy("flow", "grid", undefined)).to.deep.equal({
            conflict: false,
        });
    });

    test("layout strategy rebase reports differently overlapping policy changes", () => {
        expect(
            rebasePresentationLayoutPolicy("flow", "grid", { strategy: "stacked" }),
        ).to.deep.equal({ policy: { strategy: "stacked" }, conflict: true });
        expect(
            rebasePresentationLayoutPolicy("flow", "stacked", { strategy: "stacked" }),
        ).to.deep.equal({ policy: { strategy: "stacked" }, conflict: false });
    });

    test("pointer resize maps only to bounded semantic span presets", () => {
        expect(presentationSpanPresetAt(-10)).to.equal("third");
        expect(presentationSpanPresetAt(1)).to.equal("half");
        expect(presentationSpanPresetAt(2)).to.equal("twoThirds");
        expect(presentationSpanPresetAt(99)).to.equal("full");
        expect(presentationSpanPresetAt(Number.NaN)).to.equal("full");
        expect(presentationSpanPresetOf({ wide: 4 })).to.equal("third");
        expect(presentationSpanPresetOf({ wide: 6 })).to.equal("half");
        expect(presentationSpanPresetOf({ wide: 8 })).to.equal("twoThirds");
        expect(presentationSpanPresetOf({ wide: 11 })).to.equal("full");
    });

    test("top-rows derived builder emits only bounded closed operations", () => {
        const source = { kind: "activity-output", nodeId: "query", slot: "primary" } as const;
        expect(
            buildTopRowsDerivedSource(" slow-tests ", source, "rowset/1", "durationMs", "desc", 25),
        ).to.deep.equal({
            id: "slow-tests",
            from: source,
            authoredContract: "rowset/1",
            pipeline: {
                steps: [
                    {
                        op: "sort",
                        by: [{ field: "durationMs", direction: "desc" }],
                    },
                    { op: "limit", count: 25 },
                ],
            },
        });
        expect(buildTopRowsDerivedSource("all", source, "rowset/1", "", "asc", 100)).to.deep.equal({
            id: "all",
            from: source,
            authoredContract: "rowset/1",
            pipeline: { steps: [{ op: "limit", count: 100 }] },
        });
        expect(buildTopRowsDerivedSource("", source, "rowset/1", "", "asc", 100)).to.equal(
            undefined,
        );
        expect(
            buildTopRowsDerivedSource("too-many", source, "rowset/1", "", "asc", 10_001),
        ).to.equal(undefined);
    });
});
