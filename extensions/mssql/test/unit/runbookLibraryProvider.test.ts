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
    activeLibraryAssetId,
    collectLibraryGroups,
    deleteLibraryFolderAssets,
    groupLibraryItems,
    isArchivedLibraryAsset,
    knownLibraryCategories,
    LIBRARY_ARCHIVED_STATE,
    LIBRARY_FALLBACK_CATEGORY,
    libraryCategoryLabel,
    libraryFamilyFromCategory,
    libraryItemDescription,
    libraryRunDescription,
    parseLibraryDetailResponse,
    parseLibraryListResponse,
    remainingPendingFolders,
    RunbookLibraryAsset,
} from "../../src/runbookStudio/runbookLibraryModel";

function asset(partial: Partial<RunbookLibraryAsset> & { id: string }): RunbookLibraryAsset {
    return { title: partial.id, ...partial };
}

suite("runbookLibraryModel", () => {
    suite("deleteLibraryFolderAssets", () => {
        test("attempts every runbook and summarizes failures without aborting", async () => {
            const attempted: string[] = [];
            const summary = await deleteLibraryFolderAssets(
                [asset({ id: "a" }), asset({ id: "b" }), asset({ id: "c" })],
                async (id) => {
                    attempted.push(id);
                    if (id === "b") {
                        throw new Error("runtime unavailable");
                    }
                    return id !== "c";
                },
            );

            expect(attempted).to.deep.equal(["a", "b", "c"]);
            expect(summary).to.deep.equal({ deleted: 1, failed: 2 });
        });

        test("reports complete deletion", async () => {
            const summary = await deleteLibraryFolderAssets(
                [asset({ id: "a" }), asset({ id: "b" })],
                async () => true,
            );

            expect(summary).to.deep.equal({ deleted: 2, failed: 0 });
        });
    });

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

        test("projects missing activities from the namespaced editor artifact", () => {
            const parsed = parseLibraryListResponse([
                {
                    id: "rb-build",
                    clientExtensions: {
                        vscodeMssqlArtifact: {
                            source: {
                                requirements: {
                                    activities: [
                                        { kind: "sql.query.read", version: 1 },
                                        { kind: "catalog.missing.activity", version: 1 },
                                    ],
                                },
                            },
                        },
                    },
                },
            ]);

            expect(parsed[0].missingActivityKinds).to.deep.equal(["catalog.missing.activity@1"]);
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

    suite("collectLibraryGroups", () => {
        test("archived assets land in one dedicated group strictly last", () => {
            const groups = collectLibraryGroups([
                asset({ id: "a", category: "validate" }),
                asset({ id: "b", category: "investigate", state: "archived" }),
                asset({ id: "c" }),
                asset({ id: "d", category: "validate", state: "Archived" }),
            ]);
            expect(groups.map((g) => g.category)).to.deep.equal([
                "validate",
                LIBRARY_FALLBACK_CATEGORY,
                LIBRARY_ARCHIVED_STATE,
            ]);
            const archived = groups[2];
            expect(archived.archived).to.equal(true);
            expect(archived.items.map((i) => i.id)).to.deep.equal(["b", "d"]);
        });

        test("pending folders render as empty groups merged alphabetically", () => {
            const groups = collectLibraryGroups(
                [asset({ id: "a", category: "validate" }), asset({ id: "b" })],
                ["Alerts", "zeta"],
            );
            expect(groups.map((g) => g.category)).to.deep.equal([
                "Alerts",
                "validate",
                "zeta",
                LIBRARY_FALLBACK_CATEGORY,
            ]);
            expect(groups[0].pending).to.equal(true);
            expect(groups[0].items).to.deep.equal([]);
            expect(groups[2].pending).to.equal(true);
        });

        test("pending names drop once materialized or duplicated (case-insensitive)", () => {
            const groups = collectLibraryGroups(
                [asset({ id: "a", category: "validate" })],
                ["Validate", "alerts", "ALERTS", "  ", "alerts"],
            );
            expect(groups.map((g) => g.category)).to.deep.equal(["alerts", "validate"]);
            expect(groups.filter((g) => g.pending).map((g) => g.category)).to.deep.equal([
                "alerts",
            ]);
        });

        test("only archived assets still yields the archived group alone", () => {
            const groups = collectLibraryGroups([
                asset({ id: "a", state: "archived", category: "validate" }),
            ]);
            expect(groups).to.have.length(1);
            expect(groups[0].archived).to.equal(true);
        });

        test("empty input with no pending folders produces no groups", () => {
            expect(collectLibraryGroups([], [])).to.deep.equal([]);
        });
    });

    suite("remainingPendingFolders", () => {
        test("[artifact-folder-routing] keeps explicit folders after materialization", () => {
            const remaining = remainingPendingFolders(
                ["alerts", "reports"],
                [asset({ id: "a", category: "Alerts" })],
            );
            expect(remaining).to.deep.equal(["alerts", "reports"]);
        });

        test("archived assets do NOT materialize a pending folder", () => {
            const remaining = remainingPendingFolders(
                ["alerts"],
                [asset({ id: "a", category: "alerts", state: "archived" })],
            );
            expect(remaining).to.deep.equal(["alerts"]);
        });

        test("blank and duplicate names collapse (first spelling wins)", () => {
            expect(remainingPendingFolders(["  ", "Ops", "ops", "OPS"], [])).to.deep.equal(["Ops"]);
        });
    });

    suite("knownLibraryCategories", () => {
        test("merges asset categories and pending folders, sorted, deduped", () => {
            const categories = knownLibraryCategories(
                [
                    asset({ id: "a", category: "validate" }),
                    asset({ id: "b", category: "Alerts" }),
                    asset({ id: "c", category: "archivedCat", state: "archived" }),
                    asset({ id: "d" }),
                ],
                ["zeta", "VALIDATE"],
            );
            expect(categories).to.deep.equal(["Alerts", "validate", "zeta"]);
        });
    });

    suite("isArchivedLibraryAsset", () => {
        test("matches the archived state case-insensitively", () => {
            expect(isArchivedLibraryAsset(asset({ id: "a", state: "archived" }))).to.equal(true);
            expect(isArchivedLibraryAsset(asset({ id: "a", state: " Archived " }))).to.equal(true);
            expect(isArchivedLibraryAsset(asset({ id: "a", state: "approved" }))).to.equal(false);
            expect(isArchivedLibraryAsset(asset({ id: "a" }))).to.equal(false);
        });
    });

    suite("activeLibraryAssetId", () => {
        test("prefers the lock's library asset reference", () => {
            expect(
                activeLibraryAssetId({
                    id: "artifact-1",
                    lock: { libraryAssetRef: { assetId: "asset-9" } },
                }),
            ).to.equal("asset-9");
        });

        test("falls back to the artifact id when no reference exists", () => {
            expect(activeLibraryAssetId({ id: "artifact-1" })).to.equal("artifact-1");
            expect(activeLibraryAssetId({ id: "artifact-1", lock: {} })).to.equal("artifact-1");
            expect(
                activeLibraryAssetId({ id: "artifact-1", lock: { libraryAssetRef: {} } }),
            ).to.equal("artifact-1");
        });
    });

    suite("libraryFamilyFromCategory", () => {
        test("maps only the closed family values (case-insensitive)", () => {
            expect(libraryFamilyFromCategory("validate")).to.equal("validate");
            expect(libraryFamilyFromCategory(" Investigate ")).to.equal("investigate");
            expect(libraryFamilyFromCategory("BUILD")).to.equal("build");
            expect(libraryFamilyFromCategory("Composed")).to.equal("composed");
            expect(libraryFamilyFromCategory("alerts")).to.equal(undefined);
            expect(libraryFamilyFromCategory(undefined)).to.equal(undefined);
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

        test("appends the caller-localized running badge last", () => {
            expect(
                libraryItemDescription(
                    asset({ id: "x", state: "approved", versionLabel: "1.02" }),
                    "running",
                ),
            ).to.equal("approved · 1.02 · running");
            expect(libraryItemDescription(asset({ id: "x" }), "running")).to.equal("running");
        });

        test("includes the caller-localized design-only badge", () => {
            expect(
                libraryItemDescription(
                    asset({ id: "x", state: "draft", missingActivityKinds: ["dacpac.build@1"] }),
                    undefined,
                    "design-only",
                ),
            ).to.equal("draft · design-only");
        });
    });

    suite("libraryCategoryLabel", () => {
        test("capitalizes the first letter only", () => {
            expect(libraryCategoryLabel("investigate")).to.equal("Investigate");
            expect(libraryCategoryLabel("")).to.equal("");
        });
    });

    suite("parseLibraryDetailResponse", () => {
        test("maps recentRuns and ignores unknown run fields", () => {
            const runs = parseLibraryDetailResponse({
                item: { id: "rb-1", name: "Blocked sessions" },
                recentRuns: [
                    {
                        runId: "run-a",
                        status: "succeeded",
                        startedAt: "2026-07-18T14:31:00Z",
                        completedAt: "2026-07-18T14:32:00Z",
                        connectionAlias: "prod",
                    },
                    { runId: "run-b", status: "failed" },
                ],
                publishedDescription: "ignored",
            });
            expect(runs).to.deep.equal([
                { runId: "run-a", status: "succeeded", startedAt: "2026-07-18T14:31:00Z" },
                { runId: "run-b", status: "failed" },
            ]);
        });

        test("keeps runs with only a runId (missing optionals omitted)", () => {
            const runs = parseLibraryDetailResponse({ recentRuns: [{ runId: "run-c" }] });
            expect(runs).to.deep.equal([{ runId: "run-c" }]);
        });

        test("drops malformed entries and coerces bad field types away", () => {
            const runs = parseLibraryDetailResponse({
                recentRuns: [
                    undefined,
                    42,
                    "run-x",
                    { status: "no run id" },
                    { runId: "" },
                    { runId: "run-d", startedAt: 12345, status: false },
                ],
            });
            expect(runs).to.deep.equal([{ runId: "run-d" }]);
        });

        test("non-conforming bodies parse to an empty history", () => {
            expect(parseLibraryDetailResponse(undefined)).to.deep.equal([]);
            expect(parseLibraryDetailResponse("nope")).to.deep.equal([]);
            expect(parseLibraryDetailResponse([])).to.deep.equal([]);
            expect(parseLibraryDetailResponse({ recentRuns: "nope" })).to.deep.equal([]);
            expect(parseLibraryDetailResponse({ recentRuns: [] })).to.deep.equal([]);
        });
    });

    suite("libraryRunDescription", () => {
        // The date part is locale-dependent by design (toLocaleString);
        // expectations are computed with the same options.
        const localeDate = (iso: string) =>
            new Date(iso).toLocaleString(undefined, {
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });

        test("joins status and start time with a separator", () => {
            const startedAt = "2026-07-18T14:31:00Z";
            expect(libraryRunDescription({ runId: "r", status: "succeeded", startedAt })).to.equal(
                `succeeded · ${localeDate(startedAt)}`,
            );
        });

        test("renders whichever part exists", () => {
            const startedAt = "2026-07-18T14:31:00Z";
            expect(libraryRunDescription({ runId: "r", status: "failed" })).to.equal("failed");
            expect(libraryRunDescription({ runId: "r", startedAt })).to.equal(
                localeDate(startedAt),
            );
            expect(libraryRunDescription({ runId: "r" })).to.equal("");
        });

        test("an unparseable timestamp renders status only (never Invalid Date)", () => {
            expect(
                libraryRunDescription({ runId: "r", status: "canceled", startedAt: "not-a-date" }),
            ).to.equal("canceled");
        });
    });
});
