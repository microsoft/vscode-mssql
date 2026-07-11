/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    AzureSubscription,
    AzureTenant,
    getConfiguredAuthProviderId,
    getUnauthenticatedTenants,
    signInToTenant,
    VSCodeAzureSubscriptionProvider,
} from "@microsoft/vscode-azext-azureauth";
import * as LocalizedConstants from "../constants/locConstants";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { IAccount, ITenant } from "../models/contracts/azure";
import { FormItemOptions } from "../sharedInterfaces/form";
import { AzureAccountService } from "../services/azureAccountService";
import {
    AuthenticationType,
    AzureSqlServerInfo,
    ConnectionDialogWebviewState,
} from "../sharedInterfaces/connectionDialog";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage, listAllIterator } from "../utils/utils";
import {
    activeDirectory,
    configSelectedAzureSubscriptions,
    https,
    user,
} from "../constants/constants";
import { ILogger } from "../sharedInterfaces/logger";
import logger from "../models/logger";
import { groupQuickPickItems, MssqlQuickPickItem } from "../utils/quickpickHelpers";
import {
    AlwaysEncryptedEnclaveType,
    Database,
    FirewallRule,
    KnownFreeLimitExhaustionBehavior,
    KnownSampleName,
    ManagedDatabase,
    ManagedInstance,
    Server,
    SqlManagementClient,
    TrackedResource,
} from "@azure/arm-sql";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import {
    BlobContainer,
    StorageAccount,
    StorageAccountsListKeysResponse,
    StorageManagementClient,
} from "@azure/arm-storage";
import { ResourceManagementClient, ResourceGroup } from "@azure/arm-resources";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import {
    BlobServiceClient,
    ContainerClient,
    BlobItem,
    StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { MaintenanceManagementClient, MaintenanceConfiguration } from "@azure/arm-maintenance";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
    VscodeEntraSqlTokenInfo,
} from "../azure/vscodeEntraMfaUtils";
import { IConnectionInfo } from "vscode-mssql";

export const azureSubscriptionFilterConfigKey = "mssql.selectedAzureSubscriptions";
export const MANAGED_INSTANCE_PUBLIC_PORT = 3342;
const azureHelperLogger = logger.withPrefix("Azure Helpers");
const azureSqlServerSuffix = ".database.";

//#region VS Code integration

let _azureProvider: VSCodeAzureSubscriptionProvider | undefined;

/** Key statuses for Azure SQL databases.  Any status not included here is considered non-retryable. */
export type AzureSqlDatabaseStatus = "Paused" | "Pausing" | "Resuming" | "Online" | "UnableToCheck";

export const azureStatusesToRetry: AzureSqlDatabaseStatus[] = ["Paused", "Pausing", "Resuming"];

/**
 * Location of an Azure SQL logical server resource, resolved from an account + server name. This
 * is the expensive-to-compute, stable part of a pause-status check (finding which subscription and
 * resource group a server lives in), so it is cached and reused across status checks.
 */
export interface SqlServerResourceInfo {
    accountId: string;
    subscriptionId: string;
    resourceGroup: string;
}

export class VsCodeAzureHelper {
    /**
     * Cache of Azure SQL server resource lookups, keyed by `${accountId}|${serverName}`. Stores the
     * in-flight/resolved promise so concurrent callers share one lookup and resolved results
     * (including "UnableToCheck") are reused instead of re-scanning every subscription each time.
     */
    private static readonly _sqlResourceCache = new Map<
        string,
        Promise<SqlServerResourceInfo | "UnableToCheck">
    >();

    /**
     * Returns the singleton `VSCodeAzureSubscriptionProvider` instance used for all Azure auth operations.
     */
    public static getProvider(): VSCodeAzureSubscriptionProvider {
        _azureProvider ??= new VSCodeAzureSubscriptionProvider();
        return _azureProvider;
    }

    /**
     * Retrieves the list of Azure accounts available to MSSQL in the current VS Code session.
     */
    public static async getAccounts(
        onlyAllowedForExtension: boolean = true,
    ): Promise<vscode.AuthenticationSessionAccountInformation[]> {
        let accounts = [];

        try {
            accounts = Array.from(
                await vscode.authentication.getAccounts(getConfiguredAuthProviderId()),
            ).sort((a, b) => a.label.localeCompare(b.label));
        } catch (error) {
            azureHelperLogger.error(`Error fetching VS Code accounts: ${getErrorMessage(error)}`);
        }

        if (onlyAllowedForExtension) {
            // Filter out accounts that throw when fetching tenants, which indicates that the user hasn't given the MSSQL extension access to this account
            const filteredAccounts = [];
            for (const account of accounts) {
                try {
                    const tenants = await VsCodeAzureHelper.getProvider().getTenants(account);
                    if (tenants.length > 0) {
                        filteredAccounts.push(account);
                    } else {
                        azureHelperLogger.warn(
                            `No tenants found for account ${account.label}; this may indicate that the MSSQL extension does not have permission to use this account.`,
                        );
                    }
                } catch (error) {
                    // no-op; failure to get tenants means that the account is not accessible by this extension
                    azureHelperLogger.warn(
                        `Error fetching tenants for ${account.label}; this may indicate that the MSSQL extension does not have permission to use this account. Error: ${getErrorMessage(error)}`,
                    );
                }
            }
            return filteredAccounts;
        } else {
            return accounts;
        }
    }

    public static async getAccountById(
        accountId: string,
    ): Promise<vscode.AuthenticationSessionAccountInformation> {
        const accounts = await this.getAccounts();
        return accounts.find((a) => a.id === accountId);
    }

