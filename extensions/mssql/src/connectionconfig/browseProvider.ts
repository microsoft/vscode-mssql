/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as vscode from "vscode";
import { l10n } from "vscode";

import {
    AzureSubscription,
    VSCodeAzureSubscriptionProvider,
} from "@microsoft/vscode-azext-azureauth";

import {
    configSelectedAzureSubscriptions,
    configSelectedFabricWorkspaces,
} from "../constants/constants";
import {
    ConnectionDialog as Loc,
    Azure as LocAzure,
    Fabric as LocFabric,
} from "../constants/locConstants";
import {
    ConnectionDialogWebviewState,
    ConnectionInputMode,
} from "../sharedInterfaces/connectionDialog";
import { SqlArtifactTypes, SqlCollectionInfo, SqlDbInfo } from "../sharedInterfaces/fabric";
import { ApiStatus, Status } from "../sharedInterfaces/webview";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

import { FabricHelper } from "../fabric/fabricHelper";
import { VsCodeAzureHelper } from "./azureHelpers";
import { Logger } from "../models/logger";
import { getCloudId } from "../azure/providerSettings";
import { startActivity } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";

/** Per-mode limit for auto-loading the contents of every collection on the current tenant. */
export const AZURE_SUBSCRIPTION_AUTOLOAD_LIMIT = 20;
/** Fabric REST API rate-limits to 50 requests/user/minute; each workspace takes three requests, so leave some headroom */
export const FABRIC_WORKSPACE_AUTOLOAD_LIMIT = 7;

/**
 * Subset of the controller surface that browse providers need to interact with.
 */
export interface BrowseProviderHost {
    /** Live state object owned by the controller; used by providers for stale-result guards. */
    readonly state: ConnectionDialogWebviewState;
    readonly logger: Logger;
    /** Push a state update to the webview. */
    updateState(state?: ConnectionDialogWebviewState): void;
    /** Refresh tenant-sign-in status data; called as part of the Azure cache priming flow. */
    refreshUnauthenticatedTenants(
        state: ConnectionDialogWebviewState,
        auth: VSCodeAzureSubscriptionProvider,
    ): Promise<void>;
}

/**
 * Common abstraction over Azure Browse and Fabric Browse flows.
 */
export abstract class BrowseProvider {
    public abstract readonly inputMode: ConnectionInputMode;
    public abstract readonly autoloadLimit: number;
    public abstract readonly favoritesConfigKey: string;

    constructor(protected readonly host: BrowseProviderHost) {}

    // #region State accessors

    public abstract getCollections(state: ConnectionDialogWebviewState): SqlCollectionInfo[];
    public abstract setCollections(
        state: ConnectionDialogWebviewState,
        collections: SqlCollectionInfo[],
    ): void;
    public abstract getCollectionsLoadStatus(state: ConnectionDialogWebviewState): Status;
    public abstract setCollectionsLoadStatus(
        state: ConnectionDialogWebviewState,
        status: Status,
    ): void;
    public abstract getFavoritedIds(state: ConnectionDialogWebviewState): string[];
    public abstract setFavoritedIds(state: ConnectionDialogWebviewState, ids: string[]): void;

    /** Reset the top-level collection list and its load status to NotStarted. */
    public clearCollectionsState(state: ConnectionDialogWebviewState): void {
        this.setCollections(state, []);
        this.setCollectionsLoadStatus(state, { status: ApiStatus.NotStarted });
    }

    // #endregion

    // #region Operations

    /** Load the top-level collections (Azure subscriptions / Fabric workspaces) for the given account+tenant. */
    public abstract loadCollections(
        state: ConnectionDialogWebviewState,
        accountId: string,
        tenantId: string,
    ): Promise<void>;

    /** Load the contents (servers/databases) of a single collection in-place. */
    public abstract loadCollectionContents(
        state: ConnectionDialogWebviewState,
        collection: SqlCollectionInfo,
    ): Promise<void>;

    /** Invalidate any upstream API caches held by this provider. */
    public abstract invalidateCache(): void;

    // #endregion

    // #region Favorites

    /**
     * Parses a single config entry into the bare collection ID. Override to handle legacy
     * composite formats.
     */
    protected parseFavoriteEntry(entry: string): string {
        return entry;
    }

