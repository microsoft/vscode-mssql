/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opens a resource in the Fabric Database Hub.
 *
 * On click, the service resolves the resource's Hub ID and deep-links to it with
 * `databaseResourceId`. When the ID can't be resolved, it opens the estate grid filtered to the
 * resource's type and searched by its name. When even that isn't possible, it opens the estate
 * grid unfiltered, sorted by issues, so the user still lands on their resources.
 */

import * as vscode from "vscode";
import {
    ConnectionInfo,
    ServerInfo,
    sendActionEvent,
    sendErrorEvent,
} from "extension-toolkit/vscode";
import { DatabaseEngineEdition } from "../databaseProjects/common/enums";
import * as LocalizedConstants from "../constants/locConstants";
import {
    DatabaseHubResourceType,
    FabricEnvironment,
    formatArmResourceId,
    getDatabaseHubLink,
    getFabricEnvironment,
    getFabricItemIdFromDatabaseName,
    getFabricSqlDatabaseDisplayName,
    getFabricWorkspaceIdCandidates,
    isGuid,
    isSystemDatabaseName,
    parseArmResourceId,
} from "../fabric/fabricDatabaseHub";
import { ILogger } from "../sharedInterfaces/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import type { DatabaseHubAzureLookup, DatabaseHubFabricLookup } from "./databaseHubLookups";
import {
    DatabaseHubProfile,
    DatabaseHubServerFactsDetector,
    DatabaseHubServerFactsStore,
    searchNameOf,
} from "./databaseHubServerFacts";
import {
    DatabaseHubEligibility,
    DatabaseHubPlatform,
    DatabaseHubServerFacts,
    classifyDatabaseHubTarget,
    getAzureSqlServerName,
    getManagedInstanceName,
    isLocalServer,
} from "./databaseHubTarget";

/** Microsoft Learn: connect SQL Server to Azure Arc. */
export const connectToArcLearnMoreUrl =
    "https://learn.microsoft.com/sql/sql-server/azure-arc/connect";

/** How long the lookups of one click may take before the fallback link opens. */
const resolveTimeoutMs = 30_000;

/** Where the user opened the Hub from. A telemetry value. */
export enum DatabaseHubSource {
    ObjectExplorer = "objectExplorer",
    AzureResources = "azureResources",
    FabricWorkspace = "fabricWorkspace",
    PerformanceDashboard = "performanceDashboard",
    Unknown = "unknown",
}

/** The outcome of opening the Hub. A telemetry value. */
export enum DatabaseHubResult {
    /** The Hub opened the resource's details dialog. */
    DeepLinked = "deepLinked",
    /** The Hub opened the estate grid, filtered or searched. */
    Fallback = "fallback",
    /** The SQL Server isn't connected to Azure Arc; the user was asked what to do. */
    ArcNotRegistered = "arcNotRegistered",
    SystemDatabase = "systemDatabase",
    NotInDatabaseHub = "notInDatabaseHub",
    /** The current cloud has no Fabric portal. */
    LinkUnavailable = "linkUnavailable",
    Canceled = "canceled",
    Failed = "failed",
}

/** A saved connection profile, as far as the Hub needs it. */
export interface DatabaseHubConnectionProfile extends DatabaseHubProfile {
    readonly accountId?: string;
    readonly tenantId?: string;
    readonly authenticationType?: string;
}

/**
 * The connection and server properties that telemetry events carry across the extension, as
 * `authenticationType`, `connectionType`, `serverVersion`, `serverEdition`, and
 * `serverEngineEdition`.
 */
export interface ConnectionTelemetry {
    readonly connectionInfo?: ConnectionInfo;
    readonly serverInfo?: ServerInfo;
}

/** What to open in the Hub. */
export type DatabaseHubRequest =
    /** A saved connection, and the database of the node the user chose. */
    | {
          readonly kind: "connection";
          readonly profile: DatabaseHubConnectionProfile;
          readonly database: string | undefined;
      }
    /** An Azure SQL database from the Azure Resources view. */
    | { readonly kind: "azureResource"; readonly resourceId: string }
    /** The "SQL databases" folder of a subscription in the Azure Resources view. */
    | { readonly kind: "azureSubscription"; readonly subscriptionId: string | undefined }
    /** A SQL database item from the Fabric extension's workspace view. */
    | {
          readonly kind: "fabricItem";
          readonly itemId: string;
          readonly environment: FabricEnvironment | undefined;
      };

