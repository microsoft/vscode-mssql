/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "crypto";
import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import * as Constants from "../constants/constants";
import {
    NodeFilterPropertyDataType,
    ObjectExplorerFilterPreset,
} from "../sharedInterfaces/objectExplorerFilter";
import { EncryptedFileStorage } from "../utils/encryptedFileStorage";

const objectExplorerFilterStorageVersion = 1;
const maxRecentPresetsPerScope = 10;
const maxRecentPresetsTotal = 50;

interface StoredObjectExplorerFilterPreset extends ObjectExplorerFilterPreset {
    scopeId: string;
}

interface PersistedObjectExplorerFilters {
    version: number;
    presets: StoredObjectExplorerFilterPreset[];
}

function cloneFilters(filters: vscodeMssql.NodeFilter[]): vscodeMssql.NodeFilter[] {
    return filters.map((filter) => ({
        ...filter,
        value: Array.isArray(filter.value)
            ? ([...filter.value] as string[] | number[])
            : filter.value,
    }));
}

function getFilterKey(filters: vscodeMssql.NodeFilter[]): string {
    return JSON.stringify(
        cloneFilters(filters).sort((left, right) => {
            const nameComparison = left.name.localeCompare(right.name);
            return nameComparison !== 0 ? nameComparison : left.operator - right.operator;
        }),
    );
}

function isNodeFilter(value: unknown): value is vscodeMssql.NodeFilter {
    if (!value || typeof value !== "object") {
        return false;
    }

    const filter = value as Partial<vscodeMssql.NodeFilter>;
    const filterValue = filter.value;
    const hasValidValue =
        filterValue === undefined ||
        typeof filterValue === "string" ||
        typeof filterValue === "number" ||
        typeof filterValue === "boolean" ||
        (Array.isArray(filterValue) &&
            (filterValue.every((item) => typeof item === "string") ||
                filterValue.every((item) => typeof item === "number")));

    return typeof filter.name === "string" && typeof filter.operator === "number" && hasValidValue;
}

function isStoredPreset(value: unknown): value is StoredObjectExplorerFilterPreset {
    if (!value || typeof value !== "object") {
        return false;
    }

    const preset = value as Partial<StoredObjectExplorerFilterPreset>;
    return (
        typeof preset.id === "string" &&
        typeof preset.scopeId === "string" &&
        Array.isArray(preset.filters) &&
        preset.filters.every(isNodeFilter) &&
        typeof preset.isPinned === "boolean" &&
        typeof preset.lastUsed === "number" &&
        Number.isFinite(preset.lastUsed) &&
        (preset.name === undefined || typeof preset.name === "string")
    );
}

function sortPresets<T extends ObjectExplorerFilterPreset>(presets: T[]): T[] {
    return presets.sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
            return left.isPinned ? -1 : 1;
        }

        if (left.isPinned) {
            // JavaScript's stable sort preserves the order in which filters were saved.
            return 0;
        }

        return right.lastUsed - left.lastUsed;
    });
}

/** Persists reusable Object Explorer filters independently of any server or database. */
export class ObjectExplorerFilterStore {
    private readonly _storage: EncryptedFileStorage;

    constructor(context: vscode.ExtensionContext) {
        this._storage = new EncryptedFileStorage(
            context,
            Constants.objectExplorerFilterGlobalStorageFileName,
            Constants.objectExplorerFilterEncryptionKeySecretStorageKey,
        );
    }

    public static getScopeId(
        nodeType: string,
        filterProperties: vscodeMssql.NodeFilterProperty[],
    ): string {
        const propertySchema = filterProperties
            .map((property) => {
                const choices =
                    property.type === NodeFilterPropertyDataType.Choice
                        ? (property as vscodeMssql.NodeFilterChoiceProperty).choices
                              .map((choice) => choice.value)
                              .sort()
                        : undefined;
                return {
                    name: property.name,
                    type: property.type,
                    choices,
                };
            })
            .sort((left, right) => left.name.localeCompare(right.name));

        return JSON.stringify({ nodeType, propertySchema });
    }

    public async getPresets(scopeId: string): Promise<ObjectExplorerFilterPreset[]> {
        return this.getPresetsForScope(await this.readPresets(), scopeId);
    }

    private getPresetsForScope(
        storedPresets: StoredObjectExplorerFilterPreset[],
        scopeId: string,
    ): ObjectExplorerFilterPreset[] {
        const presets = storedPresets
            .filter((preset) => preset.scopeId === scopeId)
            .map(({ scopeId: _scopeId, ...preset }) => ({
                ...preset,
                filters: cloneFilters(preset.filters),
            }));

        return sortPresets(presets);
    }

