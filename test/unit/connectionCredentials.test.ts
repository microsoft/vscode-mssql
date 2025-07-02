/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as utils from "../../src/extension/models/utils";
import * as Constants from "../../src/extension/constants/constants";
import * as LocalizedConstants from "../../src/extension/constants/locConstants";
import * as stubs from "./stubs";
import * as interfaces from "../../src/extension/models/interfaces";
import { ConnectionProfile } from "../../src/extension/models/connectionProfile";
import { ConnectionStore } from "../../src/extension/models/connectionStore";
import { ConnectionCredentials } from "../../src/extension/models/connectionCredentials";
import { IPrompter, IQuestion } from "../../src/extension/prompts/question";
import { TestPrompter } from "./stubs";
import { AuthenticationTypes, IConnectionProfile } from "../../src/extension/models/interfaces";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";

import * as assert from "assert";
import { ConnectionDetails, IConnectionInfo } from "vscode-mssql";

suite("ConnectionCredentials Tests", () => {
    let defaultProfile: interfaces.IConnectionProfile;
    let prompter: TypeMoq.IMock<IPrompter>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;

    setup(() => {
        defaultProfile = Object.assign(new ConnectionProfile(), {
            profileName: "defaultProfile",
            server: "namedServer",
            database: "bcd",
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: "cde",
        });

        prompter = TypeMoq.Mock.ofType(TestPrompter);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        connectionStore = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );

        // setup default behavior for vscodeWrapper
        // setup configuration to return maxRecent for the #MRU items
        let maxRecent = 5;
        let configResult: { [key: string]: any } = {};
        configResult[Constants.configMaxRecentConnections] = maxRecent;
        let config = stubs.createWorkspaceConfiguration(configResult);
        vscodeWrapper
            .setup((x) => x.getConfiguration(TypeMoq.It.isAny()))
            .returns((_x) => {
                return config;
            });
    });

    // ConnectProfile sets up a connection call to ensureRequiredPropertiesSet with the provided profile
    function connectProfile(
        profile: IConnectionProfile,
        emptyPassword: boolean,
        shouldSaveUpdates: boolean,
    ): Promise<IConnectionInfo> {
        // Setup input paramaters
        let isProfile = true;
        let isPasswordRequired = false;
        let wasPasswordEmptyInConfigFile: boolean = emptyPassword;
        let answers = {};

        // Mocking functions
        connectionStore
            .setup(async (x) => await x.removeProfile(TypeMoq.It.isAny()))
            .returns((_profile1: IConnectionProfile) => Promise.resolve(true));
        connectionStore
            .setup(async (x) => await x.saveProfile(TypeMoq.It.isAny()))
            .returns((profile1: IConnectionProfile) => Promise.resolve(profile1));
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny()))
            .returns((_questions: IQuestion[]) => Promise.resolve(answers));

        // Function Call to test
        return ConnectionCredentials.ensureRequiredPropertiesSet(
            profile,
            isProfile,
            isPasswordRequired,
            wasPasswordEmptyInConfigFile,
            prompter.object,
            connectionStore.object,
            undefined, // defaultProfileValues
            shouldSaveUpdates,
        );
    }

    async function ensureRequestAndSavePassword(
        emptyPassword: boolean,
        shouldSavePassword: boolean,
    ): Promise<void> {
        // Setup Profile Information to have savePassword on and blank
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
            savePassword: shouldSavePassword,
            emptyPasswordInput: emptyPassword,
            password: "",
        });

        // Setup input paramaters
        let isProfile = true;
        let isPasswordRequired = false;
        let wasPasswordEmptyInConfigFile: boolean = emptyPassword;
        let passwordQuestion: IQuestion[];
        let answers = {};

        // Mocking functions
        connectionStore
            .setup(async (x) => await x.removeProfile(TypeMoq.It.isAny()))
            .returns((_profile1: IConnectionProfile) => Promise.resolve(true));
        connectionStore
            .setup(async (x) => await x.saveProfile(TypeMoq.It.isAny()))
            .returns((profile1: IConnectionProfile) => Promise.resolve(profile1));
        prompter
            .setup((x) => x.prompt(TypeMoq.It.isAny()))
            .callback((questions) => {
                passwordQuestion = questions.filter(
                    (question) => question.name === LocalizedConstants.passwordPrompt,
                );
                answers[LocalizedConstants.passwordPrompt] = emptyPassword ? "" : "newPassword";
                void passwordQuestion[0].onAnswered(answers[LocalizedConstants.passwordPrompt]);
            })
            .returns((_questions: IQuestion[]) => Promise.resolve(answers));

        // Call function to test
        const updatedProfile = await ConnectionCredentials.ensureRequiredPropertiesSet(
            profile,
            isProfile,
            isPasswordRequired,
            wasPasswordEmptyInConfigFile,
            prompter.object,
            connectionStore.object,
            undefined, // defaultProfileValues
            shouldSavePassword,
        );

        assert.ok(updatedProfile);
        // Checking to see password question was prompted
        assert.ok(passwordQuestion);
        assert.equal(updatedProfile.password, answers[LocalizedConstants.passwordPrompt]);
        connectionStore.verify(
            async (x) => await x.removeProfile(TypeMoq.It.isAny()),
            shouldSavePassword ? TypeMoq.Times.once() : TypeMoq.Times.never(),
        );
        connectionStore.verify(
            async (x) => await x.saveProfile(TypeMoq.It.isAny()),
            shouldSavePassword ? TypeMoq.Times.once() : TypeMoq.Times.never(),
        );
    }

    suite("ensureRequiredPropertiesSet Tests", () => {
        // Connect with savePassword true and filled password and ensure password is saved and removed from plain text
        test("ensureRequiredPropertiesSet should remove password from plain text and save password to Credential Store", (done) => {
            // Setup Profile Information to have savePassword on and filled in password
            let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
                savePassword: true,
                password: "oldPassword",
            });
            let emptyPassword = false;

            connectProfile(profile, emptyPassword, true /* shouldSaveUpdates */)
                .then((success) => {
                    assert.ok(success);
                    connectionStore.verify(
                        async (x) => await x.removeProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.once(),
                    );
                    connectionStore.verify(
                        async (x) => await x.saveProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.once(),
                    );
                    done();
                })
                .catch((err) => done(new Error(err)));
        });

        // Connect with savePassword true and empty password does not reset password
        test("ensureRequiredPropertiesSet should keep Credential Store password", (done) => {
            // Setup Profile Information to have savePassword on and blank
            let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
                savePassword: true,
                password: "",
            });

            let emptyPassword = true;
            connectProfile(profile, emptyPassword, true /* shouldSaveUpdates */)
                .then((success) => {
                    assert.ok(success);
                    connectionStore.verify(
                        async (x) => await x.removeProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    connectionStore.verify(
                        async (x) => await x.saveProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    done();
                })
                .catch((err) => done(new Error(err)));
        });

        // Connect with savePassword false and ensure password is never saved
        test("ensureRequiredPropertiesSet should not save password", (done) => {
            // Setup Profile Information to have savePassword off and blank
            let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
                savePassword: false,
                password: "oldPassword",
            });

            let emptyPassword = false;
            connectProfile(profile, emptyPassword, true /* shouldSaveUpdates */)
                .then((success) => {
                    assert.ok(success);
                    connectionStore.verify(
                        async (x) => await x.removeProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    connectionStore.verify(
                        async (x) => await x.saveProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    done();
                })
                .catch((err) => done(new Error(err)));
        });

        // Connect with savePassword false and ensure empty password is never saved
        test("ensureRequiredPropertiesSet should not save password, empty password case", (done) => {
            // Setup Profile Information to have savePassword off and blank
            let profile = Object.assign(new ConnectionProfile(), defaultProfile, {
                savePassword: false,
                password: "",
            });

            let emptyPassword = true;
            connectProfile(profile, emptyPassword, true /* shouldSaveUpdates */)
                .then((success) => {
                    assert.ok(success);
                    connectionStore.verify(
                        async (x) => await x.removeProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    connectionStore.verify(
                        async (x) => await x.saveProfile(TypeMoq.It.isAny()),
                        TypeMoq.Times.never(),
                    );
                    done();
                })
                .catch((err) => done(new Error(err)));
        });

        // Connect with savePassword true and blank password and
        // confirm password is prompted for and saved for non-empty password
        test("ensureRequiredPropertiesSet should request password and save it for non-empty passwords", async () => {
            await ensureRequestAndSavePassword(
                false /* emptyPassword */,
                true /* shouldSavePassword */,
            );
        });

        // Connect with savePassword true and blank password and
        // confirm password is prompted for and saved correctly for an empty password
        test("ensureRequiredPropertiesSet should request password and save it correctly for empty passswords", async () => {
            await ensureRequestAndSavePassword(
                true /* emptyPassword */,
                true /* shouldSavePassword */,
            );
        });

        // Connect with savePassword false and blank password and
        // confirm password is prompted for but not saved
        test("ensureRequiredPropertiesSet should request password but not save it for non-empty passswords", async () => {
            await ensureRequestAndSavePassword(
                false /* emptyPassword */,
                false /* shouldSavePassword */,
            );
        });
    });

    suite("ConnectionDetails conversion tests", () => {
        // A connection string can be set alongside other properties for createConnectionDetails
        test("createConnectionDetails sets properties in addition to the connection string", () => {
            let credentials = new ConnectionCredentials();
            credentials.connectionString = "server=some-server";
            credentials.database = "some-db";

            let connectionDetails = ConnectionCredentials.createConnectionDetails(credentials);
            assert.equal(connectionDetails.options.connectionString, credentials.connectionString);
            assert.equal(connectionDetails.options.database, credentials.database);
        });

        test("createConnectionDetails sets properties from the connection string", () => {
            const connDetails: ConnectionDetails = {
                options: {
                    server: "someServer,1234",
                    user: "testUser",
                    password: "testPassword",
                },
            };

            const connInfo = ConnectionCredentials.createConnectionInfo(connDetails);

            assert.equal(connInfo.server, connDetails.options.server);
            assert.equal(connInfo.user, connDetails.options.user);
            assert.equal(connInfo.password, connDetails.options.password);
            assert.equal(connInfo.port, 1234);
        });

        test("IConnectionInfo-ConnectionDetails conversion roundtrip", () => {
            const originalConnInfo: IConnectionInfo = {
                server: "testServer,1234",
                database: "testDatabase",
                user: "testUser",
                password: "testPassword",
                email: "testEmail@contoso.com",
                accountId: "testAccountid",
                tenantId: "testTenantId",
                port: 1234,
                authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
                azureAccountToken: "testToken",
                expiresOn: 5678,
                encrypt: "Strict",
                trustServerCertificate: true,
                hostNameInCertificate: "testHostName",
                persistSecurityInfo: true,
                secureEnclaves: "testSecureEnclaves",
                columnEncryptionSetting: "Enabled",
                attestationProtocol: "HGS",
                enclaveAttestationUrl: "testEnclaveAttestationUrl",
                connectTimeout: 7,
                commandTimeout: 11,
                connectRetryCount: 17,
                connectRetryInterval: 19,
                applicationName: "testApplicationName",
                workstationId: "testWorkstationId",
                applicationIntent: "ReadOnly",
                currentLanguage: "",
                pooling: true,
                maxPoolSize: 23,
                minPoolSize: 29,
                loadBalanceTimeout: 31,
                replication: true,
                attachDbFilename: "testAttachDbFilename",
                failoverPartner: "testFailoverPartner",
                multiSubnetFailover: true,
                multipleActiveResultSets: true,
                packetSize: 37,
                typeSystemVersion: "testTypeSystemVersion",
                connectionString: "testConnectionString",
                containerName: "",
            };

            const connDetails = ConnectionCredentials.createConnectionDetails(originalConnInfo);
            const convertedConnInfo = ConnectionCredentials.createConnectionInfo(connDetails);

            for (const key in originalConnInfo) {
                assert.equal(
                    originalConnInfo[key as keyof IConnectionInfo],
                    convertedConnInfo[key as keyof IConnectionInfo],
                    `Mismatch on ${key}`,
                );
            }
        });
    });

    test("Subsequent connection credential questions are skipped if a connection string is given", async () => {
        let credentials = new ConnectionCredentials();
        let questions = await ConnectionCredentials["getRequiredCredentialValuesQuestions"](
            credentials,
            false,
            false,
            undefined,
        );
        let serverQuestion = questions.filter(
            (question) => question.name === LocalizedConstants.serverPrompt,
        )[0];

        let connectionString = "server=some-server";
        void serverQuestion.onAnswered(connectionString);

        // Verify that the remaining questions will not prompt
        let otherQuestions = questions.filter(
            (question) => question.name !== LocalizedConstants.serverPrompt,
        );
        otherQuestions.forEach((question) => assert.equal(question.shouldPrompt({}), false));
    });

    test("Server question properly handles connection strings", async () => {
        let credentials = new ConnectionCredentials();
        let questions = await ConnectionCredentials["getRequiredCredentialValuesQuestions"](
            credentials,
            false,
            false,
            undefined,
        );
        let serverQuestion = questions.filter(
            (question) => question.name === LocalizedConstants.serverPrompt,
        )[0];

        let connectionString = "server=some-server";
        void serverQuestion.onAnswered(connectionString);

        // Verify that the question updated the connection string
        assert.equal(credentials.connectionString, connectionString);
        assert.notEqual(credentials.server, connectionString);

        let serverName = "some-server";
        void serverQuestion.onAnswered(serverName);
        assert.equal(credentials.server, serverName);
        assert.notEqual(credentials.connectionString, serverName);
    });
});
