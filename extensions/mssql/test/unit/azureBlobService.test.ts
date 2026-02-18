/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";

import { expect } from "chai";

import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { CreateSasRequest } from "../../src/models/contracts/azureBlob";

chai.use(sinonChai);

suite("AzureBlobService", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let service: AzureBlobService;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);

        service = new AzureBlobService(mockClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("createSas returns sas key", async () => {
        mockClient.sendRequest.withArgs(CreateSasRequest.type, sinon.match.any).resolves(true);

        const result = await service.createSas(
            "ownerUri",
            "blobContainerUri",
            "blobContainerKey",
            "storageAccountName",
            "expirationDate",
        );
        expect(result).to.equal(true);
    });
});
