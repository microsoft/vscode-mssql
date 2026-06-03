/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — RunStore (D3-Part-2 / TBD-3 resolution).
 *
 * Cache + CRUD facade over `.mssql/runs/*.cdrun.zip`. Wraps `RunArtifactReader`
 * with an in-memory listing cache and exposes the four verbs the dashboard
 * tree provider and the hub webview need:
 *
 *   * `list(envId?)`  — listing summaries, sorted desc by startedAtMs
 *   * `latest(envId)` — the most recent full RunRecord for an env
 *   * `get(runId)`    — the full RunRecord for a given run (fresh disk read)
 *   * `scan()`        — re-enumerate the runs directory and rebuild the cache
 *
 * The store does not own the schema, the validator, or the I/O substrate —
 * those stay with `runs/types.ts`, `runs/runArtifactSchema.ts`, and the
 * `RunArtifactReader` respectively. The store is purely a cached projection.
 *
 * Failure handling:
 *   * Missing runs directory → empty result, no throw (first-run scenario).
 *   * Corrupt / forward-version artifacts → skipped silently, never poison
 *     the rest of the cache. (The reader already reports these via the
 *     diagnostic bus when wired through the writer; the store stays quiet
 *     so a single bad file doesn't gate the listing UI.)
 *   * Concurrent `scan()` calls are deduplicated — first caller wins, the
 *     others await the same in-flight promise.
 *
 * The store does **not** subscribe to the writer or the bus directly —
 * cache invalidation is driven externally by a `vscode.FileSystemWatcher`
 * owned by `CloudDeployService`. Keeping the watcher out of the store lets
 * the store be unit-tested without spinning up a vscode environment.
 */

import * as fs from "fs/promises";
import * as path from "path";

import * as vscode from "vscode";

import { RunArtifactReader } from "./runArtifactReader";
import { RunListEntry, RunRecord } from "./types";

// Re-exported so existing callers that imported `RunListEntry` from this
// module keep working. The canonical home is `runs/types.ts` (pure types,
// safe to include in the webview build).
export type { RunListEntry } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Directory enumerator abstraction. `LocalRunsDirectoryReader` is the
 * production impl; tests substitute a fake that returns a hard-coded list.
 *
 * Returns absolute paths of every `*.cdrun.zip` file in the runs directory.
 * Returns an empty list (not a throw) when the directory does not exist —
 * a first-run workspace simply has nothing to list.
 */
export interface RunsDirectoryReader {
    list(): Promise<readonly string[]>;
}

/** Production `RunsDirectoryReader` backed by `node:fs/promises.readdir`. */
export class LocalRunsDirectoryReader implements RunsDirectoryReader {
    public constructor(private readonly _runsDir: string) {}

    public async list(): Promise<readonly string[]> {
        let entries: string[];
        try {
            entries = await fs.readdir(this._runsDir);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return [];
            }
            throw err;
        }
        return entries
            .filter((name) => name.endsWith(".cdrun.zip"))
            .map((name) => path.join(this._runsDir, name));
    }
}

// =============================================================================
// RunStore
// =============================================================================

export class RunStore implements vscode.Disposable {
    private _cache: ReadonlyMap<string, RunListEntry> = new Map();
    private _scanInFlight: Promise<void> | undefined;
    private readonly _onDidChange = new vscode.EventEmitter<void>();

    /** Fires after every successful `scan()` (whether or not the cache changed). */
    public readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

    public constructor(
        private readonly _dirReader: RunsDirectoryReader,
        private readonly _artifactReader: RunArtifactReader,
    ) {}

    /**
     * Re-enumerates the runs directory and rebuilds the cache. Concurrent
     * calls are deduplicated — the second caller awaits the first's
     * in-flight scan rather than starting a new one.
     */
    public async scan(): Promise<void> {
        if (this._scanInFlight !== undefined) {
            return this._scanInFlight;
        }
        this._scanInFlight = this._scanInternal().finally(() => {
            this._scanInFlight = undefined;
        });
        return this._scanInFlight;
    }

    private async _scanInternal(): Promise<void> {
        const artifactPaths = await this._dirReader.list();
        const next = new Map<string, RunListEntry>();
        for (const artifactPath of artifactPaths) {
            try {
                const record = await this._artifactReader.read(artifactPath);
                next.set(record.runId, summarize(record, artifactPath));
            } catch {
                // Corrupt / forward-version / missing-entry — skip silently.
                // The reader's own subscribers (bus / output channel) surface
                // these; the store's job is to keep the listing flowing.
                continue;
            }
        }
        this._cache = next;
        this._onDidChange.fire();
    }

    /**
     * Returns cached run summaries, optionally filtered by env id, sorted
     * descending by `startedAtMs` (newest first). Cheap — no disk I/O.
     */
    public list(envId?: string): readonly RunListEntry[] {
        const all = Array.from(this._cache.values());
        const filtered = envId === undefined ? all : all.filter((e) => e.envId === envId);
        return filtered.slice().sort((a, b) => b.startedAtMs - a.startedAtMs);
    }

    /**
     * Returns the most recent full `RunRecord` for an env, or `undefined`
     * when the env has no runs cached. Reads the artifact fresh — cache
     * holds only summaries.
     */
    public async latest(envId: string): Promise<RunRecord | undefined> {
        const summary = this.list(envId)[0];
        if (summary === undefined) {
            return undefined;
        }
        return this.get(summary.runId);
    }

    /**
     * Returns the full `RunRecord` for a given run id, or `undefined` if
     * the id is not cached or the artifact is no longer readable. Always
     * reads the artifact fresh — never serves a stale full record.
     */
    public async get(runId: string): Promise<RunRecord | undefined> {
        const entry = this._cache.get(runId);
        if (entry === undefined) {
            return undefined;
        }
        try {
            return await this._artifactReader.read(entry.artifactPath);
        } catch {
            return undefined;
        }
    }

    /**
     * Deletes the on-disk artifact for `runId` and removes the entry from
     * the cache. Fires `onDidChange`. Best-effort: ENOENT is treated as
     * already-deleted; any other failure is rethrown so the caller can
     * surface it to the user.
     */
    public async delete(runId: string): Promise<void> {
        const entry = this._cache.get(runId);
        if (entry === undefined) {
            return;
        }
        try {
            await fs.unlink(entry.artifactPath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
                throw err;
            }
        }
        const next = new Map(this._cache);
        next.delete(runId);
        this._cache = next;
        this._onDidChange.fire();
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }
}

// =============================================================================
// Helpers
// =============================================================================

function summarize(record: RunRecord, artifactPath: string): RunListEntry {
    return {
        runId: record.runId,
        envId: record.environmentId,
        envDisplayName: record.environmentSnapshot.name,
        status: record.status,
        startedAtMs: record.startedAtMs,
        endedAtMs: record.endedAtMs,
        artifactPath,
    };
}
