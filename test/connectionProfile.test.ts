'use strict';

import * as TypeMoq from 'typemoq';
import { IConnectionCredentials, IConnectionProfile, AuthenticationTypes } from '../src/models/interfaces';
import { ConnectionCredentials } from '../src/models/connectionCredentials';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { IQuestion, IPrompter, INameValueChoice } from '../src/prompts/question';
import { TestPrompter } from './stubs';
import { ConnectionUI } from '../src/views/connectionUI';
import { ConnectionStore } from '../src/models/connectionStore';
import ConnectionManager from '../src/controllers/connectionManager';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import Constants = require('../src/models/constants');
import assert = require('assert');
import os = require('os');

function createTestCredentials(): IConnectionCredentials {
    const creds: IConnectionCredentials = {
        server:                         'my-server',
        database:                       'my_db',
        user:                           'sa',
        password:                       '12345678',
        port:                           1234,
        authenticationType:             AuthenticationTypes[AuthenticationTypes.SqlLogin],
        encrypt:                        false,
        trustServerCertificate:         false,
        persistSecurityInfo:            false,
        connectTimeout:                 15,
        connectRetryCount:              0,
        connectRetryInterval:           0,
        applicationName:                'vscode-mssql',
        workstationId:                  'test',
        applicationIntent:              '',
        currentLanguage:                '',
        pooling:                        true,
        maxPoolSize:                    15,
        minPoolSize:                    0,
        loadBalanceTimeout:             0,
        replication:                    false,
        attachDbFilename:               '',
        failoverPartner:                '',
        multiSubnetFailover:            false,
        multipleActiveResultSets:       false,
        packetSize:                     8192,
        typeSystemVersion:              'Latest'
    };
    return creds;
}

