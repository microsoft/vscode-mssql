/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Looks up the Database Hub ID of a resource when the user opens it: ARM IDs from Azure, and
 * Fabric item IDs from the Fabric API. Lookups run only on click, never while a menu draws.
 */

import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { VscodeHttpClient, withBearerToken } from "extension-toolkit/vscode";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { FabricHelper } from "../fabric/fabricHelper";
import { formatArmResourceId } from "../fabric/fabricDatabaseHub";
import { ILogger } from "../sharedInterfaces/logger";
import { getErrorMessage } from "../utils/utils";

const resourceGraphApiVersion = "2022-10-01";

/** The most subscriptions that one Resource Graph request may name. */
const resourceGraphSubscriptionLimit = 1000;

/** ARM resource types that the Hub lists and that are looked up by name. */
export const AzureResourceType = {
    ArcSqlServer: "Microsoft.AzureArcData/sqlServerInstances",
    ManagedInstance: "Microsoft.Sql/managedInstances",
    SqlVirtualMachine: "Microsoft.SqlVirtualMachine/sqlVirtualMachines",
} as const;

/** A resource to look for: its ARM type and its name. */
export interface AzureResourceCandidate {
    readonly type: string;
    readonly name: string;
}

/** Looks up ARM IDs with the user's Azure accounts. */
export interface DatabaseHubAzureLookup {
    /**
     * Returns the Azure accounts to search, with the preferred one first. Asks the user to sign
     * in when no account is signed in, and returns an empty list when they don't.
     */
    accounts(preferredAccountId?: string): Promise<string[]>;
    azureSqlServerId(accountId: string, serverName: string): Promise<string | undefined>;
    /**
     * Returns the ID of the first candidate found in the account's subscriptions. One Azure
     * Resource Graph query searches all the subscriptions of each tenant.
     */
    resourceId(
        accountId: string,
        candidates: readonly AzureResourceCandidate[],
    ): Promise<string | undefined>;
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

    public resourceId(
        accountId: string,
        candidates: readonly AzureResourceCandidate[],
    ): Promise<string | undefined> {
        const key = [accountId, ...candidates.map(({ type, name }) => `${type}/${name}`)]
            .join("|")
            .toLowerCase();
        let result = this._cache.get(key);
        if (!result) {
            result = this.findResource(accountId, candidates).then(({ id, complete }) => {
                // A miss is cached only when every tenant answered.
                if (!id && !complete) {
                    this._cache.delete(key);
                }
                return id;
            });
            this._cache.set(key, result);
        }
        return result;
    }

    private async findResource(
        accountId: string,
        candidates: readonly AzureResourceCandidate[],
    ): Promise<{ id?: string; complete: boolean }> {
        if (candidates.length === 0) {
            return { complete: true };
        }
        let subscriptions: AzureSubscription[];
        try {
            subscriptions = await VsCodeAzureHelper.getSubscriptionsForAccount(accountId);
        } catch (error) {
            this._logger.debug(`Listing subscriptions failed: ${getErrorMessage(error)}`);
            return { complete: false };
        }
        const tenants = new Map<string, AzureSubscription[]>();
        for (const subscription of subscriptions) {
            tenants.set(subscription.tenantId, [
                ...(tenants.get(subscription.tenantId) ?? []),
                subscription,
            ]);
        }
        const query = resourceGraphQuery(candidates);
        const answers = await Promise.all(
            [...tenants.values()].map((tenantSubscriptions) =>
                this.queryResourceGraph(tenantSubscriptions, query),
            ),
        );
        const rows = answers.flatMap((answer) => answer ?? []);
        const match = candidates
            .map((candidate) =>
                rows.find(
                    (row) =>
                        sameName(row.type, candidate.type) && sameName(row.name, candidate.name),
                ),
            )
            .find((row) => row?.id);
        return { id: match?.id, complete: answers.every((answer) => answer !== undefined) };
    }

    /**
     * Runs a Resource Graph query over the subscriptions of one tenant, which share a credential.
     *
     * @returns undefined when the query fails.
     */
    private async queryResourceGraph(
        subscriptions: readonly AzureSubscription[],
        query: string,
    ): Promise<ResourceGraphRow[] | undefined> {
        const tenantId = subscriptions[0].tenantId;
        try {
            const endpoint = getCloudProviderSettings().settings.armResource.endpoint;
            const token = await subscriptions[0].credential.getToken(
                `${endpoint.replace(/\/$/, "")}/.default`,
            );
            if (!token?.token) {
                return undefined;
            }
            const url = new URL(
                `providers/Microsoft.ResourceGraph/resources?api-version=${resourceGraphApiVersion}`,
                endpoint,
            );
            const http = new VscodeHttpClient({ logger: this._logger });
            const rows: ResourceGraphRow[] = [];
            for (let i = 0; i < subscriptions.length; i += resourceGraphSubscriptionLimit) {
                const response = await http.postJson<{ data?: ResourceGraphRow[] }>(
                    url,
                    {
                        subscriptions: subscriptions
                            .slice(i, i + resourceGraphSubscriptionLimit)
                            .map((subscription) => subscription.subscriptionId),
                        query,
                    },
                    withBearerToken(token.token),
                );
                if (!response.ok) {
                    this._logger.debug(
                        `Resource Graph query in tenant ${tenantId} failed with status ${response.status}.`,
                    );
                    return undefined;
                }
                rows.push(...(response.data.data ?? []));
            }
            return rows;
        } catch (error) {
            this._logger.debug(
                `Resource Graph query in tenant ${tenantId} failed: ${getErrorMessage(error)}`,
            );
            return undefined;
        }
    }
}

interface ResourceGraphRow {
    readonly id?: string;
    readonly type?: string;
    readonly name?: string;
}

/** A Resource Graph query for the resources that match any of the candidates. */
export function resourceGraphQuery(candidates: readonly AzureResourceCandidate[]): string {
    // KQL string literals escape quotes and backslashes with a backslash.
    const literal = (value: string) => `'${value.replace(/['\\]/g, "\\$&")}'`;
    const conditions = candidates
        .map(({ type, name }) => `(type =~ ${literal(type)} and name =~ ${literal(name)})`)
        .join(" or ");
    return `resources | where ${conditions} | project id, type, name`;
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
