/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { l10n } from "vscode";
import { Azure as Loc } from "../constants/locConstants";

import {
    AzureSubscription,
    VSCodeAzureSubscriptionProvider,
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

export const azureSubscriptionFilterConfigKey = "mssql.selectedAzureSubscriptions";

//#region VS Code integration

/**
 * Checks to see if the user is signed into VS Code with an Azure account
 * @returns true if the user is signed in, false otherwise
 */
export async function isSignedIn(): Promise<boolean> {
    const auth: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
    return await auth.isSignedIn();
}

/**
 * Prompts the user to sign in to Azure if they are not already signed in
 * @returns auth object if the user signs in or is already signed in, undefined if the user cancels sign-in.
 */
export async function confirmVscodeAzureSignin(): Promise<
    VSCodeAzureSubscriptionProvider | undefined
> {
    const auth: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();

    if (!(await auth.isSignedIn())) {
        const result = await auth.signIn();

        if (!result) {
            return undefined;
        }
    }

    return auth;
}

/**
 *  * @returns true if the user selected subscriptions, false if they canceled the selection quickpick
 */
export async function promptForAzureSubscriptionFilter(
    state: ConnectionDialogWebviewState,
): Promise<boolean> {
    try {
        const auth = await confirmVscodeAzureSignin();

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
            azureSubscriptionFilterConfigKey,
            selectedSubs.map((s) => `${s.tenantId}/${s.subscriptionId}`),
            vscode.ConfigurationTarget.Global,
        );

        return true;
    } catch (error) {
        state.formError = l10n.t("Error loading Azure subscriptions.");
        console.error(state.formError + "\n" + getErrorMessage(error));
        return false;
    }
}

export interface SubscriptionPickItem extends vscode.QuickPickItem {
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
        .get<string[] | undefined>(azureSubscriptionFilterConfigKey)
        ?.map((entry) => entry.split("/")[1]);

    const quickPickItems: SubscriptionPickItem[] = allSubs
        .map((sub) => {
            return {
                label: `${sub.name} (${sub.subscriptionId})`,
                tenantId: sub.tenantId,
                subscriptionId: sub.subscriptionId,
                picked: prevSelectedSubs ? prevSelectedSubs.includes(sub.subscriptionId) : true,
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    return quickPickItems;
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
        console.error(`Error loading Azure accounts: ${getErrorMessage(error)}`);

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
): Promise<FormItemOptions[]> {
    let tenants: ITenant[] = [];
    try {
        const account = (await azureAccountService.getAccounts()).find(
            (account) => account.displayInfo?.userId === accountId,
        );
        if (!account) {
            return [];
        }
        tenants = account.properties.tenants;
        if (!tenants) {
            return [];
        }
        return tenants.map((tenant) => {
            return {
                displayName: tenant.displayName,
                value: tenant.id,
            };
        });
    } catch (error) {
        console.error(`Error loading Azure tenants: ${getErrorMessage(error)}`);

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

export async function constructAzureAccountForTenant(
    tenantId: string,
): Promise<{ account: IAccount; tokenMappings: {} }> {
    const auth = await confirmVscodeAzureSignin();
    const subs = await auth.getSubscriptions(false /* filter */);
    const sub = subs.filter((s) => s.tenantId === tenantId)[0];

    if (!sub) {
        throw new Error(Loc.errorLoadingAzureAccountInfoForTenantId(tenantId));
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

//#region Miscellaneous Auzre helpers

function extractFromResourceId(resourceId: string, property: string): string | undefined {
    if (!property.endsWith("/")) {
        property += "/";
    }

    let startIndex = resourceId.indexOf(property);

    if (startIndex === -1) {
        return undefined;
    } else {
        startIndex += property.length;
    }

    return resourceId.substring(startIndex, resourceId.indexOf("/", startIndex));
}

//#endregion
