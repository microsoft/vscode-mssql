/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { CreateDatabaseWebviewController } from "../../src/controllers/createDatabaseWebviewController";
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

suite("CreateDatabaseWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let objectManagementServiceStub: sinon.SinonStubbedInstance<ObjectManagementService>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestHandlers: Map<string, (params: any) => Promise<any>>;
    let controller: CreateDatabaseWebviewController;

    const connectionUri = "test-connection-uri";
    const serverName = "test-server";

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

        // Stub initializeView to return view info
        objectManagementServiceStub.initializeView.resolves({
            objectInfo: { name: "", owner: "sa" },
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): CreateDatabaseWebviewController {
        controller = new CreateDatabaseWebviewController(
            mockContext,
            vscodeWrapperStub,
            objectManagementServiceStub,
            connectionUri,
            serverName,
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
        expect(args[4]).to.be.true; // isNewObject
    });

    test("handleSubmit should call save", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.save.resolves();

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const params = {
            name: "test-db",
            owner: "sa",
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.CreateDatabase,
            params,
        });

        expect(result.success).to.be.true;
        expect(objectManagementServiceStub.save.calledOnce).to.be.true;
    });

    test("handleSubmit should handle error", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.save.rejects(new Error("Save failed"));

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);

        const params = {
            name: "test-db",
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.CreateDatabase,
            params,
        });

        expect(result.success).to.be.false;
        expect(result.errorMessage).to.equal("Save failed");
    });

    test("handleScript should call script and open editor", async () => {
        createController();
        await waitForInitialization();
        const script = "CREATE DATABASE [test-db]";
        objectManagementServiceStub.script.resolves(script);

        // Stub openTextDocument and showTextDocument
        const mockDoc = {} as vscode.TextDocument;
        sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDoc);
        sandbox.stub(vscode.window, "showTextDocument").resolves({} as vscode.TextEditor);

        const requestHandler = requestHandlers.get(ObjectManagementScriptRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const params = {
            name: "test-db",
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.CreateDatabase,
            params,
        });

        expect(result.success).to.be.true;
        expect(objectManagementServiceStub.script.calledOnce).to.be.true;
    });

    test("handleScript should handle empty script", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.script.resolves("");

        const requestHandler = requestHandlers.get(ObjectManagementScriptRequest.type.method);

        const params = {
            name: "test-db",
        };

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.CreateDatabase,
            params,
        });

        expect(result.success).to.be.false;
        expect(vscodeWrapperStub.showWarningMessage.calledOnce).to.be.true;
    });
});
