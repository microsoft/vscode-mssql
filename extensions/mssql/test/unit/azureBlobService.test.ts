/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { CreateSasRequest, CreateSasResponse } from "../../src/models/contracts/azureBlob";

suite("Azure Blob Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let azureBlobService: AzureBlobService;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);

        azureBlobService = new AzureBlobService(sqlToolsClientStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("createSas should successfully create a SAS token", async () => {
        const ownerUri = "conn";
        const blobContainerUri = "https://example.blob.core.windows.net/container";
        const blobContainerKey = "key";
        const storageAccountName = "examplestorage";
        const expirationDate = "exampleDate";

        sqlToolsClientStub.sendRequest
            .withArgs(CreateSasRequest.type, sinon.match.any)
            .resolves({ sharedAccessSignature: "sasToken" } as CreateSasResponse);

        const result = await azureBlobService.createSas(
            ownerUri,
            blobContainerUri,
            blobContainerKey,
            storageAccountName,
            expirationDate,
        );
        expect(result).to.deep.equal({ sharedAccessSignature: "sasToken" });
    });
});
