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
import { getLogger } from "../models/logger";

const logger = getLogger("AzureBlobService");

export class AzureBlobService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}

    /**
     * Creates a Shared Access Signature (SAS) for a blob container, and save the credentials in the connection.
     * @param ownerUri The connection URI
     * @param blobContainerUri The URI of the blob container
     * @param blobContainerKey The key of the blob container
     * @param storageAccountName  The name of the storage account
     * @param expirationDate The expiration date of the SAS
     * @returns A response containing the generated SAS.
     */
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
            logger.error("Failed to create SAS", e);
            throw e;
        }
    }
}
