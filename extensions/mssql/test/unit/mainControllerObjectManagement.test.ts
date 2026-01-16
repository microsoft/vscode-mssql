/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { RenameObjectRequest } from "../../src/models/contracts/objectManagement";

chai.use(sinonChai);

suite("ObjectManagementService Rename Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let objectManagementService: ObjectManagementService;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        objectManagementService = new ObjectManagementService(sqlToolsClientStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("rename should send correct request with connection uri and new name", async () => {
        sqlToolsClientStub.sendRequest.resolves();

        await objectManagementService.rename(
            "connection-uri",
            "Database",
            "Server/Database[@Name='test-db']",
            "new-db-name",
        );

        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(RenameObjectRequest.type);
        expect(params).to.deep.equal({
            connectionUri: "connection-uri",
            objectType: "Database",
            objectUrn: "Server/Database[@Name='test-db']",
            newName: "new-db-name",
        });
    });

    test("rename should propagate errors from service", async () => {
        const error = new Error("Rename failed");
        sqlToolsClientStub.sendRequest.rejects(error);

        try {
            await objectManagementService.rename(
                "connection-uri",
                "Database",
                "Server/Database[@Name='test-db']",
                "new-db-name",
            );
            expect.fail("Should have thrown an error");
        } catch (e) {
            expect(e).to.equal(error);
        }
    });
});
