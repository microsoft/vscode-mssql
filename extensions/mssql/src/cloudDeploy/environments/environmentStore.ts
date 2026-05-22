/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — environment store.
 *
 * In-memory cache + CRUD over the on-disk environments file. One instance per
 * workspace folder. Loads once via `init()`, persists each mutation
 * write-through, and emits a typed change event on every modification.
 *
 * Also owns the per-user default-environment selection, stored in workspace
 * `Memento` state so it doesn't pollute the shared `.mssql/environments.json`.
 */

import * as vscode from "vscode";

import { ENVIRONMENTS_FILE_SCHEMA_VERSION, Environment, EnvironmentsFile } from "./types";
import { loadEnvironmentsFile, saveEnvironmentsFile } from "./environmentFile";
import { validateEnvironmentsFile } from "./environmentSchema";

// =============================================================================
// Public types
// =============================================================================

export interface EnvironmentsChangeEvent {
    readonly added: readonly Environment[];
    readonly updated: readonly Environment[];
    readonly removed: readonly string[];
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ENV_STATE_KEY = "cloudDeploy.defaultEnvironmentId";

// =============================================================================
// EnvironmentStore
// =============================================================================

export class EnvironmentStore implements vscode.Disposable {
    private _envs: Environment[] = [];
    private _initialized = false;

    /** Serializes write-through persistence so concurrent mutations don't clobber each other. */
    private _writeChain: Promise<void> = Promise.resolve();

    private readonly _onDidChangeEnvironmentsEmitter =
        new vscode.EventEmitter<EnvironmentsChangeEvent>();
    public readonly onDidChangeEnvironments: vscode.Event<EnvironmentsChangeEvent> =
        this._onDidChangeEnvironmentsEmitter.event;

    private readonly _onDidChangeDefaultEnvironmentEmitter = new vscode.EventEmitter<
        string | undefined
    >();
    public readonly onDidChangeDefaultEnvironment: vscode.Event<string | undefined> =
        this._onDidChangeDefaultEnvironmentEmitter.event;

    public constructor(
        private readonly workspaceFolder: vscode.WorkspaceFolder,
        private readonly workspaceState: vscode.Memento,
    ) {}

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Loads `.mssql/environments.json` from disk. Must be called (and awaited)
     * exactly once before any other method. Surfaces parse errors to the caller
     * so extension activation can react to a malformed file.
     */
    public async init(): Promise<void> {
        if (this._initialized) {
            return;
        }
        const file = await loadEnvironmentsFile(this.workspaceFolder);
        this._envs = [...file.environments];
        this._initialized = true;
    }

    public dispose(): void {
        this._onDidChangeEnvironmentsEmitter.dispose();
        this._onDidChangeDefaultEnvironmentEmitter.dispose();
    }

    // -------------------------------------------------------------------------
    // Reads
    // -------------------------------------------------------------------------

    public list(): readonly Environment[] {
        this.assertInitialized();
        return [...this._envs];
    }

    public get(id: string): Environment | undefined {
        this.assertInitialized();
        return this._envs.find((e) => e.id === id);
    }

    // -------------------------------------------------------------------------
    // Mutations (write-through)
    // -------------------------------------------------------------------------

    /**
     * Inserts or replaces an env by id. Validates the entire post-mutation file
     * shape before writing to disk — defense in depth against in-process bugs
     * passing malformed envs.
     */
    public async upsert(env: Environment): Promise<void> {
        this.assertInitialized();
        await this.runWrite(async () => {
            const before = this._envs;
            const existingIdx = before.findIndex((e) => e.id === env.id);
            const next =
                existingIdx === -1
                    ? [...before, env]
                    : before.map((e, i) => (i === existingIdx ? env : e));

            await this.persist(next);
            if (existingIdx === -1) {
                this.fireChange({ added: [env], updated: [], removed: [] });
            } else {
                this.fireChange({ added: [], updated: [env], removed: [] });
            }
        });
    }

