/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";

import { ConnectionGroupWebviewController } from "../../src/controllers/connectionGroupWebviewController";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";

suite("ConnectionGroupWebviewController Tests", () => {
    let controller: ConnectionGroupWebviewController;

    setup(() => {
        const mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;

        controller = new ConnectionGroupWebviewController(mockContext, {} as ConnectionConfig);
    });

    test("uses the lowercase bundle name for webview resources", () => {
        expect(controller.panel.webview.html).to.contain('href="connectionGroup.css"');
        expect(controller.panel.webview.html).to.contain('src="connectionGroup.js"');
    });
});
