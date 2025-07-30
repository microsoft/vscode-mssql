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
} from "../../src/sharedInterfaces/webview";

suite("ReactWebviewController Tests", () => {
    let controller: TestWebviewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let onRequestStub: sinon.SinonStub;
    let onNotificationStub: sinon.SinonStub;
    let sendNotificationStub: sinon.SinonStub;

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
        // Stubs for methods
        onRequestStub = sandbox.stub();
        onNotificationStub = sandbox.stub();
        sendNotificationStub = sandbox.stub();
        controller.onRequest = onRequestStub;
        controller.onNotification = onNotificationStub;
        controller.sendNotification = sendNotificationStub;
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
        assert.ok(
            onRequestStub.calledWith(GetStateRequest.type(), sinon.match.any),
            "GetStateRequest handler is not registered",
        );
        assert.ok(
            onRequestStub.calledWith(ReducerRequest.type(), sinon.match.any),
            "ReducerRequest handler is not registered",
        );
        assert.ok(
            onRequestStub.calledWith(GetThemeRequest.type, sinon.match.any),
            "GetThemeRequest handler is not registered",
        );
        assert.ok(
            onRequestStub.calledWith(GetLocalizationRequest.type, sinon.match.any),
            "GetLocalizationRequest handler is not registered",
        );
        assert.ok(
            onRequestStub.calledWith(ExecuteCommandRequest.type, sinon.match.any),
            "ExecuteCommandRequest handler is not registered",
        );
        assert.ok(
            onNotificationStub.calledWith(LoadStatsNotification.type, sinon.match.any),
            "LoadStatsNotification handler is not registered",
        );
        assert.ok(
            onNotificationStub.calledWith(SendActionEventNotification.type, sinon.match.any),
            "SendActionEventNotification handler is not registered",
        );
        assert.ok(
            onNotificationStub.calledWith(SendErrorEventNotification.type, sinon.match.any),
            "SendErrorEventNotification handler is not registered",
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

    test("Should update state and send notification to webview", async () => {
        controller.updateState({ count: 6 });
        assert.deepStrictEqual(controller.state, { count: 6 }, "State is not updated correctly");
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for async operations
        assert.ok(
            sendNotificationStub.calledWith(StateChangeNotification.type(), {
                count: 6,
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
                sendNotificationStub.calledWith(
                    ColorThemeChangeNotification.type,
                    vscode.window.activeColorTheme.kind,
                ),
            );

            themeChangedCallback({ kind: 3 });

            assert.ok(
                sendNotificationStub.calledWith(ColorThemeChangeNotification.type, 3),
                "Theme change notification is not sent correctly",
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
});

interface TestState {
    count: number;
}

interface TestReducers {
    increment: { amount: number };
    decrement: { amount: number };
}

const vscodeWrapper = sinon.createStubInstance(VscodeWrapper);
const outputChannel = sinon.stub({
    append: () => sinon.stub(),
    appendLine: () => sinon.stub(),
}) as unknown as vscode.OutputChannel;

sinon.stub(vscodeWrapper, "outputChannel").get(() => {
    return outputChannel;
});

class TestWebviewController extends ReactWebviewBaseController<TestState, TestReducers> {
    public _webview: TestWebView;

    constructor(context: vscode.ExtensionContext, sourceFile: string, initialData: TestState) {
        super(context, vscodeWrapper, sourceFile, initialData);
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
        this.updateConnectionWebview(this._webview);
    }

    protected _getWebview(): TestWebView {
        return this._webview;
    }
}

interface TestWebView extends vscode.Webview {
    postMessage: sinon.SinonStub;
}
