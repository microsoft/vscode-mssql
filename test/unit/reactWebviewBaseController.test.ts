/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as utils from "../../src/utils/utils";
import * as vscode from "vscode";
import * as TypeMoq from "typemoq";

import Sinon, * as sinon from "sinon";

import { ReactWebviewBaseController } from "../../src/controllers/reactWebviewBaseController";
import { stubTelemetry } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    ColorThemeChangeNotification,
    ExecuteCommandRequest,
    GetLocalizationRequest,
    GetStateRequest,
    GetThemeRequest,
    LoadStatsNotification,
    MessageType,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    StateChangeNotification,
    WebviewRpcMessage,
} from "../../src/sharedInterfaces/webview";

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
        vscodeWrapper.reset();
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
        const requestHandlers = (controller as any)._requestHandlers;
        assert.ok(
            requestHandlers.has(GetStateRequest.type().method),
            "getState handler is not registered",
        );
        assert.ok(
            requestHandlers.has(ReducerRequest.type().method),
            "action handler is not registered",
        );
        assert.ok(
            requestHandlers.has(GetThemeRequest.type.method),
            "theme change handler is not registered",
        );
        assert.ok(
            requestHandlers.has(GetLocalizationRequest.type.method),
            "getLocalization handler is not registered",
        );
        assert.ok(
            requestHandlers.has(ExecuteCommandRequest.type.method),
            "executeCommand handler is not registered",
        );

        const notificationHandlers = (controller as any)._notificationHandlers;
        assert.ok(
            notificationHandlers.has(LoadStatsNotification.type.method),
            "loadStats notification handler is not registered",
        );
        assert.ok(
            notificationHandlers.has(SendActionEventNotification.type.method),
            "sendActionEvent notification handler is not registered",
        );
        assert.ok(
            notificationHandlers.has(SendErrorEventNotification.type.method),
            "sendErrorEvent notification handler is not registered",
        );
    });

    test("should register a new reducer", () => {
        const reducer = sandbox.stub().callsFake((state: TestState, payload: any) => {
            return { count: state.count + payload.amount };
        });

        controller.registerReducer("increment", reducer);
        const reducers = (controller as any)._reducerHandlers;
        assert.ok(reducers.has("increment"), "Reducer is not registered");
    });

    test("should handle getState request", async () => {
        const message = {
            type: "request",
            method: "getState",
            id: "1",
            params: {},
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.deepStrictEqual(controller.state, { count: 0 }, "State is not returned correctly");
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
        const reducer = sandbox.stub().callsFake((_state: TestState, _payload: any) => {
            return { count: 5 };
        });
        controller.registerReducer("increment", reducer);

        const message: WebviewRpcMessage = {
            type: MessageType.Request,
            method: ReducerRequest.type().method,
            id: "1",
            params: { type: "increment", payload: { amount: 5 } },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            reducer.calledOnceWith({ count: 0 }, { amount: 5 }),
            "Reducer is not called correctly",
        );
        assert.deepStrictEqual(controller.state, { count: 5 }, "State is not updated correctly");
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: StateChangeNotification.type().method,
                params: { count: 5 },
            }),
            "Response is not sent correctly",
        );
    });

    test("Should throw error for 'action' request with unregistered reducer", async () => {
        const message: WebviewRpcMessage = {
            type: MessageType.Request,
            method: ReducerRequest.type().method,
            id: "1",
            params: { type: "unknown", payload: { amount: 5 } },
        };

        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: MessageType.Response,
                id: "1",
                error: {
                    message: "No reducer registered for action unknown",
                    name: "Error",
                    stack: sinon.match.string,
                },
            }),
            "Error response is not sent correctly",
        );
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
        const mockExecuteCommand = ((vscode.commands.executeCommand as any) = sandbox
            .stub()
            .resolves("commandResult"));
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
        controller.postMessage({ type: MessageType.Notification, method: "test" });
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: "test",
            }),
            "Notification is not sent correctly",
        );
    });

    test("Should set state and send notification to webview", () => {
        controller.state = { count: 5 };
        assert.deepStrictEqual(controller.state, { count: 5 }, "State is not updated correctly");
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: StateChangeNotification.type().method,
                params: { count: 5 },
            }),
            "Notification is not sent correctly",
        );
    });

    test("Should update state and send notification to webview", () => {
        controller.updateState({ count: 6 });
        assert.deepStrictEqual(controller.state, { count: 6 }, "State is not updated correctly");
        assert.ok(
            controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: StateChangeNotification.type().method,
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
        assert.ok(disposable.dispose.calledOnce, "Disposables are not disposed");
    });

    test("Should not post message if disposed", () => {
        controller.dispose();
        controller.postMessage({ type: MessageType.Notification, method: "test" });
        assert.ok(
            !controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: "test",
            }),
            "Message is posted after dispose",
        );
    });

    test("Should setup theming and handle theme change", () => {
        const originalOnChangeActiveColorTheme = vscode.window.onDidChangeActiveColorTheme;

        try {
            (vscode.window.onDidChangeActiveColorTheme as any) = sandbox.stub();

            const onDidThemeChange = vscode.window.onDidChangeActiveColorTheme as Sinon.SinonStub;
            const themeChangedCallback = sandbox.stub();
            onDidThemeChange.callsFake((callback) => {
                themeChangedCallback.callsFake(callback);
            });
            (controller as any).initializeBase();

            assert.ok(
                controller._webview.postMessage.calledWith({
                    type: MessageType.Notification,
                    method: ColorThemeChangeNotification.type.method,
                    params: 2,
                }),
                "Theme is not sent correctly",
            );

            themeChangedCallback({ kind: 3 });

            assert.ok(
                controller._webview.postMessage.calledWith({
                    type: MessageType.Notification,
                    method: ColorThemeChangeNotification.type.method,
                    params: 3,
                }),
                "Theme is not updated correctly",
            );
        } finally {
            (vscode.window.onDidChangeActiveColorTheme as any) = originalOnChangeActiveColorTheme;
        }
    });

    test("Should generate correct HTML content", () => {
        const webviewUriStub = sandbox.stub().returns(vscode.Uri.parse("https://example.com/"));
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
        (controller as any)._handleNotification = sandbox.stub();
        const message: WebviewRpcMessage = {
            type: MessageType.Notification,
            method: SendActionEventNotification.type.method,
            params: { prop1: "val1" },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            (controller as any)._handleNotification.calledWith({
                type: MessageType.Notification,
                method: SendActionEventNotification.type.method,
                params: { prop1: "val1" },
            }),
        );
    });

    test("should handle 'sendErrorEvent' request", async () => {
        (controller as any)._handleNotification = sandbox.stub();
        const message: WebviewRpcMessage = {
            type: MessageType.Notification,
            method: SendErrorEventNotification.type.method,
            params: { prop1: "val1" },
        };
        await (controller as any)._webviewMessageHandler(message);
        assert.ok(
            (controller as any)._handleNotification.calledWith({
                type: MessageType.Notification,
                method: SendErrorEventNotification.type.method,
                params: { prop1: "val1" },
            }),
            "sendErrorEvent notification is not handled correctly",
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

const vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);

class TestWebviewController extends ReactWebviewBaseController<TestState, TestReducers> {
    public _webview: TestWebView;

    constructor(context: vscode.ExtensionContext, sourceFile: string, initialData: TestState) {
        super(context, vscodeWrapper.object, sourceFile, initialData);
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
