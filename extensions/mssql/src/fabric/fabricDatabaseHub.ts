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

/**
 * Values of the estate view's `resourceType` filter. The Hub matches them case-sensitively.
 */
export enum DatabaseHubResourceType {
    AzureSql = "AzureSql",
    AzureSqlManagedInstance = "AzureSqlManagedInstance",
    ArcSqlServer = "ArcSqlServer",
    AzureSqlVM = "AzureSqlVM",
    FabricSql = "FabricSql",
}

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fabric SQL connection catalogs append the item GUID to the Hub display name. */
const fabricItemGuidSuffixPattern =
    /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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

/** Returns the Fabric item GUID at the end of a Fabric SQL database name, if it carries one. */
export function getFabricItemIdFromDatabaseName(database: string | undefined): string | undefined {
    return fabricItemGuidSuffixPattern.exec(database?.trim() ?? "")?.[1]?.toLowerCase();
}

/** Whether a value is a bare GUID, which is how the Hub identifies a Fabric item. */
export function isGuid(value: string | undefined): boolean {
    return guidPattern.test(value?.trim() ?? "");
}

/** Decodes a percent-encoded resource ID; the Hub expects decoded ones. */
export function decodeResourceId(resourceId: string | undefined): string | undefined {
    const trimmed = resourceId?.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

/** The parts of an Azure Resource Manager ID. Segment names are matched case-insensitively. */
export interface ArmResourceIdParts {
    subscriptionId: string;
    resourceGroup: string;
    /** Provider namespace and type, lower-cased, for example `microsoft.sql/servers`. */
    resourceType: string;
    name: string;
    /** Child type and name, for example `databases` of an Azure SQL server. */
    childType?: string;
    childName?: string;
}

/**
 * Parses an ARM resource ID of a top-level resource or of one child resource. Azure Resources
 * nodes can carry percent-encoded IDs, so the ID is decoded first.
 */
export function parseArmResourceId(resourceId: string | undefined): ArmResourceIdParts | undefined {
    const segments = decodeResourceId(resourceId)?.split("/").filter(Boolean) ?? [];
    if (
        (segments.length !== 8 && segments.length !== 10) ||
        segments[0].toLowerCase() !== "subscriptions" ||
        segments[2].toLowerCase() !== "resourcegroups" ||
        segments[4].toLowerCase() !== "providers"
    ) {
        return undefined;
    }
    return {
        subscriptionId: segments[1],
        resourceGroup: segments[3],
        resourceType: `${segments[5]}/${segments[6]}`.toLowerCase(),
        name: segments[7],
        ...(segments.length === 10
            ? { childType: segments[8].toLowerCase(), childName: segments[9] }
            : {}),
    };
}

/** Builds an ARM resource ID from its parts. */
export function formatArmResourceId(parts: {
    subscriptionId: string;
    resourceGroup: string;
    provider: string;
    type: string;
    name: string;
    childType?: string;
    childName?: string;
}): string {
    const id = `/subscriptions/${parts.subscriptionId}/resourceGroups/${parts.resourceGroup}/providers/${parts.provider}/${parts.type}/${parts.name}`;
    return parts.childType && parts.childName ? `${id}/${parts.childType}/${parts.childName}` : id;
}

/**
 * Whether the Hub can open a resource from this ID: a bare Fabric item GUID, or a decoded ARM ID
 * with 8 segments, or 10 for an Azure SQL database. The Hub silently ignores any other shape.
 */
export function isDatabaseHubResourceId(resourceId: string | undefined): boolean {
    if (isGuid(resourceId)) {
        return true;
    }
    const parts = parseArmResourceId(resourceId);
    if (!parts || resourceId!.includes("%") || !resourceId!.startsWith("/")) {
        return false;
    }
    return (
        parts.childType === undefined ||
        (parts.resourceType === "microsoft.sql/servers" && parts.childType === "databases")
    );
}

export interface DatabaseHubLinkOptions {
    /** Fabric portal environment to link into; defaults to {@link FabricEnvironment.Prod}. */
    environment?: FabricEnvironment;
    /**
     * The resource to open the details dialog of: an ARM ID, which is decoded first, or a Fabric
     * item GUID. An ID of any other shape is left out, since the Hub would ignore it.
     */
    databaseResourceId?: string;
    /** Resource types to filter the estate grid to. */
    resourceTypes?: readonly DatabaseHubResourceType[];
    /** Azure subscription to filter the estate grid to. */
    subscriptionId?: string;
    /** Text to search the estate grid for; the Hub matches it as a substring. */
    search?: string;
}

/**
 * Builds a link to the Database Hub estate view, sorted by issues. With `databaseResourceId`, the
 * Hub opens that resource's details dialog over the grid.
 *
 * @returns undefined when the current cloud has no Fabric portal.
 */
export function getDatabaseHubLink(options: DatabaseHubLinkOptions = {}): string | undefined {
    const portalUriBase =
        preProductionPortalUriBases[options.environment ?? FabricEnvironment.Prod] ??
        getCloudProviderSettings().fabric.fabricPortalUriBase;
    if (!portalUriBase) {
        return undefined;
    }

    const filters: Array<{ key: string; operator: string; value: string | string[] }> = [];
    if (options.resourceTypes?.length) {
        filters.push({ key: "resourceType", operator: "in", value: [...options.resourceTypes] });
    }

    // The Hub matches subscriptions against lower-cased row values.
    const subscriptionId = options.subscriptionId?.trim().toLowerCase();
    if (subscriptionId) {
        filters.push({ key: "subscription", operator: "in", value: [subscriptionId] });
    }

    const search = options.search?.trim();
    if (search) {
        filters.push({ key: "search", operator: "contains", value: search });
    }

    const searchParams = new URLSearchParams();
    const databaseResourceId = decodeResourceId(options.databaseResourceId);
    if (databaseResourceId && isDatabaseHubResourceId(databaseResourceId)) {
        searchParams.set("databaseResourceId", databaseResourceId);
    }
    // `category` and `relevance` stay unfiltered: narrowing them to issues would drop a healthy
    // database out of its own link.
    searchParams.set(
        "estateView",
        JSON.stringify({
            schemaVersion: 1,
            state: {
                filters,
                category: ["all"],
                relevance: ["all"],
                sort: { column: "issues", direction: "descending" },
            },
        }),
    );

    const link = new URL(databaseHubEstatePath, portalUriBase);
    link.search = searchParams.toString();
    return link.toString();
}

const base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

/** Decodes unpadded RFC 4648 base32, or returns undefined when the text is not base32. */
function decodeBase32(text: string): Uint8Array | undefined {
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of text.toLowerCase()) {
        const value = base32Alphabet.indexOf(char);
        if (value < 0) {
            return undefined;
        }
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return Uint8Array.from(bytes);
}

function hex(bytes: ArrayLike<number>): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the workspace IDs that a Fabric SQL host can encode. The first label of the host starts
 * with the workspace GUID in base32, but the GUID's byte order is not documented, so both the RFC
 * order and the .NET order are returned, in that order.
 */
export function getFabricWorkspaceIdCandidates(server: string | undefined): string[] {
    if (!getFabricEnvironment(server)) {
        return [];
    }
    const label = server!.split(",")[0].trim().split(".")[0].split("-")[0];
    const bytes = label.length === 26 ? decodeBase32(label) : undefined;
    if (!bytes || bytes.length < 16) {
        return [];
    }
    const guid = (ordered: ArrayLike<number>) => {
        const text = hex(ordered);
        return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20, 32)}`;
    };
    const rfc = bytes.slice(0, 16);
    const dotNet = [
        ...rfc.slice(0, 4).reverse(),
        ...rfc.slice(4, 6).reverse(),
        ...rfc.slice(6, 8).reverse(),
        ...rfc.slice(8),
    ];
    return [...new Set([guid(rfc), guid(dotNet)])];
}
