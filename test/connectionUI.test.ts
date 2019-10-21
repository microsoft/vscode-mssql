/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import { ConnectionUI } from '../src/views/connectionUI';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import { IPrompter } from '../src/prompts/question';
import { ConnectionStore } from '../src/models/connectionStore';
import ConnectionManager from '../src/controllers/connectionManager';
import { IConnectionProfile, IConnectionCredentials } from '../src/models/interfaces';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionCredentials } from '../src/models/connectionCredentials';

suite('Connection UI tests', () => {

    // Class being tested
    let connectionUI: ConnectionUI;

    // Mocks
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let prompter: TypeMoq.IMock<IPrompter>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;

    setup(() => {
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup(c => c.clear());
        outputChannel.setup(c => c.append(TypeMoq.It.isAny()));
        outputChannel.setup(c => c.show(TypeMoq.It.isAny()));
        vscodeWrapper.setup(v => v.createOutputChannel(TypeMoq.It.isAny())).returns(() => outputChannel.object);
        vscodeWrapper.setup(v => v.showErrorMessage(TypeMoq.It.isAny()));
        prompter = TypeMoq.Mock.ofType<IPrompter>();
        prompter.setup(p => p.promptSingle(TypeMoq.It.isAny())).returns(() => Promise.resolve(TypeMoq.It.isAny()));
        connectionStore = TypeMoq.Mock.ofType(ConnectionStore, TypeMoq.MockBehavior.Loose);
        connectionStore.setup(c => c.getPickListItems()).returns(() => TypeMoq.It.isAny());
        connectionManager = TypeMoq.Mock.ofType(ConnectionManager, TypeMoq.MockBehavior.Loose);
        connectionUI = new ConnectionUI(connectionManager.object,
            connectionStore.object, prompter.object, vscodeWrapper.object);
    });

    test('showConnectionErrors should show errors in the output channel', () => {
        connectionUI.showConnectionErrors(TypeMoq.It.isAnyString());
        outputChannel.verify(c => c.clear(), TypeMoq.Times.once());
        outputChannel.verify(c => c.append(TypeMoq.It.isAny()), TypeMoq.Times.once());
        outputChannel.verify(c => c.show(true), TypeMoq.Times.once());
    });

    test('showConnections should only show picklist if true', (done) => {
        connectionUI.showConnections(true).then(() => {
            connectionStore.verify(c => c.getPickListItems(), TypeMoq.Times.once());
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('showConnection should not show recent connections if false', (done) => {
        connectionUI.showConnections(false).then(() => {
            connectionStore.verify(c => c.getPickListItems(), TypeMoq.Times.never());
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.never());
            done();
        });
    });

    test('promptLanguageFlavor should prompt for a language flavor', (done) => {
        connectionUI.promptLanguageFlavor().then(() => {
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('promptToCancelConnection should prompt for cancellation', (done) => {
        connectionUI.promptToCancelConnection().then(() => {
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('promptForPassword should prompt for password', (done) => {
        connectionUI.promptToCancelConnection().then(() => {
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('promptToChangeLanguageMode should prompt for language mode', (done) => {
        connectionUI.promptToChangeLanguageMode().then(() => {
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('removeProfile should prompt for a profile and remove it', (done) => {
        connectionStore.setup(c => c.getProfilePickListItems(TypeMoq.It.isAny())).returns(() => TypeMoq.It.isAny());
        connectionUI.removeProfile().then(() => {
            connectionStore.verify(c => c.getProfilePickListItems(false), TypeMoq.Times.once());
            prompter.verify(p => p.prompt(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('removeProfile should show error if there are no profiles to remove', (done) => {
        connectionStore.setup(c => c.getProfilePickListItems(TypeMoq.It.isAny())).returns(() => undefined);
        connectionUI.removeProfile().then(() => {
            connectionStore.verify(c => c.getProfilePickListItems(false), TypeMoq.Times.once());
            prompter.verify(p => p.prompt(TypeMoq.It.isAny()), TypeMoq.Times.never());
            vscodeWrapper.verify(v => v.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('promptToManageProfiles should prompt to manage profile', (done) => {
        connectionUI.promptToManageProfiles().then(() => {
            prompter.verify(p => p.promptSingle(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('promptForRetryCreateProfile should show an error message and create profile', (done) => {
        let profile = new ConnectionProfile();
        connectionUI.promptForRetryCreateProfile(profile).then(() => {
            vscodeWrapper.verify(v => v.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });

    test('createProfileWithDifferentCredentials should prompt to recreate connection', (done) => {
        let credentials = new ConnectionCredentials();
        connectionUI.createProfileWithDifferentCredentials(credentials).then(() => {
            vscodeWrapper.verify(v => v.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        });
    });
});
