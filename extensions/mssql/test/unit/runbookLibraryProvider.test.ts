/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Library pure model (R3): listing-response parsing tolerance,
 * deterministic grouping/sorting, and the item description projection.
 * Everything under test is vscode-free (runbookLibraryModel).
 */

import { expect } from "chai";
import {
    groupLibraryItems,
    LIBRARY_FALLBACK_CATEGORY,
    libraryCategoryLabel,
    libraryItemDescription,
    parseLibraryListResponse,
    RunbookLibraryAsset,
} from "../../src/runbookStudio/runbookLibraryModel";

function asset(partial: Partial<RunbookLibraryAsset> & { id: string }): RunbookLibraryAsset {
    return { title: partial.id, ...partial };
}

suite("runbookLibraryModel", () => {
    suite("parseLibraryListResponse", () => {
        test("accepts a bare array and ignores unknown fields", () => {
            const parsed = parseLibraryListResponse([
                {
                    id: "rb-1",
                    title: "Blocked sessions",
                    category: "investigate",
                    state: "approved",
                    versionLabel: "1.02",
                    tags: ["sql", 42],
                    updatedAt: "2026-07-18T00:00:00Z",
                    extraField: { nested: true },
                },
            ]);
            expect(parsed).to.have.length(1);
            expect(parsed[0]).to.deep.equal({
                id: "rb-1",
                title: "Blocked sessions",
                category: "investigate",
                state: "approved",
                versionLabel: "1.02",
                tags: ["sql"],
                updatedAt: "2026-07-18T00:00:00Z",
            });
        });

        test("accepts the wrapped {runbooks: []} shape", () => {
            const parsed = parseLibraryListResponse({
                runbooks: [{ id: "rb-2", title: "Regressions" }],
            });
            expect(parsed).to.have.length(1);
            expect(parsed[0].id).to.equal("rb-2");
        });

        test("drops malformed entries and falls back title to id", () => {
            const parsed = parseLibraryListResponse([
                undefined,
                42,
                { title: "no id" },
                { id: "" },
                { id: "rb-3" },
            ]);
            expect(parsed).to.have.length(1);
            expect(parsed[0]).to.deep.equal({ id: "rb-3", title: "rb-3" });
        });

        test("non-list bodies parse to an empty list", () => {
            expect(parseLibraryListResponse(undefined)).to.deep.equal([]);
            expect(parseLibraryListResponse("nope")).to.deep.equal([]);
            expect(parseLibraryListResponse({ runbooks: "nope" })).to.deep.equal([]);
        });
    });

    suite("groupLibraryItems", () => {
        test("groups by category with the fallback bucket last", () => {
            const groups = groupLibraryItems([
                asset({ id: "a", category: "validate" }),
                asset({ id: "b" }),
                asset({ id: "c", category: "investigate" }),
                asset({ id: "d", category: "  " }),
            ]);
            expect(groups.map((g) => g.category)).to.deep.equal([
                "investigate",
                "validate",
                LIBRARY_FALLBACK_CATEGORY,
            ]);
            expect(groups[2].items.map((i) => i.id)).to.deep.equal(["b", "d"]);
        });

        test("sorts items by title case-insensitively with id tiebreak", () => {
            const groups = groupLibraryItems([
                asset({ id: "z", title: "beta", category: "validate" }),
                asset({ id: "a", title: "Alpha", category: "validate" }),
                asset({ id: "m2", title: "Same", category: "validate" }),
                asset({ id: "m1", title: "Same", category: "validate" }),
            ]);
            expect(groups).to.have.length(1);
            expect(groups[0].items.map((i) => i.id)).to.deep.equal(["a", "z", "m1", "m2"]);
        });

        test("empty input produces no groups (caller renders the empty node)", () => {
            expect(groupLibraryItems([])).to.deep.equal([]);
        });
    });

    suite("libraryItemDescription", () => {
        test("joins state and version with a separator", () => {
            expect(
                libraryItemDescription(asset({ id: "x", state: "approved", versionLabel: "1.02" })),
            ).to.equal("approved · 1.02");
        });

        test("renders whichever part exists", () => {
            expect(libraryItemDescription(asset({ id: "x", state: "draft" }))).to.equal("draft");
            expect(libraryItemDescription(asset({ id: "x", versionLabel: "1.00" }))).to.equal(
                "1.00",
            );
            expect(libraryItemDescription(asset({ id: "x" }))).to.equal("");
        });
    });

    suite("libraryCategoryLabel", () => {
        test("capitalizes the first letter only", () => {
            expect(libraryCategoryLabel("investigate")).to.equal("Investigate");
            expect(libraryCategoryLabel("")).to.equal("");
        });
    });
});
