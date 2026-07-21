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

import { findActivity } from "./activities/activityCatalog";

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
    /** Catalog requirements absent from this extension, projected from the
     *  namespaced VS Code artifact when the runtime list includes it. */
    missingActivityKinds?: string[];
}

function missingActivitiesFromClientExtension(record: Record<string, unknown>): string[] {
    const clientExtensions = record.clientExtensions;
    if (
        !clientExtensions ||
        typeof clientExtensions !== "object" ||
        Array.isArray(clientExtensions)
    ) {
        return [];
    }
    const artifact = (clientExtensions as Record<string, unknown>).vscodeMssqlArtifact;
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        return [];
    }
    const source = (artifact as Record<string, unknown>).source;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return [];
    }
    const requirements = (source as Record<string, unknown>).requirements;
    if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
        return [];
    }
    const activities = (requirements as Record<string, unknown>).activities;
    if (!Array.isArray(activities)) {
        return [];
    }
    const missing = activities
        .filter(
            (activity): activity is Record<string, unknown> =>
                typeof activity === "object" && activity !== null && !Array.isArray(activity),
        )
        .map((activity) => ({ kind: activity.kind, version: activity.version }))
        .filter(
            (activity): activity is { kind: string; version: number } =>
                typeof activity.kind === "string" &&
                activity.kind.length > 0 &&
                typeof activity.version === "number" &&
                activity.version > 0,
        )
        .filter((activity) => {
            const installed = findActivity(activity.kind);
            return installed === undefined || installed.version < activity.version;
        })
        .map((activity) => `${activity.kind}@${activity.version}`);
    return [...new Set(missing)];
}

/** One recent run surfaced under a library runbook, as projected from the
 *  detail endpoint `GET /api/library/content/runbook/{id}` (`recentRuns`). */
export interface LibraryRunRef {
    runId: string;
    startedAt?: string;
    status?: string;
}

/** Grouping fallback for assets without a category. */
export const LIBRARY_FALLBACK_CATEGORY = "other";

/** The lifecycle state the runtime stamps on archived assets. */
export const LIBRARY_ARCHIVED_STATE = "archived";

export interface RunbookLibraryGroup {
    category: string;
    items: RunbookLibraryAsset[];
    /** The dedicated archived bucket — always rendered last. */
    archived?: boolean;
    /** A pending (still empty) folder from the New Folder command. */
    pending?: boolean;
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
        const missingActivityKinds = missingActivitiesFromClientExtension(record);
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
            ...(missingActivityKinds.length > 0 ? { missingActivityKinds } : {}),
        });
    }
    return assets;
}

/**
 * Parse the runtime's library detail response (`LibraryContentDetail`,
 * camelCase over the wire: `{ item, recentRuns: [{ runId, status,
 * startedAt, completedAt, connectionAlias }], ... }`). Only the fields the
 * tree renders are kept; unknown fields are ignored, entries without a
 * stable runId are dropped, and any non-conforming body parses to an
 * empty history (never a throw — a missing detail is honestly "no runs").
 */
export function parseLibraryDetailResponse(body: unknown): LibraryRunRef[] {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return [];
    }
    const wrapped = (body as { recentRuns?: unknown }).recentRuns;
    if (!Array.isArray(wrapped)) {
        return [];
    }
    const runs: LibraryRunRef[] = [];
    for (const entry of wrapped) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const runId =
            typeof record.runId === "string" && record.runId.length > 0 ? record.runId : undefined;
        if (!runId) {
            continue;
        }
        runs.push({
            runId,
            ...(typeof record.startedAt === "string" && record.startedAt.length > 0
                ? { startedAt: record.startedAt }
                : {}),
            ...(typeof record.status === "string" && record.status.length > 0
                ? { status: record.status }
                : {}),
        });
    }
    return runs;
}

/**
 * Run tree-item description, e.g. "succeeded · 7/18 2:31 PM": the status
 * verbatim plus the locale-rendered start time (either part optional; an
 * unparseable timestamp renders status only — never "Invalid Date").
 */
export function libraryRunDescription(run: LibraryRunRef): string {
    const parts: string[] = [];
    if (typeof run.status === "string" && run.status.length > 0) {
        parts.push(run.status);
    }
    if (typeof run.startedAt === "string" && run.startedAt.length > 0) {
        const startedAt = new Date(run.startedAt);
        if (!Number.isNaN(startedAt.getTime())) {
            parts.push(
                startedAt.toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                }),
            );
        }
    }
    return parts.join(" · ");
}

/** True when the asset's lifecycle state marks it archived. */
export function isArchivedLibraryAsset(asset: RunbookLibraryAsset): boolean {
    return (asset.state ?? "").trim().toLowerCase() === LIBRARY_ARCHIVED_STATE;
}

