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

export enum DabEntityAuthFilter {
    Anonymous = "anonymous",
    Authenticated = "authenticated",
    None = "none",
}

export interface DabEntityFilters {
    status: DabEntityStatusFilter;
    schemas: string[];
    sourceTypes: Dab.EntitySourceType[];
    apiTypes: Array<Dab.ApiType | "none">;
    authTypes: DabEntityAuthFilter[];
}

export const defaultDabEntityFilters: DabEntityFilters = {
    status: DabEntityStatusFilter.All,
    schemas: [],
    sourceTypes: [],
    apiTypes: [],
    authTypes: [],
};

export function getDabSchemaFilterKey(schemaName: string): string {
    return schemaName.trim().toLowerCase();
}

export function getDabEntityFilterCount(filters: DabEntityFilters): number {
    return (
        (filters.status === DabEntityStatusFilter.All ? 0 : 1) +
        filters.schemas.length +
        filters.sourceTypes.length +
        filters.apiTypes.length +
        filters.authTypes.length
    );
}

export function doesEntityMatchDabFilters(
    entity: Dab.DabEntityConfig,
    filters: DabEntityFilters,
): boolean {
    if (filters.status === DabEntityStatusFilter.Enabled && !Dab.isEntityExposed(entity)) {
        return false;
    }
    if (filters.status === DabEntityStatusFilter.Disabled && Dab.isEntityExposed(entity)) {
        return false;
    }
    if (
        filters.status === DabEntityStatusFilter.Warnings &&
        !Dab.hasBlockingUnsupportedReason(entity) &&
        !Dab.hasFixableKeyWarning(entity)
    ) {
        return false;
    }
    if (
        filters.schemas.length > 0 &&
        !filters.schemas.includes(getDabSchemaFilterKey(entity.schemaName))
    ) {
        return false;
    }

    const sourceType = entity.sourceType ?? Dab.EntitySourceType.Table;
    if (filters.sourceTypes.length > 0 && !filters.sourceTypes.includes(sourceType)) {
        return false;
    }

    if (filters.apiTypes.length > 0) {
        const enabledApiTypes: Array<Dab.ApiType | "none"> = [];
        if (Dab.isEntityRestEnabled(entity)) {
            enabledApiTypes.push(Dab.ApiType.Rest);
        }
        if (Dab.isEntityGraphQLEnabled(entity)) {
            enabledApiTypes.push(Dab.ApiType.GraphQL);
        }
        if (Dab.isEntityMcpEnabled(entity)) {
            enabledApiTypes.push(Dab.ApiType.Mcp);
        }
        if (enabledApiTypes.length === 0) {
            enabledApiTypes.push("none");
        }
        if (!filters.apiTypes.some((apiType) => enabledApiTypes.includes(apiType))) {
            return false;
        }
    }

    if (filters.authTypes.length > 0) {
        const enabledAuthTypes: DabEntityAuthFilter[] = [];
        if (Dab.hasEntityPermission(entity, Dab.AuthorizationRole.Anonymous)) {
            enabledAuthTypes.push(DabEntityAuthFilter.Anonymous);
        }
        if (Dab.hasEntityPermission(entity, Dab.AuthorizationRole.Authenticated)) {
            enabledAuthTypes.push(DabEntityAuthFilter.Authenticated);
        }
        if (enabledAuthTypes.length === 0) {
            enabledAuthTypes.push(DabEntityAuthFilter.None);
        }
        if (!filters.authTypes.some((authType) => enabledAuthTypes.includes(authType))) {
            return false;
        }
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
