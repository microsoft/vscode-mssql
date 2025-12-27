/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as utils from "../../src/utils/utils";
import * as vscode from "vscode";
import Sinon, * as sinon from "sinon";

import { ReactWebviewBaseController } from "../../src/controllers/reactWebviewBaseController";
import { stubTelemetry } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    ColorThemeChangeNotification,
    ExecuteCommandRequest,
    GetKeyBindingsConfigRequest,
    GetLocalizationRequest,
    GetStateRequest,
    GetThemeRequest,
    KeyBindingsChangeNotification,
    LoadStatsNotification,
    MessageType,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    StateChangeNotification,
} from "../../src/sharedInterfaces/webview";
import * as Constants from "../../src/constants/constants";

chai.use(sinonChai);

const DEMO_BINDING = {
    "mssql.shortcut": {
        "test.action": "ctrl+alt+p",
    },
};

suite("ReactWebviewController Tests", () => {
    let controller: TestWebviewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let onRequestStub: sinon.SinonStub;
    let onNotificationStub: sinon.SinonStub;
    let sendNotificationStub: sinon.SinonStub;
    let onDidChangeConfigurationStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;
    let configChangeHandlers: Array<(e: vscode.ConfigurationChangeEvent) => void>;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.restore();
        sinon.reset();
        stubTelemetry(sandbox);

        configChangeHandlers = [];
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration").callsFake(() => {
            return {
                get: sandbox.stub().callsFake((section: string) => {
                    if (section === Constants.configShortcuts) {
                        return DEMO_BINDING;
                    }
                    return undefined;
                }),
            } as unknown as vscode.WorkspaceConfiguration;
        });

        onDidChangeConfigurationStub = sandbox
            .stub(vscode.workspace, "onDidChangeConfiguration")
            .callsFake((handler) => {
                configChangeHandlers.push(handler);
                return { dispose: sandbox.stub() } as vscode.Disposable;
            });
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
        expect(controller.state, "State is not initialized correctly").to.deep.equal({ count: 0 });
    });

    test("Should register default request handlers", () => {
        expect(
            onRequestStub,
            "GetStateRequest handler is not registered",
        ).to.have.been.calledWith(GetStateRequest.type(), sinon.match.any);
        expect(
            onRequestStub,
            "ReducerRequest handler is not registered",
        ).to.have.been.calledWith(ReducerRequest.type(), sinon.match.any);
        expect(
            onRequestStub,
            "GetThemeRequest handler is not registered",
        ).to.have.been.calledWith(GetThemeRequest.type, sinon.match.any);
        expect(
            onRequestStub,
            "GetKeyBindingsConfigRequest handler is not registered",
        ).to.have.been.calledWith(GetKeyBindingsConfigRequest.type, sinon.match.any);
        expect(
            onRequestStub,
            "GetLocalizationRequest handler is not registered",
        ).to.have.been.calledWith(GetLocalizationRequest.type, sinon.match.any);
        expect(
            onRequestStub,
            "ExecuteCommandRequest handler is not registered",
        ).to.have.been.calledWith(ExecuteCommandRequest.type, sinon.match.any);
        expect(
            onNotificationStub,
            "LoadStatsNotification handler is not registered",
        ).to.have.been.calledWith(LoadStatsNotification.type, sinon.match.any);
        expect(
            onNotificationStub,
            "SendActionEventNotification handler is not registered",
        ).to.have.been.calledWith(SendActionEventNotification.type, sinon.match.any);
        expect(
            onNotificationStub,
            "SendErrorEventNotification handler is not registered",
        ).to.have.been.calledWith(SendErrorEventNotification.type, sinon.match.any);
    });

    test("Should send initial keybindings notification", () => {
        expect(
            sendNotificationStub,
            "Initial keybindings notification not sent",
        ).to.have.been.calledWith(KeyBindingsChangeNotification.type, DEMO_BINDING);
        expect(onDidChangeConfigurationStub, "Configuration listener not registered").to.have.been
            .calledOnce;
    });

    test("Should notify keybindings when configuration changes", () => {
        sendNotificationStub.resetHistory();
        const handler = configChangeHandlers[0];
        expect(handler, "Configuration change handler not registered").to.exist;
        handler({
            affectsConfiguration: (section: string) => section === Constants.configShortcuts,
        } as vscode.ConfigurationChangeEvent);

        expect(
            sendNotificationStub,
            "Keybindings change notification not sent",
        ).to.have.been.calledWith(KeyBindingsChangeNotification.type, DEMO_BINDING);
    });

    test("GetKeyBindingsConfigRequest returns current configuration", async () => {
        const requestCall = onRequestStub
            .getCalls()
            .find((call) => call.args[0] === GetKeyBindingsConfigRequest.type);
        expect(requestCall, "GetKeyBindingsConfigRequest handler not registered").to.exist;
        const handler = requestCall.args[1];
        const result = await handler();
        expect(result).to.deep.equal(DEMO_BINDING);
    });

    test("readKeyBindingsConfig returns empty object when configuration missing", () => {
        getConfigurationStub.callsFake(() => undefined as unknown as vscode.WorkspaceConfiguration);
        const result = (controller as any).readKeyBindingsConfig();
        expect(result).to.deep.equal({});
    });

    test("should register a new reducer", () => {
        const reducer = sandbox.stub().callsFake((state: TestState, payload: any) => {
            return { count: state.count + payload.amount };
        });

        controller.registerReducer("increment", reducer);
        const reducers = (controller as any)._reducerHandlers;
        expect(reducers.has("increment"), "Reducer is not registered").to.be.true;
    });

    test("Should post notification to webview", () => {
        controller.postMessage({ type: MessageType.Notification, method: "test" });
        expect(
            controller._webview.postMessage,
            "Notification is not sent correctly",
        ).to.have.been.calledWith({
            type: MessageType.Notification,
            method: "test",
        });
    });

    test("Should update state and send notification to webview", async () => {
        controller.updateState({ count: 6 });
        expect(controller.state, "State is not updated correctly").to.deep.equal({ count: 6 });
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for async operations
        expect(
            sendNotificationStub,
            "Notification is not sent correctly",
        ).to.have.been.calledWith(StateChangeNotification.type(), {
            count: 6,
        });
    });

    test("Should dispose properly", () => {
        const disposable = {
            dispose: sandbox.stub(),
        };
        (controller as any)._disposables.push(disposable);
        controller.dispose();
        expect(disposable.dispose, "Disposables are not disposed").to.have.been.calledOnce;
    });

    test("Should not post message if disposed", () => {
        controller.dispose();
        controller.postMessage({ type: MessageType.Notification, method: "test" });
        expect(
            controller._webview.postMessage.calledWith({
                type: MessageType.Notification,
                method: "test",
            }),
            "Message is posted after dispose",
        ).to.be.false;
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

            expect(sendNotificationStub).to.have.been.calledWith(
                ColorThemeChangeNotification.type,
                vscode.window.activeColorTheme.kind,
            );

            themeChangedCallback({ kind: 3 });

            expect(
                sendNotificationStub,
                "Theme change notification is not sent correctly",
            ).to.have.been.calledWith(ColorThemeChangeNotification.type, 3);
        } finally {
            (vscode.window.onDidChangeActiveColorTheme as any) = originalOnChangeActiveColorTheme;
        }
    });

    test("Should generate correct HTML content", () => {
        const webviewUriStub = sandbox.stub().returns(vscode.Uri.parse("https://example.com/"));
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        (controller as any)._getWebview().asWebviewUri = webviewUriStub;
        const html = controller["_getHtmlTemplate"]();
        expect(html.includes("testSource.css"), "CSS file is not included").to.be.true;
        expect(html.includes("testSource.js"), "JS file is not included").to.be.true;
        expect(html.includes('nonce="test-nonce"'), "Nonce is not included").to.be.true;
        expect(html.includes('<base href="https://example.com//">'), "Base href is not included").to
            .be.true;
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
