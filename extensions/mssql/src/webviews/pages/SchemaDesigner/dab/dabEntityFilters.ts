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
    sourceTypes: Dab.EntitySourceType[];
}

export const defaultDabEntityFilters: DabEntityFilters = {
    status: DabEntityStatusFilter.All,
    schemas: [],
    sourceTypes: [],
};

export function getDabSchemaFilterKey(schemaName: string): string {
    return schemaName.trim().toLowerCase();
}

export function getDabEntityFilterCount(filters: DabEntityFilters): number {
    return (
        (filters.status === DabEntityStatusFilter.All ? 0 : 1) +
        filters.schemas.length +
        filters.sourceTypes.length
    );
}

export function doesEntityMatchDabFilters(
    entity: Dab.DabEntityConfig,
    filters: DabEntityFilters,
): boolean {
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

    const sourceType = entity.sourceType ?? Dab.EntitySourceType.Table;
    return filters.sourceTypes.length === 0 || filters.sourceTypes.includes(sourceType);
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
