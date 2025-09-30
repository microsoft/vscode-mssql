/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../../src/constants/constants";
import * as sinon from "sinon";
import * as telemetry from "../../src/telemetry/telemetry";
import * as vscode from "vscode";
import { IExtension } from "vscode-mssql";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as path from "path";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { GetCapabilitiesRequest } from "../../src/models/contracts/connection";
import { buildCapabilitiesResult } from "./mocks";

// Launches and activates the extension
export async function activateExtension(): Promise<IExtension> {
    const extension = vscode.extensions.getExtension<IExtension>(constants.extensionId);
    return await extension.activate();
}

// Stubs the telemetry code
export function stubTelemetry(sandbox?: sinon.SinonSandbox): {
    sendActionEvent: sinon.SinonStub;
    sendErrorEvent: sinon.SinonStub;
} {
    const stubber = sandbox || sinon;
    return {
        sendActionEvent: stubber.stub(telemetry, "sendActionEvent").callsFake(() => {}),
        sendErrorEvent: stubber.stub(telemetry, "sendErrorEvent").callsFake(() => {}),
    };
}

export function stubVscodeWrapper(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<VscodeWrapper> {
    const stubber = sandbox || sinon;

    const vscodeWrapper = stubber.createStubInstance(VscodeWrapper);

    const outputChannel: vscode.OutputChannel = {
        name: "",
        append: stubber.stub(),
        appendLine: stubber.stub(),
        clear: stubber.stub(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        show: stubber.stub() as any,
        replace: stubber.stub(),
        hide: stubber.stub(),
        dispose: stubber.stub(),
    };

    stubber.stub(vscodeWrapper, "outputChannel").get(() => outputChannel);

    return vscodeWrapper;
}

export function stubGetCapabilitiesRequest(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<SqlToolsServerClient> {
    const stubber = sandbox || sinon;
    const serviceClientMock = stubber.createStubInstance(SqlToolsServerClient);
    serviceClientMock.sendRequest
        .withArgs(GetCapabilitiesRequest.type, sinon.match.any)
        .resolves(buildCapabilitiesResult());
    return serviceClientMock;
}

export function initializeIconUtils(): void {
    const { IconUtils } = require("../../src/utils/iconUtils");
    IconUtils.initialize(vscode.Uri.file(path.join(__dirname, "..", "..")));
}