    /** Removes an env by id. No-op if not present. */
    public async delete(id: string): Promise<void> {
        this.assertInitialized();
        await this.runWrite(async () => {
            const before = this._envs;
            if (!before.some((e) => e.id === id)) {
                return;
            }
            const wasDefault = this.getDefaultEnvironmentId() === id;
            const next = before.filter((e) => e.id !== id);
            await this.persist(next);
            this.fireChange({ added: [], updated: [], removed: [id] });
            // If the deleted env was the default, clear the default.
            if (wasDefault) {
                await this.setDefaultEnvironmentId(undefined);
            }
        });
    }

    /**
     * Re-reads the file from disk, replacing the in-memory cache. Fires a
     * change event with the diff against the previous cache.
     */
    public async reload(): Promise<void> {
        this.assertInitialized();
        await this.runWrite(async () => {
            const file = await loadEnvironmentsFile(this.workspaceFolder);
            const before = this._envs;
            const after = file.environments;
            this._envs = [...after];

            const diff = diffEnvironments(before, after);
            if (diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0) {
                this.fireChange(diff);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Default environment (per-user, workspace state)
    // -------------------------------------------------------------------------

    /**
     * Returns the user's preferred default env id, or undefined if none is set
     * or the previously-set id no longer exists.
     */
    public getDefaultEnvironmentId(): string | undefined {
        const id = this.workspaceState.get<string | undefined>(DEFAULT_ENV_STATE_KEY);
        if (id === undefined) {
            return undefined;
        }
        return this._envs.some((e) => e.id === id) ? id : undefined;
    }

    public async setDefaultEnvironmentId(id: string | undefined): Promise<void> {
        const current = this.workspaceState.get<string | undefined>(DEFAULT_ENV_STATE_KEY);
        if (current === id) {
            return;
        }
        await this.workspaceState.update(DEFAULT_ENV_STATE_KEY, id);
        this._onDidChangeDefaultEnvironmentEmitter.fire(id);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    private assertInitialized(): void {
        if (!this._initialized) {
            throw new Error("EnvironmentStore.init() must be awaited before use.");
        }
    }

    /**
     * Validates `next`, writes the file, and commits the in-memory cache.
     * On any failure, the in-memory state is left untouched.
     */
    private async persist(next: Environment[]): Promise<void> {
        const file: EnvironmentsFile = {
            schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
            environments: next,
        };
        // Validate before writing — never persist an invalid shape, even if a
        // caller passed something the file validator would later reject.
        const filePath = vscode.Uri.joinPath(this.workspaceFolder.uri, ".mssql", "environments.json").fsPath;
        validateEnvironmentsFile(file, filePath);
        await saveEnvironmentsFile(this.workspaceFolder, file);
        this._envs = next;

    /** Serializes a write-style operation behind any in-flight writes. */
    private runWrite(op: () => void | Promise<void>): Promise<void> {
        const next = this._writeChain.then(() => op());
        // Swallow rejections in the chain so one failure doesn't poison
        // subsequent writes — but propagate them to the original caller.
        this._writeChain = next.catch(() => undefined);
        return next;
    }

    private fireChange(evt: EnvironmentsChangeEvent): void {
        this._onDidChangeEnvironmentsEmitter.fire(evt);
    }
}

// =============================================================================
// Diff helper
// =============================================================================

function diffEnvironments(
    before: readonly Environment[],
    after: readonly Environment[],
): EnvironmentsChangeEvent {
    const beforeById = new Map(before.map((e) => [e.id, e]));
    const afterById = new Map(after.map((e) => [e.id, e]));

    const added: Environment[] = [];
    const updated: Environment[] = [];
    const removed: string[] = [];

    for (const [id, env] of afterById) {
        const prev = beforeById.get(id);
        if (prev === undefined) {
            added.push(env);
        } else if (!shallowEqualEnv(prev, env)) {
            updated.push(env);
        }
    }
    for (const id of beforeById.keys()) {
        if (!afterById.has(id)) {
            removed.push(id);
        }
    }
    return { added, updated, removed };
}

/** Stringify-equality. Cheap, correct for plain JSON shapes. */
function shallowEqualEnv(a: Environment, b: Environment): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
