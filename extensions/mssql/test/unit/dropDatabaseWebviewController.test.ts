/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { DropDatabaseWebviewController } from "../../src/controllers/dropDatabaseWebviewController";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    stubTelemetry,
    stubVscodeWrapper,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";
import {
    ObjectManagementSubmitRequest,
    ObjectManagementScriptRequest,
    ObjectManagementDialogType,
} from "../../src/sharedInterfaces/objectManagement";
import { Logger } from "../../src/models/logger";
import * as utils from "../../src/utils/utils";

suite("DropDatabaseWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let objectManagementServiceStub: sinon.SinonStubbedInstance<ObjectManagementService>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestHandlers: Map<string, (params: any) => Promise<any>>;
    let controller: DropDatabaseWebviewController;

    const connectionUri = "test-connection-uri";
    const serverName = "test-server";
    const databaseName = "test-db";

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        const loggerStub = sandbox.createStubInstance(Logger);
        sandbox.stub(Logger, "create").returns(loggerStub);
        sandbox.stub(utils, "getNonce").returns("test-nonce");

        const connection = stubWebviewConnectionRpc(sandbox);
        requestHandlers = connection.requestHandlers;
        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(connection.connection as unknown as jsonRpc.MessageConnection);

        const panelStub = stubWebviewPanel(sandbox);
        sandbox.stub(vscode.window, "createWebviewPanel").callsFake(() => panelStub);

        mockContext = {
            extensionUri: vscode.Uri.file("/tmp/ext"),
            extensionPath: "/tmp/ext",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        objectManagementServiceStub = sandbox.createStubInstance(ObjectManagementService);

        objectManagementServiceStub.initializeView.resolves({
            objectInfo: { name: databaseName },
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): DropDatabaseWebviewController {
        controller = new DropDatabaseWebviewController(
            mockContext,
            vscodeWrapperStub,
            objectManagementServiceStub,
            connectionUri,
            serverName,
            databaseName,
        );
        return controller;
    }

    async function waitForInitialization(): Promise<void> {
        // Wait for the async initializeDialog to complete
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    test("initialization should call initializeView", async () => {
        createController();
        await waitForInitialization();

        expect(objectManagementServiceStub.initializeView.calledOnce).to.be.true;
        const args = objectManagementServiceStub.initializeView.firstCall.args;
        expect(args[2]).to.equal(connectionUri);
        expect(args[3]).to.equal(databaseName);
        expect(args[4]).to.be.false; // isNewObject
    });

    test("handleSubmit should call dropDatabase", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.dropDatabase.resolves("Done");

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const params = {
            dropConnections: true,
            deleteBackupHistory: false,
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.DropDatabase,
            params,
        });

        expect(result.success).to.be.true;
        expect(objectManagementServiceStub.dropDatabase.calledOnce).to.be.true;
        const args = objectManagementServiceStub.dropDatabase.firstCall.args;
        expect(args[1]).to.equal(databaseName);
        expect(args[2]).to.be.true; // dropConnections
        expect(args[3]).to.be.false; // deleteBackupHistory
        expect(args[4]).to.be.false; // generateScript
    });

    test("handleSubmit should handle error", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.dropDatabase.rejects(new Error("Drop failed"));

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);

        const params = {
            dropConnections: true,
            deleteBackupHistory: false,
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.DropDatabase,
            params,
        });

        expect(result.success).to.be.false;
        expect(result.errorMessage).to.equal("Drop failed");
    });

    test("handleScript should call dropDatabase with script flag", async () => {
        createController();
        await waitForInitialization();
        const script = "DROP DATABASE [test-db]";
        objectManagementServiceStub.dropDatabase.resolves(script);

        // Stub openTextDocument and showTextDocument
        const mockDoc = {} as vscode.TextDocument;
        sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDoc);
        sandbox.stub(vscode.window, "showTextDocument").resolves({} as vscode.TextEditor);

        const requestHandler = requestHandlers.get(ObjectManagementScriptRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const params = {
            dropConnections: true,
            deleteBackupHistory: false,
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.DropDatabase,
            params,
        });

        expect(result.success).to.be.true;
        expect(objectManagementServiceStub.dropDatabase.calledOnce).to.be.true;
        const args = objectManagementServiceStub.dropDatabase.firstCall.args;
        expect(args[4]).to.be.true; // generateScript is true
    });
});