/** A link to open, and the result it stands for. */
interface Resolution {
    readonly result: DatabaseHubResult;
    readonly platform: DatabaseHubPlatform;
    readonly link?: string;
    /** A SQL Server that isn't connected to Azure Arc, which the user is asked about. */
    readonly arcNotRegisteredServer?: string;
    /** A system database, which the user is told the Hub doesn't list. */
    readonly systemDatabase?: string;
}

let currentService: DatabaseHubService | undefined;

/** The service of the running extension, for code that the dependency graph doesn't reach. */
export function getDatabaseHubService(): DatabaseHubService | undefined {
    return currentService;
}

export class DatabaseHubService implements vscode.Disposable {
    constructor(
        private readonly _facts: DatabaseHubServerFactsStore,
        private readonly _detector: DatabaseHubServerFactsDetector,
        private readonly _azure: DatabaseHubAzureLookup,
        private readonly _fabric: DatabaseHubFabricLookup,
        private readonly _profiles: (
            profileId: string,
        ) => Promise<DatabaseHubConnectionProfile | undefined>,
        /** The server info of an open connection of the profile, if any. */
        private readonly _liveServerInfo: (
            profile: DatabaseHubConnectionProfile,
        ) => ServerInfo | undefined,
        private readonly _logger: ILogger,
    ) {
        currentService = this;
    }

    /**
     * The telemetry properties of a connection: the server info of its open connection, or else
     * the facts saved from an earlier one, so events about a disconnected server still carry it.
     */
    public connectionTelemetry(profile: DatabaseHubConnectionProfile): ConnectionTelemetry {
        const facts = this._facts.get(profile);
        const serverInfo: ServerInfo | undefined =
            this._liveServerInfo(profile) ??
            (facts
                ? {
                      isCloud: facts.isCloud,
                      serverVersion: facts.serverVersion,
                      serverEdition: facts.serverEdition,
                      engineEditionId: facts.engineEdition,
                  }
                : undefined);
        return {
            connectionInfo: { authenticationType: profile.authenticationType },
            ...(serverInfo ? { serverInfo } : {}),
        };
    }

    /** {@link connectionTelemetry} of a saved connection. */
    public async connectionTelemetryForProfile(profileId: string): Promise<ConnectionTelemetry> {
        const profile = await this._profiles(profileId);
        return profile ? this.connectionTelemetry(profile) : {};
    }

    /** Fires with the connection ID whose server facts changed, so menus can update. */
    public get onDidChangeServerFacts(): vscode.Event<string> {
        return this._facts.onDidChange;
    }

    public get detector(): DatabaseHubServerFactsDetector {
        return this._detector;
    }

    /** Whether a node shows Open in Database Hub. Reads only saved data. */
    public eligibility(
        profile: DatabaseHubProfile,
        database: string | undefined,
    ): DatabaseHubEligibility {
        return classifyDatabaseHubTarget(profile, database, this._facts.get(profile)).eligibility;
    }

    /** Whether a database of a saved connection has a Hub row, or may have one. */
    public async eligibilityForProfile(
        profileId: string,
        database: string | undefined,
    ): Promise<DatabaseHubEligibility> {
        const profile = await this._profiles(profileId);
        return profile ? this.eligibility(profile, database || profile.database) : "no";
    }

    /** Opens a database of a saved connection in the Hub. */
    public async openProfile(
        profileId: string,
        database: string | undefined,
        source: DatabaseHubSource,
    ): Promise<void> {
        const profile = await this._profiles(profileId);
        if (profile) {
            await this.open(
                { kind: "connection", profile, database: database || profile.database },
                source,
            );
        }
    }

