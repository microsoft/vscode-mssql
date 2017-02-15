'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import * as Constants from '../src/constants/constants';
import LocalizedConstants = require('../src/constants/localizedConstants');
import * as stubs from './stubs';
import * as interfaces from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';
import { ConnectionCredentials } from '../src/models/connectionCredentials';
import { IPrompter, IQuestion} from '../src/prompts/question';
import { TestPrompter } from './stubs';
import { IConnectionProfile, IConnectionCredentials } from '../src/models/interfaces';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import assert = require('assert');

suite('ConnectionCredentials Tests', () => {
    let defaultProfile: interfaces.IConnectionProfile;
    let prompter: TypeMoq.Mock<IPrompter>;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let credentialStore: TypeMoq.Mock<CredentialStore>;
    let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    let connectionStore: TypeMoq.Mock<ConnectionStore>;

    setup(() => {
        defaultProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde'
        });


        prompter = TypeMoq.Mock.ofType(TestPrompter);
        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        credentialStore = TypeMoq.Mock.ofType(CredentialStore);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
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

    // ConnectProfile sets up a connection call to ensureRequiredPropertiesSet with the provided profile
    function connectProfile( profile: IConnectionProfile, emptyPassword: boolean): Promise<IConnectionCredentials> {
        // Setup input paramaters
        let isProfile: boolean = true;
        let isPasswordRequired: boolean = false;
        let wasPasswordEmptyInConfigFile: boolean = emptyPassword;
        let answers = {};


        // Mocking functions
        connectionStore.setup(x => x.removeProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(true)));
        connectionStore.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(profile1)));
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).returns((questions: IQuestion[]) => Promise.resolve(answers));

        // Function Call to test
        return ConnectionCredentials.ensureRequiredPropertiesSet(
            profile,
            isProfile,
            isPasswordRequired,
            wasPasswordEmptyInConfigFile,
            prompter.object,
            connectionStore.object);
    }


    // Connect with savePassword true and filled password and ensure password is saved and removed from plain text
    test('ensureRequiredPropertiesSet should remove password from plain text and save password to Credential Store', done => {
        // Setup Profile Information to have savePassword on and filled in password
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: true,
            password: 'oldPassword'
        });
        let emptyPassword = false;

        connectProfile(profile, emptyPassword).then( success => {
            assert.ok(success);
            connectionStore.verify(x => x.removeProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
            connectionStore.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
            done();
        }).catch(err => done(new Error(err)));
    });

    // Connect with savePassword true and empty password does not reset password
    test('ensureRequiredPropertiesSet should keep Credential Store password', done => {
        // Setup Profile Information to have savePassword on and blank
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: true,
            password: ''
        });

        let emptyPassword = true;
        connectProfile(profile, emptyPassword).then( success => {
            assert.ok(success);
            connectionStore.verify(x => x.removeProfile(TypeMoq.It.isAny()), TypeMoq.Times.never());
            connectionStore.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.never());
            done();
        }).catch(err => done(new Error(err)));
    });

    // Connect with savePassword false and ensure password is never saved
    test('ensureRequiredPropertiesSet should not save password', done => {
        // Setup Profile Information to have savePassword off and blank
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: false,
            password: 'oldPassword'
        });

        let emptyPassword = false;
        connectProfile(profile, emptyPassword).then( success => {
            assert.ok(success);
            connectionStore.verify(x => x.removeProfile(TypeMoq.It.isAny()), TypeMoq.Times.never());
            connectionStore.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.never());
            done();
        }).catch(err => done(new Error(err)));
    });

    // Connect with savePassword true and blank password and
    // confirm password is prompted for and saved
    test('ensureRequiredPropertiesSet should request password and save it', done => {
        // Setup Profile Information to have savePassword off and blank
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: true,
            password: ''
        });

        // Setup input paramaters
        let isProfile: boolean = true;
        let isPasswordRequired: boolean = false;
        let wasPasswordEmptyInConfigFile: boolean = false;
        let passwordQuestion: IQuestion[];
        let answers = {};


        // Mocking functions
        connectionStore.setup(x => x.removeProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(true)));
        connectionStore.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(profile1)));
        prompter.setup(x => x.prompt(TypeMoq.It.isAny())).callback(questions => {
                passwordQuestion = questions.filter(question => question.name === LocalizedConstants.passwordPrompt);
                answers[LocalizedConstants.passwordPrompt] = 'newPassword';
                passwordQuestion[0].onAnswered(answers[LocalizedConstants.passwordPrompt]);
            })
            .returns((questions: IQuestion[]) => Promise.resolve(answers));

        // Call function to test
        ConnectionCredentials.ensureRequiredPropertiesSet(
            profile,
            isProfile,
            isPasswordRequired,
            wasPasswordEmptyInConfigFile,
            prompter.object,
            connectionStore.object).then( success => {
                assert.ok(success);
                // Checking to see password question was prompted
                assert.ok(passwordQuestion);
                assert.equal(success.password, answers[LocalizedConstants.passwordPrompt]);
                connectionStore.verify(x => x.removeProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
                connectionStore.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());
                done();
            }).catch(err => done(new Error(err)));
    });
});
