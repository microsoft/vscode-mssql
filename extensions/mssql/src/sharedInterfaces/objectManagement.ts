/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import {
    BackupDatabaseFormState,
    BackupDatabaseParams,
    BackupDatabaseReducers,
    BackupDatabaseViewModel,
} from "./backup";
import { FormItemSpec, FormState } from "./form";
import { FileTypeOption, FileBrowserState } from "./fileBrowser";
import { IDialogProps } from "./connectionDialog";

export enum ObjectManagementDialogType {
    CreateDatabase = "createDatabase",
    DropDatabase = "dropDatabase",
    BackupDatabase = "backupDatabase",
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
      };

export interface ObjectManagementWebviewState
    extends FormState<
        ObjectManagementFormState,
        ObjectManagementWebviewState,
        ObjectManagementFormItemSpec
    > {
    viewModel: ObjectManagementViewModel;

    // Form specific state
    formState: ObjectManagementFormState;
    formComponents: Partial<Record<keyof ObjectManagementFormState, ObjectManagementFormItemSpec>>;
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
      };

// If there are more object management form types in the future, add them here
export type ObjectManagementFormState = BackupDatabaseFormState;

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

export interface ObjectManagementFormItemSpec
    extends FormItemSpec<
        ObjectManagementFormState,
        ObjectManagementWebviewState,
        ObjectManagementFormItemSpec
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

// If there are more object management form reducers in the future, add them here
export type ObjectManagementReducers = BackupDatabaseReducers;
