/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as utils from "../../src/utils/utils";
import * as vscode from "vscode";

import Sinon, * as sinon from "sinon";

import { ReactWebviewBaseController } from "../../src/controllers/reactWebviewBaseController";
import { stubTelemetry } from "./utils";

suite("ReactWebviewController Tests", () => {
    let controller: TestWebviewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.restore();
        sinon.reset();
        stubTelemetry(sandbox);
        // Create a mock extension context
        mockContext = {
            extensionUri: vscode.Uri.parse("file://test"),
            // Add other properties if needed
        } as unknown as vscode.ExtensionContext;
        controller = new TestWebviewController(mockContext, "testSource", {
            count: 0,
        });
        (controller as any).initializeBase();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Should initialize with initial state", () => {
        assert.deepStrictEqual(
            controller.state,
            { count: 0 },
            "State is not initialized correctly",
        );
    });

    test("Should register default request handlers", () => {
        const handlers = (controller as any)._webviewRequestHandlers;
        assert.ok("getState" in handlers, "getState handler is not registered");
        assert.ok("action" in handlers, "dispatch handler is not registered");
        assert.ok("getTheme" in handlers, "getTheme handler is not registered");
        assert.ok(
            "loadStats" in handlers,
            "loadStats handler is not registered",
        );
        assert.ok(
            "sendActionEvent" in handlers,
            "sendActionEvent handler is not registered",
        );
        assert.ok(
            "sendErrorEvent" in handlers,
            "sendErrorEvent handler is not registered",
        );
        assert.ok(
            "getLocalization" in handlers,
            "getLocalization handler is not registered",
        );
        assert.ok(
            "executeCommand" in handlers,
            "executeCommand handler is not registered",
        );
    });

    test("should register a new reducer", () => {
        const reducer = sandbox
            .stub()
            .callsFake((state: TestState, payload: any) => {
                return { count: state.count + payload.amount };
            });

        controller.registerReducer("increment", reducer);
        const reducers = (controller as any)._reducers;
        assert.ok("increment" in reducers, "Reducer is not registered");
    });

    test("should handle getState request", async () => {
        const message = {
            type: "request",
            method: "getState",
            id: "1",
            params: {},
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.deepStrictEqual(
            controller.state,
            { count: 0 },
            "State is not returned correctly",
        );
        assert.ok(
            (controller as any)._webview.postMessage.calledWith({
                type: "response",
                id: "1",
                result: { count: 0 },
            }),
            "Response is not sent correctly",
        );
    });

    test("should handle action request with registered reducer", async () => {
        const reducer = sandbox
            .stub()
            .callsFake((_state: TestState, _payload: any) => {
                return { count: 5 };
            });
        controller.registerReducer("increment", reducer);

        const message = {
            type: "request",
            method: "action",
            id: "1",
            params: { type: "increment", payload: { amount: 5 } },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            reducer.calledOnceWith({ count: 0 }, { amount: 5 }),
            "Reducer is not called correctly",
        );
        assert.deepStrictEqual(
            controller.state,
            { count: 5 },
            "State is not updated correctly",
        );
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "updateState",
                params: { count: 5 },
            }),
            "Response is not sent correctly",
        );
    });

    test("Should throw error for 'action' request with unregistered reducer", async () => {
        const message = {
            type: "request",
            method: "action",
            id: "1",
            params: { type: "unknown", payload: { amount: 5 } },
        };

        try {
            await (controller as any)._webviewMessageHandler(message);
            assert.fail("Error is not thrown");
        } catch (error) {
            assert.strictEqual(
                error.message,
                "No reducer registered for action unknown",
                "Error is not thrown correctly",
            );
        }
    });

    test("should handle getTheme request", async () => {
        (vscode.window.activeColorTheme.kind as any) = 2; // Change theme kind
        const message = {
            type: "request",
            method: "getTheme",
            id: "1",
            params: {},
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "response",
                id: "1",
                result: 2,
            }),
            "Response is not sent correctly",
        );
    });

    test("Should handle executeCommand request", async () => {
        const mockExecuteCommand = ((vscode.commands.executeCommand as any) =
            sandbox.stub().resolves("commandResult"));
        const message = {
            type: "request",
            method: "executeCommand",
            id: "5",
            params: { command: "test.command", args: [1, 2] },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            mockExecuteCommand.calledOnceWith("test.command", 1, 2),
            "executeCommand is not called correctly",
        );
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "response",
                id: "5",
                result: "commandResult",
            }),
            "Response is not sent correctly",
        );
    });

    test("Should post notification to webview", () => {
        controller.postMessage({ type: "notification", method: "test" });
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "test",
            }),
            "Notification is not sent correctly",
        );
    });

    test("Should set state and send notification to webview", () => {
        controller.state = { count: 5 };
        assert.deepStrictEqual(
            controller.state,
            { count: 5 },
            "State is not updated correctly",
        );
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "updateState",
                params: { count: 5 },
            }),
            "Notification is not sent correctly",
        );
    });

    test("Should update state and send notification to webview", () => {
        controller.updateState({ count: 6 });
        assert.deepStrictEqual(
            controller.state,
            { count: 6 },
            "State is not updated correctly",
        );
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "updateState",
                params: { count: 6 },
            }),
            "Notification is not sent correctly",
        );
    });

    test("Should dispose properly", () => {
        const disposable = {
            dispose: sandbox.stub(),
        };
        (controller as any)._disposables.push(disposable);
        controller.dispose();
        assert.ok(
            disposable.dispose.calledOnce,
            "Disposables are not disposed",
        );
    });

    test("Should not post message if disposed", () => {
        controller.dispose();
        controller.postMessage({ type: "notification", method: "test" });
        assert.ok(
            !controller._webview.postMessage.calledWith({
                type: "notification",
                method: "test",
            }),
            "Message is posted after dispose",
        );
    });

    test("Should setup theming and handle theme change", () => {
        (vscode.window.onDidChangeActiveColorTheme as any) = sandbox.stub();
        const onDidThemeChange = vscode.window
            .onDidChangeActiveColorTheme as Sinon.SinonStub;
        const themeChangedCallback = sandbox.stub();
        onDidThemeChange.callsFake((callback) => {
            themeChangedCallback.callsFake(callback);
        });
        (controller as any).initializeBase();

        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "onDidChangeTheme",
                params: 2,
            }),
            "Theme is not sent correctly",
        );

        themeChangedCallback({ kind: 3 });

        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "notification",
                method: "onDidChangeTheme",
                params: 3,
            }),
            "Theme is not updated correctly",
        );
    });

    test("Should generate correct HTML content", () => {
        const webviewUriStub = sandbox
            .stub()
            .returns(vscode.Uri.parse("https://example.com/"));
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        (controller as any)._getWebview().asWebviewUri = webviewUriStub;
        const html = controller["_getHtmlTemplate"]();
        assert.ok(html.includes("testSource.css"), "CSS file is not included");
        assert.ok(html.includes("testSource.js"), "JS file is not included");
        assert.ok(html.includes('nonce="test-nonce"'), "Nonce is not included");
        assert.ok(
            html.includes('<base href="https://example.com//">'),
            "Base href is not included",
        );
    });

    test("should handle 'sendActionEvent' request", async () => {
        const message = {
            type: "request",
            method: "sendActionEvent",
            id: "1",
            params: { eventName: "testEvent", properties: { prop1: "val1" } },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "response",
                id: "1",
                result: undefined,
            }),
            "Response is not sent correctly",
        );
    });

    test("should handle 'sendErrorEvent' request", async () => {
        const message = {
            type: "request",
            method: "sendErrorEvent",
            id: "1",
            params: { eventName: "testError", properties: { prop1: "val1" } },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: "response",
                id: "1",
                result: undefined,
            }),
            "Response is not sent correctly",
        );
    });
});

interface TestState {
    count: number;
}

interface TestReducers {
    increment: { amount: number };
    decrement: { amount: number };
}

class TestWebviewController extends ReactWebviewBaseController<
    TestState,
    TestReducers
> {
    public _webview: TestWebView;

    constructor(
        context: vscode.ExtensionContext,
        sourceFile: string,
        initialData: TestState,
    ) {
        super(context, sourceFile, initialData);
        this._webview = {
            postMessage: sinon.stub(),
            options: {},
            html: "",
            onDidReceiveMessage: () => {
                return {
                    dispose: () => {},
                };
            },

            // Implement other necessary properties/methods if needed
            // For simplicity, only postMessage is mocked here
        } as unknown as TestWebView;
    }

    protected _getWebview(): TestWebView {
        return this._webview;
    }
}

interface TestWebView extends vscode.Webview {
    postMessage: sinon.SinonStub;
}
