/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    CreateSasParams,
    CreateSasRequest,
    CreateSasResponse,
} from "../models/contracts/azureBlob";

export class AzureBlobService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async createSas(
        ownerUri: string,
        blobContainerUri: string,
        blobContainerKey: string,
        storageAccountName: string,
        expirationDate: string,
    ): Promise<CreateSasResponse> {
        try {
            let params: CreateSasParams = {
                ownerUri,
                blobContainerUri,
                blobContainerKey,
                storageAccountName,
                expirationDate,
            };
            return await this._sqlToolsClient.sendRequest(CreateSasRequest.type, params);
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
