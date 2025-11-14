/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";

import { expect } from "chai";

import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ChangePasswordService } from "../../src/services/changePasswordService";
import { ChangePasswordRequest } from "../../src/models/contracts/changePassword";
import { IConnectionInfo } from "vscode-mssql";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import * as changePasswordWebviewControllerModule from "../../src/controllers/changePasswordWebviewController";
import * as utils from "../../src/models/utils";
import { ChangePasswordResult } from "../../src/sharedInterfaces/changePassword";

chai.use(sinonChai);

suite("ChangePasswordService", () => {
    let sandbox: sinon.SinonSandbox;
    let clientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let extensionContext: vscode.ExtensionContext;
    let service: ChangePasswordService;

    const credentials: IConnectionInfo = {
        server: "test-server",
        user: "test-user",
        connectionString: "Server=test-server;User ID=test-user;",
    } as IConnectionInfo;

    setup(() => {
        sandbox = sinon.createSandbox();
        clientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        vscodeWrapperStub = sandbox.createStubInstance(VscodeWrapper);
        extensionContext = {
            extensionUri: vscode.Uri.file("/tmp/test"),
            extensionPath: "/tmp/test",
        } as unknown as vscode.ExtensionContext;

        service = new ChangePasswordService(clientStub, extensionContext, vscodeWrapperStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("handleChangePassword shows webview and returns resolved password", async () => {
        const webviewStub = {
            whenWebviewReady: sandbox.stub().resolves(),
            revealToForeground: sandbox.stub(),
            dialogResult: {
                promise: Promise.resolve("newSecurePassword"),
            },
        } as unknown as changePasswordWebviewControllerModule.ChangePasswordWebviewController;

        const controllerCtorStub = sandbox
            .stub(changePasswordWebviewControllerModule, "ChangePasswordWebviewController")
            .returns(webviewStub);

        const result = await service.handleChangePassword(credentials);

        expect(result).to.equal("newSecurePassword");
        expect(controllerCtorStub).to.have.been.calledOnceWithExactly(
            extensionContext,
            vscodeWrapperStub,
            credentials,
            service,
        );
        expect(webviewStub.whenWebviewReady).to.have.been.calledOnce;
        expect(webviewStub.revealToForeground).to.have.been.calledOnce;
    });

    test("changePassword sends request with expected payload", async () => {
        const connectionDetails = {
            options: { server: credentials.server },
        } as unknown as ReturnType<typeof ConnectionCredentials.createConnectionDetails>;

        sandbox.stub(ConnectionCredentials, "createConnectionDetails").returns(connectionDetails);
        sandbox.stub(utils, "generateGuid").returns("guid-1234");

        const expectedResult: ChangePasswordResult = { result: true };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.changePassword(credentials, "anotherPassword");

        expect(clientStub.sendRequest).to.have.been.calledOnceWithExactly(
            ChangePasswordRequest.type,
            {
                ownerUri: "changePassword:guid-1234",
                connection: connectionDetails,
                newPassword: "anotherPassword",
            },
        );
        expect(result).to.deep.equal(expectedResult);
    });

    test("changePassword returns failure result when request throws", async () => {
        const connectionDetails = { options: {} } as unknown as ReturnType<
            typeof ConnectionCredentials.createConnectionDetails
        >;

        sandbox.stub(ConnectionCredentials, "createConnectionDetails").returns(connectionDetails);
        sandbox.stub(utils, "generateGuid").returns("guid-5678");

        clientStub.sendRequest.rejects(new Error("service failure"));

        const result = await service.changePassword(credentials, "failingPassword");

        expect(result).to.deep.equal({
            result: false,
            errorMessage: "service failure",
        });
    });
});
