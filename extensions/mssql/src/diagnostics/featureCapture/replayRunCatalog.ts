/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable replay-run catalog (final plan WI-3.5): the READ side of the WI-3.3
 * run repository. Enumerates `sessions/<hostSessionId>/replay/<runId>/`
 * MANIFEST FILES ONLY (items.jsonl and configGroups.json are read lazily, per
 * run, by the detail call) — the manifest-only rule keeps listing cheap and
 * payload-free by construction.
 *
 * Ordering: the current host session's runs first, then other sessions,
 * newest `createdAt` first within each group. Unreadable manifests are
 * counted as issues, never thrown.
 */

import { logger2 } from "../../models/logger2";
import {
    REPLAY_RUN_CONFIG_GROUPS_FILE,
    REPLAY_RUN_ITEMS_FILE,
    REPLAY_RUN_MANIFEST_FILE,
    REPLAY_RUN_MANIFEST_SCHEMA,
    ReplayRunItemRecordV1,
    ReplayRunManifestV1,
} from "./replayRunRepository";
import { ConfigGroupV1 } from "../../sharedInterfaces/configGroup";
import { JournalFsLike, NodeJournalFs, joinPath } from "./journal/journalWriter";

export interface ReplayRunCatalogEntry {
    hostSessionId: string;
    manifest: ReplayRunManifestV1;
}

export interface ReplayRunCatalogListResult {
    entries: ReplayRunCatalogEntry[];
    /** Manifests that could not be read or failed schema validation. */
    issues: string[];
}

export interface ReplayRunCatalogOptions {
    storeRoot: string;
    currentHostSessionId: string;
    fs?: JournalFsLike;
}

/**
 * Enumerate every durable run manifest under the store. Manifest-only: no
 * items.jsonl or configGroups.json is opened here.
 */
export async function listReplayRunManifests(
    options: ReplayRunCatalogOptions,
): Promise<ReplayRunCatalogListResult> {
    const fs = options.fs ?? new NodeJournalFs();
    const result: ReplayRunCatalogListResult = { entries: [], issues: [] };
    let sessionNames: string[] = [];
    try {
        sessionNames = await fs.readdir(joinPath(options.storeRoot, "sessions"));
    } catch {
        return result; // store missing entirely: an honest empty catalog
    }
    for (const sessionName of sessionNames) {
        const replayDir = joinPath(options.storeRoot, `sessions/${sessionName}/replay`);
        let runDirNames: string[] = [];
        try {
            runDirNames = await fs.readdir(replayDir);
        } catch {
            continue; // no replay artifacts in this session
        }
        for (const runDirName of runDirNames) {
            const manifestPath = joinPath(replayDir, `${runDirName}/${REPLAY_RUN_MANIFEST_FILE}`);
            try {
                const raw = await fs.readFile(manifestPath);
                const manifest = JSON.parse(raw) as Partial<ReplayRunManifestV1>;
                if (manifest?.schema !== REPLAY_RUN_MANIFEST_SCHEMA) {
                    result.issues.push(`${sessionName}/${runDirName}: unknown manifest schema`);
                    continue;
                }
                result.entries.push({
                    hostSessionId: sessionName,
                    manifest: manifest as ReplayRunManifestV1,
                });
            } catch (error) {
                result.issues.push(
                    `${sessionName}/${runDirName}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }
    // Current host session first; newest-first within each group.
    const current = options.currentHostSessionId;
    result.entries.sort((left, right) => {
        const leftCurrent = left.hostSessionId === current ? 0 : 1;
        const rightCurrent = right.hostSessionId === current ? 0 : 1;
        if (leftCurrent !== rightCurrent) {
            return leftCurrent - rightCurrent;
        }
        return right.manifest.createdAt - left.manifest.createdAt;
    });
    return result;
}

export interface ReplayRunDetailReadResult {
    manifest?: ReplayRunManifestV1;
    items: ReplayRunItemRecordV1[];
    itemsTotal: number;
    configGroups?: ConfigGroupV1[];
}

/**
 * Read one run's durable detail: manifest + a page of items.jsonl records +
 * the frozen config groups. Tolerant end to end — a torn items line or a
 * missing configGroups.json degrades that slice, never the call.
 */
export async function readReplayRunDetail(options: {
    storeRoot: string;
    hostSessionId: string;
    replayRunId: string;
    itemsOffset?: number;
    itemsLimit?: number;
    fs?: JournalFsLike;
}): Promise<ReplayRunDetailReadResult> {
    const fs = options.fs ?? new NodeJournalFs();
    const logger = logger2.withPrefix("ReplayRunCatalog");
    const runDir = joinPath(
        options.storeRoot,
        `sessions/${options.hostSessionId}/replay/${options.replayRunId}`,
    );
    const result: ReplayRunDetailReadResult = { items: [], itemsTotal: 0 };
    try {
        const raw = await fs.readFile(joinPath(runDir, REPLAY_RUN_MANIFEST_FILE));
        const manifest = JSON.parse(raw) as Partial<ReplayRunManifestV1>;
        if (manifest?.schema === REPLAY_RUN_MANIFEST_SCHEMA) {
            result.manifest = manifest as ReplayRunManifestV1;
        }
    } catch {
        return result; // no manifest, no run
    }
    try {
        const rawItems = await fs.readFile(joinPath(runDir, REPLAY_RUN_ITEMS_FILE));
        const records: ReplayRunItemRecordV1[] = [];
        for (const line of rawItems.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                const record = JSON.parse(trimmed) as ReplayRunItemRecordV1;
                if (typeof record?.replayItemId === "string") {
                    records.push(record);
                }
            } catch {
                // torn tail line (crash mid-append): skip honestly
            }
        }
        result.itemsTotal = records.length;
        const offset = Math.max(0, options.itemsOffset ?? 0);
        const limit = Math.max(1, options.itemsLimit ?? records.length);
        result.items = records.slice(offset, offset + limit);
    } catch {
        // items.jsonl absent: a run that never settled an item
    }
    try {
        const rawGroups = await fs.readFile(joinPath(runDir, REPLAY_RUN_CONFIG_GROUPS_FILE));
        const parsed = JSON.parse(rawGroups) as unknown;
        if (Array.isArray(parsed)) {
            result.configGroups = parsed as ConfigGroupV1[];
        }
    } catch (error) {
        logger.info(
            `configGroups.json unavailable for ${options.replayRunId}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return result;
}
