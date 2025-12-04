/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { l10n } from "vscode";
import {
    AzureSubscription,
    AzureTenant,
    getConfiguredAuthProviderId,
} from "@microsoft/vscode-azext-azureauth";

import { Azure as Loc, Common as LocCommon } from "../constants/locConstants";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { IAccount, ITenant } from "../models/contracts/azure";
import { FormItemOptions } from "../sharedInterfaces/form";
import { AzureAccountService } from "../services/azureAccountService";
import {
    AzureSqlServerInfo,
    ConnectionDialogWebviewState,
} from "../sharedInterfaces/connectionDialog";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage, listAllIterator } from "../utils/utils";
import { MssqlVSCodeAzureSubscriptionProvider } from "../azure/MssqlVSCodeAzureSubscriptionProvider";
import { configSelectedAzureSubscriptions } from "../constants/constants";
import { Logger } from "../models/logger";
import { IMssqlAzureSubscription } from "../sharedInterfaces/azureAccountManagement";
import { groupQuickPickItems, MssqlQuickPickItem } from "../utils/quickpickHelpers";
import {
    Database,
    ManagedDatabase,
    ManagedInstance,
    Server,
    SqlManagementClient,
    TrackedResource,
} from "@azure/arm-sql";
import { PagedAsyncIterableIterator } from "@azure/core-paging";

export const azureSubscriptionFilterConfigKey = "mssql.selectedAzureSubscriptions";
export const MANAGED_INSTANCE_PUBLIC_PORT = 3342;

//#region VS Code integration

