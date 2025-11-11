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
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

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
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("https://example.com/")),
            onDidReceiveMessage: sandbox.stub(),
        } as any;
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
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
                webviewRestorePrompt: sandbox.stub().returns("Restore webview?"),
                Restore: "Restore",
            },
        };
        sandbox.stub(locConstants, "Webview").value(locConstantsStub.Webview);

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;
        sandbox.stub(utils, "getNonce").returns("test-nonce");

        vscodeWrapper = stubVscodeWrapper(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController<TResult = void>(options: Partial<MssqlWebviewPanelOptions> = {}) {
        const defaultOptions: MssqlWebviewPanelOptions = {
            title: "Test Panel",
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: true,
            iconPath: vscode.Uri.file("path"),
            showRestorePromptAfterClose: true,
        };

        const controller = new TestReactWebviewPanelController<TResult>(mockContext, {
            ...defaultOptions,
            ...options,
        });
        return controller;
    }

    test("should create a WebviewPanel with correct options upon initialization", () => {
        const options = {
            title: "My Test Panel",
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
            iconPath: vscode.Uri.file("/path/to/test-icon.png"),
            showRestorePromptAfterClose: true,
        };
        createController(options);
        assert.ok(createWebviewPanelStub.calledOnce);
        assert.ok(
            createWebviewPanelStub.calledWith(
                "mssql-react-webview",
                options.title,
                {
                    viewColumn: options.viewColumn,
                    preserveFocus: options.preserveFocus,
                },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.file(mockContext.extensionPath)],
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
        const onDidReceiveMessageSpy = mockWebview.onDidReceiveMessage as sinon.SinonSpy;
        assert.ok(onDidReceiveMessageSpy.calledOnce, "onDidReceiveMessage should be called once");
        const onDidReceiveMessageHandler = onDidReceiveMessageSpy.firstCall.args[0];
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
        createController(options);
        // Set up the stub to return the Restore option
        const restoreOption = {
            title: "Restore",
            run: sinon.stub().resolves(),
        };
        showInformationMessageStub.resolves(restoreOption);
        // Simulate panel disposal
        const disposeHandler = (mockPanel.onDidDispose as sinon.SinonStub).firstCall.args[0];
        await disposeHandler();

        // Expect showInformationMessage to be called with the correct prompt
        assert.strictEqual(
            showInformationMessageStub.calledOnce,
            true,
            "showInformationMessage should be called once",
        );

        const promptCallerArgs = showInformationMessageStub.firstCall.args;

        assert.deepEqual(promptCallerArgs[0], "Restore webview?", "prompt message is not correct");

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

        // Disposing the panel should not be called
        assert.strictEqual(
            (mockPanel.dispose as sinon.SinonStub).calledOnce,
            false,
            "Panel should not be disposed",
        );
    });

    test("should dispose without showing restore prompt when showRestorePromptAfterClose is false", async () => {
        const options = {
            showRestorePromptAfterClose: false,
        };

        const onDidReceiveMessageStub = mockWebview.onDidReceiveMessage as sinon.SinonStub;
        onDidReceiveMessageStub.returns({
            dispose: sinon.stub().returns(true),
        });

        const onDidDispose = mockPanel.onDidDispose as sinon.SinonStub;
        onDidDispose.returns({
            dispose: sinon.stub().returns(true),
        });
        const controller = createController(options);
        sandbox.stub(controller, "dispose").resolves();

        // Simulate panel disposal
        const disposeHandler = (mockPanel.onDidDispose as sinon.SinonStub).firstCall.args[0];
        await disposeHandler();

        // Expect showInformationMessage to not be called
        assert.strictEqual(
            showInformationMessageStub.calledOnce,
            false,
            "showInformationMessage should not be called",
        );

        // Disposing the panel should be called
        assert.strictEqual(
            (controller.dispose as sinon.SinonStub).calledOnce,
            true,
            "Panel should be disposed",
        );
    });

    test("should set showRestorePromptAfterClose correctly via setter", () => {
        const controller = createController();
        controller.showRestorePromptAfterClose = true;

        // To verify, we need to access the private _options
        const options = (controller as any)._options;
        assert.strictEqual(
            options.showRestorePromptAfterClose,
            true,
            "showRestorePromptAfterClose should be set to true",
        );
    });

    test("Should generate correct HTML template", () => {
        const asWebviewUriStub = mockWebview.asWebviewUri as sinon.SinonStub;
        asWebviewUriStub.returns(vscode.Uri.parse("https://example.com/"));
        const controller = createController();
        const html = controller["_getHtmlTemplate"]();
        assert.strictEqual(typeof html, "string", "HTML should be a string");
        assert.ok(html.includes("testSource.css"), "HTML should include testSource.css");
        assert.ok(html.includes("testSource.js"), "HTML should include testSource.js");
        assert.ok(html.includes('nonce="test-nonce"'), "HTML should include the nonce");
        assert.ok(
            html.includes('<base href="https://example.com//">'),
            "HTML should include the correct base href",
        );
    });

    suite("DialogResult", () => {
        function delay(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        setup(() => {
            const onDidReceiveMessageStub = mockWebview.onDidReceiveMessage as sinon.SinonStub;
            onDidReceiveMessageStub.returns({
                dispose: sinon.stub().returns(true),
            });

            const onDidDispose = mockPanel.onDidDispose as sinon.SinonStub;
            onDidDispose.returns({
                dispose: sinon.stub().returns(true),
            });
        });

        test("dialogResult should be undefined when disposed without setting dialogResult", async () => {
            const controller = createController<string>();
            let isCompleted = false;
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            assert.equal(isCompleted, false, "dialogResult should be an uncompleted promise");

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            assert.equal(isCompleted, true, "dialogResult should a resolved promise");
            assert.equal(
                await controller.dialogResult,
                undefined,
                "dialogResult should be undefined",
            );
        });

        test("Should have dialogResult set when disposed after setting dialogResult", async () => {
            const controller = createController<string>();
            let isCompleted = false;
            controller.dialogResult.resolve("testResult");
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            assert.equal(isCompleted, false, "dialogResult should be an uncompleted promise");

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            assert.equal(isCompleted, true, "dialogResult should a resolved promise");
            assert.equal(
                await controller.dialogResult,
                "testResult",
                "dialogResult should be set to the correct value",
            );
        });

        test("dialogResult should be completed when the controller is disposed", async () => {
            const controller = createController();
            let isCompleted = false;
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            assert.equal(isCompleted, false, "dialogResult should be an uncompleted promise");

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            assert.equal(isCompleted, true, "dialogResult should a resolved promise");
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

let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

class TestReactWebviewPanelController<TResult> extends ReactWebviewPanelController<
    TestState,
    TestReducers,
    TResult
> {
    constructor(context: vscode.ExtensionContext, options: MssqlWebviewPanelOptions) {
        super(context, vscodeWrapper!, "testSource", "testSource", { count: 0 }, options);
    }
}
