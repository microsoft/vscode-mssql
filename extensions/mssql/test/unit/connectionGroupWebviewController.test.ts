/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import { ExtensionContextService } from "extension-toolkit/vscode";

import { ConnectionGroupWebviewController } from "../../src/controllers/connectionGroupWebviewController";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";

suite("ConnectionGroupWebviewController Tests", () => {
    let controller: ConnectionGroupWebviewController;
    let mockContext: vscode.ExtensionContext;
    let contextService: ExtensionContextService;
    let connectionConfig: ConnectionConfig;

    setup(() => {
        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;
        contextService = new ExtensionContextService(mockContext);
        connectionConfig = {} as ConnectionConfig;

        controller = new ConnectionGroupWebviewController(
            undefined,
            contextService,
            connectionConfig,
        );
    });

    test("uses the lowercase bundle name for webview resources", () => {
        expect(controller.panel.webview.html).to.match(/href="connectionGroup\.css\?v=[^"]+"/);
        expect(controller.panel.webview.html).to.match(/src="connectionGroup\.js\?v=[^"]+"/);
    });

    test("distinct instances share the same injected connection configuration", () => {
        const secondController = new ConnectionGroupWebviewController(
            undefined,
            contextService,
            connectionConfig,
        );

        expect(secondController).to.not.equal(controller);
        expect(secondController["connectionConfig"]).to.equal(controller["connectionConfig"]);
        expect(secondController["connectionConfig"]).to.equal(connectionConfig);

        secondController.dispose();
    });

    teardown(() => {
        controller.dispose();
    });
});
