/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import logger from "../models/logger";
import { IConnectionInfo } from "vscode-mssql";
import type { SqlPlatform } from "../sharedInterfaces/performance";
import type {
    PlatformMetricKind,
    PlatformMetricPoint,
    PlatformMetricResult,
    PlatformMetricSeries,
} from "../sharedInterfaces/performanceDashboard";
import { getErrorMessage } from "../utils/utils";

/*
 * The history of a database's CPU, memory, and storage from its platform, which keeps more than
 * the database does: Azure Monitor for Azure SQL Database and Managed Instance, and the SQL
 * workload of Fabric for SQL database in Fabric. A read that cannot run, for example without an
 * Azure sign-in or access to the resource, returns why, and the dashboard reads the database
 * instead. Reads never prompt for a sign-in.
 */

const platformLogger = logger.withPrefix("Performance Platform Metrics");

const requestTimeoutMs = 30_000;
const minuteMs = 60_000;
const megabyte = 1024 * 1024;

export interface PlatformMetricRequest {
    readonly kind: PlatformMetricKind;
    readonly platform: SqlPlatform | undefined;
    readonly start: Date;
    readonly end: Date;
}

/** Reads the platform metrics of a connection. */
export class PlatformMetricsReader {
    /** Azure resource IDs by account, server, and database. */
    private readonly _resourceIds = new Map<string, Promise<string | undefined>>();
    /** Power BI clusters by tenant. */
    private readonly _clusters = new Map<string, Promise<string>>();
    /** MWC tokens by Fabric item, with the time that they are good until. */
    private readonly _mwcTokens = new Map<string, { token: MwcToken; until: number }>();

    async read(
        connection: IConnectionInfo,
        request: PlatformMetricRequest,
    ): Promise<PlatformMetricResult> {
        try {
            switch (request.platform) {
                case "azureSqlDatabase":
                case "azureSqlManagedInstance":
                    return await this.readAzureMonitor(connection, request);
                case "fabricSqlDatabase":
                    return await this.readFabric(connection, request);
                default:
                    return { reason: "The platform keeps no metrics of its own." };
            }
        } catch (error) {
            platformLogger.debug(
                `Platform ${request.kind} metrics of "${connection.server}" not read: ${getErrorMessage(error)}`,
            );
            return { reason: getErrorMessage(error) };
        }
    }

    // ---------------------------------------------------------------- Azure Monitor

