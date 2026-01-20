/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as locConstants from "../../src/constants/locConstants";
import * as sinon from "sinon";
import * as utils from "../../src/utils/utils";
import * as vscode from "vscode";

import { MssqlWebviewPanelOptions } from "../../src/sharedInterfaces/webview";
import { ReactWebviewPanelController } from "../../src/controllers/reactWebviewPanelController";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

chai.use(sinonChai);

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
        expect(createWebviewPanelStub).to.have.been.calledOnce;
        expect(createWebviewPanelStub).to.have.been.calledWith(
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
        );

        expect(mockPanel.webview.html.includes("testSource.js")).to.be.true;
        expect(mockPanel.iconPath).to.equal(options.iconPath);
    });

    test("should register onDidDispose handler that disposes the controller", async () => {
        createController();
        const disposeSpy = mockPanel.onDidDispose as sinon.SinonSpy;
        const disposeHandler = disposeSpy.firstCall.args[0];
        expect(disposeSpy, "onDidDispose should be called once").to.have.been.called;
        expect(typeof disposeHandler, "Dispose handler should be a function").to.equal("function");
    });

    test("Should register onDidReceiveMessage handler", () => {
        createController();
        const onDidReceiveMessageSpy = mockWebview.onDidReceiveMessage as sinon.SinonSpy;
        expect(onDidReceiveMessageSpy, "onDidReceiveMessage should be called once").to.have.been
            .calledOnce;
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
        expect(revealSpy, "reveal should be called once").to.have.been.calledOnce;
        expect(revealSpy).to.have.been.calledWith(vscode.ViewColumn.One, true);
    });

    test("Should reveal the panel to the foreground with the specified view column", () => {
        const controller = createController();
        const revealSpy = mockPanel.reveal as sinon.SinonSpy;
        controller.revealToForeground(vscode.ViewColumn.Two);
        expect(revealSpy, "reveal should be called once").to.have.been.calledOnce;
        expect(revealSpy).to.have.been.calledWith(vscode.ViewColumn.Two, true);
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
        ).to.be.true;

        const promptCallerArgs = showInformationMessageStub.firstCall.args;

        expect(promptCallerArgs[0], "prompt message is not correct").to.equal("Restore webview?");

        expect(promptCallerArgs[1], "Prompt should be modal").to.deep.equal({
            modal: true,
        });

        expect(promptCallerArgs[2].title, "Restore button title is not correct").to.equal(
            "Restore",
        );

        expect(restoreOption.run.calledOnce, "Restore option run should be called once").to.be.true;

        // Disposing the panel should not be called
        expect((mockPanel.dispose as sinon.SinonStub).calledOnce, "Panel should not be disposed").to
            .be.false;
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
        expect(showInformationMessageStub.calledOnce, "showInformationMessage should not be called")
            .to.be.false;

        // Disposing the panel should be called
        expect((controller.dispose as sinon.SinonStub).calledOnce, "Panel should be disposed").to.be
            .true;
    });

    test("should set showRestorePromptAfterClose correctly via setter", () => {
        const controller = createController();
        controller.showRestorePromptAfterClose = true;

        // To verify, we need to access the private _options
        const options = (controller as any)._options;
        expect(
            options.showRestorePromptAfterClose,
            "showRestorePromptAfterClose should be set to true",
        ).to.be.true;
    });

    test("Should generate correct HTML template", () => {
        const asWebviewUriStub = mockWebview.asWebviewUri as sinon.SinonStub;
        asWebviewUriStub.returns(vscode.Uri.parse("https://example.com/"));
        const controller = createController();
        const html = controller["_getHtmlTemplate"]();
        expect(typeof html, "HTML should be a string").to.equal("string");
        expect(html.includes("testSource.css"), "HTML should include testSource.css").to.be.true;
        expect(html.includes("testSource.js"), "HTML should include testSource.js").to.be.true;
        expect(html.includes('nonce="test-nonce"'), "HTML should include the nonce").to.be.true;
        expect(
            html.includes('<base href="https://example.com//">'),
            "HTML should include the correct base href",
        ).to.be.true;
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

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.be.false;

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.be.true;
            expect(await controller.dialogResult, "dialogResult should be undefined").to.be
                .undefined;
        });

        test("Should have dialogResult set when disposed after setting dialogResult", async () => {
            const controller = createController<string>();
            let isCompleted = false;
            controller.dialogResult.resolve("testResult");
            controller.dialogResult.then(() => {
                isCompleted = true;
            });

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.be.false;

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.be.true;
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

            expect(isCompleted, "dialogResult should be an uncompleted promise").to.be.false;

            controller.dispose();

            await delay(50); // Give a moment for the promise completion check to occur
            expect(isCompleted, "dialogResult should a resolved promise").to.be.true;
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
