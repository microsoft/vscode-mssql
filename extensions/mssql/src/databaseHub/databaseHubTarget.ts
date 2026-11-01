/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decides whether a connection has a row in the Fabric Database Hub, and of which kind.
 *
 * Every Hub row is an Azure resource (Azure SQL database, managed instance, SQL Server enabled by
 * Azure Arc, SQL Server on an Azure VM) or a Fabric SQL database. Anything else reaches the Hub
 * only through Azure Arc. Classification reads only the saved profile and the facts saved from
 * an earlier connection, so it can run while a tree draws, without a connection or the network.
 */

import { DatabaseEngineEdition } from "../databaseProjects/common/enums";
import {
    getFabricEnvironment,
    isGuid,
    isSystemDatabaseName,
    parseArmResourceId,
} from "../fabric/fabricDatabaseHub";

/** Whether a tree node shows Open in Database Hub. `maybe` shows it and checks on click. */
export type DatabaseHubEligibility = "yes" | "maybe" | "no";

export enum DatabaseHubPlatform {
    /** SQL Server or Azure SQL Database in a local container. Arc can't manage containers. */
    Container = "container",
    /** SQL Server on premises, on an Azure VM, or on a VM in another cloud. */
    SqlServer = "sqlServer",
    ManagedInstance = "managedInstance",
    AzureSqlDatabase = "azureSqlDatabase",
    FabricSqlDatabase = "fabricSqlDatabase",
    /** Synapse, Fabric warehouses and endpoints, Dataverse, and other clouds' managed databases. */
    Unsupported = "unsupported",
}

/** The profile properties that classification reads. */
export interface DatabaseHubConnection {
    readonly server: string;
    readonly database?: string;
    readonly containerName?: string;
    /**
     * The ARM ID of the Azure SQL server, managed instance, or SQL Server instance, or the item
     * GUID of a Fabric SQL database, saved when the profile was created from Azure or Fabric.
     */
    readonly resourceId?: string;
}

/** What the SQL Server Azure Arc table said about the instance. */
export type DatabaseHubArcRegistration =
    | {
          readonly state: "registered";
          /** The `Microsoft.AzureArcData/sqlServerInstances` ARM ID. */
          readonly resourceId: string;
          /** True when the Arc resource's host is an Azure VM. */
          readonly onAzureVm: boolean;
      }
    /** The table is missing or empty, and the login could have read it. */
    | { readonly state: "notRegistered" }
    /** The login can't read the table. */
    | { readonly state: "unknown" };

/** Facts about a connection's server, saved after a connection for later classification. */
export interface DatabaseHubServerFacts {
    /** The profile's server when the facts were read. Facts for another server are stale. */
    readonly server: string;
    readonly engineEdition?: number;
    /** `@@SERVERNAME`, which names the logical server even through an alias or IP address. */
    readonly logicalServerName?: string;
    readonly machineName?: string;
    /** `SERVERPROPERTY('ProductVersion')`, for telemetry. */
    readonly serverVersion?: string;
    /** `SERVERPROPERTY('Edition')`, for telemetry. */
    readonly serverEdition?: string;
    /** Whether the server is an Azure or Fabric service, for telemetry. */
    readonly isCloud?: boolean;
    readonly isContainer?: boolean;
    readonly arc?: DatabaseHubArcRegistration;
    /** When the Arc table was read, in milliseconds since the epoch. */
    readonly arcCheckedAt?: number;
}

export interface DatabaseHubTarget {
    readonly platform: DatabaseHubPlatform;
    readonly eligibility: DatabaseHubEligibility;
}

/** SQL Edge, which runs only in containers and on IoT devices. */
const sqlEdgeEngineEdition = 9;

const sqlServerEngineEditions: ReadonlySet<number> = new Set([
    DatabaseEngineEdition.Personal,
    DatabaseEngineEdition.Standard,
    DatabaseEngineEdition.Enterprise,
    DatabaseEngineEdition.Express,
]);

/** DNS suffixes of Azure SQL logical servers and managed instances, in every Azure cloud. */
const azureSqlDnsSuffixes = [
    ".database.windows.net",
    ".database.usgovcloudapi.net",
    ".database.chinacloudapi.cn",
];

/** DNS suffixes of databases that have no Hub row and can't be Arc-enabled. */
const unsupportedDnsSuffixes = [
    ".sql.azuresynapse.net",
    ".sql.azuresynapse.usgovcloudapi.net",
    ".sql.azuresynapse.chinacloudapi.cn",
    ".datawarehouse.fabric.microsoft.com",
    ".datawarehouse.pbidedicated.windows.net",
    ".pbidedicated.windows.net",
    ".dynamics.com",
    ".rds.amazonaws.com",
    ".sql.goog",
    ".oraclecloud.com",
];

const localHosts: ReadonlySet<string> = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "[::1]",
    ".",
    "(local)",
    "host.docker.internal",
]);

/** Docker names a container's host after the first 12 hex digits of the container ID. */
const containerMachineNamePattern = /^[0-9a-f]{12}$/i;

/** Returns the host of a server name, without a `tcp:` prefix, port, or instance name. */
export function getServerHost(server: string | undefined): string {
    const withoutPort = (server ?? "").split(",")[0].trim().toLowerCase();
    return withoutPort.replace(/^tcp:/, "").split("\\")[0];
}

/** Whether the server runs on this machine. */
export function isLocalServer(server: string | undefined): boolean {
    const host = getServerHost(server);
    return localHosts.has(host) || host.startsWith("(localdb)");
}