    public readFavoritesFromConfig(): string[] {
        const raw = vscode.workspace.getConfiguration().get<string[]>(this.favoritesConfigKey, []);
        return raw.map((e) => this.parseFavoriteEntry(e));
    }

    public refreshFavoritesIntoState(state: ConnectionDialogWebviewState): void {
        this.setFavoritedIds(state, this.readFavoritesFromConfig());
    }

    public async toggleFavorite(
        state: ConnectionDialogWebviewState,
        collectionId: string,
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const raw = config.get<string[]>(this.favoritesConfigKey, []);
        // Migrate any legacy composite entries to the bare-ID format on write.
        const normalized = raw.map((e) => this.parseFavoriteEntry(e));
        const next = normalized.includes(collectionId)
            ? normalized.filter((id) => id !== collectionId)
            : [...normalized, collectionId];
        await config.update(this.favoritesConfigKey, next, vscode.ConfigurationTarget.Global);
        this.setFavoritedIds(state, next);
    }

    // #endregion

    /**
     * Auto-loads the contents of each collection in the current tenant using a two-wave
     * strategy:
     *   1. Favorites — always loaded.
     *   2. Remaining collections — loaded only if the total count is within `autoloadLimit`.
     */
    public async autoLoadContents(state: ConnectionDialogWebviewState): Promise<void> {
        const collections = this.getCollections(state);
        if (collections.length === 0) {
            return;
        }

        const favoritedIds = this.getFavoritedIds(state);
        const favorites = collections.filter((c) => favoritedIds.includes(c.id));
        const rest = collections.filter((c) => !favoritedIds.includes(c.id));

        // Wave 1: favorites — always auto-load, awaited so they appear before the rest start.
        await Promise.all(favorites.map((c) => this.loadCollectionContents(state, c)));

        // Wave 2: remainder — only auto-load if total count is within threshold.
        if (collections.length <= this.autoloadLimit) {
            await Promise.all(rest.map((c) => this.loadCollectionContents(state, c)));
        }
    }
}

// #region Azure

export class AzureBrowseProvider extends BrowseProvider {
    public readonly inputMode = ConnectionInputMode.AzureBrowse;
    public readonly autoloadLimit = AZURE_SUBSCRIPTION_AUTOLOAD_LIMIT;
    public readonly favoritesConfigKey = configSelectedAzureSubscriptions;

    /** Cached `AzureSubscription` instances, keyed by subscription ID, across all tenants. */
    private _subscriptionCache: Map<string, AzureSubscription> = new Map();

    public getCollections(state: ConnectionDialogWebviewState): SqlCollectionInfo[] {
        return state.azureSubscriptions;
    }
    public setCollections(state: ConnectionDialogWebviewState, c: SqlCollectionInfo[]): void {
        state.azureSubscriptions = c;
    }
    public getCollectionsLoadStatus(state: ConnectionDialogWebviewState): Status {
        return state.azureSubscriptionsLoadStatus;
    }
    public setCollectionsLoadStatus(state: ConnectionDialogWebviewState, status: Status): void {
        state.azureSubscriptionsLoadStatus = status;
    }
    public getFavoritedIds(state: ConnectionDialogWebviewState): string[] {
        return state.favoritedAzureSubscriptionIds;
    }
    public setFavoritedIds(state: ConnectionDialogWebviewState, ids: string[]): void {
        state.favoritedAzureSubscriptionIds = ids;
    }

    public invalidateCache(): void {
        this._subscriptionCache.clear();
    }

    /**
     * Strips any legacy `tenantId/` prefix from a favorites entry, returning the bare
     * subscription ID. New entries are written in bare-ID form; existing settings are
     * migrated on read and rewritten the next time the user toggles a favorite.
     */
    protected parseFavoriteEntry(entry: string): string {
        const idx = entry.lastIndexOf("/");
        return idx >= 0 ? entry.substring(idx + 1) : entry;
    }

    public async loadCollections(
        state: ConnectionDialogWebviewState,
        accountId: string,
        tenantId: string,
    ): Promise<void> {
        const telemActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureSubscriptions,
        );

        // Snapshot selection at call time to discard results if the user navigates away.
        const requestedAccountId = accountId;
        const requestedTenantId = tenantId;

