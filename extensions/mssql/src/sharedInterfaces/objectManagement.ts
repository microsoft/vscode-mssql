/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { BackupDatabaseParams, BackupDatabaseViewModel } from "./backup";
import { FormItemSpec, FormState } from "./form";
import { FileTypeOption, FileBrowserState } from "./fileBrowser";
import { IDialogProps } from "./connectionDialog";
import { RestoreDatabaseParams, RestoreDatabaseViewModel } from "./restore";
import { AzureSubscription, AzureTenant } from "@microsoft/vscode-azext-azureauth";
import { BlobContainer, StorageAccount } from "@azure/arm-storage";
import { ApiStatus } from "./webview";

export enum ObjectManagementDialogType {
    CreateDatabase = "createDatabase",
    DropDatabase = "dropDatabase",
    BackupDatabase = "backupDatabase",
    RestoreDatabase = "restoreDatabase",
}

export interface CreateDatabaseViewModel {
    serverName: string;
    databaseName?: string;
    ownerOptions?: string[];
    owner?: string;
    collationOptions?: string[];
    collationName?: string;
    recoveryModelOptions?: string[];
    recoveryModel?: string;
    compatibilityLevelOptions?: string[];
    compatibilityLevel?: string;
    containmentTypeOptions?: string[];
    containmentType?: string;
    isLedgerDatabase?: boolean;
}

export interface CreateDatabaseParams {
    name: string;
    owner?: string;
    collationName?: string;
    recoveryModel?: string;
    compatibilityLevel?: string;
    containmentType?: string;
    isLedgerDatabase?: boolean;
}

export interface DropDatabaseViewModel {
    serverName: string;
    databaseName: string;
    owner?: string;
    status?: string;
}

export interface DropDatabaseParams {
    dropConnections: boolean;
    deleteBackupHistory: boolean;
}

export type ObjectManagementViewModel =
    | {
          dialogType: ObjectManagementDialogType.CreateDatabase;
          model?: CreateDatabaseViewModel;
      }
    | {
          dialogType: ObjectManagementDialogType.DropDatabase;
          model?: DropDatabaseViewModel;
      }
    | {
          dialogType: ObjectManagementDialogType.BackupDatabase;
          model?: BackupDatabaseViewModel;
      }
    | {
          dialogType: ObjectManagementDialogType.RestoreDatabase;
          model?: RestoreDatabaseViewModel;
      };

export interface ObjectManagementWebviewState<TFormState> extends FormState<
    TFormState,
    ObjectManagementWebviewState<TFormState>,
    ObjectManagementFormItemSpec<TFormState>
> {
    viewModel: ObjectManagementViewModel;

    // Form specific state
    formState: TFormState;
    formComponents: Partial<Record<keyof TFormState, ObjectManagementFormItemSpec<TFormState>>>;
    formErrors: string[];

    // File browser specific state
    ownerUri: string;
    fileFilterOptions: FileTypeOption[];
    fileBrowserState: FileBrowserState | undefined;
    defaultFileBrowserExpandPath: string;
    dialog: IDialogProps | undefined;

    isLoading?: boolean;
    dialogTitle?: string;
    errorMessage?: string;
}

export type ObjectManagementActionParams =
    | {
          dialogType: ObjectManagementDialogType.CreateDatabase;
          params: CreateDatabaseParams;
      }
    | {
          dialogType: ObjectManagementDialogType.DropDatabase;
          params: DropDatabaseParams;
      }
    | {
          dialogType: ObjectManagementDialogType.BackupDatabase;
          params: BackupDatabaseParams;
      }
    | {
          dialogType: ObjectManagementDialogType.RestoreDatabase;
          params: RestoreDatabaseParams;
      };

export interface ObjectManagementActionResult {
    success: boolean;
    errorMessage?: string;
}

export namespace ObjectManagementSubmitRequest {
    export const type = new RequestType<
        ObjectManagementActionParams,
        ObjectManagementActionResult,
        void
    >("objectManagementWebview/submit");
}

export namespace ObjectManagementScriptRequest {
    export const type = new RequestType<
        ObjectManagementActionParams,
        ObjectManagementActionResult,
        void
    >("objectManagementWebview/script");
}

export namespace ObjectManagementCancelNotification {
    export const type = new NotificationType<void>("objectManagementWebview/cancel");
}

export namespace ObjectManagementHelpNotification {
    export const type = new NotificationType<void>("objectManagementWebview/help");
}

export interface ObjectManagementFormItemSpec<TFormState> extends FormItemSpec<
    TFormState,
    ObjectManagementWebviewState<TFormState>,
    ObjectManagementFormItemSpec<TFormState>
> {
    /**
     * The width of the form item component
     */
    componentWidth?: string;

    /**
     * The name of the advanced options group this item belongs to
     */
    groupName?: string;

    /**
     * Misc props for the form item component
     */
    componentProps?: any;
}

// Disaster Recovery Azure Interfaces
export interface DisasterRecoveryAzureFormState {
    accountId: string;
    tenantId: string;
    subscriptionId: string;
    storageAccountId: string;
    blobContainerId: string;
}

export class DisasterRecoveryViewModel {
    tenants: AzureTenant[] = [];
    subscriptions: AzureSubscription[] = [];
    storageAccounts: StorageAccount[] = [];
    blobContainers: BlobContainer[] = [];
    azureComponentStatuses: Record<string, ApiStatus> = {
        accountId: ApiStatus.NotStarted,
        tenantId: ApiStatus.NotStarted,
        subscriptionId: ApiStatus.NotStarted,
        storageAccountId: ApiStatus.NotStarted,
        blobContainerId: ApiStatus.NotStarted,
    };
}

export interface DisasterRecoveryAzureReducers {
    loadAzureComponent: { componentName: string };
}

export interface DisasterRecoveryAzureProvider {
    /**
     * Loads the specified Azure component for backup to URL operations
     * @param componentName  The name of the Azure component to load
     */
    loadAzureComponent(componentName: string): void;
}