    public static async getAccountByName(
        accountName: string,
    ): Promise<vscode.AuthenticationSessionAccountInformation> {
        const accounts = await this.getAccounts();
        return accounts.find((a) => a.label === accountName);
    }

    /**
     * Checks to see if the user is signed into VS Code with an Azure account
     * @returns true if the user is signed in, false otherwise
     */
    public static async isSignedIn(): Promise<boolean> {
        return await VsCodeAzureHelper.getProvider().isSignedIn();
    }

    /**
     * Prompts the user to sign in to Azure if they are not already signed in
     * @param forceSignInPrompt - If true, the user will be prompted, even if they are already signed in to an account. Defaults to false.
     * @returns auth object if the user signs in or is already signed in.
     * @throws Error if the sign-in is canceled or fails.
     */
    public static async signIn(
        forceSignInPrompt: boolean = false,
    ): Promise<{ auth: VSCodeAzureSubscriptionProvider; newAccountId: string | undefined }> {
        const auth: VSCodeAzureSubscriptionProvider = VsCodeAzureHelper.getProvider();

        if (forceSignInPrompt || !(await auth.isSignedIn())) {
            const accountsBefore = new Set(
                (await VsCodeAzureHelper.getAccounts()).map((a) => a.id),
            );

            const result = await auth.signIn();

            if (!result) {
                throw new Error("Azure sign-in was canceled or failed.");
            }

            const accountsAfter = await VsCodeAzureHelper.getAccounts();
            const newAccount = accountsAfter.find((a) => !accountsBefore.has(a.id));

            return { auth, newAccountId: newAccount?.id ?? accountsAfter[0]?.id };
        }

        // Already signed in — return the first available account
        const accounts = await VsCodeAzureHelper.getAccounts();
        return { auth, newAccountId: accounts[0]?.id };
    }

    public static getHomeTenantIdForAccount(
        account: vscode.AuthenticationSessionAccountInformation | string,
    ): string | undefined {
        const accountId = typeof account === "string" ? account : account.id;

        if (accountId?.includes(".")) {
            return accountId.split(".")[1]; // account ID takes the format <accountID>.<homeTenantID>
        }

        return undefined;
    }

    /**
     * Gets the user's Object ID (OID) from the subscription's authentication session token.
     * The OID in the token reflects the user's identity in the target tenant, which is
     * required for setting up Entra admin when Azure SQL servers.
     * Falls back to parsing the first segment of the account ID if token decode fails.
     */
    public static async getAccountObjectId(
        subscription: AzureSubscription,
        account?: { id: string },
    ): Promise<string | undefined> {
        try {
            const session = await subscription.authentication.getSession();
            if (session?.accessToken) {
                const tokenParts = session.accessToken.split(".");
                if (tokenParts.length >= 2) {
                    const tokenBody = tokenParts[1].replace(/-/g, "+").replace(/_/g, "/");
                    const claims = JSON.parse(Buffer.from(tokenBody, "base64").toString("utf8"));
                    if (claims.oid) {
                        return claims.oid;
                    }
                }
            }
        } catch {
            // Fall through to fallback
        }

        // Fall back to parsing the first segment of the account ID
        return account?.id?.split(".")[0];
    }

    /**
     * Gets the tenants available for a specific Azure account
     * @param account The account to get tenants for
     * @returns Array of tenant information
     */
    public static async getTenantsForAccount(
        account: vscode.AuthenticationSessionAccountInformation | string,
    ): Promise<AzureTenant[]> {
        try {
            account = typeof account === "string" ? await this.getAccountById(account) : account;

            const auth: VSCodeAzureSubscriptionProvider = VsCodeAzureHelper.getProvider();
            const tenants = [...(await auth.getTenants(account))]; // spread operator to create a new array since sort() mutates the array

            return tenants.sort((a, b) => a.displayName.localeCompare(b.displayName));
        } catch (error) {
            azureHelperLogger.error("Error fetching tenants for account", getErrorMessage(error));
            return [];
        }
    }

    public static async getTenant(
        account: vscode.AuthenticationSessionAccountInformation | string,
        tenantId: string,
    ): Promise<AzureTenant> {
        const tenants = await this.getTenantsForAccount(account);
        return tenants.find((t) => t.tenantId === tenantId);
    }

    /**
     * Gets the subscriptions available for a specific Azure tenant
     * @param tenant The tenant to get subscriptions for
     * @returns Array of subscription information
     */
    public static async getSubscriptionsForTenant(
        tenant: AzureTenant,
    ): Promise<AzureSubscription[]> {
        const allSubs = await VsCodeAzureHelper.getProvider().getSubscriptions(false);
        // Filter subscriptions by tenant
        const subs = allSubs.filter((sub) => sub.tenantId === tenant.tenantId);
        return subs;
    }

    public static async getSubscriptionsForAccount(
        account: vscode.AuthenticationSessionAccountInformation | string,
    ): Promise<AzureSubscription[]> {
        const accountInfo =
            typeof account === "string" ? await this.getAccountById(account) : account;
        const tenants = await this.getTenantsForAccount(accountInfo);
        const tenantIds = new Set(tenants.map((t) => t.tenantId));
        const allSubs = await VsCodeAzureHelper.getProvider().getSubscriptions(false);
        return allSubs.filter((sub) => tenantIds.has(sub.tenantId));
    }