    /** Resolves the request and opens the Hub, or tells the user why it can't. */
    public async open(request: DatabaseHubRequest, source: DatabaseHubSource): Promise<void> {
        let platform = this.fallback(request).platform;
        const telemetry = this.telemetryOf(request);
        try {
            const resolution = await this.resolveWithProgress(request);
            if (!resolution) {
                this.sendEvent(telemetry, source, platform, DatabaseHubResult.Canceled);
                return;
            }
            platform = resolution.platform;
            const result = await this.show(resolution);
            this.sendEvent(telemetry, source, platform, result);
        } catch (error) {
            sendErrorEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                ...telemetry,
                error,
                additionalProps: { source, platform },
            });
            throw error;
        }
    }

    public dispose(): void {
        if (currentService === this) {
            currentService = undefined;
        }
    }

    /**
     * Resolves a request, showing progress while lookups run. A lookup that outlasts the timeout
     * gives way to the request's fallback link.
     *
     * @returns undefined when the user cancels.
     */
    private resolveWithProgress(request: DatabaseHubRequest): Promise<Resolution | undefined> {
        return Promise.resolve(
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: LocalizedConstants.DatabaseHub.findingResource,
                    cancellable: true,
                },
                async (_progress, token) => {
                    const fallback = this.fallback(request);
                    const deadline = new LookupDeadline(resolveTimeoutMs);
                    const canceled = new Promise<undefined>((resolve) =>
                        token.onCancellationRequested(() => resolve(undefined)),
                    );
                    try {
                        return await Promise.race([
                            this.resolve(request, deadline).catch((error) => {
                                this._logger.error(
                                    `Resolving the Database Hub link failed: ${error instanceof Error ? error.message : String(error)}`,
                                );
                                return fallback;
                            }),
                            deadline.expired.then(() => fallback),
                            canceled,
                        ]);
                    } finally {
                        deadline.dispose();
                    }
                },
            ),
        );
    }

    private async show(resolution: Resolution): Promise<DatabaseHubResult> {
        if (resolution.systemDatabase) {
            void vscode.window.showInformationMessage(
                LocalizedConstants.Azure.systemDatabaseNotInFabricDatabaseHub(
                    resolution.systemDatabase,
                ),
            );
            return resolution.result;
        }
        if (resolution.arcNotRegisteredServer) {
            const learnMore = LocalizedConstants.DatabaseHub.learnHowToConnectToArc;
            const openHub = LocalizedConstants.DatabaseHub.openDatabaseHub;
            const choice = await vscode.window.showInformationMessage(
                LocalizedConstants.DatabaseHub.arcNotRegistered(resolution.arcNotRegisteredServer),
                learnMore,
                openHub,
            );
            if (choice === learnMore) {
                await vscode.env.openExternal(vscode.Uri.parse(connectToArcLearnMoreUrl));
            } else if (choice === openHub && resolution.link) {
                await vscode.env.openExternal(vscode.Uri.parse(resolution.link, true));
            }
            return resolution.result;
        }
        if (resolution.result === DatabaseHubResult.NotInDatabaseHub) {
            void vscode.window.showInformationMessage(
                LocalizedConstants.DatabaseHub.notInDatabaseHub,
            );
            return resolution.result;
        }
        if (!resolution.link) {
            this._logger.debug(
                "No Database Hub link could be built: the cloud has no Fabric portal.",
            );
            return DatabaseHubResult.LinkUnavailable;
        }
        const opened = await vscode.env.openExternal(vscode.Uri.parse(resolution.link, true));
        return opened ? resolution.result : DatabaseHubResult.Failed;
    }

    /** The link a request falls back to when its lookups fail or time out. */
    private fallback(request: DatabaseHubRequest): Resolution {
        switch (request.kind) {
            case "connection":
                return this.connectionFallback(
                    request.profile,
                    request.database,
                    this._facts.get(request.profile),
                );
            case "azureResource":
            case "azureSubscription":
                return fallbackTo(DatabaseHubPlatform.AzureSqlDatabase, {
                    resourceTypes: [DatabaseHubResourceType.AzureSql],
                });
            case "fabricItem":
                return fallbackTo(DatabaseHubPlatform.FabricSqlDatabase, {
                    environment: request.environment,
                    resourceTypes: [DatabaseHubResourceType.FabricSql],
                });
        }
    }

    private async resolve(
        request: DatabaseHubRequest,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        switch (request.kind) {
            case "azureResource":
                return this.resolveAzureResource(request.resourceId);
            case "azureSubscription":
                // The folder spans the subscription, so there is no single row to open.
                return fallbackTo(DatabaseHubPlatform.AzureSqlDatabase, {
                    resourceTypes: [DatabaseHubResourceType.AzureSql],
                    subscriptionId: request.subscriptionId,
                });
            case "fabricItem":
                return deepLink(DatabaseHubPlatform.FabricSqlDatabase, {
                    environment: request.environment,
                    databaseResourceId: request.itemId,
                    resourceTypes: [DatabaseHubResourceType.FabricSql],
                });
            case "connection":
                return this.resolveConnection(request.profile, request.database, deadline);
        }
    }

    private resolveAzureResource(resourceId: string): Resolution {
        const parts = parseArmResourceId(resourceId);
        if (parts?.resourceType !== "microsoft.sql/servers" || parts.childType !== "databases") {
            return {
                platform: DatabaseHubPlatform.Unsupported,
                result: DatabaseHubResult.NotInDatabaseHub,
            };
        }
        if (isSystemDatabaseName(parts.childName)) {
            return systemDatabase(DatabaseHubPlatform.AzureSqlDatabase, parts.childName!);
        }
        return deepLink(DatabaseHubPlatform.AzureSqlDatabase, {
            databaseResourceId: resourceId,
            resourceTypes: [DatabaseHubResourceType.AzureSql],
            subscriptionId: parts.subscriptionId,
        });
    }

    private async resolveConnection(
        profile: DatabaseHubConnectionProfile,
        database: string | undefined,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        let facts = this._facts.get(profile);
        let target = classifyDatabaseHubTarget(profile, database, facts);
        if (
            target.platform === DatabaseHubPlatform.SqlServer ||
            target.platform === DatabaseHubPlatform.AzureSqlDatabase
        ) {
            facts = await this._detector.ensure(profile);
            target = classifyDatabaseHubTarget(profile, database, facts);
        }
        if (target.eligibility === "no") {
            return database &&
                isSystemDatabaseName(database) &&
                target.platform === DatabaseHubPlatform.AzureSqlDatabase
                ? systemDatabase(target.platform, database)
                : { platform: target.platform, result: DatabaseHubResult.NotInDatabaseHub };
        }

        switch (target.platform) {
            case DatabaseHubPlatform.AzureSqlDatabase:
                return this.resolveAzureSqlDatabase(profile, database!, facts, deadline);
            case DatabaseHubPlatform.ManagedInstance:
                return this.resolveManagedInstance(profile, facts, deadline);
            case DatabaseHubPlatform.FabricSqlDatabase:
                return this.resolveFabricSqlDatabase(profile, database!, deadline);
            default:
                return this.resolveSqlServer(profile, facts, deadline);
        }
    }

    private connectionFallback(
        profile: DatabaseHubProfile,
        database: string | undefined,
        facts: DatabaseHubServerFacts | undefined,
    ): Resolution {
        const { platform } = classifyDatabaseHubTarget(profile, database, facts);
        switch (platform) {
            case DatabaseHubPlatform.AzureSqlDatabase:
                return fallbackTo(platform, {
                    resourceTypes: [DatabaseHubResourceType.AzureSql],
                    search: database,
                });
            case DatabaseHubPlatform.ManagedInstance:
                return fallbackTo(platform, {
                    resourceTypes: [DatabaseHubResourceType.AzureSqlManagedInstance],
                    search: getManagedInstanceName(profile.server) ?? facts?.logicalServerName,
                });
            case DatabaseHubPlatform.FabricSqlDatabase:
                return fallbackTo(platform, {
                    environment: getFabricEnvironment(profile.server),
                    resourceTypes: [DatabaseHubResourceType.FabricSql],
                    search: getFabricSqlDatabaseDisplayName(database),
                });
            case DatabaseHubPlatform.SqlServer:
                return fallbackTo(platform, {
                    resourceTypes: [
                        DatabaseHubResourceType.ArcSqlServer,
                        DatabaseHubResourceType.AzureSqlVM,
                    ],
                    search: searchNameOf(profile, facts),
                });
            default:
                return fallbackTo(platform, {});
        }
    }

    /**
     * Row 7: the database's ARM ID from the saved server ID, or from a lookup of the logical
     * server that `@@SERVERNAME` names, which also covers connections through an alias or IP.
     */
    private async resolveAzureSqlDatabase(
        profile: DatabaseHubConnectionProfile,
        database: string,
        facts: DatabaseHubServerFacts | undefined,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        const serverName = (
            facts?.logicalServerName?.split(".")[0] ?? getAzureSqlServerName(profile.server)
        )?.toLowerCase();
        const saved = parseArmResourceId(profile.resourceId);
        let serverId =
            saved?.resourceType === "microsoft.sql/servers" &&
            saved.name.toLowerCase() === serverName
                ? formatArmResourceId({
                      subscriptionId: saved.subscriptionId,
                      resourceGroup: saved.resourceGroup,
                      provider: "Microsoft.Sql",
                      type: "servers",
                      name: saved.name,
                  })
                : undefined;
        if (!serverId && serverName) {
            for (const accountId of await this.accounts(profile, deadline)) {
                serverId = await this._azure.azureSqlServerId(accountId, serverName);
                if (serverId) {
                    break;
                }
            }
        }
        const parts = parseArmResourceId(serverId);
        if (!serverId || !parts) {
            return this.connectionFallback(profile, database, facts);
        }
        return deepLink(DatabaseHubPlatform.AzureSqlDatabase, {
            databaseResourceId: `${serverId}/databases/${database}`,
            resourceTypes: [DatabaseHubResourceType.AzureSql],
            subscriptionId: parts.subscriptionId,
        });
    }

    /** Row 5: the instance's ARM ID, saved or looked up by name. Databases open the instance. */
    private async resolveManagedInstance(
        profile: DatabaseHubConnectionProfile,
        facts: DatabaseHubServerFacts | undefined,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        const instanceName = (
            getManagedInstanceName(profile.server) ?? facts?.logicalServerName?.split(".")[0]
        )?.toLowerCase();
        const saved = parseArmResourceId(profile.resourceId);
        let instanceId =
            saved?.resourceType === "microsoft.sql/managedinstances" &&
            saved.name.toLowerCase() === instanceName
                ? profile.resourceId
                : undefined;
        if (!instanceId && instanceName) {
            for (const accountId of await this.accounts(profile, deadline)) {
                instanceId = await this._azure.managedInstanceId(accountId, instanceName);
                if (instanceId) {
                    break;
                }
            }
        }
        const parts = parseArmResourceId(instanceId);
        if (!instanceId || !parts) {
            return this.connectionFallback(profile, undefined, facts);
        }
        return deepLink(DatabaseHubPlatform.ManagedInstance, {
            databaseResourceId: instanceId,
            resourceTypes: [DatabaseHubResourceType.AzureSqlManagedInstance],
            subscriptionId: parts.subscriptionId,
        });
    }

    /**
     * Row 8: the item GUID at the end of the database name, the GUID saved with the profile, or
     * the item whose database name matches in the workspace that the host encodes.
     */
    private async resolveFabricSqlDatabase(
        profile: DatabaseHubConnectionProfile,
        database: string,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        const environment = getFabricEnvironment(profile.server);
        let itemId =
            getFabricItemIdFromDatabaseName(database) ??
            (isGuid(profile.resourceId) && sameName(profile.database, database)
                ? profile.resourceId
                : undefined);
        for (const workspaceId of itemId ? [] : getFabricWorkspaceIdCandidates(profile.server)) {
            // The Fabric API can ask the user to sign in, which the deadline waits for.
            itemId = await deadline.pausedFor(() =>
                this._fabric.sqlDatabaseId(workspaceId, database, profile.tenantId),
            );
            if (itemId) {
                break;
            }
        }
        if (!itemId) {
            return this.connectionFallback(profile, database, undefined);
        }
        return deepLink(DatabaseHubPlatform.FabricSqlDatabase, {
            environment,
            databaseResourceId: itemId,
            resourceTypes: [DatabaseHubResourceType.FabricSql],
        });
    }

    /**
     * Rows 3, 4 and 6: the Arc ID from the Arc table, or the SQL virtual machine named after the
     * machine. A local server can't be an Azure VM, so it isn't looked up there.
     */
    private async resolveSqlServer(
        profile: DatabaseHubConnectionProfile,
        facts: DatabaseHubServerFacts | undefined,
        deadline: LookupDeadline,
    ): Promise<Resolution> {
        const saved = parseArmResourceId(profile.resourceId);
        if (saved && profile.resourceId) {
            const onAzureVm =
                saved.resourceType === "microsoft.sqlvirtualmachine/sqlvirtualmachines";
            return sqlServerDeepLink(profile.resourceId, saved.subscriptionId, onAzureVm);
        }

        const arc = facts?.arc;
        if (arc?.state === "registered") {
            const parts = parseArmResourceId(arc.resourceId);
            if (parts) {
                return sqlServerDeepLink(arc.resourceId, parts.subscriptionId, arc.onAzureVm);
            }
        }

        const machineName = searchNameOf(profile, facts);
        if (!isLocalServer(profile.server)) {
            for (const accountId of await this.accounts(profile, deadline)) {
                const vmId = await this._azure.sqlVirtualMachineId(accountId, machineName);
                const parts = parseArmResourceId(vmId);
                if (vmId && parts) {
                    return sqlServerDeepLink(vmId, parts.subscriptionId, true);
                }
            }
        }

        if (arc?.state === "notRegistered") {
            return {
                platform: DatabaseHubPlatform.SqlServer,
                result: DatabaseHubResult.ArcNotRegistered,
                arcNotRegisteredServer: machineName,
                link: getDatabaseHubLink(),
            };
        }
        return this.connectionFallback(profile, undefined, facts);
    }

    /** The Azure accounts to search. A sign-in prompt doesn't count against the deadline. */
    private accounts(
        profile: DatabaseHubConnectionProfile,
        deadline: LookupDeadline,
    ): Promise<string[]> {
        return deadline.pausedFor(() => this._azure.accounts(profile.accountId));
    }

    /**
     * The telemetry properties of a request. Resources from the Azure and Fabric views have no
     * connection, so they carry the engine edition of their kind.
     */
    private telemetryOf(request: DatabaseHubRequest): ConnectionTelemetry {
        switch (request.kind) {
            case "connection":
                return this.connectionTelemetry(request.profile);
            case "azureResource":
            case "azureSubscription":
                return {
                    serverInfo: {
                        isCloud: true,
                        engineEditionId: DatabaseEngineEdition.SqlDatabase,
                    },
                };
            case "fabricItem":
                return {
                    serverInfo: {
                        isCloud: true,
                        engineEditionId: DatabaseEngineEdition.SqlDbFabric,
                    },
                };
        }
    }

    private sendEvent(
        telemetry: ConnectionTelemetry,
        source: DatabaseHubSource,
        platform: DatabaseHubPlatform,
        result: DatabaseHubResult,
    ): void {
        sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
            ...telemetry,
            additionalProps: { source, platform, result },
        });
    }
}

