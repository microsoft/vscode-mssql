/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";
import { KnownFreeLimitExhaustionBehavior, KnownSampleName, Server } from "@azure/arm-sql";
import { AzureSubscription, AzureTenant } from "@microsoft/vscode-azext-azureauth";

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

/** Centralized Azure SQL documentation URLs used across wizard pages. */
export const AzureSqlDatabaseLinks = {
    freeOffer: "https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer",
    serviceTiers:
        "https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-sql-database-vcore",
    createQuickstart:
        "https://learn.microsoft.com/en-us/azure/azure-sql/database/single-database-create-quickstart",
    connectQuerySsms:
        "https://learn.microsoft.com/en-us/azure/azure-sql/database/connect-query-ssms",
    azureSqlDocs: "https://learn.microsoft.com/en-us/azure/azure-sql/database/",
} as const;

export class AzureSqlDatabaseState
    implements
        FormState<AzureSqlDatabaseFormState, AzureSqlDatabaseState, AzureSqlDatabaseFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- formState is initialized in initializeAzureSqlDatabaseState before use
    formState: AzureSqlDatabaseFormState = undefined as any;
    formComponents: Partial<Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>> =
        {};
    formErrors: string[] = [];
    dialog: IDialogProps | undefined;
    createResourceGroupDrawerState: CreateResourceGroupDrawerState | undefined = undefined;
    createServerDrawerState: CreateServerDrawerState | undefined = undefined;
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    provisionLoadState: ApiStatus = ApiStatus.NotStarted;
    deploymentStartTime: string = "";
    connectionLoadState: ApiStatus = ApiStatus.NotStarted;
    /** True when the server was just created via the drawer with SQL auth credentials already provided */
    serverCreatedWithAuth: boolean = false;
    azureComponentStatuses: Record<string, ApiStatus> = {
        accountId: ApiStatus.NotStarted,
        tenantId: ApiStatus.NotStarted,
        subscriptionId: ApiStatus.NotStarted,
        resourceGroup: ApiStatus.NotStarted,
        serverName: ApiStatus.NotStarted,
        maintenanceConfig: ApiStatus.NotStarted,
    };
    accounts: { id: string; label: string }[] = [];
    tenants: AzureTenant[] = [];
    subscriptions: AzureSubscription[] = [];
    resourceGroups: string[] = [];
    servers: Server[] = [];
    locations: { name: string; displayName: string }[] = [];
    maintenanceConfigs: { name: string; id: string }[] = [];
    publicIp: string = "";
    subscriptionName: string = "";
    serverRegion: string = "";
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
    authenticationType: string;
    userName: string;
    password: string;
    savePassword: boolean;
    freeLimitBehavior: KnownFreeLimitExhaustionBehavior;
    profileName: string;
    groupId: string;
    dataSource: KnownSampleName | "";
    collation: string;
    maintenanceConfig: string;
    enableAlwaysEncrypted: boolean;
}

export interface AzureSqlDatabaseFormItemSpec
    extends FormItemSpec<
        AzureSqlDatabaseFormState,
        AzureSqlDatabaseState,
        AzureSqlDatabaseFormItemSpec
    > {
    componentWidth: string;
}

export interface CreateResourceGroupDrawerState {
    locationOptions: { name: string; displayName: string }[];
    locationsLoadState: ApiStatus;
    createLoadState: ApiStatus;
    message?: string;
}

export interface CreateResourceGroupSpec {
    resourceGroupName: string;
    location: string;
}

export interface CreateServerDrawerState {
    locationOptions: { name: string; displayName: string }[];
    locationsLoadState: ApiStatus;
    createLoadState: ApiStatus;
    defaultLocation?: string;
    message?: string;
}

export interface CreateServerSpec {
    serverName: string;
    location: string;
    authenticationType: string;
    adminLogin?: string;
    adminPassword?: string;
    savePassword?: boolean;
}

export interface AzureSqlDatabaseContextProps extends FormContextProps<AzureSqlDatabaseFormState> {
    loadAzureComponent(componentName: string): void;
    startAzureSqlDatabaseDeployment(tags: Record<string, string>): void;
    setCreateResourceGroupDrawerState(shouldOpen: boolean): void;
    submitCreateResourceGroup(spec: CreateResourceGroupSpec): void;
    setCreateServerDrawerState(shouldOpen: boolean): void;
    submitCreateServer(spec: CreateServerSpec): void;
}

export interface AzureSqlDatabaseReducers extends FormReducers<AzureSqlDatabaseFormState> {
    loadAzureComponent: { componentName: string };
    startAzureSqlDatabaseDeployment: { tags: Record<string, string> };
    setCreateResourceGroupDrawerState: { shouldOpen: boolean };
    submitCreateResourceGroup: { spec: CreateResourceGroupSpec };
    setCreateServerDrawerState: { shouldOpen: boolean };
    submitCreateServer: { spec: CreateServerSpec };
}