        try {
            state.formMessage = undefined;
            this.setCollections(state, []);
            this.setCollectionsLoadStatus(state, { status: ApiStatus.Loading });
            this.host.updateState(state);

            const auth = await this.ensureSubscriptionCache(state);
            if (!auth) {
                this.setCollectionsLoadStatus(state, { status: ApiStatus.Error });
                return;
            }

            if (
                this.host.state.selectedAccountId !== requestedAccountId ||
                this.host.state.selectedTenantId !== requestedTenantId
            ) {
                return;
            }

            const subsForTenant = Array.from(this._subscriptionCache.values()).filter(
                (s) => s.tenantId === tenantId,
            );

            this.setCollections(
                state,
                subsForTenant.map((s) => ({
                    id: s.subscriptionId,
                    displayName: s.name,
                    tenantId: s.tenantId,
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                })),
            );
            this.setCollectionsLoadStatus(state, {
                status: ApiStatus.Loaded,
                message: subsForTenant.length === 0 ? Loc.noSubscriptionsFound : undefined,
            });
            this.refreshFavoritesIntoState(state);
            this.host.updateState(state);

            this.host.logger.log(
                `Loaded ${subsForTenant.length} Azure subscriptions for tenant ${tenantId}`,
            );

            telemActivity.end(ActivityStatus.Succeeded, undefined, {
                subscriptionCount: subsForTenant.length,
            });
        } catch (error) {
            state.formMessage = { message: l10n.t("Error loading Azure subscriptions.") };
            this.setCollectionsLoadStatus(state, {
                status: ApiStatus.Error,
                message: getErrorMessage(error),
            });
            this.host.logger.error(state.formMessage.message + os.EOL + getErrorMessage(error));
            telemActivity.endFailed(
                error,
                false, // includeErrorMessage
            );
        }
    }

    public async loadCollectionContents(
        state: ConnectionDialogWebviewState,
        subscription: SqlCollectionInfo,
    ): Promise<void> {
        const telemActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureDatabases,
        );

        const azSub = this._subscriptionCache.get(subscription.id);
        if (!azSub) {
            subscription.loadStatus = {
                status: ApiStatus.Error,
                message: l10n.t("Azure subscription not found in cache."),
            };
            this.host.updateState(state);
            return;
        }

        subscription.loadStatus = { status: ApiStatus.Loading };
        this.host.updateState(state);

        try {
            const servers = await VsCodeAzureHelper.fetchServersFromAzure(azSub);
            subscription.databases = servers.map((s) => ({
                ...s,
                collectionId: subscription.id,
                collectionName: subscription.displayName,
                tenantId: subscription.tenantId,
            }));
            subscription.databases.sort((a, b) =>
                (a.displayName ?? a.server ?? "").localeCompare(b.displayName ?? b.server ?? ""),
            );
            subscription.loadStatus = { status: ApiStatus.Loaded };
            this.host.updateState(state);
            this.host.logger.log(
                `Loaded ${servers.length} servers for subscription ${azSub.name} (${azSub.subscriptionId})`,
            );

            telemActivity.end(ActivityStatus.Succeeded, undefined, {
                serverCount: servers.length,
            });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.host.logger.error(
                `Error loading servers for Azure subscription ${azSub.name} (${azSub.subscriptionId}): ${errorMessage}`,
            );

            subscription.loadStatus = { status: ApiStatus.Error, message: errorMessage };
            this.host.updateState(state);

            telemActivity.endFailed(
                error,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    cloudType: getCloudId(),
                },
            );
        }
    }

    /**
     * Ensures the subscription cache is populated and the user has signed in.
     * Returns the auth provider on success, or `undefined` if sign-in failed.
     */
    private async ensureSubscriptionCache(
        state: ConnectionDialogWebviewState,
    ): Promise<VSCodeAzureSubscriptionProvider | undefined> {
        let auth: VSCodeAzureSubscriptionProvider;
        try {
            auth = (await VsCodeAzureHelper.signIn()).auth;
        } catch (error) {
            state.formMessage = {
                message: LocAzure.errorSigningIntoAzure(getErrorMessage(error)),
            };
            return undefined;
        }

        if (this._subscriptionCache.size === 0) {
            await this.host.refreshUnauthenticatedTenants(state, auth);
            this.host.updateState(state);

            this._subscriptionCache = new Map(
                (await auth.getSubscriptions(false)).map((s) => [s.subscriptionId, s]),
            );
        }

        return auth;
    }
}

// #endregion

// #region Fabric

