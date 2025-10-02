/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    TenantId,
    SubscriptionId,
    VSCodeAzureSubscriptionProvider,
} from "@microsoft/vscode-azext-azureauth";
import { configSelectedAzureSubscriptions } from "../constants/constants";

/**
 * Extends the VSCodeAzureSubscriptionProvider to filter subscriptions based on user selection.
 * This class overrides the getTenantFilters and getSubscriptionFilters methods to use our own config key instead of `azureResources.selectedSubscriptions`.
 * More information here: https://github.com/microsoft/vscode-azuretools/blob/12ba643e625c66fadd94483e18d4e430bd77d187/auth/src/VSCodeAzureSubscriptionProvider.ts#L240
 */
export class MssqlVSCodeAzureSubscriptionProvider extends VSCodeAzureSubscriptionProvider {
    private static _instance: MssqlVSCodeAzureSubscriptionProvider;

    private constructor() {
        super();
    }

    public static getInstance(): MssqlVSCodeAzureSubscriptionProvider {
        MssqlVSCodeAzureSubscriptionProvider._instance ??=
            new MssqlVSCodeAzureSubscriptionProvider();
        return MssqlVSCodeAzureSubscriptionProvider._instance;
    }

    private getSelectedSubscriptions(): string[] {
        return vscode.workspace.getConfiguration().get(configSelectedAzureSubscriptions, []);
    }

    protected override async getTenantFilters(): Promise<TenantId[]> {
        return this.getSelectedSubscriptions().map((id) => id.split("/")[0]);
    }

    protected override async getSubscriptionFilters(): Promise<SubscriptionId[]> {
        return this.getSelectedSubscriptions().map((id) => id.split("/")[1]);
    }
}
