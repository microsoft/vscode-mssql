/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCloudProviderSettings } from "../azure/providerSettings";

/**
 * Fabric portal environments, matching the environment names the Fabric extension reports for its
 * workspace items.
 */
export enum FabricEnvironment {
    Prod = "PROD",
    Msit = "MSIT",
    Daily = "DAILY",
    Dxt = "DXT",
    Edog = "EDOG",
    EdogOnebox = "EDOGONEBOX",
    Onebox = "ONEBOX",
}

/**
 * Portal URIs for Microsoft-internal pre-production rings.  These are not part of any Azure cloud,
 * so unlike the production portal they have no home in {@link getCloudProviderSettings}.
 */
const preProductionPortalUriBases: Partial<Record<FabricEnvironment, string>> = {
    [FabricEnvironment.Msit]: "https://msit.fabric.microsoft.com/",
    [FabricEnvironment.Daily]: "https://daily.fabric.microsoft.com/",
    [FabricEnvironment.Dxt]: "https://dxt.fabric.microsoft.com/",
    [FabricEnvironment.Edog]: "https://edog.analysis-df.windows.net/",
    [FabricEnvironment.EdogOnebox]: "https://edog.analysis-df.windows.net/",
    [FabricEnvironment.Onebox]: "https://portal.analysis.windows-int.net/",
};

/** Path of the Database Hub's estate view within the Fabric portal. */
const databaseHubEstatePath = "workloads/fdh/databaseHub/estate";

/** Database kinds the Database Hub estate view can be filtered to. */
export enum FabricDatabaseHubDatabaseType {
    AzureSql = "azure-sql",
    FabricSql = "fabric-sql",
}

/** Estate view `resourceType` filter value for each database kind. */
const estateResourceTypes: Record<FabricDatabaseHubDatabaseType, string> = {
    [FabricDatabaseHubDatabaseType.AzureSql]: "AzureSql",
    [FabricDatabaseHubDatabaseType.FabricSql]: "FabricSql",
};

/** Fabric SQL connection catalogs append the item GUID to the Hub display name. */
const fabricItemGuidSuffixPattern =
    /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Databases the Database Hub leaves out of its estate inventory, so they can never be shown there.
 *
 * Kept in sync with the exclusion list in the Hub's Azure Resource Graph inventory query.
 */
const systemDatabaseNames: ReadonlySet<string> = new Set([
    "master",
    "model",
    "msdb",
    "tempdb",
    "azure_maintenance",
    "azure_sys",
]);

/** Whether a database is one the Database Hub excludes from its estate inventory. */
export function isSystemDatabaseName(databaseName: string | undefined): boolean {
    return systemDatabaseNames.has(databaseName?.trim().toLowerCase() ?? "");
}

/**
 * Resolves the Fabric portal environment hosting a Fabric SQL server.
 *
 * Production endpoints sit directly under the cloud's Fabric SQL DNS suffix, while pre-production
 * rings prefix it with the ring name (e.g. `<host>.msit-database.fabric.microsoft.com`).
 *
 * @returns undefined when the server is not a Fabric SQL endpoint, or names an unknown ring.
 */
export function getFabricEnvironment(server: string | undefined): FabricEnvironment | undefined {
    const dnsSuffix = getCloudProviderSettings().fabric.sqlDbDnsSuffix;
    if (!server || !dnsSuffix) {
        return undefined;
    }

    const host = server.split(",")[0].trim().toLowerCase();
    const bareSuffix = dnsSuffix.startsWith(".") ? dnsSuffix.slice(1) : dnsSuffix;
    const normalizedSuffix = bareSuffix.toLowerCase();
    if (!host.endsWith(normalizedSuffix)) {
        return undefined;
    }

    const suffixIndex = host.length - normalizedSuffix.length;
    if (suffixIndex <= 0) {
        return undefined;
    }

    const separator = host[suffixIndex - 1];
    if (separator === ".") {
        return FabricEnvironment.Prod;
    }
    if (separator !== "-") {
        return undefined;
    }

    const ring = host.slice(host.lastIndexOf(".", suffixIndex - 1) + 1, suffixIndex - 1);
    return parseFabricEnvironment(ring);
}

/** Resolves a Fabric environment name, however cased, to a known {@link FabricEnvironment}. */
export function parseFabricEnvironment(
    environment: string | undefined,
): FabricEnvironment | undefined {
    const name = environment?.trim().toUpperCase();
    return Object.values(FabricEnvironment).find((known) => known === name);
}

/**
 * Normalizes a Fabric SQL database name to the name the Database Hub displays, dropping the item
 * GUID that Fabric SQL connection catalogs carry.
 */
export function getFabricSqlDatabaseDisplayName(database: string | undefined): string | undefined {
    return database?.trim().replace(fabricItemGuidSuffixPattern, "") || undefined;
}

export interface FabricDatabaseHubLinkOptions {
    /** Fabric portal environment to link into; defaults to {@link FabricEnvironment.Prod}. */
    environment?: FabricEnvironment;
    /** Database name to pre-filter the estate view by; the Hub matches it as a substring. */
    databaseName?: string;
    /** Azure subscription to pre-filter the estate view by. */
    subscriptionId?: string;
    /** Azure resource group to pre-filter the estate view by; ignored without a subscription. */
    resourceGroupName?: string;
}

/**
 * Builds a link to the Fabric Database Hub estate view, filtered to the given kind of database.
 *
 * The link only narrows the estate grid; it never carries `databaseResourceId`, which is what makes
 * the Hub open a database's details dialog on arrival.
 *
 * @returns undefined when the current cloud has no Fabric portal.
 */
export function getFabricDatabaseHubLink(
    databaseType: FabricDatabaseHubDatabaseType,
    options: FabricDatabaseHubLinkOptions = {},
): string | undefined {
    const portalUriBase =
        preProductionPortalUriBases[options.environment ?? FabricEnvironment.Prod] ??
        getCloudProviderSettings().fabric.fabricPortalUriBase;
    if (!portalUriBase) {
        return undefined;
    }

    const filters: Array<{ key: string; operator: string; value: string | string[] }> = [
        { key: "resourceType", operator: "in", value: [estateResourceTypes[databaseType]] },
    ];

    // The Hub matches both of these against lower-cased row values, and keys a resource group by
    // the subscription owning it, so the same group name in two subscriptions stays distinct.
    const subscriptionId = options.subscriptionId?.trim().toLowerCase();
    if (subscriptionId) {
        filters.push({ key: "subscription", operator: "in", value: [subscriptionId] });

        const resourceGroupName = options.resourceGroupName?.trim().toLowerCase();
        if (resourceGroupName) {
            filters.push({
                key: "resourceGroup",
                operator: "in",
                value: [`${subscriptionId}/${resourceGroupName}`],
            });
        }
    }

    const databaseName = options.databaseName?.trim();
    if (databaseName) {
        filters.push({ key: "search", operator: "contains", value: databaseName });
    }

    // `category` and `relevance` stay unfiltered: narrowing them to issues would drop a healthy
    // database out of its own link, and the Hub expands each row's insights by default anyway.
    const searchParams = new URLSearchParams({
        databaseType,
        estateView: JSON.stringify({
            schemaVersion: 1,
            state: { filters, category: ["all"], relevance: ["all"], sort: null },
        }),
    });

    const link = new URL(databaseHubEstatePath, portalUriBase);
    link.search = searchParams.toString();
    return link.toString();
}