    private async readAzureMonitor(
        connection: IConnectionInfo,
        request: PlatformMetricRequest,
    ): Promise<PlatformMetricResult> {
        const managedInstance = request.platform === "azureSqlManagedInstance";
        if (request.kind === "requests" || request.kind === "blocked") {
            return { reason: "Azure Monitor has no metric for this." };
        }
        // Managed Instance reports CPU for the instance only; no memory, logins, or requests, and
        // its storage is of the instance, not of the database.
        if (managedInstance && request.kind !== "cpu") {
            return { reason: "Managed Instance has no database metric for this." };
        }
        const located = await this.azureResource(connection, managedInstance);
        if (!located) {
            return { reason: "The Azure resource of the database was not found." };
        }
        const names = azureMetricNames(request.kind, managedInstance);
        const interval = azureInterval(request.end.getTime() - request.start.getTime());
        const timespan = `${request.start.toISOString()}/${request.end.toISOString()}`;
        const arm = getCloudProviderSettings().settings.armResource.endpoint.replace(/\/$/, "");
        const url =
            `${arm}${located.resourceId}/providers/Microsoft.Insights/metrics` +
            `?api-version=2023-10-01&metricnames=${encodeURIComponent(names.join(","))}` +
            `&timespan=${encodeURIComponent(timespan)}&interval=${interval.iso}` +
            `&aggregation=Average,Maximum,Total`;
        const token = await located.getToken();
        const response = await fetchJson<AzureMetricsResponse>(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const series = (name: string, aggregation: "average" | "maximum" | "total") => {
            const metric = response.value?.find(
                (candidate) => candidate.name?.value?.toLowerCase() === name.toLowerCase(),
            );
            return (metric?.timeseries?.[0]?.data ?? []).map((point) => ({
                startUtc: point.timeStamp,
                value: point[aggregation] ?? null,
            }));
        };
        const latest = (points: readonly PlatformMetricPoint[]) =>
            [...points].reverse().find((point) => point.value !== null)?.value ?? undefined;
        const base = { source: "azureMonitor" as const, bucketMinutes: interval.minutes };

        switch (request.kind) {
            case "cpu": {
                if (managedInstance) {
                    return {
                        series: {
                            ...base,
                            kind: "cpu",
                            unit: "percent",
                            points: series("avg_cpu_percent", "average"),
                        },
                    };
                }
                // vCore databases have a vCore limit: the vCores in use are the CPU percent of
                // it, which Azure reports for every interval, while cpu_used is often sparse on
                // an idle database. DTU databases have no limit, so they stay in percent.
                const percent = series("cpu_percent", "average");
                const limit = latest(series("cpu_limit", "maximum"));
                if (limit) {
                    return {
                        series: {
                            ...base,
                            kind: "cpu",
                            unit: "vCores",
                            points: percent.map((point) => ({
                                ...point,
                                value: point.value === null ? null : (point.value / 100) * limit,
                            })),
                            limit,
                        },
                    };
                }
                return {
                    series: { ...base, kind: "cpu", unit: "percent", points: percent },
                };
            }
            case "memory":
                return {
                    series: {
                        ...base,
                        kind: "memory",
                        unit: "percent",
                        points: series("sql_instance_memory_percent", "average"),
                    },
                };
            case "logins":
                return {
                    series: {
                        ...base,
                        kind: "logins",
                        unit: "count",
                        points: series("connection_successful", "total"),
                    },
                };
            case "storage": {
                const toMegabytes = (points: PlatformMetricPoint[]) =>
                    points.map((point) => ({
                        ...point,
                        value: point.value === null ? null : point.value / megabyte,
                    }));
                const allocated = latest(toMegabytes(series("allocated_data_storage", "maximum")));
                return {
                    series: {
                        ...base,
                        kind: "storage",
                        unit: "megabytes",
                        points: toMegabytes(series("storage", "maximum")),
                        ...(allocated ? { limit: allocated } : {}),
                    },
                };
            }
        }
    }

    /**
     * The Azure resource of the connection's database or instance, and a token for Azure Resource
     * Manager, from the connection's Azure account, or else the first signed-in account.
     */
    private async azureResource(
        connection: IConnectionInfo,
        managedInstance: boolean,
    ): Promise<{ resourceId: string; getToken(): Promise<string> } | undefined> {
        const accountIds = connection.accountId
            ? [connection.accountId]
            : (await VsCodeAzureHelper.getAccounts()).map((account) => account.id);
        for (const accountId of accountIds) {
            const key = `${accountId}|${connection.server}|${connection.database ?? ""}`;
            let lookup = this._resourceIds.get(key);
            if (!lookup) {
                lookup = managedInstance
                    ? findManagedInstance(accountId, connection.server)
                    : findDatabase(accountId, connection);
                this._resourceIds.set(key, lookup);
            }
            const resourceId = await lookup;
            if (!resourceId) {
                continue;
            }
            const subscriptionId = resourceId.split("/")[2];
            const subscription = (
                await VsCodeAzureHelper.getSubscriptionsForAccount(accountId)
            ).find((candidate) => candidate.subscriptionId === subscriptionId);
            if (!subscription) {
                continue;
            }
            const arm = getCloudProviderSettings().settings.armResource.endpoint.replace(/\/$/, "");
            return {
                resourceId,
                getToken: async () => {
                    const token = await subscription.credential.getToken(`${arm}/.default`);
                    if (!token?.token) {
                        throw new Error("No Azure Resource Manager token.");
                    }
                    return token.token;
                },
            };
        }
        return undefined;
    }

    // ---------------------------------------------------------------- Fabric

    private async readFabric(
        connection: IConnectionInfo,
        request: PlatformMetricRequest,
    ): Promise<PlatformMetricResult> {
        const ids = fabricIds(connection);
        if (!ids) {
            return { reason: "The Fabric workspace or item of the database is not known." };
        }
        const token = await this.mwcToken(ids);
        const base =
            `https://${token.TargetUriHost}/webapi/capacities/${token.CapacityObjectId}` +
            `/workloads/SQLDb/SQLDbService/automatic/sqldbnative/${ids.itemId}`;
        const metric = async (name: string): Promise<PlatformMetricPoint[]> => {
            const response = await fetchJson<FabricMetricsResponse>(
                `${base}/monitoring/metrics/${name}?startTime=${request.start.toISOString()}` +
                    `&endTime=${request.end.toISOString()}&alertInfoNeeded=false`,
                {
                    headers: {
                        Authorization: `MwcToken ${token.Token}`,
                        "x-ms-workload-resource-moniker": ids.itemId,
                    },
                },
            );
            return (response.results?.[0]?.datapoints ?? []).map((point) => ({
                // The service writes UTC times without an offset.
                startUtc: /[zZ]|[+-]\d\d:\d\d$/.test(point.timeStamp)
                    ? point.timeStamp
                    : `${point.timeStamp}Z`,
                value: point.value ?? null,
            }));
        };
        const bucketMinutes = (points: readonly PlatformMetricPoint[]) =>
            points.length > 1
                ? Math.max(
                      1,
                      Math.round(
                          (Date.parse(points[1].startUtc) - Date.parse(points[0].startUtc)) /
                              minuteMs,
                      ),
                  )
                : 15;
        const toMegabytes = (points: PlatformMetricPoint[]) =>
            points.map((point) => ({
                ...point,
                value: point.value === null ? null : point.value / megabyte,
            }));

        switch (request.kind) {
            case "cpu": {
                // The CPU time of each bucket, which the service scales to the vCore limit; over
                // the bucket's length, it is the vCores in use.
                const used = await metric("cpu_used_ms");
                const minutes = bucketMinutes(used);
                return {
                    series: {
                        source: "fabric",
                        kind: "cpu",
                        unit: "vCores",
                        bucketMinutes: minutes,
                        points: used.map((point) => ({
                            ...point,
                            value: point.value === null ? null : point.value / (minutes * minuteMs),
                        })),
                    },
                };
            }
            case "memory": {
                const used = toMegabytes(await metric("memory_used_bytes"));
                return {
                    series: {
                        source: "fabric",
                        kind: "memory",
                        unit: "megabytes",
                        bucketMinutes: bucketMinutes(used),
                        points: used,
                    },
                };
            }
            case "logins":
            case "requests":
            case "blocked": {
                // Logins and requests are the sum of each bucket; blocked requests the most at
                // one time in it.
                const name = {
                    logins: "logins_completed",
                    requests: "requests_completed",
                    blocked: "blocked_requests",
                }[request.kind];
                const points = await metric(name);
                return {
                    series: {
                        source: "fabric",
                        kind: request.kind,
                        unit: "count",
                        bucketMinutes: bucketMinutes(points),
                        points,
                    },
                };
            }
            case "storage": {
                const [used, allocated] = await Promise.all([
                    metric("used_storage_in_bytes").then(toMegabytes),
                    metric("allocated_storage_in_bytes").then(toMegabytes),
                ]);
                const limit = [...allocated].reverse().find((point) => point.value !== null)?.value;
                return {
                    series: {
                        source: "fabric",
                        kind: "storage",
                        unit: "megabytes",
                        bucketMinutes: bucketMinutes(used),
                        points: used,
                        ...(limit ? { limit } : {}),
                    },
                };
            }
        }
    }

    /**
     * An MWC token for the SQL workload and the item, as the Fabric portal gets one: from the
     * Power BI cluster of the tenant, with a Power BI token of the signed-in account.
     */
    private async mwcToken(ids: FabricIds): Promise<MwcToken> {
        const cached = this._mwcTokens.get(ids.itemId);
        if (cached && cached.until > Date.now()) {
            return cached.token;
        }
        const scopeBase = getCloudProviderSettings().fabric.fabricScopeUriBase;
        if (!scopeBase) {
            throw new Error("The cloud has no Fabric.");
        }
        // Silent: the dashboard never prompts for a sign-in to read metrics.
        const session = await vscode.authentication.getSession(
            "microsoft",
            [`${scopeBase}.default`, `VSCODE_TENANT:${ids.tenantId}`],
            { silent: true },
        );
        if (!session?.accessToken) {
            throw new Error("No Fabric sign-in.");
        }
        const cluster = await this.cluster(ids.tenantId, session.accessToken);
        const token = await fetchJson<MwcToken>(
            `${cluster.replace(/\/$/, "")}/metadata/v201606/generatemwctokenv2`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    workspaceObjectId: ids.workspaceId,
                    workloadType: "SQLDb",
                    artifactObjectIds: [
                        { artifactType: "SQLDbNative", artifactObjectId: ids.itemId },
                    ],
                }),
            },
        );
        if (!token.Token || !token.TargetUriHost || !token.CapacityObjectId) {
            throw new Error("The MWC token response is incomplete.");
        }
        // The token lasts about an hour; it is used for half of that.
        this._mwcTokens.set(ids.itemId, { token, until: Date.now() + 30 * minuteMs });
        return token;
    }

    private cluster(tenantId: string, powerBiToken: string): Promise<string> {
        let cluster = this._clusters.get(tenantId);
        if (!cluster) {
            cluster = fetchJson<{ clusterUrl?: string }>(
                "https://api.powerbi.com/powerbi/globalservice/v201606/clusterdetails",
                { headers: { Authorization: `Bearer ${powerBiToken}` } },
            ).then((details) => {
                if (!details.clusterUrl) {
                    throw new Error("The Power BI cluster of the tenant is not known.");
                }
                return details.clusterUrl;
            });
            cluster.catch(() => this._clusters.delete(tenantId));
            this._clusters.set(tenantId, cluster);
        }
        return cluster;
    }
}