/** A timeout that stops while the user answers a sign-in prompt. */
class LookupDeadline {
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _disposed = false;
    private _expire: () => void = () => undefined;
    public readonly expired = new Promise<void>((resolve) => (this._expire = resolve));

    constructor(private readonly _timeoutMs: number) {
        this.start();
    }

    public async pausedFor<T>(work: () => Promise<T>): Promise<T> {
        clearTimeout(this._timer);
        try {
            return await work();
        } finally {
            this.start();
        }
    }

    public dispose(): void {
        this._disposed = true;
        clearTimeout(this._timer);
    }

    private start(): void {
        if (!this._disposed) {
            clearTimeout(this._timer);
            this._timer = setTimeout(this._expire, this._timeoutMs);
        }
    }
}

function deepLink(
    platform: DatabaseHubPlatform,
    options: Parameters<typeof getDatabaseHubLink>[0],
): Resolution {
    return { platform, result: DatabaseHubResult.DeepLinked, link: getDatabaseHubLink(options) };
}

function fallbackTo(
    platform: DatabaseHubPlatform,
    options: Parameters<typeof getDatabaseHubLink>[0],
): Resolution {
    return { platform, result: DatabaseHubResult.Fallback, link: getDatabaseHubLink(options) };
}

function systemDatabase(platform: DatabaseHubPlatform, database: string): Resolution {
    return { platform, result: DatabaseHubResult.SystemDatabase, systemDatabase: database };
}

function sqlServerDeepLink(
    resourceId: string,
    subscriptionId: string,
    onAzureVm: boolean,
): Resolution {
    return deepLink(DatabaseHubPlatform.SqlServer, {
        databaseResourceId: resourceId,
        resourceTypes: onAzureVm
            ? [DatabaseHubResourceType.AzureSqlVM]
            : [DatabaseHubResourceType.ArcSqlServer, DatabaseHubResourceType.AzureSqlVM],
        subscriptionId,
    });
}

function sameName(first: string | undefined, second: string | undefined): boolean {
    return !!first && !!second && first.toLowerCase() === second.toLowerCase();
}
