/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

'use strict';
import * as TypeMoq from 'typemoq';

import * as utils from '../src/models/utils';
import * as Constants from '../src/constants/constants';
import LocalizedConstants = require('../src/constants/localizedConstants');
import * as stubs from './stubs';
import * as interfaces from '../src/models/interfaces';
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
    let prompter: TypeMoq.IMock<IPrompter>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;

    setup(() => {
        defaultProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde'
        });


        prompter = TypeMoq.Mock.ofType(TestPrompter);
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

    function ensureRequestAndSavePassword(emptyPassword: boolean): (done: MochaDone) => void {
        return (done: MochaDone) => {
            // Setup Profile Information to have savePassword on and blank
            let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
                savePassword: true,
                emptyPasswordInput: emptyPassword,
                password: ''
            });

            // Setup input paramaters
            let isProfile: boolean = true;
            let isPasswordRequired: boolean = false;
            let wasPasswordEmptyInConfigFile: boolean = emptyPassword;
            let passwordQuestion: IQuestion[];
            let answers = {};

            // Mocking functions
            connectionStore.setup(x => x.removeProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(true)));
            connectionStore.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns((profile1: IConnectionProfile) => (Promise.resolve(profile1)));
            prompter.setup(x => x.prompt(TypeMoq.It.isAny())).callback(questions => {
                    passwordQuestion = questions.filter(question => question.name === LocalizedConstants.passwordPrompt);
                    answers[LocalizedConstants.passwordPrompt] = emptyPassword ? '' : 'newPassword';
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
        };
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

    // Connect with savePassword false and ensure empty password is never saved
    test('ensureRequiredPropertiesSet should not save password, empty password case', done => {
        // Setup Profile Information to have savePassword off and blank
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: false,
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

    // Connect with savePassword true and blank password and
    // confirm password is prompted for and saved for non-empty password
    test('ensureRequiredPropertiesSet should request password and save it for non-empty passwords', ensureRequestAndSavePassword(false));

    // Connect with savePassword true and blank password and
    // confirm password is prompted for and saved correctly for an empty password
    test('ensureRequiredPropertiesSet should request password and save it correctly for empty passswords', ensureRequestAndSavePassword(true));

    // A connection string can be set alongside other properties for createConnectionDetails
    test('createConnectionDetails sets properties in addition to the connection string', () => {
        let credentials = new ConnectionCredentials();
        credentials.connectionString = 'server=some-server';
        credentials.database = 'some-db';

        let connectionDetails = ConnectionCredentials.createConnectionDetails(credentials);
        assert.equal(connectionDetails.options.connectionString, credentials.connectionString);
        assert.equal(connectionDetails.options.database, credentials.database);
    });

    test('Subsequent connection credential questions are skipped if a connection string is given', () => {
        let credentials = new ConnectionCredentials();
        let questions = ConnectionCredentials['getRequiredCredentialValuesQuestions'](credentials, false, false);
        let serverQuestion = questions.filter(question => question.name === LocalizedConstants.serverPrompt)[0];

        let connectionString = 'server=some-server';
        serverQuestion.onAnswered(connectionString);

        // Verify that the remaining questions will not prompt
        let otherQuestions = questions.filter(question => question.name !== LocalizedConstants.serverPrompt);
        otherQuestions.forEach(question => assert.equal(question.shouldPrompt({}), false));
    });

    test('Server question properly handles connection strings', () => {
        let credentials = new ConnectionCredentials();
        let questions = ConnectionCredentials['getRequiredCredentialValuesQuestions'](credentials, false, false);
        let serverQuestion = questions.filter(question => question.name === LocalizedConstants.serverPrompt)[0];

        let connectionString = 'server=some-server';
        serverQuestion.onAnswered(connectionString);

        // Verify that the question updated the connection string
        assert.equal(credentials.connectionString, connectionString);
        assert.notEqual(credentials.server, connectionString);

        let serverName = 'some-server';
        serverQuestion.onAnswered(serverName);
        assert.equal(credentials.server, serverName);
        assert.notEqual(credentials.connectionString, serverName);
    });
});