function sortAssetsByTitle(items: RunbookLibraryAsset[]): RunbookLibraryAsset[] {
    return items.sort((a, b) => {
        const left = a.title.toLowerCase();
        const right = b.title.toLowerCase();
        if (left !== right) {
            return left < right ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
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
        sortAssetsByTitle(items);
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

/**
 * The full file-explorer projection: non-archived assets grouped by
 * category, explicitly created empty folders merged alphabetically among the
 * named groups, the "other" fallback bucket after the named groups, and a
 * single archived bucket (all archived assets regardless of category)
 * strictly last. Explicit names that duplicate a real category render through
 * that category group and remain in the durable folder-name set.
 */
export function collectLibraryGroups(
    assets: RunbookLibraryAsset[],
    pendingFolders: string[] = [],
): RunbookLibraryGroup[] {
    const activeAssets: RunbookLibraryAsset[] = [];
    const archivedAssets: RunbookLibraryAsset[] = [];
    for (const asset of assets) {
        (isArchivedLibraryAsset(asset) ? archivedAssets : activeAssets).push(asset);
    }
    const grouped = groupLibraryItems(activeAssets);
    const known = new Set(grouped.map((group) => group.category.toLowerCase()));
    const pendingGroups: RunbookLibraryGroup[] = [];
    for (const name of remainingPendingFolders(pendingFolders, activeAssets)) {
        if (known.has(name.toLowerCase())) {
            continue;
        }
        pendingGroups.push({ category: name, items: [], pending: true });
    }
    const named = [
        ...grouped.filter((group) => group.category !== LIBRARY_FALLBACK_CATEGORY),
        ...pendingGroups,
    ];
    named.sort((a, b) => {
        const left = a.category.toLowerCase();
        const right = b.category.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    });
    const groups = [
        ...named,
        ...grouped.filter((group) => group.category === LIBRARY_FALLBACK_CATEGORY),
    ];
    if (archivedAssets.length > 0) {
        groups.push({
            category: LIBRARY_ARCHIVED_STATE,
            items: sortAssetsByTitle(archivedAssets),
            archived: true,
        });
    }
    return groups;
}

/**
 * Normalize explicitly created folders. The assets argument remains for the
 * persisted-state migration call shape, but a folder no longer loses its
 * identity merely because it currently contains a runbook.
 */
export function remainingPendingFolders(
    pendingFolders: string[],
    _assets: RunbookLibraryAsset[],
): string[] {
    const seen = new Set<string>();
    const remaining: string[] = [];
    for (const raw of pendingFolders) {
        const name = raw.trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) {
            continue;
        }
        seen.add(key);
        remaining.push(name);
    }
    return remaining;
}

/**
 * Every folder name a runbook can move to: categories of non-archived
 * assets plus pending folders, deduplicated case-insensitively (first
 * spelling wins — asset-derived spellings first) and sorted alphabetically.
 */
export function knownLibraryCategories(
    assets: RunbookLibraryAsset[],
    pendingFolders: string[] = [],
): string[] {
    const byKey = new Map<string, string>();
    for (const asset of assets) {
        if (isArchivedLibraryAsset(asset)) {
            continue;
        }
        const name = asset.category?.trim();
        if (name && !byKey.has(name.toLowerCase())) {
            byKey.set(name.toLowerCase(), name);
        }
    }
    for (const raw of pendingFolders) {
        const name = raw.trim();
        if (name && !byKey.has(name.toLowerCase())) {
            byKey.set(name.toLowerCase(), name);
        }
    }
    return [...byKey.values()].sort((a, b) => {
        const left = a.toLowerCase();
        const right = b.toLowerCase();
        return left < right ? -1 : left > right ? 1 : 0;
    });
}

/**
 * The library asset id a run counts against for the running badge: the
 * lock's library asset reference when the plan launched a library asset,
 * else the artifact's own id (publish path reuses it as the asset id).
 */
export function activeLibraryAssetId(artifact: {
    id: string;
    lock?: { libraryAssetRef?: { assetId?: string } };
}): string {
    const refId = artifact.lock?.libraryAssetRef?.assetId;
    return typeof refId === "string" && refId.length > 0 ? refId : artifact.id;
}

/** Runtime library category -> the artifact's CLOSED family enum, only
 *  when the category names one of its values (case-insensitive); anything
 *  else is undefined — the family is never guessed. */
export function libraryFamilyFromCategory(
    category: string | undefined,
): "build" | "validate" | "investigate" | "composed" | undefined {
    const normalized = category?.trim().toLowerCase();
    return normalized === "build" ||
        normalized === "validate" ||
        normalized === "investigate" ||
        normalized === "composed"
        ? normalized
        : undefined;
}

/** Tree item description, e.g. "approved · 1.02 · running" (every part
 *  optional; the running badge label is caller-localized — this module
 *  stays vscode-free). */
export function libraryItemDescription(
    asset: RunbookLibraryAsset,
    runningLabel?: string,
    designOnlyLabel?: string,
): string {
    return [
        asset.state,
        asset.versionLabel,
        asset.missingActivityKinds?.length ? designOnlyLabel : undefined,
        runningLabel,
    ]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ");
}

/** Group label: category with the first letter capitalized (data-derived). */
export function libraryCategoryLabel(category: string): string {
    return category.length > 0 ? category[0].toUpperCase() + category.slice(1) : category;
}
