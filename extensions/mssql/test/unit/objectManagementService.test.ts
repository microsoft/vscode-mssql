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
import { RestoreParams } from "../../src/sharedInterfaces/restore";
import { Logger } from "../../src/models/logger";

suite("ObjectManagementService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let objectManagementService: ObjectManagementService;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let loggerStub: sinon.SinonStubbedInstance<Logger>; // Add this

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create logger stub
        loggerStub = {
            error: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            debug: sinon.stub(),
            // Add any other logger methods your code uses
        } as any;

        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        sandbox.stub(sqlToolsClientStub, "logger").get(() => loggerStub);

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
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.getBackupConfigInfo("ownerUri");
            expect.fail("Expected getBackupConfigInfo to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });

    test("backupDatabase returns backup response", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.backupDatabase("ownerUri", {} as any, 0);

        expect(result).to.equal(true);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.backupDatabase("ownerUri", {} as any, 0);
            expect.fail("Expected backupDatabase to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });

    test("getRestoreConfigInfo returns restore config info", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.getRestoreConfigInfo("ownerUri");

        expect(result).to.equal(true);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.getRestoreConfigInfo("ownerUri");
            expect.fail("Expected getRestoreConfigInfo to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });

    test("getRestorePlan returns restore plan", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.getRestorePlan({} as RestoreParams);

        expect(result).to.equal(true);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.getRestorePlan({} as RestoreParams);
            expect.fail("Expected getRestorePlan to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });

    test("cancelRestorePlan returns cancel result", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.cancelRestorePlan({} as RestoreParams);

        expect(result).to.equal(true);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.cancelRestorePlan({} as RestoreParams);
            expect.fail("Expected cancelRestorePlan to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });

    test("restoreDatabase returns restore response", async () => {
        sqlToolsClientStub.sendRequest.withArgs(sinon.match.any, sinon.match.any).resolves(true);

        const result = await objectManagementService.restoreDatabase({} as RestoreParams);

        expect(result).to.equal(true);
        expect(sqlToolsClientStub.sendRequest.calledOnce).to.be.true;

        const mockError = new Error("Request failed");

        sqlToolsClientStub.sendRequest
            .withArgs(sinon.match.any, sinon.match.any)
            .rejects(mockError);

        try {
            await objectManagementService.restoreDatabase({} as RestoreParams);
            expect.fail("Expected restoreDatabase to throw");
        } catch (e) {
            expect(e).to.equal(mockError);
        }
    });
});
