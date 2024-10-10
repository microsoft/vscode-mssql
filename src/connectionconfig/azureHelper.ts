/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { l10n } from "vscode";
import { ConnectionDialogWebviewState } from "../sharedInterfaces/connectionDialog";
import { getErrorMessage } from "../utils/utils";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";

export const azureSubscriptionFilterConfigKey =
    "azureResourceGroups.selectedSubscriptions";

export async function confirmVscodeAzureSignin(): Promise<
    VSCodeAzureSubscriptionProvider | undefined
> {
    const auth: VSCodeAzureSubscriptionProvider =
        new VSCodeAzureSubscriptionProvider();

    if (!(await auth.isSignedIn())) {
        const result = await auth.signIn();

        if (!result) {
            return undefined;
        }
    }

    return auth;
}

export async function promptForAzureSubscriptionFilter(
    state: ConnectionDialogWebviewState,
) {
    try {
        const auth = await confirmVscodeAzureSignin();

        if (!auth) {
            state.formError = l10n.t("Azure sign in failed.");
            return;
        }

        const selectedSubs = await vscode.window.showQuickPick(
            getQuickPickItems(auth),
            {
                canPickMany: true,
                ignoreFocusOut: true,
                placeHolder: l10n.t("Select subscriptions"),
            },
        );

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
                picked: prevSelectedSubs
                    ? prevSelectedSubs.includes(sub.subscriptionId)
                    : true,
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    return quickPickItems;
}
