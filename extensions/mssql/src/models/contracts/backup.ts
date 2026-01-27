/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import {
    BackupParams,
    DefaultDatabaseInfoParams,
    BackupConfigInfoResponse,
    BackupResponse,
} from "../../sharedInterfaces/backup";

export namespace BackupRequest {
    export const type = new RequestType<BackupParams, BackupResponse, void, void>("backup/backup");
}

export namespace BackupConfigInfoRequest {
    export const type = new RequestType<
        DefaultDatabaseInfoParams,
        BackupConfigInfoResponse,
        void,
        void
    >("backup/backupconfiginfo");
}