    /**
     * Gets the resource groups available for a specific Azure subscription
     * @param subscription The subscription to get resource groups for
     * @returns Array of resource group names sorted alphabetically
     */
    public static async getResourceGroupsForSubscription(
        subscription: AzureSubscription,
    ): Promise<string[]> {
        try {
            const client = new ResourceManagementClient(
                subscription.credential,
                subscription.subscriptionId,
                {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                },
            );
            const groups = await listAllIterator(client.resourceGroups.list());
            return groups
                .map((g) => g.name ?? "")
                .filter((name) => name !== "")
                .sort((a, b) => a.localeCompare(b));
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching resource groups for subscription",
                getErrorMessage(error),
            );
            return [];
        }
    }

    public static async getDefaultLocationForResourceGroup(
        resourceGroupName: string,
        subscription: AzureSubscription,
    ): Promise<string> {
        try {
            const client = new ResourceManagementClient(
                subscription.credential,
                subscription.subscriptionId,
                {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                },
            );
            const rg = await client.resourceGroups.get(resourceGroupName);
            return rg.location;
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching default location for resource group",
                getErrorMessage(error),
            );
            return "";
        }
    }

    /**
     * Fetches available Azure locations for a subscription.
     */
    public static async getLocationsForSubscription(
        subscription: AzureSubscription,
    ): Promise<{ name: string; displayName: string }[]> {
        try {
            const client = new SubscriptionClient(subscription.credential, {
                endpoint: getCloudProviderSettings().settings.armResource.endpoint,
            });
            const locations = await listAllIterator(
                client.subscriptions.listLocations(subscription.subscriptionId),
            );
            return locations
                .map((loc) => ({
                    name: loc.name ?? "",
                    displayName: loc.displayName ?? loc.name ?? "",
                }))
                .filter((loc) => loc.name !== "")
                .sort((a, b) => a.displayName.localeCompare(b.displayName));
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching locations for subscription",
                getErrorMessage(error),
            );
            return [];
        }
    }

    /**
     * Creates a new resource group in the given subscription and location.
     */
    public static async createResourceGroup(
        subscription: AzureSubscription,
        resourceGroupName: string,
        location: string,
        tags?: Record<string, string>,
    ): Promise<ResourceGroup> {
        const client = new ResourceManagementClient(
            subscription.credential,
            subscription.subscriptionId,
            {
                endpoint: getCloudProviderSettings().settings.armResource.endpoint,
            },
        );
        return client.resourceGroups.createOrUpdate(resourceGroupName, {
            location,
            tags: tags && Object.keys(tags).length > 0 ? tags : undefined,
        });
    }

    /**
     * Fetches the SQL servers within a given resource group.
     */
    public static async getSqlServersForResourceGroup(
        subscription: AzureSubscription,
        resourceGroupName: string,
    ): Promise<Server[]> {
        try {
            const sql = new SqlManagementClient(
                subscription.credential,
                subscription.subscriptionId,
                {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                },
            );
            const servers = await listAllIterator(
                sql.servers.listByResourceGroup(resourceGroupName),
            );

            return servers.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching logical servers for resource group",
                getErrorMessage(error),
            );
            return [];
        }
    }

    /**
     * Uses the Azure ARM API to check the wake status of a database. All failures are logged and
     * swallowed, returning "UnableToCheck".
     *
     * The (expensive) server-to-subscription/resource-group lookup is delegated to
     * {@link findSqlResource}, which is cached, so repeated status checks for the same server only
     * pay for the live `databases.get` status call.
     *
     * @param connection the connection being attempted.
     * @param database optional database name override, used when the database being accessed differs
     *   from the connection's database (e.g. expanding a  database node on a server connection).
     * @param source short label identifying the caller who initiated the check
     */
    public static async getAzureSqlDatabaseStatus(
        connection: IConnectionInfo,
        database?: string,
        source?: string,
    ): Promise<AzureSqlDatabaseStatus> {
        const databaseName = database ?? connection.database;
        const serverName = this.getAzureSqlServerName(connection.server);
        const accountId = connection.accountId;

        const target = `"${databaseName ?? connection.database}" on "${connection.server}"`;
        const sourceSuffix = source ? ` [${source}]` : "";

        if (!accountId || !serverName || !databaseName) {
            azureHelperLogger.trace(
                `Pause status check ${sourceSuffix}: could not determine status for ${target}`,
            );
            return "UnableToCheck";
        }

        // Resolve (from cache when possible) which subscription/resource group the server lives in.
        const resource = await this.findSqlResource(accountId, serverName);
        if (resource === "UnableToCheck") {
            azureHelperLogger.trace(
                `Pause status check ${sourceSuffix}: server for ${target} could not be located for user ${accountId}`,
            );
            return "UnableToCheck";
        }

        try {
            const subscriptions = await this.getSubscriptionsForAccount(accountId);
            const subscription = subscriptions.find(
                (sub) => sub.subscriptionId === resource.subscriptionId,
            );

            if (!subscription) {
                azureHelperLogger.trace(
                    `Pause status check ${sourceSuffix}: subscription ${resource.subscriptionId} for ${target} is no longer available to user ${accountId}`,
                );
                return "UnableToCheck";
            }

            const sql = new SqlManagementClient(
                subscription.credential,
                subscription.subscriptionId,
                {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                },
            );

            const dbResource = await sql.databases.get(
                resource.resourceGroup,
                serverName,
                databaseName,
            );

            azureHelperLogger.trace(
                `Pause check ${sourceSuffix}: database ${target} is ${dbResource.status}`,
            );

            return (dbResource?.status as AzureSqlDatabaseStatus) ?? "UnableToCheck";
        } catch (err) {
            azureHelperLogger.trace(
                `Pause check ${sourceSuffix}: error occurred while checking database ${target}; exiting. ${getErrorMessage(err)}`,
            );

            return "UnableToCheck";
        }
    }

    /**
     * Finds which subscription and resource group an Azure SQL logical server belongs to for the
     * given account, by scanning the account's subscriptions. The result (including "UnableToCheck"
     * when the server can't be located) is cached by `${accountId}|${serverName}`, and concurrent
     * lookups share a single in-flight promise, so the expensive per-subscription server scan runs
     * at most once per server per session.
     *
     * @param accountId the Azure account to search within.
     * @param serverName the Azure SQL logical server name (without the `.database.*` suffix).
     */
    public static findSqlResource(
        accountId: string,
        serverName: string,
    ): Promise<SqlServerResourceInfo | "UnableToCheck"> {
        const cacheKey = `${accountId}|${serverName.toLowerCase()}`;

        const cached = this._sqlResourceCache.get(cacheKey);
        if (cached) {
            azureHelperLogger.trace(
                `SQL resource lookup: cache hit for server "${serverName}" (user ${accountId})`,
            );
            return cached;
        }

        azureHelperLogger.trace(
            `SQL resource lookup: cache miss for server "${serverName}" (user ${accountId}); searching subscriptions`,
        );

        // The worker never rejects (all failures resolve to "UnableToCheck"), so the cached promise
        // is always safe to reuse.
        const lookup = this.searchForSqlResource(accountId, serverName);
        this._sqlResourceCache.set(cacheKey, lookup);
        return lookup;
    }

    /**
     * Clears the cached {@link findSqlResource} lookups. Useful when account/subscription
     * membership may have changed, and for keeping unit tests isolated from one another.
     */
    public static clearSqlResourceCache(): void {
        azureHelperLogger.trace("SQL resource lookup: clearing cache");
        this._sqlResourceCache.clear();
    }

    private static async searchForSqlResource(
        accountId: string,
        serverName: string,
    ): Promise<SqlServerResourceInfo | "UnableToCheck"> {
        try {
            azureHelperLogger.trace(
                `SQL resource lookup: searching for '${serverName}' in account '${accountId}'`,
            );

            const subscriptions = await this.getSubscriptionsForAccount(accountId);

            for (const subscription of subscriptions) {
                try {
                    const sql = new SqlManagementClient(
                        subscription.credential,
                        subscription.subscriptionId,
                        {
                            endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                        },
                    );

                    const servers = await listAllIterator(sql.servers.list());
                    const matchingServer = servers.find(
                        (server) => server.name?.toLowerCase() === serverName.toLowerCase(),
                    );

                    if (!matchingServer?.id) {
                        continue;
                    }

                    const resourceGroup = extractFromResourceId(
                        matchingServer.id,
                        "resourceGroups",
                    );
                    if (!resourceGroup) {
                        continue;
                    }

                    azureHelperLogger.trace(
                        `SQL resource lookup: found server "${serverName}" in subscription ${subscription.subscriptionId}, resource group ${resourceGroup} (user ${accountId})`,
                    );

                    return {
                        accountId,
                        subscriptionId: subscription.subscriptionId,
                        resourceGroup,
                    };
                } catch (err) {
                    azureHelperLogger.trace(
                        `SQL resource lookup: error searching subscription ${subscription.subscriptionId} for server "${serverName}"; continuing... ${getErrorMessage(err)}`,
                    );

                    continue;
                }
            }
        } catch (err) {
            azureHelperLogger.trace(
                `SQL resource lookup: error searching for server "${serverName}"; exiting. ${getErrorMessage(err)}`,
            );

            return "UnableToCheck";
        }

        azureHelperLogger.trace(
            `SQL resource lookup: server "${serverName}" could not be found for user ${accountId}`,
        );

        return "UnableToCheck";
    }

    private static getAzureSqlServerName(server: string | undefined): string | undefined {
        if (!server) {
            return undefined;
        }

        const serverWithoutPort = server.split(",")[0].trim().toLowerCase();
        const azureSqlSuffixIndex = serverWithoutPort.indexOf(azureSqlServerSuffix);
        return azureSqlSuffixIndex > 0
            ? serverWithoutPort.substring(0, azureSqlSuffixIndex)
            : undefined;
    }

    /**
     * Creates or updates an Azure SQL Database using the ARM SDK.
     * @returns The created/updated database resource.
     */
    public static async createAzureSqlDatabase(
        subscription: AzureSubscription,
        resourceGroupName: string,
        serverName: string,
        databaseName: string,
        options: {
            sampleName?: KnownSampleName;
            collation?: string;
            preferredEnclaveType?: AlwaysEncryptedEnclaveType;
            maintenanceConfigurationId?: string;
            tags?: {
                [propertyName: string]: string;
            };
            freeLimitExhaustionBehavior?: KnownFreeLimitExhaustionBehavior;
            useFreeLimit?: boolean;
            maxVcores?: string;
        },
    ): Promise<Database> {
        const sql = new SqlManagementClient(subscription.credential, subscription.subscriptionId, {
            endpoint: getCloudProviderSettings().settings.armResource.endpoint,
        });

        const server = await sql.servers.get(resourceGroupName, serverName);

        const skuName = options.maxVcores ? `GP_S_Gen5_${options.maxVcores}` : "GP_S_Gen5";

        const freeOfferOptions = options.useFreeLimit
            ? {
                  sku: {
                      name: skuName,
                      tier: "GeneralPurpose",
                      family: "Gen5",
                      capacity: options.maxVcores ? Number(options.maxVcores) : 2,
                  },
                  autoPauseDelay: 60,
                  minCapacity: 0.5,
                  requestedBackupStorageRedundancy: "Local",
              }
            : {};

        const poller = await sql.databases.beginCreateOrUpdate(
            resourceGroupName,
            serverName,
            databaseName,
            { ...options, ...freeOfferOptions, location: server.location },
        );
        return poller.pollUntilDone();
    }

    /**
     * Creates a new Azure SQL Server using the ARM SDK.
     */
    public static async createSqlServer(
        subscription: AzureSubscription,
        resourceGroupName: string,
        serverName: string,
        location: string,
        authConfig: {
            authenticationType: string;
            adminLogin?: string;
            adminPassword?: string;
            entraAdmin?: {
                login: string;
                sid: string;
                tenantId: string;
                principalType?: string;
            };
        },
    ): Promise<Server> {
        const sql = new SqlManagementClient(subscription.credential, subscription.subscriptionId, {
            endpoint: getCloudProviderSettings().settings.armResource.endpoint,
        });

        const serverParams: Server = { location };

        if (authConfig.authenticationType !== AuthenticationType.AzureMFA) {
            serverParams.administratorLogin = authConfig.adminLogin;
            serverParams.administratorLoginPassword = authConfig.adminPassword;
        }

        if (authConfig.authenticationType !== AuthenticationType.SqlLogin) {
            serverParams.administrators = {
                administratorType: activeDirectory,
                principalType: authConfig.entraAdmin?.principalType ?? user,
                azureADOnlyAuthentication:
                    authConfig.authenticationType === AuthenticationType.AzureMFA,
                login: authConfig.entraAdmin?.login,
                sid: authConfig.entraAdmin?.sid,
                tenantId: authConfig.entraAdmin?.tenantId,
            };
        }

        const poller = await sql.servers.beginCreateOrUpdate(
            resourceGroupName,
            serverName,
            serverParams,
        );
        return poller.pollUntilDone();
    }

    /**
     * Creates a firewall rule on an Azure SQL Server using the ARM SDK directly,
     * bypassing the STS server-name lookup that can fail for newly created servers.
     */
    public static async createFirewallRule(
        subscription: AzureSubscription,
        resourceGroupName: string,
        serverName: string,
        ruleName: string,
        startIpAddress: string,
        endIpAddress: string,
    ): Promise<FirewallRule> {
        const sql = new SqlManagementClient(subscription.credential, subscription.subscriptionId, {
            endpoint: getCloudProviderSettings().settings.armResource.endpoint,
        });

        return sql.firewallRules.createOrUpdate(resourceGroupName, serverName, ruleName, {
            startIpAddress,
            endIpAddress,
        });
    }

    public static async fetchSqlResourcesForSubscription<
        TServer extends TrackedResource,
        TDatabase extends TrackedResource,
    >(
        sub: AzureSubscription,
        listServers: (
            sqlManagementClient: SqlManagementClient,
        ) => () => PagedAsyncIterableIterator<TServer>,
        listDatabases: (
            sqlManagementClient: SqlManagementClient,
        ) => (
            resourceGroupName: string,
            serverName: string,
        ) => PagedAsyncIterableIterator<TDatabase>,
    ): Promise<{
        servers: TServer[];
        databases: (TDatabase & { server: string })[];
    }> {
        const sql = new SqlManagementClient(sub.credential, sub.subscriptionId, {
            endpoint: getCloudProviderSettings().settings.armResource.endpoint,
        });

        const servers = await listAllIterator(listServers(sql)());
        const databases: (TDatabase & { server: string })[] = [];

        for (const server of servers) {
            const newDbs = await listAllIterator(
                listDatabases(sql)(extractFromResourceId(server.id, "resourceGroups"), server.name),
            );

            databases.push(
                ...newDbs.map((db) => {
                    return {
                        ...db,
                        server: server.name, // add server name to database for later use
                    };
                }),
            );
        }

        return { servers, databases };
    }

    /**
     * Fetches the Azure SQL servers and databases (including Managed Instances) for a given subscription.
     * Managed Instances with public endpoints enabled have separate entries for public and private endpoints.
     */
    public static async fetchServersFromAzure(
        sub: AzureSubscription,
    ): Promise<AzureSqlServerInfo[]> {
        const sqlDbResources = await this.fetchSqlResourcesForSubscription<Server, Database>(
            sub,
            (sql) => sql.servers.list.bind(sql.servers),
            (sql) => sql.databases.listByServer.bind(sql.databases),
        );

        const miResources = await this.fetchSqlResourcesForSubscription<
            ManagedInstance,
            ManagedDatabase
        >(
            sub,
            (sql) => sql.managedInstances.list.bind(sql.managedInstances),
            (sql) => sql.managedDatabases.listByInstance.bind(sql.managedDatabases),
        );

        const sqlDbMap = this.populateServerMap(
            sub,
            sqlDbResources.servers,
            sqlDbResources.databases,
        );

        const miMap = this.populateManagedInstanceMap(
            sub,
            miResources.servers,
            miResources.databases,
        );

        return Array.from(sqlDbMap.values()).concat(Array.from(miMap.values()));
    }

    /**
     * Fetches the storage accounts for a given subscription.
     * @param sub The subscription to fetch storage accounts for.
     * @param storageClient storage client for testing purposes
     * @returns A list of storage accounts.
     */
    public static async fetchStorageAccountsForSubscription(
        sub: AzureSubscription,
        storageClient?: StorageManagementClient,
    ): Promise<StorageAccount[]> {
        try {
            const storage =
                storageClient ??
                new StorageManagementClient(sub.credential, sub.subscriptionId, {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                });

            return listAllIterator(storage.storageAccounts.list());
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching storage accounts for subscription",
                getErrorMessage(error),
            );
            throw new Error(getErrorMessage(error));
        }
    }

    /**
     * Fetches the blob containers for a given storage account.
     * @param sub The subscription to fetch blob containers for.
     * @param storageAccount The storage account to fetch blob containers for.
     * @param storageClient storage client for testing purposes
     * @returns A list of blob containers.
     */
    public static async fetchBlobContainersForStorageAccount(
        sub: AzureSubscription,
        storageAccount: StorageAccount,
        storageClient?: StorageManagementClient,
    ): Promise<BlobContainer[]> {
        try {
            const storage =
                storageClient ??
                new StorageManagementClient(sub.credential, sub.subscriptionId, {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                });

            const storageAccountResourceGroup = extractFromResourceId(
                storageAccount.id,
                "resourceGroups",
            );

            // get resource group for storage account
            return listAllIterator(
                storage.blobContainers.list(storageAccountResourceGroup, storageAccount.name),
            );
        } catch (error) {
            azureHelperLogger.error(
                "Error fetching blob containers for storage account",
                getErrorMessage(error),
            );
            throw error;
        }
    }

    /**
     * Fetches blobs for a given blob container using storage account keys.
     * @param sub Azure subscription
     * @param storageAccount Storage account
     * @param container Blob container
     * @param blobClient Blob service client for testing purposes
     * @returns A list of blobs.
     */
    public static async fetchBlobsForContainer(
        sub: AzureSubscription,
        storageAccount: StorageAccount,
        container: BlobContainer,
        blobClient?: BlobServiceClient,
    ): Promise<BlobItem[]> {
        try {
            const keys = await this.getStorageAccountKeys(sub, storageAccount);
            const accountKey = keys.keys?.[0]?.value;

            if (!accountKey) {
                throw new Error("No storage account key returned.");
            }

            // get cloud endpoint from provider settings and construct blob service endpoint url
            const cloudEndpoint =
                getCloudProviderSettings().settings.azureStorageResource.endpoint.substring(
                    https.length,
                );

            const accountName = storageAccount.name;
            const blobEndpoint = `${https}${accountName}.${cloudEndpoint}`;

            // Create shared key credential
            const credential = new StorageSharedKeyCredential(accountName, accountKey);

            // Create blob service client using key-based auth
            const blobServiceClient = blobClient ?? new BlobServiceClient(blobEndpoint, credential);

            const containerClient: ContainerClient = blobServiceClient.getContainerClient(
                container.name,
            );

            const blobs: BlobItem[] = [];

            for await (const blob of containerClient.listBlobsFlat()) {
                blobs.push(blob);
            }

            return blobs;
        } catch (error) {
            azureHelperLogger.error("Error fetching blobs for container", getErrorMessage(error));
            throw error;
        }
    }

    public static async fetchPublicMaintenanceConfigurations(
        subscription: AzureSubscription,
    ): Promise<MaintenanceConfiguration[]> {
        const client = new MaintenanceManagementClient(
            subscription.credential,
            subscription.subscriptionId,
            {
                endpoint: getCloudProviderSettings().settings.armResource.endpoint,
            },
        );
        return await listAllIterator(client.publicMaintenanceConfigurations.list());
    }

    /**
     * Gets the storage account keys for a given storage account.
     * @param sub The subscription to fetch storage account keys for.
     * @param storageAccount The storage account to fetch keys for.
     * @param storageClient storage client for testing purposes
     * @returns A list of storage account keys.
     */
    public static async getStorageAccountKeys(
        sub: AzureSubscription,
        storageAccount: StorageAccount,
        storageClient?: StorageManagementClient,
    ): Promise<StorageAccountsListKeysResponse> {
        try {
            const storage =
                storageClient ??
                new StorageManagementClient(sub.credential, sub.subscriptionId, {
                    endpoint: getCloudProviderSettings().settings.armResource.endpoint,
                });

            const storageAccountResourceGroup = extractFromResourceId(
                storageAccount.id,
                "resourceGroups",
            );

            return await storage.storageAccounts.listKeys(
                storageAccountResourceGroup,
                storageAccount.name,
            );
        } catch (error) {
            azureHelperLogger.error("Error fetching storage account keys", getErrorMessage(error));
            throw error;
        }
    }

    private static populateManagedInstanceMap(
        subscription: AzureSubscription,
        servers: ManagedInstance[],
        databases: (ManagedDatabase & { server: string })[],
    ): Map<string, AzureSqlServerInfo> {
        const serverMap = this.populateServerMap(subscription, servers, databases);

        // Managed Instances may need to be split into public and private endpoints.
        // Split and label them only if the public endpoint is enabled

        for (const server of servers) {
            const serverEntry = serverMap.get(server.name.toLowerCase());
            if (serverEntry) {
                serverEntry.type = "AzureSqlManagedInstance";
                const publicEndpointEnabled =
                    (server.publicDataEndpointEnabled as boolean) ?? false;

                if (publicEndpointEnabled) {
                    // Create a separate entry for the public endpoint

                    // Public endpoint URI is the private FQDN, but with ".public" inserted after the server name and on port 3342
                    const publicServerUri =
                        serverEntry.server?.replace(`${server.name}.`, `${server.name}.public.`) +
                        `,${MANAGED_INSTANCE_PUBLIC_PORT}`;

                    const publicDisplayName = `${serverEntry.displayName} (${LocalizedConstants.Common.publicString})`;
                    const publicServerEntry: AzureSqlServerInfo = {
                        ...serverEntry,
                        id: publicDisplayName,
                        displayName: publicDisplayName,
                        server: publicServerUri,
                    };
                    serverMap.set(publicDisplayName.toLowerCase(), publicServerEntry);

                    // Label the existing endpoint as private
                    const privateDisplayName = `${serverEntry.displayName} (${LocalizedConstants.Common.privateString})`;
                    serverEntry.id = privateDisplayName;
                    serverEntry.displayName = privateDisplayName;
                }
            }
        }

        return serverMap;
    }

    private static populateServerMap(
        subscription: AzureSubscription,
        servers: Server[],
        databases: (Database & { server: string })[],
    ): Map<string, AzureSqlServerInfo> {
        const serverMap = new Map<string, AzureSqlServerInfo>();

        for (const server of servers) {
            // Synapse workspaces appear in Microsoft.Sql/servers with workspaceFeature === "Connected"
            // (and a kind containing "analytics"), but their fullyQualifiedDomainName is the underlying
            // *.database.windows.net address rather than the SQL endpoint used to connect to the workspace.
            // Connections must instead target [workspace].sql.azuresynapse.net (analyticsDnsSuffix).
            const isSynapseWorkspace =
                server.workspaceFeature === "Connected" ||
                (server.kind?.toLowerCase().includes("analytics") ?? false);

            let serverFqdn = server.fullyQualifiedDomainName!;
            if (isSynapseWorkspace) {
                const analyticsDnsSuffix =
                    getCloudProviderSettings().settings.sqlResource.analyticsDnsSuffix;
                if (analyticsDnsSuffix && server.name) {
                    serverFqdn = `${server.name}${analyticsDnsSuffix}`;
                }
            }

            serverMap.set(server.name!.toLowerCase(), {
                id: server.name!,
                displayName: server.name!,
                server: serverFqdn,
                databases: [],
                type: isSynapseWorkspace ? "AzureSynapseAnalytics" : "AzureSqlServer",
                collectionId: subscription.subscriptionId,
                collectionName: subscription.name,
                tenantId: subscription.tenantId,
                resourceGroup: extractFromResourceId(server.id!, "resourceGroups"),
            });
        }

        for (const database of databases) {
            const serverName = database.server;
            const server = serverMap.get(serverName.toLowerCase());

            if (server) {
                const databaseName = database.name;

                if (databaseName) {
                    server.databases.push(databaseName);
                }
            }
        }

        return serverMap;
    }
}

