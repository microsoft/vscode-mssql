/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: VscodeWrapper;

    setup(() => {
        sandbox = sinon.createSandbox();

        const rawContext: Partial<vscode.ExtensionContext> = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        };
        contextStub = rawContext as vscode.ExtensionContext;

        const outputChannel: vscode.OutputChannel = {
            name: "test",
            append: () => undefined,
            appendLine: () => undefined,
            clear: () => undefined,
            replace: (_value: string) => undefined,
            show: () => undefined,
            hide: () => undefined,
            dispose: () => undefined,
        };

        // Subclass VscodeWrapper to override the outputChannel getter cleanly.
        class TestVscodeWrapper extends VscodeWrapper {
            public override get outputChannel(): vscode.OutputChannel {
                return outputChannel;
            }
        }
        vscodeWrapperStub = new TestVscodeWrapper();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor initializes state and derives database name", async () => {
        const projectPath = "c:/work/MySampleProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        // Initial synchronous expectations
        expect(controller.state.projectFilePath).to.equal(projectPath);
        expect(controller.state.formState.databaseName).to.equal("MySampleProject");

        // Wait for async initializeDialog() to finish populating formComponents
        await controller.initialized.promise;

        // Form components should be initialized after async initialization
        const components = controller.state.formComponents;
        // Basic fields expected from generatePublishFormComponents()
        expect(components.profileName, "profileName component should exist").to.exist;
        expect(components.serverName, "serverName component should exist").to.exist;
        expect(components.databaseName, "databaseName component should exist").to.exist;
        expect(components.publishTarget, "publishTarget component should exist").to.exist;
    });
});