// ---------------------------------------------------------------- Azure resource lookup

/** The database's resource ID, through the server lookup that the extension caches. */
async function findDatabase(
    accountId: string,
    connection: IConnectionInfo,
): Promise<string | undefined> {
    const serverName = VsCodeAzureHelper.getAzureSqlServerName(connection.server);
    if (!serverName || !connection.database) {
        return undefined;
    }
    const server = await VsCodeAzureHelper.findSqlResource(accountId, serverName);
    if (server === "UnableToCheck") {
        return undefined;
    }
    return (
        `/subscriptions/${server.subscriptionId}/resourceGroups/${server.resourceGroup}` +
        `/providers/Microsoft.Sql/servers/${serverName}/databases/${connection.database}`
    );
}

/** The managed instance whose host name the connection uses, in the account's subscriptions. */
async function findManagedInstance(accountId: string, server: string): Promise<string | undefined> {
    const host = server.split(",")[0].trim().toLowerCase();
    const arm = getCloudProviderSettings().settings.armResource.endpoint.replace(/\/$/, "");
    for (const subscription of await VsCodeAzureHelper.getSubscriptionsForAccount(accountId)) {
        try {
            const token = await subscription.credential.getToken(`${arm}/.default`);
            const response = await fetchJson<{
                value?: { id?: string; properties?: { fullyQualifiedDomainName?: string } }[];
            }>(
                `${arm}/subscriptions/${subscription.subscriptionId}/providers/Microsoft.Sql/managedInstances?api-version=2021-11-01`,
                { headers: { Authorization: `Bearer ${token?.token}` } },
            );
            const match = response.value?.find(
                (instance) => instance.properties?.fullyQualifiedDomainName?.toLowerCase() === host,
            );
            if (match?.id) {
                return match.id;
            }
        } catch {
            // The account may not read this subscription; try the next.
        }
    }
    return undefined;
}

