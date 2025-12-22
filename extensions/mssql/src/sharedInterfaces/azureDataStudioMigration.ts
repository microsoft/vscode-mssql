/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";

export interface AdsMigrationConnectionGroup {
    id: string;
    name: string;
    color: string;
    selected: boolean;
}

export interface AdsMigrationConnection {
    id: string;
    displayName: string;
    server: string;
    database?: string;
    authenticationType: string;
    userId?: string;
    groupId?: string;
    selected: boolean;
}

export interface AzureDataStudioMigrationWebviewState {
    adsConfigPath: string;
    connectionGroups: AdsMigrationConnectionGroup[];
    connections: AdsMigrationConnection[];
}

export namespace AzureDataStudioMigrationBrowseForConfigRequest {
    export const type = new RequestType<void, string | undefined, void>(
        "azureDataStudioMigration/browseConfig",
    );
}
