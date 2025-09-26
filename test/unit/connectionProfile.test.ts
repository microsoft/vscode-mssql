/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import { AccountStore } from "../../src/azure/accountStore";
import { AzureController } from "../../src/azure/azureController";
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";
import * as LocalizedConstants from "../../src/constants/locConstants";
import ConnectionManager from "../../src/controllers/connectionManager";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ConnectionCredentials } from "../../src/models/connectionCredentials";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ConnectionStore } from "../../src/models/connectionStore";
import { AuthenticationTypes, IConnectionProfile } from "../../src/models/interfaces";
import { INameValueChoice, IPrompter, IQuestion } from "../../src/prompts/question";
import { ConnectionUI } from "../../src/views/connectionUI";
import { TestPrompter } from "./stubs";

function createTestCredentials(): IConnectionInfo {
    const creds: IConnectionInfo = {
        server: "my-server",
        database: "my_db",
        user: "sa",
        password: "12345678",
        email: "test-email",
        accountId: "test-account-id",
        tenantId: "test-tenant-id",
        port: 1234,
        authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
        azureAccountToken: "",
        expiresOn: 0,
        encrypt: "Optional",
        trustServerCertificate: false,
        hostNameInCertificate: "",
        persistSecurityInfo: false,
        columnEncryptionSetting: "Enabled",
        secureEnclaves: "Enabled",
        attestationProtocol: "HGS",
        enclaveAttestationUrl: "https://attestationurl",
        connectTimeout: 15,
        commandTimeout: 30,
        connectRetryCount: 0,
        connectRetryInterval: 0,
        applicationName: "vscode-mssql",
        workstationId: "test",
        applicationIntent: "",
        currentLanguage: "",
        pooling: true,
        maxPoolSize: 15,
        minPoolSize: 0,
        loadBalanceTimeout: 0,
        replication: false,
        attachDbFilename: "",
        failoverPartner: "",
        multiSubnetFailover: false,
        multipleActiveResultSets: false,
        packetSize: 8192,
        typeSystemVersion: "Latest",
        connectionString: "",
        containerName: "",
    };
    return creds;
}