/** Whether a machine name is the short container ID that Docker uses as a container's host name. */
export function isContainerMachineName(machineName: string | undefined): boolean {
    return containerMachineNamePattern.test(machineName?.trim() ?? "");
}

function azureSqlHostPrefix(host: string): string | undefined {
    const suffix = azureSqlDnsSuffixes.find((candidate) => host.endsWith(candidate));
    return suffix && host.length > suffix.length
        ? host.slice(0, host.length - suffix.length)
        : undefined;
}

/**
 * Returns the managed instance name of a host such as `<mi>.<zone>.database.windows.net` or its
 * public endpoint `<mi>.public.<zone>.database.windows.net`.
 */
export function getManagedInstanceName(server: string | undefined): string | undefined {
    const labels = azureSqlHostPrefix(getServerHost(server))?.split(".");
    if (!labels || labels.length < 2 || labels.length > 3) {
        return undefined;
    }
    // Private Link puts `privatelink` where a managed instance has its DNS zone.
    if (labels.includes("privatelink") || (labels.length === 3 && labels[1] !== "public")) {
        return undefined;
    }
    return labels[0];
}

/** Returns the logical server name of a host such as `<server>.database.windows.net`. */
export function getAzureSqlServerName(server: string | undefined): string | undefined {
    const labels = azureSqlHostPrefix(getServerHost(server))?.split(".");
    if (!labels || (labels.length === 2 && labels[1] !== "privatelink") || labels.length > 2) {
        return undefined;
    }
    return labels[0];
}

function isUnsupportedHost(host: string): boolean {
    return unsupportedDnsSuffixes.some((suffix) => host.endsWith(suffix));
}

function platformOfResourceId(resourceId: string | undefined): DatabaseHubPlatform | undefined {
    if (isGuid(resourceId)) {
        return DatabaseHubPlatform.FabricSqlDatabase;
    }
    switch (parseArmResourceId(resourceId)?.resourceType) {
        case "microsoft.sql/servers":
            return DatabaseHubPlatform.AzureSqlDatabase;
        case "microsoft.sql/managedinstances":
            return DatabaseHubPlatform.ManagedInstance;
        case "microsoft.azurearcdata/sqlserverinstances":
        case "microsoft.sqlvirtualmachine/sqlvirtualmachines":
            return DatabaseHubPlatform.SqlServer;
        default:
            return undefined;
    }
}

function platformOf(
    connection: DatabaseHubConnection,
    facts: DatabaseHubServerFacts | undefined,
): DatabaseHubPlatform {
    const host = getServerHost(connection.server);
    const edition = facts?.engineEdition;
    const local = isLocalServer(connection.server);

    // The Azure SQL Database container reports engine edition 5, so containers come first.
    if (
        connection.containerName ||
        facts?.isContainer ||
        (local && edition === DatabaseEngineEdition.SqlDatabase) ||
        edition === sqlEdgeEngineEdition
    ) {
        return DatabaseHubPlatform.Container;
    }
    if (
        isUnsupportedHost(host) ||
        edition === DatabaseEngineEdition.SqlDataWarehouse ||
        edition === DatabaseEngineEdition.SqlOnDemand ||
        host.startsWith("(localdb)")
    ) {
        return DatabaseHubPlatform.Unsupported;
    }

    const saved = platformOfResourceId(connection.resourceId);
    if (saved) {
        return saved;
    }
    if (getFabricEnvironment(connection.server) || edition === DatabaseEngineEdition.SqlDbFabric) {
        return DatabaseHubPlatform.FabricSqlDatabase;
    }
    if (
        getManagedInstanceName(connection.server) ||
        edition === DatabaseEngineEdition.SqlManagedInstance
    ) {
        return DatabaseHubPlatform.ManagedInstance;
    }
    if (getAzureSqlServerName(connection.server) || edition === DatabaseEngineEdition.SqlDatabase) {
        return DatabaseHubPlatform.AzureSqlDatabase;
    }
    if (edition !== undefined && !sqlServerEngineEditions.has(edition)) {
        return DatabaseHubPlatform.Unsupported;
    }
    return DatabaseHubPlatform.SqlServer;
}

/**
 * Classifies a tree node of a connection.
 *
 * @param database The database the node stands for: a database node's name, or the profile's
 * database for a connection node. Undefined for a connection node with no database.
 * @param facts The server facts saved for the connection, if any.
 */
export function classifyDatabaseHubTarget(
    connection: DatabaseHubConnection,
    database: string | undefined,
    facts?: DatabaseHubServerFacts,
): DatabaseHubTarget {
    const platform = platformOf(connection, facts);
    switch (platform) {
        case DatabaseHubPlatform.AzureSqlDatabase:
        case DatabaseHubPlatform.FabricSqlDatabase:
            // The Hub lists user databases only; it has no row for a logical server.
            return {
                platform,
                eligibility: database && !isSystemDatabaseName(database) ? "yes" : "no",
            };
        case DatabaseHubPlatform.ManagedInstance:
            // The Hub lists the instance, which every database node under it opens.
            return { platform, eligibility: "yes" };
        case DatabaseHubPlatform.SqlServer:
            return {
                platform,
                eligibility:
                    facts?.arc?.state === "registered" ||
                    platformOfResourceId(connection.resourceId) === DatabaseHubPlatform.SqlServer
                        ? "yes"
                        : "maybe",
            };
        default:
            return { platform, eligibility: "no" };
    }
}
