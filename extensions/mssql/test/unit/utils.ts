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
import * as jsonRpc from "vscode-jsonrpc/node";
import { UserSurvey } from "../../src/nps/userSurvey";
import { IPrompter } from "../../src/prompts/question";
import CodeAdapter from "../../src/prompts/adapter";
import { buildCapabilitiesResult } from "./mocks";
import { GetCapabilitiesRequest } from "../../src/models/contracts/connection";

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
        .withArgs(GetCapabilitiesRequest.type)
        .resolves(buildCapabilitiesResult());
    return serviceClientMock;
}

/**
 * Stubs a vscode.WebviewPanel
 * @param sandbox The sinon sandbox to use
 * @returns A stubbed vscode.WebviewPanel
 */
export function stubWebviewPanel(sandbox: sinon.SinonSandbox): vscode.WebviewPanel {
    const webviewStub = {
        postMessage: sandbox.stub().resolves(true),
        onDidReceiveMessage: sandbox.stub().callsFake(() => {
            return { dispose: sandbox.stub() } as vscode.Disposable;
        }),
        asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("file:///webview")),
        html: "",
    } as unknown as vscode.Webview;

    return {
        webview: webviewStub,
        visible: true,
        reveal: sandbox.stub(),
        dispose: sandbox.stub(),
        onDidDispose: sandbox.stub().callsFake(() => {
            return { dispose: sandbox.stub() } as vscode.Disposable;
        }),
        onDidChangeViewState: sandbox.stub().callsFake(() => {
            return { dispose: sandbox.stub() } as vscode.Disposable;
        }),
    } as unknown as vscode.WebviewPanel;
}

/**
 * Stubs a webview connection RPC
 * @param sandbox The sinon sandbox to use
 * @returns An object containing request and notification handlers and the connection stub
 */
export function stubWebviewConnectionRpc(sandbox: sinon.SinonSandbox): {
    requestHandlers: Map<string, (password: string) => Promise<unknown>>;
    notificationHandlers: Map<string, () => void>;
    connection: jsonRpc.MessageConnection;
} {
    const requestHandlers = new Map();
    const notificationHandlers = new Map();
    const connection = {
        onRequest: sandbox.stub().callsFake((type, handler) => {
            requestHandlers.set(type.method, handler as (password: string) => Promise<unknown>);
        }),
        onNotification: sandbox.stub().callsFake((type, handler) => {
            notificationHandlers.set(type.method, handler as () => void);
        }),
        sendNotification: sandbox.stub(),
        sendRequest: sandbox.stub(),
        listen: sandbox.stub(),
        dispose: sandbox.stub(),
    } as unknown as jsonRpc.MessageConnection;
    return { requestHandlers, notificationHandlers, connection };
}

export function stubUserSurvey(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<UserSurvey> {
    const stubber = sandbox || sinon;

    const userSurvey = stubber.createStubInstance(UserSurvey);
    userSurvey.promptUserForNPSFeedback.resolves();

    stubber.stub(UserSurvey, "getInstance").returns(userSurvey);

    return userSurvey;
}

export function stubExtensionContext(sandbox?: sinon.SinonSandbox): vscode.ExtensionContext {
    const stubber = sandbox || sinon;

    let globalState = {
        get: stubber.stub(),
        update: stubber.stub(),
    };

    const context = {
        globalState: globalState,
        extensionUri: vscode.Uri.parse("file://testExtensionPath"),
        extensionPath: "testExtensionPath",
        subscriptions: [],
        logUri: vscode.Uri.parse("file://testLogPath"),
    } as unknown as vscode.ExtensionContext;

    return context;
}

export function stubPrompter(sandbox?: sinon.SinonSandbox): sinon.SinonStubbedInstance<IPrompter> {
    const stubber = sandbox || sinon;

    const prompter = stubber.createStubInstance(CodeAdapter); // CodeAdapter is an implementation of IPrompter

    return prompter;
}

export function initializeIconUtils(): void {
    const { IconUtils } = require("../../src/utils/iconUtils");
    IconUtils.initialize(vscode.Uri.file(path.join(__dirname, "..", "..")));
}

export function stubWithProgress(
    sandbox: sinon.SinonSandbox,
    onInvoke: (
        options: vscode.ProgressOptions,
        task: (
            progress: vscode.Progress<{
                message?: string;
                increment?: number;
            }>,
            token: vscode.CancellationToken,
        ) => Thenable<unknown>,
    ) => Thenable<unknown>,
): sinon.SinonStub {
    return sandbox.stub(vscode.window, "withProgress").callsFake(onInvoke);
}

export function stubPathAsPlatform(sandbox: sinon.SinonSandbox, platform: path.PlatformPath): void {
    if (
        (process.platform === "win32" && platform === path.win32) ||
        (process.platform !== "win32" && platform === path.posix)
    ) {
        // stubbing the path module to the same platform results in infinite recursion when calling the stubbed methods.
        return;
    }

    sandbox.stub(path, "dirname").callsFake(platform.dirname);
    sandbox.stub(path, "join").callsFake(platform.join);
    sandbox.stub(path, "basename").callsFake(platform.basename);
    sandbox.stub(path, "extname").callsFake(platform.extname);
    sandbox.stub(path, "isAbsolute").callsFake(platform.isAbsolute);
    sandbox.stub(path, "normalize").callsFake(platform.normalize);
}