/**
 * Re-exported Azure auth helpers from vscode-azext-azureauth.
 * Allows for stubbing in unit tests.
 */
export const VsCodeAzureAuth = {
    getUnauthenticatedTenants: getUnauthenticatedTenants,
    signInToTenant: signInToTenant,
};

/**
 *  * @returns true if the user selected subscriptions, false if they canceled the selection quickpick
 */
export async function promptForAzureSubscriptionFilter(
    state: ConnectionDialogWebviewState,
    logger: ILogger,
): Promise<boolean> {
    try {
        const result = await VsCodeAzureHelper.signIn();

        if (!result?.auth) {
            state.formMessage = { message: LocalizedConstants.azureSignInFailed };
            return false;
        }

        const selectedSubs = await vscode.window.showQuickPick(
            getSubscriptionQuickPickItems(result.auth),
            {
                canPickMany: true,
                ignoreFocusOut: true,
                placeHolder: LocalizedConstants.selectSubscriptions,
            },
        );

        if (!selectedSubs) {
            return false;
        }

        await vscode.workspace.getConfiguration().update(
            configSelectedAzureSubscriptions,
            selectedSubs.map((s) => `${s.tenantId}/${s.subscriptionId}`),
            vscode.ConfigurationTarget.Global,
        );

        return true;
    } catch (error) {
        state.formMessage = { message: LocalizedConstants.errorLoadingAzureSubscriptions };
        logger.error(state.formMessage.message + "\n" + getErrorMessage(error));
        return false;
    }
}

