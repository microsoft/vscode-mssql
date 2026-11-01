/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Looks up the Database Hub ID of a resource when the user opens it: ARM IDs from Azure, and
 * Fabric item IDs from the Fabric API. Lookups run only on click, never while a menu draws.
 */

import { SqlManagementClient } from "@azure/arm-sql";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { VscodeHttpClient, withBearerToken } from "extension-toolkit/vscode";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { FabricHelper } from "../fabric/fabricHelper";
import { formatArmResourceId } from "../fabric/fabricDatabaseHub";
import { ILogger } from "../sharedInterfaces/logger";
import { getErrorMessage, listAllIterator } from "../utils/utils";

const sqlVirtualMachineApiVersion = "2022-02-01";

/** Looks up ARM IDs with the user's Azure accounts. */
export interface DatabaseHubAzureLookup {
    /**
     * Returns the Azure accounts to search, with the preferred one first. Asks the user to sign
     * in when no account is signed in, and returns an empty list when they don't.
     */
    accounts(preferredAccountId?: string): Promise<string[]>;
    azureSqlServerId(accountId: string, serverName: string): Promise<string | undefined>;
    managedInstanceId(accountId: string, instanceName: string): Promise<string | undefined>;
    sqlVirtualMachineId(accountId: string, vmName: string): Promise<string | undefined>;
}

/** Looks up Fabric SQL database IDs with the Fabric API. */
export interface DatabaseHubFabricLookup {
    /** Returns the ID of the workspace's SQL database that a connection's database names. */
    sqlDatabaseId(
        workspaceId: string,
        databaseName: string,
        tenantId: string | undefined,
    ): Promise<string | undefined>;
}

/** The lookups of the signed-in user. Results are cached for the session, like server lookups. */
export class AccountDatabaseHubAzureLookup implements DatabaseHubAzureLookup {
    private readonly _cache = new Map<string, Promise<string | undefined>>();

    constructor(private readonly _logger: ILogger) {}

    public async accounts(preferredAccountId?: string): Promise<string[]> {
        try {
            if (!(await VsCodeAzureHelper.isSignedIn())) {
                await VsCodeAzureHelper.signIn();
            }
            const accounts = (await VsCodeAzureHelper.getAccounts()).map((account) => account.id);
            return preferredAccountId && accounts.includes(preferredAccountId)
                ? [preferredAccountId, ...accounts.filter((id) => id !== preferredAccountId)]
                : accounts;
        } catch (error) {
            this._logger.debug(`Azure sign-in for the Database Hub: ${getErrorMessage(error)}`);
            return [];
        }
    }

    public async azureSqlServerId(
        accountId: string,
        serverName: string,
    ): Promise<string | undefined> {
        const resource = await VsCodeAzureHelper.findSqlResource(accountId, serverName);
        return resource === "UnableToCheck"
            ? undefined
            : formatArmResourceId({
                  subscriptionId: resource.subscriptionId,
                  resourceGroup: resource.resourceGroup,
                  provider: "Microsoft.Sql",
                  type: "servers",
                  name: serverName,
              });
    }

    public managedInstanceId(accountId: string, instanceName: string): Promise<string | undefined> {
        return this.cached(`managedInstance|${accountId}|${instanceName}`, () =>
            this.searchSubscriptions(accountId, async (subscription) => {
                const sql = new SqlManagementClient(
                    subscription.credential,
                    subscription.subscriptionId,
                    { endpoint: getCloudProviderSettings().settings.armResource.endpoint },
                );
                const instances = await listAllIterator(sql.managedInstances.list());
                return instances.find((instance) => sameName(instance.name, instanceName))?.id;
            }),
        );
    }

    public sqlVirtualMachineId(accountId: string, vmName: string): Promise<string | undefined> {
        return this.cached(`sqlVirtualMachine|${accountId}|${vmName}`, () =>
            this.searchSubscriptions(accountId, async (subscription) => {
                const endpoint = getCloudProviderSettings().settings.armResource.endpoint;
                const token = await subscription.credential.getToken(
                    `${endpoint.replace(/\/$/, "")}/.default`,
                );
                if (!token?.token) {
                    return undefined;
                }
                const http = new VscodeHttpClient({ logger: this._logger });
                let next: string | undefined = new URL(
                    `subscriptions/${subscription.subscriptionId}/providers/Microsoft.SqlVirtualMachine/sqlVirtualMachines?api-version=${sqlVirtualMachineApiVersion}`,
                    endpoint,
                ).toString();
                while (next) {
                    const response = await http.get<{
                        value?: { id?: string; name?: string }[];
                        nextLink?: string;
                    }>(next, withBearerToken(token.token));
                    if (!response.ok) {
                        return undefined;
                    }
                    const match = response.data.value?.find((vm) => sameName(vm.name, vmName));
                    if (match?.id) {
                        return match.id;
                    }
                    next = response.data.nextLink;
                }
                return undefined;
            }),
        );
    }

    private cached(
        key: string,
        lookup: () => Promise<string | undefined>,
    ): Promise<string | undefined> {
        const normalized = key.toLowerCase();
        let result = this._cache.get(normalized);
        if (!result) {
            result = lookup();
            this._cache.set(normalized, result);
        }
        return result;
    }

    private async searchSubscriptions(
        accountId: string,
        search: (subscription: AzureSubscription) => Promise<string | undefined>,
    ): Promise<string | undefined> {
        let subscriptions: AzureSubscription[];
        try {
            subscriptions = await VsCodeAzureHelper.getSubscriptionsForAccount(accountId);
        } catch (error) {
            this._logger.debug(`Listing subscriptions failed: ${getErrorMessage(error)}`);
            return undefined;
        }
        for (const subscription of subscriptions) {
            try {
                const id = await search(subscription);
                if (id) {
                    return id;
                }
            } catch (error) {
                this._logger.debug(
                    `Searching subscription ${subscription.subscriptionId} failed: ${getErrorMessage(error)}`,
                );
            }
        }
        return undefined;
    }
}

/** Lists a workspace's SQL databases with the Fabric API and matches on the database name. */
export class FabricApiDatabaseHubLookup implements DatabaseHubFabricLookup {
    constructor(private readonly _logger: ILogger) {}

    public async sqlDatabaseId(
        workspaceId: string,
        databaseName: string,
        tenantId: string | undefined,
    ): Promise<string | undefined> {
        try {
            const databases = await FabricHelper.getFabricDatabases(workspaceId, tenantId);
            return databases.find(
                (database) =>
                    database.databases.some((name) => sameName(name, databaseName)) ||
                    sameName(database.displayName, databaseName),
            )?.id;
        } catch (error) {
            this._logger.debug(
                `Listing the SQL databases of workspace ${workspaceId} failed: ${getErrorMessage(error)}`,
            );
            return undefined;
        }
    }
}

function sameName(first: string | undefined, second: string): boolean {
    return first?.toLowerCase() === second.toLowerCase();
}