export class VsCodeAzureHelper {
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
            console.error(`Error fetching VS Code accounts: ${getErrorMessage(error)}`);
        }

        if (onlyAllowedForExtension) {
            // Filter out accounts that throw when fetching tenants, which indicates that the user hasn't given the MSSQL extension access to this account
            const filteredAccounts = [];
            for (const account of accounts) {
                try {
                    const tenants =
                        await MssqlVSCodeAzureSubscriptionProvider.getInstance().getTenants(
                            account,
                        );
                    if (tenants.length > 0) {
                        filteredAccounts.push(account);
                    } else {
                        console.warn(
                            `No tenants found for account ${account.label}; this may indicate that the MSSQL extension does not have permission to use this account.`,
                        );
                    }
                } catch (error) {
                    // no-op; failure to get tenants means that the account is not accessible by this extension
                    console.warn(
                        `Error fetching tenants for ${account.label}; this may indicate that the MSSQL extension does not have permission to use this account.  Error: ${getErrorMessage(error)}`,
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
        const auth: MssqlVSCodeAzureSubscriptionProvider =
            MssqlVSCodeAzureSubscriptionProvider.getInstance();
        return await auth.isSignedIn();
    }

    /**
     * Prompts the user to sign in to Azure if they are not already signed in
     * @param forceSignInPrompt - If true, the user will be prompted, even if they are already signed in to an account. Defaults to false.
     * @returns auth object if the user signs in or is already signed in.
     * @throws Error if the sign-in is canceled or fails.
     */
    public static async signIn(
        forceSignInPrompt: boolean = false,
    ): Promise<MssqlVSCodeAzureSubscriptionProvider> {
        const auth: MssqlVSCodeAzureSubscriptionProvider =
            MssqlVSCodeAzureSubscriptionProvider.getInstance();

        if (forceSignInPrompt || !(await auth.isSignedIn())) {
            const result = await auth.signIn();
            if (!result) {
                throw new Error("Azure sign-in was canceled or failed.");
            }
        }

        return auth;
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
     * Gets the tenants available for a specific Azure account
     * @param account The account to get tenants for
     * @returns Array of tenant information
     */
    public static async getTenantsForAccount(
        account: vscode.AuthenticationSessionAccountInformation | string,
    ): Promise<AzureTenant[]> {
        try {
            account = typeof account === "string" ? await this.getAccountById(account) : account;

            const auth: MssqlVSCodeAzureSubscriptionProvider =
                MssqlVSCodeAzureSubscriptionProvider.getInstance();
            const tenants = [...(await auth.getTenants(account))]; // spread operator to create a new array since sort() mutates the array

            return tenants.sort((a, b) => a.displayName.localeCompare(b.displayName));
        } catch (error) {
            console.error("Error fetching tenants for account:", error);
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
    ): Promise<IMssqlAzureSubscription[]> {
        const auth = MssqlVSCodeAzureSubscriptionProvider.getInstance();
        const allSubs = await auth.getSubscriptions(false);
        // Filter subscriptions by tenant
        const subs = allSubs.filter((sub) => sub.tenantId === tenant.tenantId);
        return subs.map((sub) => ({
            subscriptionId: sub.subscriptionId,
            displayName: sub.name,
        }));
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
                const publicEndpointEnabled =
                    (server.publicDataEndpointEnabled as boolean) ?? false;

                if (publicEndpointEnabled) {
                    // Create a separate entry for the public endpoint

                    // Public endpoint URI is the private FQDN, but with ".public" inserted after the server name and on port 3342
                    const publicServerUri =
                        serverEntry.uri?.replace(`${server.name}.`, `${server.name}.public.`) +
                        `,${MANAGED_INSTANCE_PUBLIC_PORT}`;

                    const publicServerEntry: AzureSqlServerInfo = {
                        ...serverEntry,
                        server: `${serverEntry.server} (${LocCommon.publicString})`,
                        uri: publicServerUri,
                    };
                    serverMap.set(publicServerEntry.server.toLowerCase(), publicServerEntry);

                    // Label the existing endpoint as private
                    serverEntry.server = `${serverEntry.server} (${LocCommon.privateString})`;
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
            serverMap.set(server.name.toLowerCase(), {
                server: server.name,
                databases: [],
                location: server.location,
                resourceGroup: extractFromResourceId(server.id, "resourceGroups"),
                subscription: `${subscription.name} (${subscription.subscriptionId})`,
                uri: server.fullyQualifiedDomainName,
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
 *  * @returns true if the user selected subscriptions, false if they canceled the selection quickpick
 */
export async function promptForAzureSubscriptionFilter(
    state: ConnectionDialogWebviewState,
    logger: Logger,
): Promise<boolean> {
    try {
        const auth = await VsCodeAzureHelper.signIn();

        if (!auth) {
            state.formMessage = { message: l10n.t("Azure sign in failed.") };
            return false;
        }

        const selectedSubs = await vscode.window.showQuickPick(
            getSubscriptionQuickPickItems(auth),
            {
                canPickMany: true,
                ignoreFocusOut: true,
                placeHolder: l10n.t("Select subscriptions"),
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
        state.formMessage = { message: l10n.t("Error loading Azure subscriptions.") };
        logger.error(state.formMessage.message + "\n" + getErrorMessage(error));
        return false;
    }
}

export interface SubscriptionPickItem extends MssqlQuickPickItem {
    tenantId: string;
    subscriptionId: string;
}

export async function getSubscriptionQuickPickItems(
    auth: MssqlVSCodeAzureSubscriptionProvider,
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

//#endregion

//#region Azure Entra auth helpers

export async function getAccounts(
    azureAccountService: AzureAccountService,
    logger: Logger,
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
    logger: Logger,
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
                displayName: tenant.displayName,
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
    const auth = await VsCodeAzureHelper.signIn();
    const subs = await auth.getSubscriptions({
        account: await VsCodeAzureHelper.getAccountById(azureAccountInfo.accountId),
        tenantId: azureAccountInfo.tenantId,
    });

    const sub = subs.filter((s) => s.tenantId === azureAccountInfo.tenantId)[0];

    if (!sub) {
        throw new Error(Loc.errorLoadingAzureAccountInfoForTenantId(azureAccountInfo.tenantId));
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

//#endregion
