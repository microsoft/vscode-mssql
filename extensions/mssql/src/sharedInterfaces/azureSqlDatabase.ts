/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";

/**
 * Ordered list of Azure component names used for cascading load/reset.
 * Components are loaded in this order; changing a parent resets all downstream components.
 */
export const AZURE_SQL_DB_COMPONENT_ORDER = [
    "accountId",
    "tenantId",
    "subscriptionId",
    "resourceGroup",
    "serverName",
] as const;

export class AzureSqlDatabaseState
    implements
        FormState<AzureSqlDatabaseFormState, AzureSqlDatabaseState, AzureSqlDatabaseFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    // @ts-ignore
    formState: AzureSqlDatabaseFormState = undefined;
    formComponents: Partial<Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>> =
        {};
    formErrors: string[] = [];
    dialog: IDialogProps | undefined;
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    provisionLoadState: ApiStatus = ApiStatus.NotStarted;
    deploymentStartTime: string = "";
    subscriptions: AzureSubscription[] = [];
    azureComponentStatuses: Record<string, ApiStatus> = {
        accountId: ApiStatus.NotStarted,
        tenantId: ApiStatus.NotStarted,
        subscriptionId: ApiStatus.NotStarted,
        resourceGroup: ApiStatus.NotStarted,
        serverName: ApiStatus.NotStarted,
    };
    constructor(params?: Partial<AzureSqlDatabaseState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof AzureSqlDatabaseState] =
                    params[key as keyof AzureSqlDatabaseState]!;
            }
        }
    }
}

export interface AzureSqlDatabaseFormState {
    accountId: string;
    tenantId: string;
    subscriptionId: string;
    resourceGroup: string;
    serverName: string;
    databaseName: string;
    profileName: string;
    groupId: string;
}

export interface AzureSqlDatabaseFormItemSpec
    extends FormItemSpec<
        AzureSqlDatabaseFormState,
        AzureSqlDatabaseState,
        AzureSqlDatabaseFormItemSpec
    > {
    componentWidth: string;
}

export interface AzureSqlDatabaseContextProps extends FormContextProps<AzureSqlDatabaseFormState> {
    loadAzureComponent(componentName: string): void;
    startAzureSqlDatabaseDeployment(): void;
}

export interface AzureSqlDatabaseReducers extends FormReducers<AzureSqlDatabaseFormState> {
    loadAzureComponent: { componentName: string };
    startAzureSqlDatabaseDeployment: {};
}