    public async recordUsage(
        scopeId: string,
        filters: vscodeMssql.NodeFilter[],
        saveName?: string,
    ): Promise<ObjectExplorerFilterPreset[]> {
        const presets = await this.readPresets();
        if (filters.length === 0) {
            return this.getPresetsForScope(presets, scopeId);
        }

        const filterKey = getFilterKey(filters);
        const normalizedSaveName = saveName?.trim();
        const matchingFilter = presets.find(
            (preset) => preset.scopeId === scopeId && getFilterKey(preset.filters) === filterKey,
        );
        const matchingName = normalizedSaveName
            ? presets.find(
                  (preset) =>
                      preset.scopeId === scopeId &&
                      preset.name?.localeCompare(normalizedSaveName, undefined, {
                          sensitivity: "accent",
                      }) === 0,
              )
            : undefined;
        const existingPreset = matchingFilter ?? matchingName;
        const isPinned = normalizedSaveName ? true : (matchingFilter?.isPinned ?? false);
        const updatedPreset: StoredObjectExplorerFilterPreset = {
            id: existingPreset?.id ?? randomUUID(),
            scopeId,
            name: normalizedSaveName || matchingFilter?.name,
            filters: cloneFilters(filters),
            isPinned,
            lastUsed: Date.now(),
        };

        const existingIndex = presets.findIndex(
            (preset) => preset === matchingFilter || preset === matchingName,
        );
        const remainingPresets = presets.filter(
            (preset) => preset !== matchingFilter && preset !== matchingName,
        );
        remainingPresets.splice(
            existingIndex < 0 ? remainingPresets.length : existingIndex,
            0,
            updatedPreset,
        );
        const prunedPresets = this.prunePresets(remainingPresets);
        await this.writePresets(prunedPresets);
        return this.getPresetsForScope(prunedPresets, scopeId);
    }

    public async setPinned(
        scopeId: string,
        presetId: string,
        isPinned: boolean,
    ): Promise<ObjectExplorerFilterPreset[]> {
        const presets = await this.readPresets();
        const preset = presets.find(
            (candidate) => candidate.scopeId === scopeId && candidate.id === presetId,
        );
        if (!preset) {
            return this.getPresetsForScope(presets, scopeId);
        }

        if (!isPinned) {
            preset.name = undefined;
        }
        preset.isPinned = isPinned;
        preset.lastUsed = Date.now();
        const prunedPresets = this.prunePresets(presets);
        await this.writePresets(prunedPresets);
        return this.getPresetsForScope(prunedPresets, scopeId);
    }

    public async renamePreset(
        scopeId: string,
        presetId: string,
        name: string,
    ): Promise<ObjectExplorerFilterPreset[]> {
        const normalizedName = name.trim();
        const presets = await this.readPresets();
        if (!normalizedName) {
            return this.getPresetsForScope(presets, scopeId);
        }

        const preset = presets.find(
            (candidate) =>
                candidate.scopeId === scopeId && candidate.id === presetId && candidate.isPinned,
        );
        const matchingName = presets.find(
            (candidate) =>
                candidate.scopeId === scopeId &&
                candidate.id !== presetId &&
                candidate.name?.localeCompare(normalizedName, undefined, {
                    sensitivity: "accent",
                }) === 0,
        );
        if (!preset || matchingName) {
            return this.getPresetsForScope(presets, scopeId);
        }

        preset.name = normalizedName;
        await this.writePresets(presets);
        return this.getPresetsForScope(presets, scopeId);
    }

    public async deletePreset(
        scopeId: string,
        presetId: string,
    ): Promise<ObjectExplorerFilterPreset[]> {
        const presets = await this.readPresets();
        const remainingPresets = presets.filter(
            (preset) => !(preset.scopeId === scopeId && preset.id === presetId),
        );
        await this.writePresets(remainingPresets);
        return this.getPresetsForScope(remainingPresets, scopeId);
    }

    private async readPresets(): Promise<StoredObjectExplorerFilterPreset[]> {
        try {
            const serializedFilters = await this._storage.read();
            if (!serializedFilters) {
                return [];
            }

            const persistedFilters = JSON.parse(
                serializedFilters,
            ) as PersistedObjectExplorerFilters;
            if (
                !persistedFilters ||
                persistedFilters.version !== objectExplorerFilterStorageVersion ||
                !Array.isArray(persistedFilters.presets)
            ) {
                return [];
            }

            return persistedFilters.presets.filter(isStoredPreset).map((preset) => ({
                id: preset.id,
                scopeId: preset.scopeId,
                name: preset.name,
                filters: cloneFilters(preset.filters),
                isPinned: preset.isPinned,
                lastUsed: preset.lastUsed,
            }));
        } catch {
            return [];
        }
    }

    private async writePresets(presets: StoredObjectExplorerFilterPreset[]): Promise<void> {
        if (presets.length === 0) {
            await this._storage.clear();
            return;
        }

        const persistedFilters: PersistedObjectExplorerFilters = {
            version: objectExplorerFilterStorageVersion,
            presets,
        };
        await this._storage.write(JSON.stringify(persistedFilters));
    }

    private prunePresets(
        presets: StoredObjectExplorerFilterPreset[],
    ): StoredObjectExplorerFilterPreset[] {
        const pinnedPresets = presets.filter((preset) => preset.isPinned);
        const recentPresetsByScope = new Map<string, StoredObjectExplorerFilterPreset[]>();

        for (const preset of presets.filter((candidate) => !candidate.isPinned)) {
            const scopePresets = recentPresetsByScope.get(preset.scopeId) ?? [];
            scopePresets.push(preset);
            recentPresetsByScope.set(preset.scopeId, scopePresets);
        }

        const recentPresets = [...recentPresetsByScope.values()]
            .flatMap((scopePresets) =>
                scopePresets
                    .sort((left, right) => right.lastUsed - left.lastUsed)
                    .slice(0, maxRecentPresetsPerScope),
            )
            .sort((left, right) => right.lastUsed - left.lastUsed)
            .slice(0, maxRecentPresetsTotal);

        return [...pinnedPresets, ...recentPresets];
    }
}
