/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";

import { expect } from "chai";

import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { BackupService } from "../../src/services/backupService";
import { BackupConfigInfoRequest } from "../../src/models/contracts/backup";

chai.use(sinonChai);

suite("BackupService", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let service: BackupService;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);

        service = new BackupService(mockClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getBackupConfigInfo returns backup config info", async () => {
        mockClient.sendRequest
            .withArgs(BackupConfigInfoRequest.type, sinon.match.any)
            .resolves(true);

        const result = await service.getBackupConfigInfo("ownerUri");

        expect(result).to.equal(true);
    });

    test("backupDatabase returns backup response", async () => {
        mockClient.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await service.backupDatabase("ownerUri", {} as any, 0);

        expect(result).to.equal(true);
    });
});
