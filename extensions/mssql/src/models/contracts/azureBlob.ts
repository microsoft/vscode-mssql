/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

export namespace CreateSasRequest {
    export const type = new RequestType<CreateSasParams, CreateSasResponse, void, void>(
        "blob/createSas",
    );
}

export interface CreateSasParams {
    ownerUri: string;
    blobContainerUri: string;
    blobContainerKey: string;
    storageAccountName: string;
    expirationDate: string;
}

export interface CreateSasResponse {
    sharedAccessSignature: string;
}

export interface AzureBlobService {
    /**
     * Creates a Shared Access Signature (SAS) for a blob container.
     * @param ownerUri The URI of the owner
     * @param blobContainerUri The URI of the blob container
     * @param blobContainerKey The key of the blob container
     * @param storageAccountName The name of the storage account
     * @param expirationDate The expiration date of the SAS
     * @returns A response containing the generated SAS.
     */
    createSas(
        ownerUri: string,
        blobContainerUri: string,
        blobContainerKey: string,
        storageAccountName: string,
        expirationDate: string,
    ): Promise<CreateSasResponse>;
}
