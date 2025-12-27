/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";
import { IConnectionDialogProfile } from "./connectionDialog";
import { IConnectionGroup } from "./connectionGroup";

export enum MigrationStatus {
    NeedsAttention = "needsAttention",
    Ready = "ready",
    AlreadyImported = "alreadyImported",
}

export interface AdsMigrationItem {
    selected: boolean;
    status: MigrationStatus;
    statusMessage: string;
}

export interface AdsMigrationConnectionGroup extends AdsMigrationItem {
    group: IConnectionGroup;
}

export interface AdsMigrationConnection extends AdsMigrationItem {
    profile: IConnectionDialogProfile;
    profileName?: string;
}

export interface EntraAccountTenantOption {
    id: string;
    displayName: string;
}

export interface EntraAccountOption {
    id: string;
    displayName: string;
    tenants: EntraAccountTenantOption[];
}

export interface EntraSignInDialogProps {
    type: "entraSignIn";
    connectionId: string;
    originalEntraAccount: string;
    originalEntraTenantId: string;
    entraAuthAccounts: EntraAccountOption[];
}

export type AzureDataStudioMigrationDialogProps = EntraSignInDialogProps;

export interface AzureDataStudioMigrationWebviewState {
    adsConfigPath: string;
    connectionGroups: AdsMigrationConnectionGroup[];
    connections: AdsMigrationConnection[];
    rootGroupIds: string[];
    dialog?: AzureDataStudioMigrationDialogProps;
}

export interface AzureDataStudioMigrationReducers {
    openEntraSignInDialog: {
        connectionId: string;
    };
    closeDialog: {};
    signIntoEntraAccount: {
        connectionId: string;
    };
    selectAccount: {
        connectionId: string;
        accountId: string;
        tenantId: string;
    };
    enterSqlPassword: {
        connectionId: string;
        password: string;
    };
    setConnectionGroupSelections: {
        groupId?: string;
        selected: boolean;
    };
    setConnectionSelections: {
        connectionId?: string;
        selected: boolean;
    };
}

export namespace AzureDataStudioMigrationBrowseForConfigRequest {
    export const type = new RequestType<void, string | undefined, void>(
        "azureDataStudioMigration/browseConfig",
    );
}
