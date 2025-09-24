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

        const globalState = {
            get: (<T>(_key: string, defaultValue?: T) => defaultValue) as {
                <T>(key: string): T | undefined;
                <T>(key: string, defaultValue: T): T;
            },
            update: async () => undefined,
            keys: () => [] as readonly string[],
            setKeysForSync: (_keys: readonly string[]) => undefined,
        } as unknown as vscode.Memento & { setKeysForSync(keys: readonly string[]): void };

        const rawContext = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
            globalState,
            workspaceState: globalState,
            storagePath: undefined,
            storageUri: undefined,
            globalStoragePath: "",
            globalStorageUri: vscode.Uri.parse("file://ProjectPath/global"),
            logPath: "",
            logUri: vscode.Uri.parse("file://ProjectPath/log"),
            asAbsolutePath: (rel: string) => rel,
            extensionMode: vscode.ExtensionMode.Test,
            secrets: {
                get: async () => undefined,
                store: async () => undefined,
                delete: async () => false,
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
            } as unknown as vscode.SecretStorage,
            environmentVariableCollection: {
                // minimal stub; tests here don't rely on it
                persistent: true,
                replace: () => undefined,
                append: () => undefined,
                get: () => undefined,
                forEach: () => undefined,
                delete: () => undefined,
                clear: () => undefined,
            } as unknown as vscode.EnvironmentVariableCollection,
            extension: undefined as unknown as vscode.Extension<unknown>,
        };
        contextStub = rawContext as unknown as vscode.ExtensionContext;

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
