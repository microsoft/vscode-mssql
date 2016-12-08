'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
// import fs = require('fs');
import * as utils from '../src/models/utils';
// import * as connectionInfo from '../src/models/connectionInfo';
import * as Constants from '../src/models/constants';
import * as stubs from './stubs';
import * as interfaces from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';
import { ConnectionConfig } from '../src/connectionconfig/connectionconfig';
import { ConnectionCredentials } from '../src/models/ConnectionCredentials';
import { IPrompter, IQuestion} from '../src/prompts/question';
import { TestPrompter } from './stubs';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import assert = require('assert');

suite('ConnectionCredentials Tests', () => {
    let defaultNamedProfile: interfaces.IConnectionProfile;
    let prompter: TypeMoq.Mock<IPrompter>;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.Mock<vscode.Memento>;
    let credentialStore: TypeMoq.Mock<CredentialStore>;
    let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    let connectionConfig: TypeMoq.Mock<ConnectionConfig>;
    let connectionStore: TypeMoq.Mock<ConnectionStore>;

    setup(() => {
        defaultNamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultNamedProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: 'asdf!@#$'
        });


        prompter = TypeMoq.Mock.ofType(TestPrompter);
        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        globalstate = TypeMoq.Mock.ofType(stubs.TestMemento);
        context.object.globalState = globalstate.object;
        credentialStore = TypeMoq.Mock.ofType(CredentialStore);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        connectionConfig = TypeMoq.Mock.ofType(ConnectionConfig);
        connectionStore = TypeMoq.Mock.ofType(ConnectionStore);

        // setup default behavior for vscodeWrapper
        // setup configuration to return maxRecent for the #MRU items
        let maxRecent = 5;
        let configResult: {[key: string]: any} = {};
        configResult[Constants.configMaxRecentConnections] = maxRecent;
        let config = stubs.createWorkspaceConfiguration(configResult);
        vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
        .returns(x => {
            return config;
        });
    });

    test('ensureRequiredPropertiesSet should remove password from plain text and save password to Credential Store', done => {
        // Setup Profile Information
        let profile = Object.assign(new ConnectionProfile(), defaultNamedProfile, {
            profileName: 'otherServer-bcd-cde',
            server: 'otherServer',
            savePassword: true
        });

        let isProfile: boolean = true;
        let isPasswordRequired: boolean = false;
        let wasPasswordEmptyInConfigFile: boolean = false;
        let answers = {};

        connectionConfig.setup(x => x.addConnection(TypeMoq.It.isAny()));
        connectionStore.setup(x => x.removeProfile(TypeMoq.It.isAny()));
        connectionStore.setup(x => x.saveProfile(TypeMoq.It.isAny()));
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAny())).returns(() => Promise.resolve());
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).returns((questions: IQuestion[]) => Promise.resolve(answers));


        ConnectionCredentials.ensureRequiredPropertiesSet(
            profile,
            isProfile,
            isPasswordRequired,
            wasPasswordEmptyInConfigFile,
            prompter.object,
            connectionStore.object)
            .then( success => {
                assert.ok(success);
                connectionStore.verify(x => x.removeProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
                connectionStore.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
                connectionConfig.verify(x => x.addConnection(TypeMoq.It.isAny()), TypeMoq.Times.once());
                // done();
            });

        done();
    });

});