export class FabricBrowseProvider extends BrowseProvider {
    public readonly inputMode = ConnectionInputMode.FabricBrowse;
    public readonly autoloadLimit = FABRIC_WORKSPACE_AUTOLOAD_LIMIT;
    public readonly favoritesConfigKey = configSelectedFabricWorkspaces;

    /** Cached workspace lists keyed by `accountId|tenantId`. */
    private _workspaceCache: Map<string, { id: string; displayName: string; tenantId: string }[]> =
        new Map();

    public getCollections(state: ConnectionDialogWebviewState): SqlCollectionInfo[] {
        return state.fabricWorkspaces;
    }
    public setCollections(state: ConnectionDialogWebviewState, c: SqlCollectionInfo[]): void {
        state.fabricWorkspaces = c;
    }
    public getCollectionsLoadStatus(state: ConnectionDialogWebviewState): Status {
        return state.fabricWorkspacesLoadStatus;
    }
    public setCollectionsLoadStatus(state: ConnectionDialogWebviewState, status: Status): void {
        state.fabricWorkspacesLoadStatus = status;
    }
    public getFavoritedIds(state: ConnectionDialogWebviewState): string[] {
        return state.favoritedFabricWorkspaceIds;
    }
    public setFavoritedIds(state: ConnectionDialogWebviewState, ids: string[]): void {
        state.favoritedFabricWorkspaceIds = ids;
    }

    public invalidateCache(): void {
        this._workspaceCache.clear();
    }

    public async loadCollections(
        state: ConnectionDialogWebviewState,
        accountId: string,
        tenantId: string,
    ): Promise<void> {
        const telemActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadFabricWorkspaces,
        );

        // Snapshot selection at call time to discard results if the user navigates away.
        const requestedAccountId = accountId;
        const requestedTenantId = tenantId;
        const cacheKey = `${accountId}|${tenantId}`;

