/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { RenameDatabaseWebviewController } from "../../src/controllers/renameDatabaseWebviewController";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    stubTelemetry,
    stubLogger,
    stubVscodeWrapper,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";
import {
    ObjectManagementSubmitRequest,
    ObjectManagementScriptRequest,
    ObjectManagementDialogType,
} from "../../src/sharedInterfaces/objectManagement";
import * as utils from "../../src/utils/utils";

suite("RenameDatabaseWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let objectManagementServiceStub: sinon.SinonStubbedInstance<ObjectManagementService>;
    let requestHandlers: Map<string, (params: unknown) => Promise<unknown>>;
    let initializeViewCalled: Promise<void>;
    let resolveInitializeViewCalled: (() => void) | undefined;

    const connectionUri = "test-connection-uri";
    const serverName = "test-server";
    const databaseName = "test-db";

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubLogger(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");

        const connection = stubWebviewConnectionRpc(sandbox);
        requestHandlers = connection.requestHandlers as Map<
            string,
            (params: unknown) => Promise<unknown>
        >;
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
        initializeViewCalled = new Promise<void>((resolve) => {
            resolveInitializeViewCalled = resolve;
        });
        objectManagementServiceStub.initializeView.callsFake(async () => {
            resolveInitializeViewCalled?.();
            return {
                objectInfo: { name: databaseName, owner: "sa", status: "Normal" },
            };
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): RenameDatabaseWebviewController {
        return new RenameDatabaseWebviewController(
            mockContext,
            vscodeWrapperStub,
            objectManagementServiceStub,
            connectionUri,
            serverName,
            databaseName,
        );
    }

    async function waitForInitialization(): Promise<void> {
        await initializeViewCalled;
    }

    test("initialization should call initializeView for the selected database", async () => {
        createController();
        await waitForInitialization();

        expect(
            objectManagementServiceStub.initializeView.calledWithMatch(
                sinon.match.string,
                "Database",
                connectionUri,
                databaseName,
                false,
            ),
        ).to.be.true;
    });

    test("handleSubmit should call renameDatabase", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.renameDatabase.resolves("");

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);
        expect(requestHandler).to.be.a("function");

        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.RenameDatabase,
            params: {
                newName: "renamed-db",
                dropConnections: true,
            },
        });

        expect(result).to.deep.equal({ success: true });
        expect(
            objectManagementServiceStub.renameDatabase.calledWith(
                connectionUri,
                databaseName,
                "renamed-db",
                true,
                false,
            ),
        ).to.be.true;
    });

    test("handleSubmit should surface service errors", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.renameDatabase.rejects(new Error("Rename failed"));

        const requestHandler = requestHandlers.get(ObjectManagementSubmitRequest.type.method);
        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.RenameDatabase,
            params: {
                newName: "renamed-db",
                dropConnections: false,
            },
        });

        expect(result).to.deep.equal({
            success: false,
            errorMessage: "Rename failed",
        });
    });

    test("handleScript should request a rename script and open it", async () => {
        createController();
        await waitForInitialization();
        objectManagementServiceStub.renameDatabase.resolves(
            "ALTER DATABASE [test-db] MODIFY NAME = [renamed-db]",
        );

        const mockDoc = {} as vscode.TextDocument;
        sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDoc);
        sandbox.stub(vscode.window, "showTextDocument").resolves({} as vscode.TextEditor);

        const requestHandler = requestHandlers.get(ObjectManagementScriptRequest.type.method);
        const result = await requestHandler!({
            dialogType: ObjectManagementDialogType.RenameDatabase,
            params: {
                newName: "renamed-db",
                dropConnections: true,
            },
        });

        expect(result).to.deep.equal({ success: true });
        expect(
            objectManagementServiceStub.renameDatabase.calledWith(
                connectionUri,
                databaseName,
                "renamed-db",
                true,
                true,
            ),
        ).to.be.true;
    });
});
