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

export interface AdsMigrationConnectionGroup {
    group: IConnectionGroup;
    selected: boolean;
    status: MigrationStatus;
    statusMessage: string;
}

export interface AdsMigrationConnection {
    profile: IConnectionDialogProfile;
    profileName?: string;
    selected: boolean;
    status: MigrationStatus;
    statusMessage: string;
}

export interface EntraSignInDialogProps {
    type: "entraSignIn";
    connectionId: string;
    title: string;
    message: string;
    accountDisplayName: string;
    tenantIdDisplayName: string;
    primaryButtonText: string;
    secondaryButtonText: string;
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
}

export namespace AzureDataStudioMigrationBrowseForConfigRequest {
    export const type = new RequestType<void, string | undefined, void>(
        "azureDataStudioMigration/browseConfig",
    );
}