        try {
            this.setCollections(state, []);
            this.setCollectionsLoadStatus(state, { status: ApiStatus.Loading });
            this.host.updateState(state);

            const vscodeAccount = await VsCodeAzureHelper.getAccountById(accountId);
            const tenant = await VsCodeAzureHelper.getTenant(vscodeAccount, tenantId);

            if (!tenant) {
                const message = `Failed to get tenant '${tenantId}' for account '${vscodeAccount.label}'.`;
                const locMessage = LocAzure.failedToGetTenantForAccount(
                    tenantId,
                    vscodeAccount.label,
                );

                this.host.logger.error(message);
                this.setCollectionsLoadStatus(state, {
                    status: ApiStatus.Error,
                    message: locMessage,
                });

                telemActivity.endFailed(
                    new Error(
                        "Failed to get tenant info from VS Code; may have been user-canceled.",
                    ),
                    true, // includeErrorMessage
                );
                return;
            }

            let cachedWorkspaces = this._workspaceCache.get(cacheKey);
            if (!cachedWorkspaces) {
                try {
                    const workspaces = await FabricHelper.getFabricWorkspaces(tenant.tenantId);
                    cachedWorkspaces = workspaces.map((w) => ({
                        id: w.id,
                        displayName: w.displayName,
                        tenantId: tenant.tenantId,
                    }));
                    this._workspaceCache.set(cacheKey, cachedWorkspaces);
                } catch (err) {
                    const message = `Failed to get Fabric workspaces for tenant '${tenant.displayName} (${tenant.tenantId})': ${getErrorMessage(err)}`;
                    const locMessage = LocFabric.failedToGetWorkspacesForTenant(
                        tenant.displayName,
                        tenant.tenantId,
                        getErrorMessage(err),
                    );

                    this.host.logger.error(message);
                    this.setCollectionsLoadStatus(state, {
                        status: ApiStatus.Error,
                        message: locMessage,
                    });

                    telemActivity.endFailed(
                        new Error("Failed to fetch Fabric workspaces"),
                        true, // includeErrorMessage
                    );
                    return;
                }
            }

            if (
                this.host.state.selectedAccountId !== requestedAccountId ||
                this.host.state.selectedTenantId !== requestedTenantId
            ) {
                return;
            }

            this.setCollections(
                state,
                cachedWorkspaces.map((w) => ({
                    id: w.id,
                    displayName: w.displayName,
                    tenantId: w.tenantId,
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                })),
            );
            this.setCollectionsLoadStatus(state, {
                status: ApiStatus.Loaded,
                message: cachedWorkspaces.length === 0 ? Loc.noWorkspacesFound : undefined,
            });
            this.refreshFavoritesIntoState(state);
            this.host.updateState(state);

            this.host.logger.log(
                `Loaded ${cachedWorkspaces.length} Fabric workspaces for tenant ${tenantId}`,
            );

            telemActivity.end(ActivityStatus.Succeeded, undefined, {
                workspaceCount: cachedWorkspaces.length,
            });
        } catch (err) {
            state.formMessage = { message: getErrorMessage(err) };

            telemActivity.endFailed(
                new Error("Failure while getting Fabric workspaces"),
                true, // includeErrorMessage
            );
        }
    }

    public async loadCollectionContents(
        state: ConnectionDialogWebviewState,
        workspace: SqlCollectionInfo,
    ): Promise<void> {
        const telemActivity = startActivity(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadFabricDatabases,
        );

        workspace.loadStatus = { status: ApiStatus.Loading };
        this.host.updateState(state);

        try {
            const databases: SqlDbInfo[] = [];
            const errorMessages: string[] = [];

            try {
                databases.push(
                    ...(await FabricHelper.getFabricDatabases(workspace.id, workspace.tenantId)),
                );
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                this.host.logger.error(
                    `Error loading Fabric databases for workspace ${workspace.id}: ${errorMessage}`,
                );
                errorMessages.push(errorMessage);
            }

            const sqlDbCount = databases.length;
            const sqlDbErrored = errorMessages.length > 0;

            try {
                databases.push(
                    ...(await FabricHelper.getFabricSqlEndpoints(workspace.id, workspace.tenantId)),
                );
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                this.host.logger.error(
                    `Error loading Fabric SQL endpoints for workspace ${workspace.id}: ${errorMessage}`,
                );
                errorMessages.push(errorMessage);
            }

            const sqlEndpointCount = databases.length - sqlDbCount;
            const sqlEndpointErrored = errorMessages.length > (sqlDbErrored ? 1 : 0);

            try {
                databases.push(
                    ...(await FabricHelper.getFabricWarehouses(workspace.id, workspace.tenantId)),
                );
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                this.host.logger.error(
                    `Error loading Fabric warehouses for workspace ${workspace.id}: ${errorMessage}`,
                );
                errorMessages.push(errorMessage);
            }

            workspace.databases = databases.map((db) => ({
                id: db.id,
                databases: db.databases,
                displayName: db.displayName,
                server: db.server,
                type: db.type,
                collectionId: workspace.id,
                collectionName: workspace.displayName,
                tenantId: workspace.tenantId,
            }));

            workspace.databases.sort((a, b) => a.displayName.localeCompare(b.displayName));

            workspace.loadStatus =
                errorMessages.length > 0
                    ? { status: ApiStatus.Error, message: errorMessages.join("\n") }
                    : { status: ApiStatus.Loaded };

            const totalCount = workspace.databases.length;
            const warehouseCount = totalCount - sqlDbCount - sqlEndpointCount;
            this.host.logger.log(
                `Loaded ${sqlDbCount} Fabric databases, ${sqlEndpointCount} SQL endpoints, and ${warehouseCount} warehouses for workspace ${workspace.id}`,
            );

            telemActivity.end(
                ActivityStatus.Succeeded,
                {
                    sqlDbErrored: String(sqlDbErrored),
                    sqlAnalyticsEndpointErrored: String(sqlEndpointErrored),
                    warehouseErrored: String(
                        errorMessages.length -
                            (sqlDbErrored ? 1 : 0) -
                            (sqlEndpointErrored ? 1 : 0),
                    ),
                },
                {
                    sqlDbCount,
                    sqlAnalyticsEndpointCount: sqlEndpointCount,
                    warehouseCount,
                },
            );

            this.host.updateState(state);
        } catch (err) {
            const errorMessage = getErrorMessage(err);
            this.host.logger.error(
                `Error loading Fabric databases for workspace ${workspace.id}: ${errorMessage}`,
            );
            workspace.loadStatus = { status: ApiStatus.Error, message: errorMessage };

            telemActivity.endFailed(
                err,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
            );
        }
    }
}

// #endregion

// Re-export so callers don't need to also import from the fabric shared types module.
export { SqlArtifactTypes };