suite("Connection Profile tests", () => {
    let authTypeQuestionIndex = 2;
    let mockAccountStore: AccountStore;
    let mockAzureController: AzureController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockPrompter: TypeMoq.IMock<IPrompter>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let globalstate: TypeMoq.IMock<
        vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
    >;

    setup(() => {
        globalstate = TypeMoq.Mock.ofType<
            vscode.Memento & { setKeysForSync(keys: readonly string[]): void }
        >();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockPrompter = TypeMoq.Mock.ofType<IPrompter>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockContext.setup((c) => c.globalState).returns(() => globalstate.object);
        mockAzureController = new MsalAzureController(
            mockContext.object,
            mockPrompter.object,
            undefined,
        );
        mockAccountStore = new AccountStore(mockContext.object, mockVscodeWrapper.object);
    });

    test("CreateProfile should ask questions in correct order", async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: { [key: string]: string } = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called and user cancels out
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((questions) => {
                // Capture questions for verification
                profileQuestions = questions;
            })
            .returns((questions) => {
                //
                return Promise.resolve(answers);
            });

        await ConnectionProfile.createProfile(
            prompter.object,
            undefined,
            undefined,
            mockAzureController,
            mockAccountStore,
        ).then((profile) => (profileReturned = profile));

        // Then expect the following flow:
        let questionNames: string[] = [
            LocalizedConstants.serverPrompt, // Server
            LocalizedConstants.databasePrompt, // DB Name
            LocalizedConstants.authTypeName, // Authentication Type
            LocalizedConstants.usernamePrompt, // UserName
            LocalizedConstants.passwordPrompt, // Password
            LocalizedConstants.msgSavePassword, // Save Password
            LocalizedConstants.aad, // Choose MEID Account
            LocalizedConstants.tenant, // Choose ME Tenant
            LocalizedConstants.profileNamePrompt, // Profile Name
        ];

        assert.strictEqual(
            profileQuestions.length,
            questionNames.length,
            "unexpected number of questions",
        );
        for (let i = 0; i < profileQuestions.length; i++) {
            assert.strictEqual(
                profileQuestions[i].name,
                questionNames[i],
                `Missing question for ${questionNames[i]}`,
            );
        }
        // And expect result to be undefined as questions were not answered
        assert.strictEqual(profileReturned, undefined);
    });

    test("CreateProfile - SqlPassword should be default auth type", async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: { [key: string]: string } = {};
        let profileQuestions: IQuestion[];

        // When createProfile is called
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((questions) => {
                // Capture questions for verification
                profileQuestions = questions;
            })
            .returns(async (questions) => {
                //
                return answers;
            });

        await ConnectionProfile.createProfile(
            prompter.object,
            undefined,
            undefined,
            mockAzureController,
            mockAccountStore,
        );

        // Then expect SqlAuth to be the only default type
        let authChoices = <INameValueChoice[]>profileQuestions[authTypeQuestionIndex].choices;
        assert.strictEqual(authChoices[0].name, LocalizedConstants.authTypeSql);
    });

    test("CreateProfile - Integrated auth support", async () => {
        // Given
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: { [key: string]: string } = {};
        let profileQuestions: IQuestion[];
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((questions) => {
                // Capture questions for verification
                profileQuestions = questions;
            })
            .returns(async (questions) => {
                //
                return answers;
            });

        // When createProfile is called on an OS
        await ConnectionProfile.createProfile(
            prompter.object,
            undefined,
            undefined,
            mockAzureController,
            mockAccountStore,
        );

        // Then integrated auth should/should not be supported
        // TODO if possible the test should mock out the OS dependency but it's not clear
        // how to do this without implementing a facade and doing full factory/dependency injection
        // for now, just validates expected behavior on the platform tests are running on
        let authQuestion: IQuestion = profileQuestions[authTypeQuestionIndex];
        let authChoices = <INameValueChoice[]>authQuestion.choices;
        assert.strictEqual(authChoices.length, 3);
        assert.strictEqual(authChoices[1].name, LocalizedConstants.authTypeIntegrated);
        assert.strictEqual(
            authChoices[1].value,
            AuthenticationTypes[AuthenticationTypes.Integrated],
        );

        // And on a platform with multiple choices, should prompt for input
        assert.strictEqual(authQuestion.shouldPrompt(answers), true);
    });

    test("Port number is applied to server name when connection credentials are transformed into details", () => {
        // Given a connection credentials object with server and a port
        let creds = new ConnectionCredentials();
        creds.server = "my-server";
        creds.port = 1234;

        // When credentials are transformed into a details contract
        const details = ConnectionCredentials.createConnectionDetails(creds);

        // Server name should be in the format <address>,<port>
        assert.strictEqual(details.options["server"], "my-server,1234");
    });

    test("All connection details properties can be set from connection credentials", () => {
        const creds = createTestCredentials();
        const details = ConnectionCredentials.createConnectionDetails(creds);

        assert.notStrictEqual(typeof details.options["applicationIntent"], "undefined");
        assert.notStrictEqual(typeof details.options["applicationName"], "undefined");
        assert.notStrictEqual(typeof details.options["attachDbFilename"], "undefined");
        assert.notStrictEqual(typeof details.options["authenticationType"], "undefined");
        assert.notStrictEqual(typeof details.options["connectRetryCount"], "undefined");
        assert.notStrictEqual(typeof details.options["connectRetryInterval"], "undefined");
        assert.notStrictEqual(typeof details.options["connectTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["commandTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["currentLanguage"], "undefined");
        assert.notStrictEqual(typeof details.options["database"], "undefined");
        assert.notStrictEqual(typeof details.options["encrypt"], "undefined");
        assert.notStrictEqual(typeof details.options["failoverPartner"], "undefined");
        assert.notStrictEqual(typeof details.options["loadBalanceTimeout"], "undefined");
        assert.notStrictEqual(typeof details.options["maxPoolSize"], "undefined");
        assert.notStrictEqual(typeof details.options["minPoolSize"], "undefined");
        assert.notStrictEqual(typeof details.options["multipleActiveResultSets"], "undefined");
        assert.notStrictEqual(typeof details.options["multiSubnetFailover"], "undefined");
        assert.notStrictEqual(typeof details.options["packetSize"], "undefined");
        assert.notStrictEqual(typeof details.options["password"], "undefined");
        assert.notStrictEqual(typeof details.options["persistSecurityInfo"], "undefined");
        assert.notStrictEqual(typeof details.options["columnEncryptionSetting"], "undefined");
        assert.notStrictEqual(typeof details.options["attestationProtocol"], "undefined");
        assert.notStrictEqual(typeof details.options["enclaveAttestationUrl"], "undefined");
        assert.notStrictEqual(typeof details.options["pooling"], "undefined");
        assert.notStrictEqual(typeof details.options["replication"], "undefined");
        assert.notStrictEqual(typeof details.options["server"], "undefined");
        assert.notStrictEqual(typeof details.options["trustServerCertificate"], "undefined");
        assert.notStrictEqual(typeof details.options["hostNameInCertificate"], "undefined");
        assert.notStrictEqual(typeof details.options["typeSystemVersion"], "undefined");
        assert.notStrictEqual(typeof details.options["user"], "undefined");
        assert.notStrictEqual(typeof details.options["workstationId"], "undefined");
    });

    test("Profile is connected to and validated prior to saving", async () => {
        let contextMock: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        let connectionManagerMock: TypeMoq.IMock<ConnectionManager> = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionManagerMock
            .setup(async (x) => await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        let connectionStoreMock = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionStoreMock
            .setup(async (x) => await x.saveProfile(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((questions) => {
                let answers: { [key: string]: string } = {};
                answers[LocalizedConstants.serverPrompt] = "my-server";
                answers[LocalizedConstants.databasePrompt] = "my_db";
                answers[LocalizedConstants.usernamePrompt] = "sa";
                answers[LocalizedConstants.passwordPrompt] = "12345678";
                answers[LocalizedConstants.authTypeName] =
                    AuthenticationTypes[AuthenticationTypes.SqlLogin];
                for (let key in answers) {
                    if (answers.hasOwnProperty(key)) {
                        questions.map((q) => {
                            if (q.name === key) {
                                q.onAnswered(answers[key]);
                            }
                        });
                    }
                }
                return Promise.resolve(answers);
            });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup((x) => x.activeTextEditorUri).returns(() => "test.sql");

        let connectionUI = new ConnectionUI(
            connectionManagerMock.object,
            contextMock.object,
            connectionStoreMock.object,
            mockAccountStore,
            prompter.object,
            true, // useLegacyConnectionExperience
            vscodeWrapperMock.object,
        );

        // create a new connection profile
        await connectionUI.createAndSaveProfile();

        // connection is attempted
        connectionManagerMock.verify(
            async (x) => await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        // profile is saved
        connectionStoreMock.verify(
            async (x) => await x.saveProfile(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("Updated Profile is returned when SSL error occurs", async () => {
        let uri = "myserver_mydb_undefined";
        let server = "myserver";
        let database = "mydb";
        let encrypt = "Mandatory";
        let authType = AuthenticationTypes[AuthenticationTypes.Integrated];

        let updatedProfile = new ConnectionProfile();
        updatedProfile.server = server;
        updatedProfile.database = database;
        updatedProfile.authenticationType = authType;
        updatedProfile.trustServerCertificate = true;
        updatedProfile.encrypt = encrypt;

        let contextMock: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        let connectionManagerMock: TypeMoq.IMock<ConnectionManager> = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionManagerMock
            .setup(async (x) => await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(false));
        // failedUriToFirewallIpMap and failedUriToSSLMap removed in refactoring

        let sslUriMockMap = new Map<string, string>();
        sslUriMockMap.set(uri, "An error occurred while connecting to the server");
        connectionManagerMock
            .setup((x) => x.handleSSLError(TypeMoq.It.isAny()))
            .returns(
                () =>
                    new Promise<ConnectionProfile>((resolve, reject) => {
                        // let obj = connectionManagerMock.object;
                        // SSL error handling updated in refactoring
                        // mock the connection to succeed
                        connectionManagerMock
                            .setup(
                                async (x) =>
                                    await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                            )
                            .returns(() => Promise.resolve(true));
                        return resolve(updatedProfile);
                    }),
            );

        let connectionStoreMock = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionStoreMock
            .setup(async (x) => await x.saveProfile(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(updatedProfile));

        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((questions) => {
                let answers: { [key: string]: string } = {};
                answers[LocalizedConstants.serverPrompt] = server;
                answers[LocalizedConstants.databasePrompt] = database;
                answers[LocalizedConstants.authTypeName] = authType;
                answers[LocalizedConstants.profileNamePrompt] = "";
                for (let key in answers) {
                    if (answers.hasOwnProperty(key)) {
                        questions.map((q) => {
                            if (q.name === key) {
                                q.onAnswered(answers[key]);
                            }
                        });
                    }
                }
                return Promise.resolve(answers);
            });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup((x) => x.activeTextEditorUri).returns(() => uri);
        vscodeWrapperMock
            .setup((x) => x.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));

        let connectionUI = new ConnectionUI(
            connectionManagerMock.object,
            contextMock.object,
            connectionStoreMock.object,
            mockAccountStore,
            prompter.object,
            true, // useLegacyConnectionExperience
            vscodeWrapperMock.object,
        );

        // create a new connection profile
        let connProfile = await connectionUI.createAndSaveProfile();

        // connection is attempted twice
        connectionManagerMock.verify(
            async (x) => await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.exactly(2),
        );

        // profile is saved
        connectionStoreMock.verify(
            async (x) => await x.saveProfile(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        // ssl error is handled
        connectionManagerMock.verify(
            async (x) => await x.handleSSLError(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        assert.ok(connProfile, "Connection profile should be returned.");
        assert.strictEqual(connProfile.server, server);
        assert.strictEqual(connProfile.database, database);
        assert.strictEqual(connProfile.trustServerCertificate, true);
        assert.strictEqual(connProfile.encrypt, encrypt);
    });

    test("Profile is not saved when connection validation fails", async () => {
        let contextMock: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        let connectionManagerMock: TypeMoq.IMock<ConnectionManager> = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionManagerMock
            .setup(async (x) => await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(false));
        // failedUriToFirewallIpMap removed in refactoring

        let connectionStoreMock = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            contextMock.object,
        );
        connectionStoreMock
            .setup(async (x) => await x.saveProfile(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));

        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((questions) => {
                let answers: { [key: string]: string } = {};
                answers[LocalizedConstants.serverPrompt] = "my-server";
                answers[LocalizedConstants.databasePrompt] = "my_db";
                answers[LocalizedConstants.usernamePrompt] = "sa";
                answers[LocalizedConstants.passwordPrompt] = "12345678";
                answers[LocalizedConstants.authTypeName] =
                    AuthenticationTypes[AuthenticationTypes.SqlLogin];
                for (let key in answers) {
                    if (answers.hasOwnProperty(key)) {
                        questions.map((q) => {
                            if (q.name === key) {
                                q.onAnswered(answers[key]);
                            }
                        });
                    }
                }
                return Promise.resolve(answers);
            });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup((x) => x.activeTextEditorUri).returns(() => "test.sql");
        // user cancels out of retry prompt
        vscodeWrapperMock
            .setup((x) => x.showErrorMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));

        let connectionUI = new ConnectionUI(
            connectionManagerMock.object,
            contextMock.object,
            connectionStoreMock.object,
            mockAccountStore,
            prompter.object,
            true, // useLegacyConnectionExperience
            vscodeWrapperMock.object,
        );

        // create a new connection profile
        await connectionUI
            .createAndSaveProfile()
            // CancelError will be thrown (expected)
            .catch(() => {
                // connection is attempted
                connectionManagerMock.verify(
                    async (x) =>
                        await x.connect(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.once(),
                );

                // profile is not saved
                connectionStoreMock.verify(
                    async (x) => await x.saveProfile(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.never(),
                );
            });
    });

    test("Profile can be created from a connection string", async () => {
        let answers = {};
        answers[LocalizedConstants.serverPrompt] = "Server=my-server";

        // Set up the prompter to answer the server prompt with the connection string
        let prompter: TypeMoq.IMock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((questions) => {
                questions
                    .filter((question) => question.name === LocalizedConstants.serverPrompt)[0]
                    .onAnswered(answers[LocalizedConstants.serverPrompt]);
                questions
                    .filter(
                        (question) =>
                            question.name !== LocalizedConstants.serverPrompt &&
                            question.name !== LocalizedConstants.profileNamePrompt,
                    )
                    .forEach((question) => {
                        // Verify that none of the other questions prompt once a connection string is given
                        assert.equal(question.shouldPrompt(answers), false);
                    });
                return Promise.resolve(answers);
            });

        // Verify that a profile was created
        let profile = await ConnectionProfile.createProfile(
            prompter.object,
            undefined,
            undefined,
            mockAzureController,
            mockAccountStore,
        );
        assert.equal(Boolean(profile), true);
    });
});
