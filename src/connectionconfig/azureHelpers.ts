/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { l10n } from "vscode";
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

export const azureSubscriptionFilterConfigKey = "azureResourceGroups.selectedSubscriptions";

//#region VS Code integration

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

export async function promptForAzureSubscriptionFilter(state: ConnectionDialogWebviewState) {
    try {
        const auth = await confirmVscodeAzureSignin();

        if (!auth) {
            state.formError = l10n.t("Azure sign in failed.");
            return;
        }

        const selectedSubs = await vscode.window.showQuickPick(getQuickPickItems(auth), {
            canPickMany: true,
            ignoreFocusOut: true,
            placeHolder: l10n.t("Select subscriptions"),
        });

        if (!selectedSubs) {
            return;
        }

        await vscode.workspace.getConfiguration().update(
            azureSubscriptionFilterConfigKey,
            selectedSubs.map((s) => `${s.tenantId}/${s.subscriptionId}`),
            vscode.ConfigurationTarget.Global,
        );
    } catch (error) {
        state.formError = l10n.t("Error loading Azure subscriptions.");
        console.error(state.formError + "\n" + getErrorMessage(error));
        return;
    }
}

export interface SubscriptionPickItem extends vscode.QuickPickItem {
    tenantId: string;
    subscriptionId: string;
}

export async function getQuickPickItems(
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
