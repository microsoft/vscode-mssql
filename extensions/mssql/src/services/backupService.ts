/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    BackupConfigInfoResponse,
    BackupInfo,
    BackupParams,
    BackupResponse,
    DefaultDatabaseInfoParams,
} from "../sharedInterfaces/backup";
import { BackupConfigInfoRequest, BackupRequest } from "../models/contracts/backup";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";

export class BackupService implements BackupService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async getBackupConfigInfo(connectionUri: string): Promise<BackupConfigInfoResponse> {
        try {
            let params: DefaultDatabaseInfoParams = {
                ownerUri: connectionUri,
            };
            return await this._sqlToolsClient.sendRequest(BackupConfigInfoRequest.type, params);
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async backupDatabase(
        connectionUri: string,
        backupInfo: BackupInfo,
        taskMode: TaskExecutionMode,
    ): Promise<BackupResponse> {
        try {
            let params: BackupParams = {
                ownerUri: connectionUri,
                BackupInfo: backupInfo,
                taskExecutionMode: taskMode,
            };
            return await this._sqlToolsClient.sendRequest(BackupRequest.type, params);
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
