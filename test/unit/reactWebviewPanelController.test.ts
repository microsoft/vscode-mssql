/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
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
        expect(createWebviewPanelStub.calledOnce).to.be.ok;
        expect(
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
        ).to.be.ok;

        expect(mockPanel.webview.html.includes("testSource.js")).to.be.ok;
        expect(mockPanel.iconPath).to.equal(options.iconPath);
    });

    test("should register onDidDispose handler that disposes the controller", async () => {
        createController();
        const disposeSpy = mockPanel.onDidDispose as sinon.SinonSpy;
        const disposeHandler = disposeSpy.firstCall.args[0];
        expect(disposeSpy.called, "onDidDispose should be called once").to.be.ok;
        expect(typeof disposeHandler, "Dispose handler should be a function").to.equal("function");
    });

    test("Should register onDidReceiveMessage handler", () => {
        createController();
        const onDidReceiveMessageSpy = mockWebview.onDidReceiveMessage as sinon.SinonSpy;
        expect(onDidReceiveMessageSpy.calledOnce, "onDidReceiveMessage should be called once").to.be
            .ok;
        const onDidReceiveMessageHandler = onDidReceiveMessageSpy.firstCall.args[0];
        expect(
            typeof onDidReceiveMessageHandler,
            "onDidReceiveMessage handler should be a function",
        ).to.equal("function");
    });

    test("Should reveal the panel to the foreground", () => {
        const controller = createController();
        const revealSpy = mockPanel.reveal as sinon.SinonSpy;
        controller.revealToForeground();
        expect(revealSpy.calledOnce, "reveal should be called once").to.be.ok;
        expect(revealSpy.calledWith(vscode.ViewColumn.One, true)).to.be.ok;
    });

    test("Should reveal the panel to the foreground with the specified view column", () => {
        const controller = createController();
        const revealSpy = mockPanel.reveal as sinon.SinonSpy;
        controller.revealToForeground(vscode.ViewColumn.Two);
        expect(revealSpy.calledOnce, "reveal should be called once").to.be.ok;
        expect(revealSpy.calledWith(vscode.ViewColumn.Two, true)).to.be.ok;
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
        expect(
            showInformationMessageStub.calledOnce,
            "showInformationMessage should be called once",
        ).to.equal(true);

        const promptCallerArgs = showInformationMessageStub.firstCall.args;

        expect(promptCallerArgs[0], "prompt message is not correct").to.deep.equal(
            "Restore webview?",
        );

        expect(promptCallerArgs[1], "Prompt should be modal").to.deep.equal({
            modal: true,
        });

        expect(promptCallerArgs[2].title, "Restore button title is not correct").to.equal(
            "Restore",
        );

        expect(restoreOption.run.calledOnce, "Restore option run should be called once").to.equal(
            true,
        );

        // Disposing the panel should not be called
        expect(
            (mockPanel.dispose as sinon.SinonStub).calledOnce,
            "Panel should not be disposed",
        ).to.equal(false);
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
        expect(
            showInformationMessageStub.calledOnce,
            "showInformationMessage should not be called",
        ).to.equal(false);

        // Disposing the panel should be called
        expect(
            (controller.dispose as sinon.SinonStub).calledOnce,
            "Panel should be disposed",
        ).to.equal(true);
    });

    test("should set showRestorePromptAfterClose correctly via setter", () => {
        const controller = createController();
        controller.showRestorePromptAfterClose = true;

        // To verify, we need to access the private _options
        const options = (controller as any)._options;
        expect(
            options.showRestorePromptAfterClose,
            "showRestorePromptAfterClose should be set to true",
        ).to.equal(true);
    });

    test("Should generate correct HTML template", () => {
        const asWebviewUriStub = mockWebview.asWebviewUri as sinon.SinonStub;
        asWebviewUriStub.returns(vscode.Uri.parse("https://example.com/"));
        const controller = createController();
        const html = controller["_getHtmlTemplate"]();
        expect(typeof html, "HTML should be a string").to.equal("string");
        expect(html.includes("testSource.css"), "HTML should include testSource.css").to.be.ok;
        expect(html.includes("testSource.js"), "HTML should include testSource.js").to.be.ok;
        expect(html.includes('nonce="test-nonce"'), "HTML should include the nonce").to.be.ok;
        expect(
            html.includes('<base href="https://example.com//">'),
            "HTML should include the correct base href",
        ).to.be.ok;
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

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.equal(false);

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.equal(true);
            expect(await controller.dialogResult, "dialogResult should be undefined").to.equal(
                undefined,
            );
        });

        test("Should have dialogResult set when disposed after setting dialogResult", async () => {
            const controller = createController<string>();
            let isCompleted = false;
            controller.dialogResult.resolve("testResult");
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.equal(false);

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.equal(true);
            expect(
                await controller.dialogResult,
                "dialogResult should be set to the correct value",
            ).to.equal("testResult");
        });

        test("dialogResult should be completed when the controller is disposed", async () => {
            const controller = createController();
            let isCompleted = false;
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.equal(false);

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.equal(true);
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
