/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

export enum ObjectManagementDialogType {
    CreateDatabase = "createDatabase",
    DropDatabase = "dropDatabase",
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
      };

export interface ObjectManagementWebviewState {
    viewModel: ObjectManagementViewModel;
    isLoading?: boolean;
    dialogTitle?: string;
}

export type ObjectManagementActionParams =
    | {
          dialogType: ObjectManagementDialogType.CreateDatabase;
          params: CreateDatabaseParams;
      }
    | {
          dialogType: ObjectManagementDialogType.DropDatabase;
          params: DropDatabaseParams;
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
