/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as locConstants from "../../src/constants/locConstants";
import * as sinon from "sinon";
import * as utils from "../../src/utils/utils";
import * as vscode from "vscode";

import { MssqlWebviewPanelOptions } from "../../src/sharedInterfaces/webview";
import { ReactWebviewPanelController } from "../../src/controllers/reactWebviewPanelController";
import { stubTelemetery as stubTelemetry } from "./utils";

suite("ReactWebviewPanelController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let createWebviewPanelStub: sinon.SinonStub;
    let locConstantsStub: any;

    // Mock WebviewPanel and Webview
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;

    let showInformationMessageStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockWebview = {
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox
                .stub()
                .returns(vscode.Uri.parse("https://example.com/")),
            onDidReceiveMessage: sandbox.stub(),
        } as any;
        showInformationMessageStub = sandbox.stub(
            vscode.window,
            "showInformationMessage",
        );
        mockPanel = {
            webview: mockWebview,
            title: "Test Panel",
            viewColumn: vscode.ViewColumn.One,
            options: {},
            reveal: sandbox.stub(),
            dispose: sandbox.stub(),
            onDidDispose: sandbox.stub(),
            onDidChangeViewState: sandbox.stub(),
            iconPath: undefined,
        } as any;

        createWebviewPanelStub = sandbox
            .stub(vscode.window, "createWebviewPanel")
            .returns(mockPanel);
        stubTelemetry(sandbox);
        // Stub locConstants
        locConstantsStub = {
            Webview: {
                webviewRestorePrompt: sandbox
                    .stub()
                    .returns("Restore webview?"),
                Restore: "Restore",
            },
        };
        sandbox.stub(locConstants, "Webview").value(locConstantsStub.Webview);

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;
        sandbox.stub(utils, "getNonce").returns("test-nonce");
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(options: Partial<MssqlWebviewPanelOptions> = {}) {
        const defaultOptions: MssqlWebviewPanelOptions = {
            title: "Test Panel",
            viewColumn: vscode.ViewColumn.One,
            iconPath: vscode.Uri.file("path"),
            showRestorePromptAfterClose: true,
        };

        const controller = new TestReactWebviewPanelController(mockContext, {
            ...defaultOptions,
            ...options,
        });
        return controller;
    }

    test("should create a WebviewPanel with correct options upon initialization", () => {
        const options = {
            title: "My Test Panel",
            viewColumn: vscode.ViewColumn.Two,
            iconPath: vscode.Uri.file("/path/to/test-icon.png"),
            showRestorePromptAfterClose: true,
        };
        createController(options);
        assert.ok(createWebviewPanelStub.calledOnce);
        assert.ok(
            createWebviewPanelStub.calledWith(
                "mssql-react-webview",
                options.title,
                options.viewColumn,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.file(mockContext.extensionPath),
                    ],
                },
            ),
        );

        assert.ok(mockPanel.webview.html.includes("testSource.js"));
        assert.strictEqual(mockPanel.iconPath, options.iconPath);
    });

    test("should register onDidDispose handler that disposes the controller", async () => {
        createController();
        const disposeSpy = mockPanel.onDidDispose as sinon.SinonSpy;
        const disposeHandler = disposeSpy.firstCall.args[0];
        assert.ok(disposeSpy.called, "onDidDispose should be called once");
        assert.strictEqual(
            typeof disposeHandler,
            "function",
            "Dispose handler should be a function",
        );
    });

    test("Should register onDidReceiveMessage handler", () => {
        createController();
        const onDidReceiveMessageSpy =
            mockWebview.onDidReceiveMessage as sinon.SinonSpy;
        assert.ok(
            onDidReceiveMessageSpy.calledOnce,
            "onDidReceiveMessage should be called once",
        );
        const onDidReceiveMessageHandler =
            onDidReceiveMessageSpy.firstCall.args[0];
        assert.strictEqual(
            typeof onDidReceiveMessageHandler,
            "function",
            "onDidReceiveMessage handler should be a function",
        );
    });

    test("Should reveal the panel to the foreground", () => {
        const controller = createController();
        const revealSpy = mockPanel.reveal as sinon.SinonSpy;
        controller.revealToForeground();
        assert.ok(revealSpy.calledOnce, "reveal should be called once");
        assert.ok(revealSpy.calledWith(vscode.ViewColumn.One, true));
    });

    test("Should reveal the panel to the foreground with the specified view column", () => {
        const controller = createController();
        const revealSpy = mockPanel.reveal as sinon.SinonSpy;
        controller.revealToForeground(vscode.ViewColumn.Two);
        assert.ok(revealSpy.calledOnce, "reveal should be called once");
        assert.ok(revealSpy.calledWith(vscode.ViewColumn.Two, true));
    });

    test("should show restore prompt when showRestorePromptAfterClose is true", async () => {
        const options = {
            showRestorePromptAfterClose: true,
        };
        const controller = createController(options);
        // Set up the stub to return the Restore option
        const restoreOption = {
            title: "Restore",
            run: sinon.stub().resolves(),
        };
        showInformationMessageStub.resolves(restoreOption);
        // Simulate panel disposal
        const disposeHandler = (mockPanel.onDidDispose as sinon.SinonStub)
            .firstCall.args[0];
        await disposeHandler();

        // Expect showInformationMessage to be called with the correct prompt
        assert.strictEqual(
            showInformationMessageStub.calledOnce,
            true,
            "showInformationMessage should be called once",
        );

        const promptCallerArgs = showInformationMessageStub.firstCall.args;

        assert.deepEqual(
            promptCallerArgs[0],
            "Restore webview?",
            "prompt message is not correct",
        );

        assert.deepEqual(
            promptCallerArgs[1],
            {
                modal: true,
            },
            "Prompt should be modal",
        );

        assert.strictEqual(
            promptCallerArgs[2].title,
            "Restore",
            "Restore button title is not correct",
        );

        assert.strictEqual(
            restoreOption.run.calledOnce,
            true,
            "Restore option run should be called once",
        );

        // To test the side effects within run, we need to redefine run
        sandbox.restore();
        sandbox = sinon.createSandbox();
        sendActionEventStub = sandbox
            .stub(telemetry, "sendActionEvent")
            .resolves();
        showInformationMessageStub = sandbox.stub(
            vscode.window,
            "showInformationMessage",
        );
        sandbox.stub(locConstants, "Webview").value({
            webviewRestorePrompt: sandbox.stub().returns("Restore webview?"),
            Restore: "Restore",
        });
    });
});

interface TestState {
    count: number;
}

interface TestReducers {
    increment: { amount: number };
    decrement: { amount: number };
}

class TestReactWebviewPanelController extends ReactWebviewPanelController<
    TestState,
    TestReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        options: MssqlWebviewPanelOptions,
    ) {
        super(context, "testSource", { count: 0 }, options);
    }
}
