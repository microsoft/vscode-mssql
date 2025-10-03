/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";

import { expect } from "chai";

import * as jsonRpc from "vscode-jsonrpc/node";

import { ChangePasswordWebviewController } from "../../src/controllers/changePasswordWebviewController";
import { ChangePasswordService } from "../../src/services/changePasswordService";
import {
    ChangePasswordWebviewRequest,
    CancelChangePasswordWebviewNotification,
} from "../../src/sharedInterfaces/changePassword";
import * as LocConstants from "../../src/constants/locConstants";
import {
    stubTelemetry,
    stubVscodeWrapper,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IConnectionInfo } from "vscode-mssql";
import { Logger } from "../../src/models/logger";
import * as utils from "../../src/utils/utils";

chai.use(sinonChai);

suite("ChangePasswordWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let changePasswordServiceStub: sinon.SinonStubbedInstance<ChangePasswordService>;
    let requestHandlers: Map<string, (password: string) => Promise<unknown>>;
    let notificationHandlers: Map<string, () => void>;
    let connectionStub: jsonRpc.MessageConnection;
    let createWebviewPanelStub: sinon.SinonStub;
    let panelStub: vscode.WebviewPanel;
    let controller: ChangePasswordWebviewController;
    let credentials: IConnectionInfo;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        const loggerStub = sandbox.createStubInstance(Logger);
        sandbox.stub(Logger, "create").returns(loggerStub);

        sandbox.stub(utils, "getNonce").returns("test-nonce");
        sandbox.stub(LocConstants.Connection, "ChangePassword").value("Change Password");

        const connection = stubWebviewConnectionRpc(sandbox);

        requestHandlers = connection.requestHandlers;
        notificationHandlers = connection.notificationHandlers;

        connectionStub = connection.connection;
        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(connectionStub as unknown as jsonRpc.MessageConnection);

        panelStub = stubWebviewPanel(sandbox);

        createWebviewPanelStub = sandbox
            .stub(vscode.window, "createWebviewPanel")
            .callsFake(() => panelStub);

        mockContext = {
            extensionUri: vscode.Uri.file("/tmp/ext"),
            extensionPath: "/tmp/ext",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        changePasswordServiceStub = sandbox.createStubInstance(ChangePasswordService);

        credentials = {
            server: "test-server",
            user: "test-user",
        } as IConnectionInfo;
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): ChangePasswordWebviewController {
        controller = new ChangePasswordWebviewController(
            mockContext,
            vscodeWrapperStub,
            credentials,
            changePasswordServiceStub,
        );
        return controller;
    }

    test("change password request resolves dialog and disposes panel on success", async () => {
        changePasswordServiceStub.changePassword.resolves({ result: true });
        createController();

        expect(createWebviewPanelStub).to.have.been.calledOnce;

        const requestHandler = requestHandlers.get(ChangePasswordWebviewRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const resultPromise = controller.dialogResult.promise;
        const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");

        const response = await requestHandler!("updatedPassword");
        const dialogValue = await resultPromise;

        expect(changePasswordServiceStub.changePassword).to.have.been.calledOnceWithExactly(
            credentials,
            "updatedPassword",
        );
        expect(resolveSpy).to.have.been.calledOnceWithExactly("updatedPassword");
        expect(panelStub.dispose).to.have.been.calledOnce;
        expect(response).to.deep.equal({ result: true });
        expect(dialogValue).to.equal("updatedPassword");
    });

    test("change password request returns error object when service fails", async () => {
        changePasswordServiceStub.changePassword.rejects(new Error("network failure"));
        createController();

        const requestHandler = requestHandlers.get(ChangePasswordWebviewRequest.type.method);
        expect(requestHandler, "Request handler was not registered").to.be.a("function");

        const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");

        const response = await requestHandler!("badPassword");

        expect(changePasswordServiceStub.changePassword).to.have.been.calledOnceWithExactly(
            credentials,
            "badPassword",
        );
        expect(response).to.deep.equal({ error: "network failure" });
        expect(panelStub.dispose).to.not.have.been.called;
        expect(resolveSpy).to.not.have.been.called;
    });

    test("cancel notification resolves dialog with undefined and disposes panel", async () => {
        createController();

        const cancelHandler = notificationHandlers.get(
            CancelChangePasswordWebviewNotification.type.method,
        );
        expect(cancelHandler, "Cancel handler was not registered").to.be.a("function");

        const resultPromise = controller.dialogResult.promise;
        const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");

        (cancelHandler as () => void)();
        const resolvedValue = await resultPromise;

        expect(resolveSpy).to.have.been.calledOnceWithExactly(undefined);
        expect(panelStub.dispose).to.have.been.calledOnce;
        expect(resolvedValue).to.be.undefined;
    });
});
