/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import { ConnectionUI } from "../../src/views/connectionUI";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IPrompter } from "../../src/prompts/question";
import { ConnectionStore } from "../../src/models/connectionStore";
import ConnectionManager from "../../src/controllers/connectionManager";
import {
    IConnectionCredentialsQuickPickItem,
    CredentialsQuickPickItemType,
} from "../../src/models/interfaces";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { AccountStore } from "../../src/azure/accountStore";
import { Logger } from "../../src/models/logger";

suite("Connection UI tests", () => {
    // Class being tested
    let connectionUI: ConnectionUI;

    // Mocks
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let prompter: TypeMoq.IMock<IPrompter>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockAccountStore: AccountStore;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.IMock<
        vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
    >;
    let quickPickMock: TypeMoq.IMock<vscode.QuickPick<IConnectionCredentialsQuickPickItem>>;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup((c) => c.clear());
        outputChannel.setup((c) => c.append(TypeMoq.It.isAny()));
        outputChannel.setup((c) => c.show(TypeMoq.It.isAny()));
        quickPickMock =
            TypeMoq.Mock.ofType<vscode.QuickPick<IConnectionCredentialsQuickPickItem>>();
        quickPickMock.setup((q) => q.items);
        quickPickMock.setup((q) => q.show());
        vscodeWrapper
            .setup((v) => v.createOutputChannel(TypeMoq.It.isAny()))
            .returns(() => outputChannel.object);
        vscodeWrapper.setup((v) => v.showErrorMessage(TypeMoq.It.isAny()));
        vscodeWrapper.setup((v) => v.executeCommand(TypeMoq.It.isAnyString()));
        vscodeWrapper.setup((v) => v.createQuickPick()).returns(() => quickPickMock.object);
        prompter = TypeMoq.Mock.ofType<IPrompter>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.globalState).returns(() => globalstate.object);
        connectionStore = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );
        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );
        globalstate = TypeMoq.Mock.ofType<
            vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
        >();
        mockLogger = TypeMoq.Mock.ofType<Logger>();
        mockAccountStore = new AccountStore(mockContext.object, mockLogger.object);
        connectionUI = new ConnectionUI(
            connectionManager.object,
            mockContext.object,
            connectionStore.object,
            mockAccountStore,
            prompter.object,
            true, // legacyConnectionExperience
            vscodeWrapper.object,
        );
    });

    test("showConnections with recent and new connection", async () => {
        let item: IConnectionCredentialsQuickPickItem = {
            connectionCreds: undefined,
            quickPickItemType: CredentialsQuickPickItemType.NewConnection,
            label: undefined,
        };
        let mockConnection = { connectionString: "test" };
        // setup stubbed event for us to trigger later
        const onDidChangeSelectionEventEmitter = new vscode.EventEmitter<
            IConnectionCredentialsQuickPickItem[]
        >();
        quickPickMock
            .setup((q) => q.onDidChangeSelection)
            .returns(() => onDidChangeSelectionEventEmitter.event);

        // createProfile prompter stub
        prompter
            .setup((p) => p.prompt(TypeMoq.It.isAny(), true))
            .returns(() => Promise.resolve(mockConnection));

        const promptPromise = connectionUI.promptForConnection(undefined);
        // Trigger onDidChangeSelection event to simulate user selecting new connection option
        onDidChangeSelectionEventEmitter.fire([item]);
        await promptPromise;

        quickPickMock.verify((q) => q.show(), TypeMoq.Times.once());
    });

    test("showConnections with recent and edit connection", async () => {
        let testCreds = new ConnectionCredentials();
        testCreds.connectionString = "test";
        let item: IConnectionCredentialsQuickPickItem = {
            connectionCreds: testCreds,
            quickPickItemType: CredentialsQuickPickItemType.Mru,
            label: undefined,
        };
        // setup stubbed event for us to trigger later
        const onDidChangeSelectionEventEmitter = new vscode.EventEmitter<
            IConnectionCredentialsQuickPickItem[]
        >();
        quickPickMock
            .setup((q) => q.onDidChangeSelection)
            .returns(() => onDidChangeSelectionEventEmitter.event);

        const promptPromise = connectionUI.promptForConnection(undefined);
        // Trigger onDidChangeSelection event to simulate user selecting edit connection option
        onDidChangeSelectionEventEmitter.fire([item]);
        await promptPromise;

        quickPickMock.verify((q) => q.show(), TypeMoq.Times.once());
    });

    test("showConnections with recent but no selection", async () => {
        // setup stubbed event for us to trigger later
        const onDidHideEventEmitter = new vscode.EventEmitter<void>();
        quickPickMock.setup((q) => q.onDidHide).returns(() => onDidHideEventEmitter.event);
        const promptForConnectionPromise = connectionUI.promptForConnection(undefined);
        // Trigger onDidHide event to simulate user exiting the dialog without choosing anything
        onDidHideEventEmitter.fire();
        await promptForConnectionPromise;

        quickPickMock.verify((q) => q.show(), TypeMoq.Times.once());
    });

    test("promptLanguageFlavor should prompt for a language flavor", () => {
        let mockProvider = { providerId: "test" };
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockProvider));
        return connectionUI.promptLanguageFlavor().then(() => {
            prompter.verify(
                (p) => p.promptSingle(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("promptToCancelConnection should prompt for cancellation", () => {
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(TypeMoq.It.isAny()));
        return connectionUI.promptToCancelConnection().then(() => {
            prompter.verify((p) => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
    });

    test("promptForPassword should prompt for password", () => {
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(TypeMoq.It.isAnyString()));
        return connectionUI.promptToCancelConnection().then(() => {
            prompter.verify((p) => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
    });

    test("promptToChangeLanguageMode should prompt for language mode - selection", () => {
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(TypeMoq.It.isAny()));
        return connectionUI.promptToChangeLanguageMode().then(() => {
            prompter.verify((p) => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            vscodeWrapper.verify(
                (v) => v.executeCommand(TypeMoq.It.isAnyString()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("promptToChangeLanguageMode should prompt for language mode - no selection", () => {
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        return connectionUI.promptToChangeLanguageMode().then(() => {
            prompter.verify((p) => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            vscodeWrapper.verify(
                (v) => v.executeCommand(TypeMoq.It.isAnyString()),
                TypeMoq.Times.never(),
            );
        });
    });

    test("removeProfile should prompt for a profile and remove it", () => {
        connectionStore
            .setup((c) => c.getProfilePickListItems(TypeMoq.It.isAny()))
            .returns(() =>
                Promise.resolve([
                    {
                        connectionCreds: undefined,
                        quickPickItemType: undefined,
                        label: "test",
                    },
                ]),
            );
        connectionStore.setup(async (c) => await c.removeProfile(TypeMoq.It.isAny()));
        let mockItem = {
            ConfirmRemoval: true,
            ChooseProfile: {
                connectionCreds: {},
            },
        };
        prompter
            .setup((p) => p.prompt(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockItem));
        return connectionUI.removeProfile().then(() => {
            connectionStore.verify((c) => c.getProfilePickListItems(false), TypeMoq.Times.once());
            prompter.verify((p) => p.prompt(TypeMoq.It.isAny()), TypeMoq.Times.once());
            connectionStore.verify(
                async (c) => await c.removeProfile(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("removeProfile should show error if there are no profiles to remove", async () => {
        connectionStore
            .setup((c) => c.getProfilePickListItems(TypeMoq.It.isAny()))
            .returns(() => undefined);
        return await connectionUI.removeProfile().then(() => {
            connectionStore.verify((c) => c.getProfilePickListItems(false), TypeMoq.Times.once());
            prompter.verify((p) => p.prompt(TypeMoq.It.isAny()), TypeMoq.Times.never());
            vscodeWrapper.verify(
                (v) => v.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    test("promptToManageProfiles should prompt to manage profile", () => {
        prompter
            .setup((p) => p.promptSingle(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));
        void connectionUI.promptToManageProfiles();
        prompter.verify((p) => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test("promptForRetryCreateProfile should show an error message and create profile", async () => {
        let profile = new ConnectionProfile();
        let mockConnection = { connectionString: "test" };
        vscodeWrapper
            .setup((v) => v.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(LocalizedConstants.retryLabel));
        prompter
            .setup((p) => p.prompt(TypeMoq.It.isAny(), true))
            .returns(() => Promise.resolve(mockConnection));

        await connectionUI.promptForRetryCreateProfile(profile);

        vscodeWrapper.verify(
            (v) => v.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("createProfileWithDifferentCredentials should prompt to recreate connection", () => {
        let credentials = new ConnectionCredentials();
        vscodeWrapper
            .setup((v) => v.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve("test"));
        return connectionUI.createProfileWithDifferentCredentials(credentials).then(() => {
            vscodeWrapper.verify(
                (v) => v.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });
});