suite('Connection Profile tests', () => {
    let authTypeQuestionIndex = 2;

    setup(() => {
        // No setup currently needed
    });

    test('CreateProfile should ask questions in correct order', done => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called and user cancels out
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then expect the following flow:
        let questionNames: string[] = [
            Constants.serverPrompt,     // Server
            Constants.databasePrompt,   // DB Name
            Constants.authTypePrompt,   // Authentication Type
            Constants.usernamePrompt,   // UserName
            Constants.passwordPrompt,   // Password
            Constants.msgSavePassword,  // Save Password
            Constants.profileNamePrompt // Profile Name
        ];

        assert.strictEqual(profileQuestions.length, questionNames.length, 'unexpected number of questions');
        for (let i = 0; i < profileQuestions.length; i++) {
            assert.strictEqual(profileQuestions[i].name, questionNames[i], `Missing question for ${questionNames[i]}`);
        }
        // And expect result to be undefined as questions were not answered
        assert.strictEqual(profileReturned, undefined);
        done();
    });


    test('CreateProfile - SqlPassword should be default auth type', done => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then expect SqlAuth to be the only default type
        let authChoices = <INameValueChoice[]>profileQuestions[authTypeQuestionIndex].choices;
        assert.strictEqual(authChoices[0].name, Constants.authTypeSql);
        done();
    });

    test('CreateProfile - Integrated auth support', done => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        // When createProfile is called on an OS
        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then integrated auth should/should not be supported
        // TODO if possible the test should mock out the OS dependency but it's not clear
        // how to do this without implementing a facade and doing full factory/dependency injection
        // for now, just validates expected behavior on the platform tests are running on
        let authQuestion: IQuestion = profileQuestions[authTypeQuestionIndex];
        let authChoices = <INameValueChoice[]>authQuestion.choices;
        if ('win32' === os.platform()) {
            assert.strictEqual(authChoices.length, 2);
            assert.strictEqual(authChoices[1].name, Constants.authTypeIntegrated);
            assert.strictEqual(authChoices[1].value, AuthenticationTypes[AuthenticationTypes.Integrated]);

            // And on a platform with multiple choices, should prompt for input
            assert.strictEqual(authQuestion.shouldPrompt(answers), true);
        } else {
            assert.strictEqual(authChoices.length, 1);
            // And on a platform with only 1 choice, should not prompt for input
            assert.strictEqual(authQuestion.shouldPrompt(answers), false);
        }
        done();
    });

    test('Port number is applied to server name when connection credentials are transformed into details', () => {
        // Given a connection credentials object with server and a port
        let creds = new ConnectionCredentials();
        creds.server = 'my-server';
        creds.port = 1234;

        // When credentials are transformed into a details contract
        const details = ConnectionCredentials.createConnectionDetails(creds);

        // Server name should be in the format <address>,<port>
        assert.strictEqual(details.serverName, 'my-server,1234');
    });

    test('All connection details properties can be set from connection credentials', () => {
        const creds = createTestCredentials();
        const details = ConnectionCredentials.createConnectionDetails(creds);

        assert.notStrictEqual(typeof details.applicationIntent, 'undefined');
        assert.notStrictEqual(typeof details.applicationName, 'undefined');
        assert.notStrictEqual(typeof details.attachDbFilename, 'undefined');
        assert.notStrictEqual(typeof details.authenticationType, 'undefined');
        assert.notStrictEqual(typeof details.connectRetryCount, 'undefined');
        assert.notStrictEqual(typeof details.connectRetryInterval, 'undefined');
        assert.notStrictEqual(typeof details.connectTimeout, 'undefined');
        assert.notStrictEqual(typeof details.currentLanguage, 'undefined');
        assert.notStrictEqual(typeof details.databaseName, 'undefined');
        assert.notStrictEqual(typeof details.encrypt, 'undefined');
        assert.notStrictEqual(typeof details.failoverPartner, 'undefined');
        assert.notStrictEqual(typeof details.loadBalanceTimeout, 'undefined');
        assert.notStrictEqual(typeof details.maxPoolSize, 'undefined');
        assert.notStrictEqual(typeof details.minPoolSize, 'undefined');
        assert.notStrictEqual(typeof details.multipleActiveResultSets, 'undefined');
        assert.notStrictEqual(typeof details.multiSubnetFailover, 'undefined');
        assert.notStrictEqual(typeof details.packetSize, 'undefined');
        assert.notStrictEqual(typeof details.password, 'undefined');
        assert.notStrictEqual(typeof details.persistSecurityInfo, 'undefined');
        assert.notStrictEqual(typeof details.pooling, 'undefined');
        assert.notStrictEqual(typeof details.replication, 'undefined');
        assert.notStrictEqual(typeof details.serverName, 'undefined');
        assert.notStrictEqual(typeof details.trustServerCertificate, 'undefined');
        assert.notStrictEqual(typeof details.typeSystemVersion, 'undefined');
        assert.notStrictEqual(typeof details.userName, 'undefined');
        assert.notStrictEqual(typeof details.workstationId, 'undefined');
    });

    test('Profile is connected to and validated prior to saving', done => {
        let connectionManagerMock: TypeMoq.Mock<ConnectionManager> = TypeMoq.Mock.ofType(ConnectionManager);
        connectionManagerMock.setup(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(true));

        let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
        connectionStoreMock.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .returns(questions => {
                    let answers: {[key: string]: string} = {};
                    answers[Constants.serverPrompt] = 'my-server';
                    answers[Constants.databasePrompt] = 'my_db';
                    answers[Constants.usernamePrompt] = 'sa';
                    answers[Constants.passwordPrompt] = '12345678';
                    answers[Constants.authTypePrompt] = AuthenticationTypes[AuthenticationTypes.SqlLogin];
                    for (let key in answers) {
                        if (answers.hasOwnProperty(key)) {
                            questions.map(q => { if (q.name === key) { q.onAnswered(answers[key]); } });
                        }
                    }
                    return Promise.resolve(answers);
                });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup(x => x.activeTextEditorUri).returns(() => 'test.sql');

        let connectionUI = new ConnectionUI(connectionManagerMock.object, connectionStoreMock.object, prompter.object, vscodeWrapperMock.object);

        // create a new connection profile
        connectionUI.createAndSaveProfile().then(profile => {
            // connection is attempted
            connectionManagerMock.verify(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

            // profile is saved
            connectionStoreMock.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.once());

            done();
        }).catch(err => {
            done(err);
        });
    });

    test('Profile is not saved when connection validation fails', done => {
        let connectionManagerMock: TypeMoq.Mock<ConnectionManager> = TypeMoq.Mock.ofType(ConnectionManager);
        connectionManagerMock.setup(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(false));

        let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
        connectionStoreMock.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .returns(questions => {
                    let answers: {[key: string]: string} = {};
                    answers[Constants.serverPrompt] = 'my-server';
                    answers[Constants.databasePrompt] = 'my_db';
                    answers[Constants.usernamePrompt] = 'sa';
                    answers[Constants.passwordPrompt] = '12345678';
                    answers[Constants.authTypePrompt] = AuthenticationTypes[AuthenticationTypes.SqlLogin];
                    for (let key in answers) {
                        if (answers.hasOwnProperty(key)) {
                            questions.map(q => { if (q.name === key) { q.onAnswered(answers[key]); } });
                        }
                    }
                    return Promise.resolve(answers);
                });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup(x => x.activeTextEditorUri).returns(() => 'test.sql');
        vscodeWrapperMock.setup(x => x.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        let connectionUI = new ConnectionUI(connectionManagerMock.object, connectionStoreMock.object, prompter.object, vscodeWrapperMock.object);

        // create a new connection profile
        connectionUI.createAndSaveProfile().then(profile => {
            // connection is attempted
            connectionManagerMock.verify(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

            // profile is not saved
            connectionStoreMock.verify(x => x.saveProfile(TypeMoq.It.isAny()), TypeMoq.Times.never());

            done();
        }).catch(err => {
            done(err);
        });
    });
});