export interface SubscriptionPickItem extends MssqlQuickPickItem {
    tenantId: string;
    subscriptionId: string;
}

export async function getSubscriptionQuickPickItems(
    auth: VSCodeAzureSubscriptionProvider,
): Promise<SubscriptionPickItem[]> {
    const allSubs = await auth.getSubscriptions(
        false /* don't use the current filter, 'cause we're gonna set it */,
    );

    const prevSelectedSubs = vscode.workspace
        .getConfiguration()
        .get<string[] | undefined>(configSelectedAzureSubscriptions)
        ?.map((entry) => entry.split("/")[1]);

    const quickPickItems: SubscriptionPickItem[] = allSubs
        .map((sub) => {
            return {
                label: sub.name,
                description: sub.subscriptionId,
                tenantId: sub.tenantId,
                subscriptionId: sub.subscriptionId,
                picked: prevSelectedSubs ? prevSelectedSubs.includes(sub.subscriptionId) : true,
                group: sub.account.label,
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    return groupQuickPickItems(quickPickItems);
}

// https://learn.microsoft.com/en-us/azure/azure-sql/database/maintenance-window-configure
export enum MaintenanceSchedule {
    Default = "Default",
    Weekday = "DB_1",
    Weekend = "DB_2",
}

//#endregion

//#region Azure Entra auth helpers

export async function getAccounts(
    azureAccountService: AzureAccountService,
    logger: ILogger,
): Promise<FormItemOptions[]> {
    let accounts: IAccount[] = [];
    try {
        accounts = await azureAccountService.getAccounts();
        return accounts.map((account) => {
            return {
                displayName: account.displayInfo?.displayName,
                value: account.key.id,
            };
        });
    } catch (error) {
        logger.error(`Error loading Azure accounts: ${getErrorMessage(error)}`);

        sendErrorEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureAccountsForEntraAuth,
            error,
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
            undefined, // additionalProperties
            {
                accountCount: accounts.length,
                undefinedAccountCount: accounts.filter((x) => x === undefined).length,
                undefinedDisplayInfoCount: accounts.filter(
                    (x) => x !== undefined && x.displayInfo === undefined,
                ).length,
            }, // additionalMeasurements
        );

        return [];
    }
}

/**
 * Retrieves the tenants for a given Azure account.
 * @param accountId The ID of the account to retrieve tenants for.  Recommended to be `IAccount.key.id`.
 */
export async function getTenants(
    azureAccountService: AzureAccountService,
    accountId: string,
    logger: ILogger,
): Promise<FormItemOptions[]> {
    let tenants: ITenant[] = [];

    if (!accountId) {
        logger.error("getTenants(): undefined accountId passed.");
        return [];
    }

    try {
        const account = await azureAccountService.getAccount(accountId);

        if (!account?.properties?.tenants) {
            const missingProp = !account
                ? "account"
                : !account.properties
                  ? "properties"
                  : "tenants";
            const message = `Unable to retrieve tenants for the selected account due to undefined ${missingProp}`;
            logger.error(message);

            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadAzureTenantsForEntraAuth,
                new Error(message),
                true, // includeErrorMessage
                undefined, // errorCode
                `missing_${missingProp}`, // errorType
            );

            return [];
        }

        tenants = account.properties.tenants;

        return tenants.map((tenant) => {
            return {
                displayName: `${tenant.displayName} (${tenant.id})`,
                value: tenant.id,
            };
        });
    } catch (error) {
        logger.error(`Error loading Azure tenants: ${getErrorMessage(error)}`);

        sendErrorEvent(
            TelemetryViews.ConnectionDialog,
            TelemetryActions.LoadAzureTenantsForEntraAuth,
            error,
            false, // includeErrorMessage
            undefined, // errorCode
            undefined, // errorType
            undefined, // additionalProperties
            {
                tenant: tenants.length,
                undefinedTenantCount: tenants.filter((x) => x === undefined).length,
            }, // additionalMeasurements
        );

        return [];
    }
}

export async function constructAzureAccountForTenant(azureAccountInfo: {
    accountId: string;
    tenantId: string;
}): Promise<{ account: IAccount; tokenMappings: {} }> {
    const result = await VsCodeAzureHelper.signIn();

    const subs = await result.auth.getSubscriptions({
        account: await VsCodeAzureHelper.getAccountById(azureAccountInfo.accountId),
        tenantId: azureAccountInfo.tenantId,
    });

    const sub = subs.filter((s) => s.tenantId === azureAccountInfo.tenantId)[0];

    if (!sub) {
        throw new Error(
            LocalizedConstants.Azure.errorLoadingAzureAccountInfoForTenantId(
                azureAccountInfo.tenantId,
            ),
        );
    }

    const token = await sub.credential.getToken(".default");

    const session = await sub.authentication.getSession();

    const account: IAccount = {
        displayInfo: {
            displayName: session.account.label,
            userId: session.account.label,
            name: session.account.label,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accountType: (session.account as any).type as any,
        },
        key: {
            providerId: "microsoft",
            id: session.account.label,
        },
        isStale: false,
        properties: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            azureAuthType: 0 as any,
            providerSettings: getCloudProviderSettings(),
            isMsAccount: false,
            owningTenant: undefined,
            tenants: [
                {
                    displayName: sub.tenantId,
                    id: sub.tenantId,
                    userId: token.token,
                },
            ],
        },
    };

    const tokenMappings = {};
    tokenMappings[sub.tenantId] = {
        Token: token.token,
    };

    return { account, tokenMappings };
}

