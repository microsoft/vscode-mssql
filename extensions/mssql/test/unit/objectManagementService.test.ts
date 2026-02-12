/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    InitializeViewRequest,
    SaveObjectRequest,
    ScriptObjectRequest,
    DisposeViewRequest,
    RenameObjectRequest,
    DropDatabaseRequest,
    ObjectManagementSqlObject,
    BackupConfigInfoRequest,
} from "../../src/models/contracts/objectManagement";

suite("ObjectManagementService Tests", () => {
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

    test("initializeView should send correct request", async () => {
        const expectedResponse = { objectInfo: {} };
        sqlToolsClientStub.sendRequest.resolves(expectedResponse);

        const result = await objectManagementService.initializeView(
            "context-id",
            "Database",
            "connection-uri",
            "database-name",
            true,
            "parent-urn",
            "object-urn",
        );

        expect(result).to.deep.equal(expectedResponse);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(InitializeViewRequest.type);
        expect(params).to.deep.equal({
            contextId: "context-id",
            objectType: "Database",
            connectionUri: "connection-uri",
            database: "database-name",
            isNewObject: true,
            parentUrn: "parent-urn",
            objectUrn: "object-urn",
        });
    });

    test("save should send correct request", async () => {
        const object: ObjectManagementSqlObject = { name: "test-object" };
        sqlToolsClientStub.sendRequest.resolves();

        await objectManagementService.save("context-id", object);

        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(SaveObjectRequest.type);
        expect(params).to.deep.equal({
            contextId: "context-id",
            object,
        });
    });

    test("script should send correct request", async () => {
        const object: ObjectManagementSqlObject = { name: "test-object" };
        const expectedScript = "CREATE DATABASE ...";
        sqlToolsClientStub.sendRequest.resolves(expectedScript);

        const result = await objectManagementService.script("context-id", object);

        expect(result).to.equal(expectedScript);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(ScriptObjectRequest.type);
        expect(params).to.deep.equal({
            contextId: "context-id",
            object,
        });
    });

    test("disposeView should send correct request", async () => {
        sqlToolsClientStub.sendRequest.resolves();

        await objectManagementService.disposeView("context-id");

        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(DisposeViewRequest.type);
        expect(params).to.deep.equal({
            contextId: "context-id",
        });
    });

    test("rename should send correct request", async () => {
        sqlToolsClientStub.sendRequest.resolves();

        await objectManagementService.rename(
            "connection-uri",
            "Database",
            "object-urn",
            "new-name",
        );

        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(RenameObjectRequest.type);
        expect(params).to.deep.equal({
            connectionUri: "connection-uri",
            objectType: "Database",
            objectUrn: "object-urn",
            newName: "new-name",
        });
    });

    test("dropDatabase should send correct request", async () => {
        sqlToolsClientStub.sendRequest.resolves("script");

        const result = await objectManagementService.dropDatabase(
            "connection-uri",
            "database-name",
            true,
            false,
            true,
        );

        expect(result).to.equal("script");
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;
        const [type, params] = sqlToolsClientStub.sendRequest.firstCall.args;
        expect(type).to.equal(DropDatabaseRequest.type);
        expect(params).to.deep.equal({
            connectionUri: "connection-uri",
            database: "database-name",
            dropConnections: true,
            deleteBackupHistory: false,
            generateScript: true,
        });
    });

    test("getBackupConfigInfo returns backup config info", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(BackupConfigInfoRequest.type, sinon.match.any)
            .resolves(true);

        const result = await objectManagementService.getBackupConfigInfo("ownerUri");

        expect(result).to.equal(true);
    });

    test("backupDatabase returns backup response", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.backupDatabase("ownerUri", {} as any, 0);

        expect(result).to.equal(true);
    });
});
