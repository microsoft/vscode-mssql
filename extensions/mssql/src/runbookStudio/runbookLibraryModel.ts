/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Library pure model (R3, D-0012): boundary-tolerant parsing of the
 * Hobbes runtime's library listing plus the deterministic grouping/sorting
 * the tree view renders. Deliberately vscode-free so the logic is unit
 * testable and shareable with the runtime adapter (which must never import
 * vscode). Unknown fields from the runtime are ignored; entries without a
 * stable id are dropped rather than rendered half-formed.
 */

/** Library asset summary as projected from `GET /api/runbooks`. */
export interface RunbookLibraryAsset {
    id: string;
    title: string;
    description?: string;
    category?: string;
    state?: string;
    versionLabel?: string;
    tags?: string[];
    updatedAt?: string;
}

/** Grouping fallback for assets without a category. */
export const LIBRARY_FALLBACK_CATEGORY = "other";

export interface RunbookLibraryGroup {
    category: string;
    items: RunbookLibraryAsset[];
}

/**
 * Parse the runtime's library listing response. The surface has been
 * observed in two shapes (a bare array and `{ runbooks: [...] }`); both are
 * accepted. Extra fields are ignored, malformed entries are skipped, and a
 * missing title falls back to the id (never an empty tree row).
 */
export function parseLibraryListResponse(body: unknown): RunbookLibraryAsset[] {
    let raw: unknown[] = [];
    if (Array.isArray(body)) {
        raw = body;
    } else if (body && typeof body === "object") {
        const wrapped = (body as { runbooks?: unknown }).runbooks;
        if (Array.isArray(wrapped)) {
            raw = wrapped;
        }
    }
    const assets: RunbookLibraryAsset[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" && record.id.length > 0 ? record.id : undefined;
        if (!id) {
            continue;
        }
        assets.push({
            id,
            title: typeof record.title === "string" && record.title.length > 0 ? record.title : id,
            ...(typeof record.description === "string" && record.description.length > 0
                ? { description: record.description }
                : {}),
            ...(typeof record.category === "string" && record.category.length > 0
                ? { category: record.category }
                : {}),
            ...(typeof record.state === "string" && record.state.length > 0
                ? { state: record.state }
                : {}),
            ...(typeof record.versionLabel === "string" && record.versionLabel.length > 0
                ? { versionLabel: record.versionLabel }
                : {}),
            ...(Array.isArray(record.tags)
                ? { tags: record.tags.filter((tag): tag is string => typeof tag === "string") }
                : {}),
            ...(typeof record.updatedAt === "string" && record.updatedAt.length > 0
                ? { updatedAt: record.updatedAt }
                : {}),
        });
    }
    return assets;
}

/**
 * Deterministic grouping for the tree: group by category (fallback
 * "other"), categories alphabetical with the fallback bucket last, items
 * by title (case-insensitive) then id for a stable tiebreak.
 */
export function groupLibraryItems(assets: RunbookLibraryAsset[]): RunbookLibraryGroup[] {
    const byCategory = new Map<string, RunbookLibraryAsset[]>();
    for (const asset of assets) {
        const category = asset.category?.trim() || LIBRARY_FALLBACK_CATEGORY;
        const bucket = byCategory.get(category);
        if (bucket) {
            bucket.push(asset);
        } else {
            byCategory.set(category, [asset]);
        }
    }
    const groups: RunbookLibraryGroup[] = [];
    for (const [category, items] of byCategory) {
        items.sort((a, b) => {
            const left = a.title.toLowerCase();
            const right = b.title.toLowerCase();
            if (left !== right) {
                return left < right ? -1 : 1;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        groups.push({ category, items });
    }
    groups.sort((a, b) => {
        if (a.category === b.category) {
            return 0;
        }
        // The fallback bucket always sorts last.
        if (a.category === LIBRARY_FALLBACK_CATEGORY) {
            return 1;
        }
        if (b.category === LIBRARY_FALLBACK_CATEGORY) {
            return -1;
        }
        const left = a.category.toLowerCase();
        const right = b.category.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return groups;
}

/** Tree item description, e.g. "approved · 1.02" (either part optional). */
export function libraryItemDescription(asset: RunbookLibraryAsset): string {
    return [asset.state, asset.versionLabel]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ");
}

/** Group label: category with the first letter capitalized (data-derived). */
export function libraryCategoryLabel(category: string): string {
    return category.length > 0 ? category[0].toUpperCase() + category.slice(1) : category;
}