//#endregion

//#region Miscellaneous Azure helpers

export function extractFromResourceId(resourceId: string, property: string): string | undefined {
    if (!property.endsWith("/")) {
        property += "/";
    }

    let startIndex = resourceId.indexOf(property);

    if (startIndex === -1) {
        return undefined;
    } else {
        startIndex += property.length;
    }

    let endIndex = resourceId.indexOf("/", startIndex);
    if (endIndex === -1) {
        endIndex = undefined;
    }

    return resourceId.substring(startIndex, endIndex);
}

/**
 * Gets the default tenant ID for the given account and tenants.
 * @param accountId The account ID.
 * @param tenants The list of tenants for the account.
 * @returns The default tenant ID.
 */
export function getDefaultTenantId(accountId: string, tenants: AzureTenant[]): string {
    if (accountId === "" || tenants.length === 0) return "";

    // Response from VS Code account system shows all tenants as "Home", so we need to extract the home tenant ID manually
    const homeTenantId = VsCodeAzureHelper.getHomeTenantIdForAccount(accountId);

    // For personal Microsoft accounts, the extracted tenant ID may not be one that the user has access to.
    // Only use the extracted tenant ID if it's in the tenant list; otherwise, default to the first.
    return tenants.some((t) => t.tenantId === homeTenantId)
        ? homeTenantId
        : tenants.length > 0
          ? tenants[0].tenantId
          : "";
}

/**
 * Acquires a SQL access token from a VS Code authentication account.
 * Convenience wrapper around {@link acquireTokenFromVscodeAccountForResource}
 * that targets the SQL resource endpoint for the current cloud.
 */
export async function acquireSqlAccessTokenFromVscodeAccount(
    accountId?: string,
    tenantId?: string,
): Promise<VscodeEntraSqlTokenInfo> {
    return acquireTokenFromVscodeAccountForResource(
        getCloudResourceEndpoint("sqlResource"),
        accountId,
        tenantId,
    );
}

//#endregion
