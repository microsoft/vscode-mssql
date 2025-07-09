/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { l10n } from "vscode";
import { Azure as Loc } from "../constants/locConstants";

import {
    AzureSubscription,
    AzureTenant,
    getConfiguredAuthProviderId,
} from "@microsoft/vscode-azext-azureauth";
import { GenericResourceExpanded, ResourceManagementClient } from "@azure/arm-resources";

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

export const azureSubscriptionFilterConfigKey = "mssql.selectedAzureSubscriptions";

//#region VS Code integration

export class VsCodeAzureHelper {
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
                    await MssqlVSCodeAzureSubscriptionProvider.getInstance().getTenants(account);
                    filteredAccounts.push(account);
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
            state.formError = l10n.t("Azure sign in failed.");
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
        state.formError = l10n.t("Error loading Azure subscriptions.");
        logger.error(state.formError + "\n" + getErrorMessage(error));
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

const serverResourceType = "Microsoft.Sql/servers";
const databaseResourceType = "Microsoft.Sql/servers/databases";

export async function fetchResourcesForSubscription(
    sub: AzureSubscription,
): Promise<GenericResourceExpanded[]> {
    const client = new ResourceManagementClient(sub.credential, sub.subscriptionId);
    const resources = await listAllIterator<GenericResourceExpanded>(client.resources.list());
    return resources;
}

export async function fetchServersFromAzure(sub: AzureSubscription): Promise<AzureSqlServerInfo[]> {
    const result: AzureSqlServerInfo[] = [];

    const resources = await fetchResourcesForSubscription(sub);

    // for some subscriptions, supplying a `resourceType eq 'Microsoft.Sql/servers/databases'` filter to list() causes an error:
    // > invalid filter in query string 'resourceType eq "Microsoft.Sql/servers/databases'"
    // no idea why, so we're fetching all resources and filtering them ourselves

    const servers = resources.filter((r) => r.type === serverResourceType);
    const databases = resources.filter((r) => r.type === databaseResourceType);

    for (const server of servers) {
        result.push({
            server: server.name,
            databases: [],
            location: server.location,
            resourceGroup: extractFromResourceId(server.id, "resourceGroups"),
            subscription: `${sub.name} (${sub.subscriptionId})`,
            kind: server.kind,
        });
    }

    for (const database of databases) {
        const serverName = extractFromResourceId(database.id, "servers");
        const server = result.find((s) => s.server === serverName);
        if (server) {
            server.databases.push(database.name.substring(serverName.length + 1)); // database.name is in the form 'serverName/databaseName', so we need to remove the server name and slash
        }
    }

    return result;
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
                displayName: account.displayInfo.displayName,
                value: account.displayInfo.userId,
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

export async function getTenants(
    azureAccountService: AzureAccountService,
    accountId: string,
    logger: Logger,
): Promise<FormItemOptions[]> {
    let tenants: ITenant[] = [];
    try {
        const account = (await azureAccountService.getAccounts()).find(
            (account) => account.displayInfo?.userId === accountId,
        );

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
            providerSettings: undefined,
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
