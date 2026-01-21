/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

export enum ObjectManagementDialogType {
    CreateDatabase = "createDatabase",
    DropDatabase = "dropDatabase",
    User = "user",
}

export type UserType =
    | "LoginMapped"
    | "WindowsUser"
    | "SqlAuthentication"
    | "AADAuthentication"
    | "NoLoginAccess";

export interface PermissionMetadata {
    name: string;
    displayName?: string;
}

export interface SecurableTypeMetadata {
    name: string;
    displayName?: string;
    permissions?: PermissionMetadata[];
}

export interface SecurablePermissionItem {
    permission: string;
    grantor?: string;
    grant?: boolean;
    withGrant?: boolean;
}

export interface SecurablePermissions {
    name: string;
    schema?: string;
    type: string;
    permissions?: SecurablePermissionItem[];
    effectivePermissions?: string[];
}

export interface UserInfo {
    name: string;
    type?: UserType;
    loginName?: string;
    password?: string;
    defaultSchema?: string;
    ownedSchemas?: string[];
    databaseRoles?: string[];
    defaultLanguage?: string;
    securablePermissions?: SecurablePermissions[];
}

export interface UserViewModel {
    serverName: string;
    databaseName: string;
    isNewObject: boolean;
    user: UserInfo;
    userTypes: UserType[];
    schemas: string[];
    logins: string[];
    databaseRoles: string[];
    languages: string[];
    supportedSecurableTypes: SecurableTypeMetadata[];
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

export type UserParams = UserInfo;

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
          dialogType: ObjectManagementDialogType.User;
          model?: UserViewModel;
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
      }
    | {
          dialogType: ObjectManagementDialogType.User;
          params: UserParams;
      };

export interface ObjectManagementSearchParams {
    objectTypes: string[];
    searchText?: string;
    schema?: string;
    database?: string;
}

export interface ObjectManagementSearchActionParams {
    dialogType: ObjectManagementDialogType;
    params: ObjectManagementSearchParams;
}

export interface ObjectManagementSearchResultItem {
    name: string;
    schema?: string;
    type?: string;
}

export interface ObjectManagementSearchResult {
    success: boolean;
    errorMessage?: string;
    results?: ObjectManagementSearchResultItem[];
}

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

export namespace ObjectManagementSearchRequest {
    export const type = new RequestType<
        ObjectManagementSearchActionParams,
        ObjectManagementSearchResult,
        void
    >("objectManagementWebview/search");
}

export namespace ObjectManagementCancelNotification {
    export const type = new NotificationType<void>("objectManagementWebview/cancel");
}

export namespace ObjectManagementHelpNotification {
    export const type = new NotificationType<void>("objectManagementWebview/help");
}
