/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");
        mockContext.setup((c) => c.subscriptions).returns(() => []);
        const globalState = {
            get: (<T>(_key: string, defaultValue?: T) => defaultValue) as {
                <T>(key: string): T | undefined;
                <T>(key: string, defaultValue: T): T;
            },
            update: async () => undefined,
            keys: () => [] as readonly string[],
            setKeysForSync: (_keys: readonly string[]) => undefined,
        } as unknown as vscode.Memento & { setKeysForSync(keys: readonly string[]): void };
        mockContext.setup((c) => c.globalState).returns(() => globalState);

        mockVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        const outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        mockVscodeWrapper.setup((v) => v.outputChannel).returns(() => outputChannel.object);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor initializes state and derives database name", async () => {
        const projectPath = "c:/work/MySampleProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            mockContext.object,
            mockVscodeWrapper.object,
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
