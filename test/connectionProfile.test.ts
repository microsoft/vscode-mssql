/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import { IConnectionProfile, AuthenticationTypes } from '../src/models/interfaces';
import { ConnectionCredentials } from '../src/models/connectionCredentials';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { IQuestion, IPrompter, INameValueChoice } from '../src/prompts/question';
import { TestPrompter } from './stubs';
import { ConnectionUI } from '../src/views/connectionUI';
import { ConnectionStore } from '../src/models/connectionStore';
import ConnectionManager from '../src/controllers/connectionManager';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import * as LocalizedConstants from '../src/constants/localizedConstants';
import * as assert from 'assert';
import { AccountStore } from '../src/azure/accountStore';
import { IConnectionInfo } from 'vscode-mssql';
import { AzureController } from '../src/azure/azureController';

function createTestCredentials(): IConnectionInfo {
    const creds: IConnectionInfo = {
        server:                         'my-server',
        database:                       'my_db',
        user:                           'sa',
        password:                       '12345678',
        email:                          'test-email',
        accountId:                      'test-account-id',
        port:                           1234,
        authenticationType:             AuthenticationTypes[AuthenticationTypes.SqlLogin],
        azureAccountToken:              '',
        expiresOn:                      0,
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
        typeSystemVersion:              'Latest',
        connectionString:               ''
    };
    return creds;
}