/** The metrics of a kind, by the names that Azure Monitor gives them. */
function azureMetricNames(kind: PlatformMetricKind, managedInstance: boolean): string[] {
    if (managedInstance) {
        return ["avg_cpu_percent"];
    }
    switch (kind) {
        case "cpu":
            return ["cpu_limit", "cpu_percent"];
        case "memory":
            return ["sql_instance_memory_percent"];
        case "storage":
            return ["storage", "allocated_data_storage"];
        case "logins":
            return ["connection_successful"];
        default:
            return [];
    }
}

/** The Azure Monitor interval for a window, so that a chart has at most a few hundred points. */
function azureInterval(windowMs: number): { iso: string; minutes: number } {
    const hours = windowMs / (60 * minuteMs);
    if (hours <= 1) {
        return { iso: "PT1M", minutes: 1 };
    }
    if (hours <= 12) {
        return { iso: "PT5M", minutes: 5 };
    }
    if (hours <= 24) {
        return { iso: "PT15M", minutes: 15 };
    }
    if (hours <= 7 * 24) {
        return { iso: "PT1H", minutes: 60 };
    }
    return { iso: "PT6H", minutes: 360 };
}

// ---------------------------------------------------------------- Fabric IDs

interface FabricIds {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly itemId: string;
}

