/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";
import { IConnectionDialogProfile } from "./connectionDialog";
import { IConnectionGroup } from "./connectionGroup";

export interface AdsMigrationConnectionGroup extends IConnectionGroup {
    selected: boolean;
    status: AdsMigrationConnectionGroupStatus;
}

export type AdsMigrationConnectionStatus = "ready" | "needsAttention";
export type AdsMigrationConnectionResolvedStatus = AdsMigrationConnectionStatus | "alreadyImported";
export type AdsMigrationConnectionGroupStatus = "ready" | "alreadyImported";

export interface AdsMigrationConnection {
    profile: IConnectionDialogProfile;
    issue?: "missingCredentials";
    selected: boolean;
    status: AdsMigrationConnectionResolvedStatus;
}

export interface AzureDataStudioMigrationWebviewState {
    adsConfigPath: string;
    connectionGroups: AdsMigrationConnectionGroup[];
    connections: AdsMigrationConnection[];
    rootGroupIds: string[];
}

export namespace AzureDataStudioMigrationBrowseForConfigRequest {
    export const type = new RequestType<void, string | undefined, void>(
        "azureDataStudioMigration/browseConfig",
    );
}