suite('Connection Profile tests', () => {
    let authTypeQuestionIndex = 2;
    let mockAccountStore: AccountStore;
    let mockAzureController: AzureController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.IMock<vscode.Memento>;

    setup(() => {

        globalstate = TypeMoq.Mock.ofType<vscode.Memento>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup(c => c.workspaceState).returns(() => globalstate.object);
        mockAzureController = new AzureController(mockContext.object);
        mockAccountStore = new AccountStore(mockContext.object);
    });

    test('CreateProfile should ask questions in correct order', async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called and user cancels out
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        await ConnectionProfile.createProfile(prompter.object, undefined, undefined, mockAzureController, mockAccountStore)
            .then(profile => profileReturned = profile);

        // Then expect the following flow:
        let questionNames: string[] = [
            LocalizedConstants.serverPrompt,     // Server
            LocalizedConstants.databasePrompt,   // DB Name
            LocalizedConstants.authTypeName,   // Authentication Type
            LocalizedConstants.usernamePrompt,   // UserName
            LocalizedConstants.passwordPrompt,   // Password
            LocalizedConstants.msgSavePassword,  // Save Password
            LocalizedConstants.aad,              // Choose AAD Account
            LocalizedConstants.profileNamePrompt // Profile Name
        ];

        assert.strictEqual(profileQuestions.length, questionNames.length, 'unexpected number of questions');
        for (let i = 0; i < profileQuestions.length; i++) {
            assert.strictEqual(profileQuestions[i].name, questionNames[i], `Missing question for ${questionNames[i]}`);
        }
        // And expect result to be undefined as questions were not answered
        assert.strictEqual(profileReturned, undefined);
    });


    test('CreateProfile - SqlPassword should be default auth type', async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];

        // When createProfile is called
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(async questions => {
                    //
                    return answers;
                });

        await ConnectionProfile.createProfile(prompter.object, undefined, undefined, mockAzureController, mockAccountStore);

        // Then expect SqlAuth to be the only default type
        let authChoices = <INameValueChoice[]>profileQuestions[authTypeQuestionIndex].choices;
        assert.strictEqual(authChoices[0].name, LocalizedConstants.authTypeSql);
    });

    test('CreateProfile - Integrated auth support', async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(async questions => {
                    //
                    return answers;
                });

        // When createProfile is called on an OS
        await ConnectionProfile.createProfile(prompter.object, undefined, undefined, mockAzureController, mockAccountStore);

        // Then integrated auth should/should not be supported
        // TODO if possible the test should mock out the OS dependency but it's not clear
        // how to do this without implementing a facade and doing full factory/dependency injection
        // for now, just validates expected behavior on the platform tests are running on
        let authQuestion: IQuestion = profileQuestions[authTypeQuestionIndex];
        let authChoices = <INameValueChoice[]>authQuestion.choices;
        assert.strictEqual(authChoices.length, 3);
        assert.strictEqual(authChoices[1].name, LocalizedConstants.authTypeIntegrated);
        assert.strictEqual(authChoices[1].value, AuthenticationTypes[AuthenticationTypes.Integrated]);

        // And on a platform with multiple choices, should prompt for input
        assert.strictEqual(authQuestion.shouldPrompt(answers), true);
    });

    test('Port number is applied to server name when connection credentials are transformed into details', () => {
        // Given a connection credentials object with server and a port
        let creds = new ConnectionCredentials();
        creds.server = 'my-server';
        creds.port = 1234;

        // When credentials are transformed into a details contract
        const details = ConnectionCredentials.createConnectionDetails(creds);

        // Server name should be in the format <address>,<port>
        assert.strictEqual(details.options['server'], 'my-server,1234');
    });

    test('All connection details properties can be set from connection credentials', () => {
        const creds = createTestCredentials();
        const details = ConnectionCredentials.createConnectionDetails(creds);

        assert.notStrictEqual(typeof details.options['applicationIntent'], 'undefined');
        assert.notStrictEqual(typeof details.options['applicationName'], 'undefined');
        assert.notStrictEqual(typeof details.options['attachDbFilename'], 'undefined');
        assert.notStrictEqual(typeof details.options['authenticationType'], 'undefined');
        assert.notStrictEqual(typeof details.options['connectRetryCount'], 'undefined');
        assert.notStrictEqual(typeof details.options['connectRetryInterval'], 'undefined');
        assert.notStrictEqual(typeof details.options['connectTimeout'], 'undefined');
        assert.notStrictEqual(typeof details.options['currentLanguage'], 'undefined');
        assert.notStrictEqual(typeof details.options['database'], 'undefined');
        assert.notStrictEqual(typeof details.options['encrypt'], 'undefined');
        assert.notStrictEqual(typeof details.options['failoverPartner'], 'undefined');
        assert.notStrictEqual(typeof details.options['loadBalanceTimeout'], 'undefined');
        assert.notStrictEqual(typeof details.options['maxPoolSize'], 'undefined');
        assert.notStrictEqual(typeof details.options['minPoolSize'], 'undefined');
        assert.notStrictEqual(typeof details.options['multipleActiveResultSets'], 'undefined');
        assert.notStrictEqual(typeof details.options['multiSubnetFailover'], 'undefined');
        assert.notStrictEqual(typeof details.options['packetSize'], 'undefined');
        assert.notStrictEqual(typeof details.options['password'], 'undefined');
        assert.notStrictEqual(typeof details.options['persistSecurityInfo'], 'undefined');
        assert.notStrictEqual(typeof details.options['pooling'], 'undefined');
        assert.notStrictEqual(typeof details.options['replication'], 'undefined');
        assert.notStrictEqual(typeof details.options['server'], 'undefined');
        assert.notStrictEqual(typeof details.options['trustServerCertificate'], 'undefined');
        assert.notStrictEqual(typeof details.options['typeSystemVersion'], 'undefined');
        assert.notStrictEqual(typeof details.options['user'], 'undefined');
        assert.notStrictEqual(typeof details.options['workstationId'], 'undefined');
    });

    test('Profile is connected to and validated prior to saving', done => {
        let connectionManagerMock: TypeMoq.IMock<ConnectionManager> = TypeMoq.Mock.ofType(ConnectionManager);
        connectionManagerMock.setup(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(true));

        let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
        connectionStoreMock.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(questions => {
                    let answers: {[key: string]: string} = {};
                    answers[LocalizedConstants.serverPrompt] = 'my-server';
                    answers[LocalizedConstants.databasePrompt] = 'my_db';
                    answers[LocalizedConstants.usernamePrompt] = 'sa';
                    answers[LocalizedConstants.passwordPrompt] = '12345678';
                    answers[LocalizedConstants.authTypeName] = AuthenticationTypes[AuthenticationTypes.SqlLogin];
                    for (let key in answers) {
                        if (answers.hasOwnProperty(key)) {
                            questions.map(q => { if (q.name === key) { q.onAnswered(answers[key]); } });
                        }
                    }
                    return Promise.resolve(answers);
                });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup(x => x.activeTextEditorUri).returns(() => 'test.sql');

        let connectionUI = new ConnectionUI(connectionManagerMock.object, undefined,
            connectionStoreMock.object, mockAccountStore, prompter.object, vscodeWrapperMock.object);

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
        let connectionManagerMock: TypeMoq.IMock<ConnectionManager> = TypeMoq.Mock.ofType(ConnectionManager);
        connectionManagerMock.setup(x => x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(false));
        connectionManagerMock.setup(x => x.failedUriToFirewallIpMap).returns(() => new Map());

        let connectionStoreMock = TypeMoq.Mock.ofType(ConnectionStore);
        connectionStoreMock.setup(x => x.saveProfile(TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns(questions => {
                    let answers: {[key: string]: string} = {};
                    answers[LocalizedConstants.serverPrompt] = 'my-server';
                    answers[LocalizedConstants.databasePrompt] = 'my_db';
                    answers[LocalizedConstants.usernamePrompt] = 'sa';
                    answers[LocalizedConstants.passwordPrompt] = '12345678';
                    answers[LocalizedConstants.authTypeName] = AuthenticationTypes[AuthenticationTypes.SqlLogin];
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

        let connectionUI = new ConnectionUI(connectionManagerMock.object, undefined,
            connectionStoreMock.object, mockAccountStore, prompter.object, vscodeWrapperMock.object);

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

    test('Profile can be created from a connection string', done => {
        let answers = {};
        answers[LocalizedConstants.serverPrompt] = 'Server=my-server';

        // Set up the prompter to answer the server prompt with the connection string
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter.setup(x => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(questions => {
            questions.filter(question => question.name === LocalizedConstants.serverPrompt)[0].onAnswered(answers[LocalizedConstants.serverPrompt]);
            questions.filter(question => question.name !== LocalizedConstants.serverPrompt && question.name !== LocalizedConstants.profileNamePrompt)
                .forEach(question => {
                    // Verify that none of the other questions prompt once a connection string is given
                    assert.equal(question.shouldPrompt(answers), false);
                });
            return Promise.resolve(answers);
        });

        // Verify that a profile was created
        ConnectionProfile.createProfile(prompter.object, undefined, undefined, mockAzureController, mockAccountStore).then( profile => {
            assert.equal(Boolean(profile), true);
            done();
        });
    });
});

