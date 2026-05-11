/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";
import { KnownSampleName } from "@azure/arm-sql";

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
    autoPauseDelay: number;
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

export interface CreateResourceGroupDrawerProps extends IDialogProps {
    type: "createResourceGroup";
    props: CreateResourceGroupDrawerState;
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

export interface CreateServerDrawerProps extends IDialogProps {
    type: "createServer";
    props: CreateServerDrawerState;
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