/**
 * The tenant, workspace, and item of a SQL database in Fabric. Its host name has the tenant and
 * the workspace in base32, and its database name ends with the item ID.
 */
export function fabricIds(connection: IConnectionInfo): FabricIds | undefined {
    const label = connection.server.split(",")[0].trim().split(".")[0].toLowerCase();
    const [tenantPart, workspacePart] = label.split("-");
    const itemId = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        connection.database ?? "",
    )?.[1];
    const tenantId = tenantPart ? guidFromBase32(tenantPart) : undefined;
    const workspaceId = workspacePart ? guidFromBase32(workspacePart) : undefined;
    return tenantId && workspaceId && itemId ? { tenantId, workspaceId, itemId } : undefined;
}

/** A GUID from its 16 bytes in base32, in the byte order of .NET. */
export function guidFromBase32(text: string): string | undefined {
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    let bits = "";
    for (const character of text) {
        const value = alphabet.indexOf(character);
        if (value < 0) {
            return undefined;
        }
        bits += value.toString(2).padStart(5, "0");
    }
    if (bits.length < 128) {
        return undefined;
    }
    const hex = Array.from({ length: 16 }, (_, index) =>
        parseInt(bits.slice(index * 8, index * 8 + 8), 2)
            .toString(16)
            .padStart(2, "0"),
    );
    const reversed = (from: number, to: number) => hex.slice(from, to).reverse().join("");
    return [
        reversed(0, 4),
        reversed(4, 6),
        reversed(6, 8),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
    ].join("-");
}

// ---------------------------------------------------------------- HTTP

interface AzureMetricsResponse {
    value?: {
        name?: { value?: string };
        timeseries?: {
            data?: { timeStamp: string; average?: number; maximum?: number }[];
        }[];
    }[];
}

interface FabricMetricsResponse {
    results?: { datapoints?: { timeStamp: string; value?: number | null }[] }[];
}

interface MwcToken {
    Token: string;
    TargetUriHost: string;
    CapacityObjectId: string;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return (await response.json()) as T;
}

export type { PlatformMetricSeries };
