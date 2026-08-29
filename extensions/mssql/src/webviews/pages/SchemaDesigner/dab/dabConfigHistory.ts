/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../sharedInterfaces/dab";

type PatchPath = Array<string | number>;

interface DabConfigPatch {
    operation: "add" | "remove" | "replace";
    path: PatchPath;
    value?: unknown;
}

interface DabConfigHistoryEntry {
    forward: DabConfigPatch[];
    inverse: DabConfigPatch[];
    sizeInBytes: number;
}

// Match the established schema-designer undo limit and add a memory ceiling for large schemas.
export const DAB_CONFIG_HISTORY_MAX_ACTIONS = 100;
export const DAB_CONFIG_HISTORY_MAX_BYTES = 5 * 1024 * 1024;

function clone<T>(value: T): T {
    if (value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createPatches(
    previous: unknown,
    next: unknown,
    path: PatchPath,
    forward: DabConfigPatch[],
    inverse: DabConfigPatch[],
): void {
    if (Object.is(previous, next)) {
        return;
    }

    if (Array.isArray(previous) && Array.isArray(next)) {
        if (previous.length !== next.length) {
            forward.push({ operation: "replace", path, value: clone(next) });
            inverse.unshift({ operation: "replace", path, value: clone(previous) });
            return;
        }

        for (let index = 0; index < previous.length; index++) {
            createPatches(previous[index], next[index], [...path, index], forward, inverse);
        }
        return;
    }

    if (isRecord(previous) && isRecord(next)) {
        const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const key of keys) {
            const previousHasKey = Object.prototype.hasOwnProperty.call(previous, key);
            const nextHasKey = Object.prototype.hasOwnProperty.call(next, key);
            const childPath = [...path, key];

            if (!previousHasKey) {
                forward.push({ operation: "add", path: childPath, value: clone(next[key]) });
                inverse.unshift({ operation: "remove", path: childPath });
            } else if (!nextHasKey) {
                forward.push({ operation: "remove", path: childPath });
                inverse.unshift({
                    operation: "add",
                    path: childPath,
                    value: clone(previous[key]),
                });
            } else {
                createPatches(previous[key], next[key], childPath, forward, inverse);
            }
        }
        return;
    }

    forward.push({ operation: "replace", path, value: clone(next) });
    inverse.unshift({ operation: "replace", path, value: clone(previous) });
}

function applyPatches(config: Dab.DabConfig, patches: DabConfigPatch[]): Dab.DabConfig {
    const result = clone(config) as unknown;

    for (const patch of patches) {
        if (patch.path.length === 0) {
            throw new Error("DAB config history does not support replacing the root value.");
        }

        let parent = result as Record<string | number, unknown>;
        for (const segment of patch.path.slice(0, -1)) {
            parent = parent[segment] as Record<string | number, unknown>;
        }

        const property = patch.path[patch.path.length - 1];
        if (patch.operation === "remove") {
            if (Array.isArray(parent) && typeof property === "number") {
                parent.splice(property, 1);
            } else {
                delete parent[property];
            }
        } else {
            parent[property] = clone(patch.value);
        }
    }

    return result as Dab.DabConfig;
}

/** Session-only, patch-based history for the canonical DAB configuration. */
export class DabConfigHistory {
    private _undoEntries: DabConfigHistoryEntry[] = [];
    private _redoEntries: DabConfigHistoryEntry[] = [];
    private _sizeInBytes = 0;

    public get canUndo(): boolean {
        return this._undoEntries.length > 0;
    }

    public get canRedo(): boolean {
        return this._redoEntries.length > 0;
    }

    public clear(): void {
        this._undoEntries = [];
        this._redoEntries = [];
        this._sizeInBytes = 0;
    }

    public push(previous: Dab.DabConfig, next: Dab.DabConfig): boolean {
        const forward: DabConfigPatch[] = [];
        const inverse: DabConfigPatch[] = [];
        createPatches(previous, next, [], forward, inverse);
        if (forward.length === 0) {
            return false;
        }

        for (const entry of this._redoEntries) {
            this._sizeInBytes -= entry.sizeInBytes;
        }
        this._redoEntries = [];

        const sizeInBytes = JSON.stringify({ forward, inverse }).length * 2;
        if (sizeInBytes > DAB_CONFIG_HISTORY_MAX_BYTES) {
            this.clear();
            return true;
        }
        const entry = { forward, inverse, sizeInBytes };
        this._undoEntries.push(entry);
        this._sizeInBytes += sizeInBytes;

        while (
            this._undoEntries.length > DAB_CONFIG_HISTORY_MAX_ACTIONS ||
            (this._sizeInBytes > DAB_CONFIG_HISTORY_MAX_BYTES && this._undoEntries.length > 1)
        ) {
            const removed = this._undoEntries.shift();
            if (removed) {
                this._sizeInBytes -= removed.sizeInBytes;
            }
        }
        return true;
    }

    public undo(current: Dab.DabConfig): Dab.DabConfig | undefined {
        const entry = this._undoEntries.pop();
        if (!entry) {
            return undefined;
        }
        this._redoEntries.push(entry);
        return applyPatches(current, entry.inverse);
    }

    public redo(current: Dab.DabConfig): Dab.DabConfig | undefined {
        const entry = this._redoEntries.pop();
        if (!entry) {
            return undefined;
        }
        this._undoEntries.push(entry);
        return applyPatches(current, entry.forward);
    }
}
