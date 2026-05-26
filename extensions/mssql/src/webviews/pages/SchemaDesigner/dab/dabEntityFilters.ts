/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../sharedInterfaces/dab";

export enum DabEntityStatusFilter {
    All = "all",
    Enabled = "enabled",
    Disabled = "disabled",
    Warnings = "warnings",
}

export interface DabEntityFilters {
    status: DabEntityStatusFilter;
    schemas: string[];
}

export const defaultDabEntityFilters: DabEntityFilters = {
    status: DabEntityStatusFilter.All,
    schemas: [],
};

export function getDabSchemaFilterKey(schemaName: string): string {
    return schemaName.trim().toLowerCase();
}

export function getDabEntityFilterCount(filters: DabEntityFilters): number {
    return (filters.status === DabEntityStatusFilter.All ? 0 : 1) + filters.schemas.length;
}

export function isDabTableEntity(entity: Dab.DabEntityConfig): boolean {
    return (entity.sourceType ?? Dab.EntitySourceType.Table) === Dab.EntitySourceType.Table;
}

export function doesEntityMatchDabFilters(
    entity: Dab.DabEntityConfig,
    filters: DabEntityFilters,
): boolean {
    if (!isDabTableEntity(entity)) {
        return false;
    }
    if (filters.status === DabEntityStatusFilter.Enabled && !entity.isEnabled) {
        return false;
    }
    if (filters.status === DabEntityStatusFilter.Disabled && entity.isEnabled) {
        return false;
    }
    if (filters.status === DabEntityStatusFilter.Warnings && entity.isSupported) {
        return false;
    }
    if (
        filters.schemas.length > 0 &&
        !filters.schemas.includes(getDabSchemaFilterKey(entity.schemaName))
    ) {
        return false;
    }

    return true;
}

export function toggleDabEntityFilterValue<T>(values: T[], value: T, allValues?: T[]): T[] {
    const updatedValues = values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value];

    if (allValues?.length && allValues.every((option) => updatedValues.includes(option))) {
        return [];
    }

    return updatedValues;
}
