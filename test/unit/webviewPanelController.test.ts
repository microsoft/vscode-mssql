/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as assert from "assert";
import { WebviewPanelController } from "../../src/extension/controllers/webviewController";

suite("Webview Panel Controller Tests", () => {
    let testTitle = "test";
    let webviewPanel: vscode.WebviewPanel = undefined;
    let mockWebviewPanelController: TypeMoq.IMock<WebviewPanelController>;

    setup(() => {
        mockWebviewPanelController = TypeMoq.Mock.ofType<WebviewPanelController>();
        mockWebviewPanelController
            .setup((c) => c.init())
            .returns(() => {
                mockWebviewPanelController.setup((c) => c.isDisposed).returns(() => false);
                webviewPanel = vscode.window.createWebviewPanel(
                    testTitle,
                    testTitle,
                    vscode.ViewColumn.One,
                );
                return Promise.resolve();
            });
        mockWebviewPanelController
            .setup((c) => c.dispose())
            .returns(() => {
                if (webviewPanel) {
                    webviewPanel.dispose();
                }
                mockWebviewPanelController.setup((c) => c.isDisposed).returns(() => true);
            });
    });

    test("Initializing a controller should create and open a new webview panel", (done) => {
        assert.equal(webviewPanel, undefined);
        void mockWebviewPanelController.object.init();
        assert.notEqual(webviewPanel, undefined);
        assert.equal(mockWebviewPanelController.object.isDisposed, false);
        mockWebviewPanelController.object.dispose();
        done();
    });

    test("Closing the Webview Panel should dispose the webview", (done) => {
        void mockWebviewPanelController.object.init();
        assert.notEqual(webviewPanel, undefined);
        assert.equal(mockWebviewPanelController.object.isDisposed, false);
        mockWebviewPanelController.object.dispose();
        assert.equal(mockWebviewPanelController.object.isDisposed, true);
        done();
    });
});
