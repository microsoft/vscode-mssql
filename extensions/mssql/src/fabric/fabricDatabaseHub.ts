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
    AzureSqlManagedInstance = "azure-sql-managed-instance",
    ArcSqlServer = "arc-sql-server",
    FabricSql = "fabric-sql",
}

/** Estate view `resourceType` filter values for each database kind. */
const estateResourceTypes: Record<FabricDatabaseHubDatabaseType, string[]> = {
    [FabricDatabaseHubDatabaseType.AzureSql]: ["AzureSql"],
    [FabricDatabaseHubDatabaseType.AzureSqlManagedInstance]: ["AzureSqlManagedInstance"],
    // The Hub files an Arc-enabled instance hosted on an Azure VM under SQL Server on Azure VMs.
    [FabricDatabaseHubDatabaseType.ArcSqlServer]: ["ArcSqlServer", "AzureSqlVM"],
    [FabricDatabaseHubDatabaseType.FabricSql]: ["FabricSql"],
};

/**
 * Azure SQL host labels that sit between a logical server's name and the DNS suffix, unlike a
 * managed instance's DNS zone.
 */
const azureSqlDatabaseHostLabels: ReadonlySet<string> = new Set(["privatelink", "secondary"]);

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

/**
 * Whether the current cloud has a production Fabric portal to host the Database Hub.  Sovereign
 * clouds have none, so no database in them can be linked to.
 */
export function hasFabricPortal(): boolean {
    return !!getCloudProviderSettings().fabric.fabricPortalUriBase;
}

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

/**
 * Returns the managed instance an Azure SQL host belongs to.
 *
 * A managed instance host carries a DNS zone label before the Azure SQL suffix
 * (`<instance>.<dnsZone>.database.windows.net`, or `<instance>.public.<dnsZone>...` for its
 * public endpoint), while a logical server's host does not (`<server>.database.windows.net`).
 *
 * @returns undefined for hosts that are not a managed instance.
 */
export function getAzureSqlManagedInstanceName(server: string | undefined): string | undefined {
    const dnsSuffix = getCloudProviderSettings().settings.sqlResource?.dnsSuffix;
    if (!server || !dnsSuffix) {
        return undefined;
    }

    const host = server.split(",")[0].trim().toLowerCase().replace(/^tcp:/, "");
    const normalizedSuffix = (
        dnsSuffix.startsWith(".") ? dnsSuffix : `.${dnsSuffix}`
    ).toLowerCase();
    if (!host.endsWith(normalizedSuffix)) {
        return undefined;
    }

    const labels = host.slice(0, -normalizedSuffix.length).split(".");
    if (labels.length < 2 || azureSqlDatabaseHostLabels.has(labels[1])) {
        return undefined;
    }
    return labels[0];
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

/**
 * Reads the Fabric item ID that Fabric SQL connection catalogs append to a database's name, which
 * the Database Hub deep-links a Fabric SQL database by.
 *
 * @returns undefined for names without an item ID.
 */
export function getFabricSqlDatabaseItemId(database: string | undefined): string | undefined {
    return database?.trim().match(fabricItemGuidSuffixPattern)?.[0].slice(1).toLowerCase();
}

export interface FabricDatabaseHubLinkOptions {
    /** Fabric portal environment to link into; defaults to {@link FabricEnvironment.Prod}. */
    environment?: FabricEnvironment;
    /**
     * Name of the Hub's row to pre-filter the estate view by: a database, or for kinds the Hub lists
     * by instance, the instance.  The Hub matches it as a substring.
     */
    resourceName?: string;
    /** Azure subscription to pre-filter the estate view by. */
    subscriptionId?: string;
    /** Azure resource group to pre-filter the estate view by; ignored without a subscription. */
    resourceGroupName?: string;
    /**
     * Database for the Hub to open in its details dialog on arrival: an Azure SQL database's Azure
     * resource ID, or a Fabric SQL database's Fabric item ID.
     */
    databaseResourceId?: string;
}

/**
 * Builds a link to the Fabric Database Hub estate view, filtered to the given kind of database and
 * sorted by issues.
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
        { key: "resourceType", operator: "in", value: estateResourceTypes[databaseType] },
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

    const resourceName = options.resourceName?.trim();
    if (resourceName) {
        filters.push({ key: "search", operator: "contains", value: resourceName });
    }

    // `category` and `relevance` stay unfiltered: narrowing them to issues would drop a healthy
    // database out of its own link, and the Hub expands each row's insights by default anyway.
    const searchParams = new URLSearchParams({
        estateView: JSON.stringify({
            schemaVersion: 1,
            state: {
                filters,
                category: ["all"],
                relevance: ["all"],
                sort: { column: "issues", direction: "descending" },
            },
        }),
    });
    const databaseResourceId = options.databaseResourceId?.trim();
    if (databaseResourceId) {
        searchParams.set("databaseResourceId", databaseResourceId);
    }

    const link = new URL(databaseHubEstatePath, portalUriBase);
    link.search = searchParams.toString();
    return link.toString();
}
