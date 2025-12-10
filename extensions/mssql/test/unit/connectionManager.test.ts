/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import { ConnectionDetails, IToken, IConnectionInfo } from "vscode-mssql";
import { ConnectionStore } from "../../src/models/connectionStore";
import { Logger } from "../../src/models/logger";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import StatusView from "../../src/views/statusView";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import { ParseConnectionStringRequest } from "../../src/models/contracts/connection";
import { RequestSecurityTokenParams } from "../../src/models/contracts/azure";
import { AzureController } from "../../src/azure/azureController";
import { azureCloudProviderId } from "../../src/azure/providerSettings";
import { ConnectionUI } from "../../src/views/connectionUI";
import { AccountStore } from "../../src/azure/accountStore";
import { TestPrompter } from "./stubs";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";
import { Deferred } from "../../src/protocol";
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";

chai.use(sinonChai);

suite("ConnectionManager Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: ConnectionManager;

    let mockContext: vscode.ExtensionContext;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockCredentialStore: sinon.SinonStubbedInstance<CredentialStore>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let mockStatusView: sinon.SinonStubbedInstance<StatusView>;

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = stubExtensionContext(sandbox);
        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockLogger = sandbox.createStubInstance(Logger);
        mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
        mockCredentialStore = sandbox.createStubInstance(CredentialStore);
        mockServiceClient = sandbox.createStubInstance(SqlToolsServerClient);
        mockStatusView = sandbox.createStubInstance(StatusView);

        const initializedDeferred = new Deferred<void>();
        initializedDeferred.resolve();
        Object.defineProperty(mockConnectionStore, "initialized", {
            get: () => initializedDeferred,
        });

        mockConnectionStore.readAllConnections.resolves([]);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization Tests", () => {
        test("Initializes correctly", async () => {
            expect(() => {
                connectionManager = new ConnectionManager(
                    mockContext,
                    mockStatusView,
                    undefined, // prompter
                    mockLogger,
                    mockServiceClient,
                    mockVscodeWrapper,
                    mockConnectionStore,
                    mockCredentialStore,
                    undefined, // connectionUI
                    undefined, // accountStore
                );
            }).to.not.throw();

            await connectionManager.initialized; // Wait for initialization to complete
        });

        test("Initialization migrates legacy Connection String connections in credential store", async () => {
            const testServer = "localhost";
            const testDatabase = "TestDb";
            const testUser = "testUser";
            const testPassword = "testPassword";
            const testConnectionString = `Data Source=${testServer};Initial Catalog=${testDatabase};User Id=${testUser};Password=${testPassword}`;
            const testCredentialId = `Microsoft.SqlTools|itemtype:Profile|server:${testServer}|db:${testDatabase}|user:${testUser}|isConnectionString:true`;
            const testConnectionId = "00000000-1111-2222-3333-444444444444";

            mockCredentialStore.readCredential.callsFake(async (credId: string) => {
                return {
                    credentialId: credId,
                    password: testConnectionString,
                };
            });

            mockConnectionStore.readAllConnections.resolves([
                {
                    id: testConnectionId,
                    connectionString: testCredentialId,
                    server: testServer,
                    database: testDatabase,
                    user: testUser,
                } as IConnectionProfileWithSource,
            ]);

            mockConnectionStore.lookupPassword
                .withArgs(sinon.match.any, true)
                .resolves(testConnectionString);

            let savedProfile: IConnectionProfile | undefined;

            mockConnectionStore.saveProfile.callsFake(async (profile: IConnectionProfile) => {
                savedProfile = profile;
                return profile;
            });

            mockServiceClient.sendRequest
                .withArgs(ParseConnectionStringRequest.type, sinon.match.any)
                .resolves({
                    options: {
                        server: testServer,
                        database: testDatabase,
                        user: testUser,
                        password: testPassword,
                    },
                } as ConnectionDetails);

            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined, // connectionUI
                undefined, // accountStore
            );

            await connectionManager.initialized; // Wait for initialization to complete

            expect(savedProfile, "Migrated profile should have been saved").to.not.be.undefined;

            expect(savedProfile, "Saved profile should have the expected properties").to.deep.equal(
                {
                    id: testConnectionId,
                    server: testServer,
                    database: testDatabase,
                    connectionString: "",
                    savePassword: true,
                    user: testUser,
                    password: testPassword,
                } as IConnectionProfile,
            );
        });

        test("Initialization migrates legacy Connection String connections with no credential", async () => {
            const testServer = "localhost";
            const testDatabase = "TestDb";
            const testConnectionString = `Data Source=${testServer};Initial Catalog=${testDatabase};Integrated Security=True;`;
            const testConnectionId = "00000000-1111-2222-3333-444444444444";
            mockCredentialStore.readCredential.callsFake(async (credId: string) => {
                return {
                    credentialId: credId,
                    password: testConnectionString,
                };
            });

            mockConnectionStore.readAllConnections.resolves([
                {
                    id: testConnectionId,
                    connectionString: testConnectionString,
                    server: testServer,
                    database: testDatabase,
                } as IConnectionProfileWithSource,
            ]);

            let savedProfile: IConnectionProfile | undefined;

            mockConnectionStore.saveProfile.callsFake(async (profile: IConnectionProfile) => {
                savedProfile = profile;
                return profile;
            });

            mockServiceClient.sendRequest
                .withArgs(ParseConnectionStringRequest.type, sinon.match.any)
                .resolves({
                    options: {
                        server: testServer,
                        database: testDatabase,
                        authenticationType: "Integrated",
                    },
                } as ConnectionDetails);

            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined, // connectionUI
                undefined, // accountStore
            );

            await connectionManager.initialized; // Wait for initialization to complete

            expect(savedProfile, "Migrated profile should have been saved").to.not.be.undefined;

            expect(savedProfile, "Saved profile should have the expected properties").to.deep.equal(
                {
                    id: testConnectionId,
                    server: testServer,
                    database: testDatabase,
                    authenticationType: "Integrated",
                    connectionString: "",
                } as IConnectionProfile,
            );
        });
    });

    suite("Functionality tests", () => {
        setup(() => {
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined, // connectionUI
                undefined, // accountStore
            );
        });

        test("User is informed when legacy connection migration fails", async () => {
            const erroringConnProfile: IConnectionProfile = {
                connectionString: "some test connection string",
                id: "00000000-1111-2222-3333-444444444444",
            } as IConnectionProfile;

            mockVscodeWrapper.showErrorMessage.resolves(undefined);

            mockServiceClient.sendRequest
                .withArgs(ParseConnectionStringRequest.type, sinon.match.any)
                .rejects(new Error("Test error!"));

            const result = await connectionManager["migrateLegacyConnection"](erroringConnProfile);

            expect(result, "Migration should return that it errored instead of throwing").to.equal(
                "error",
            );

            expect(mockVscodeWrapper.showErrorMessage).to.have.been.calledOnce;
        });
    });

    suite("Token request handling", () => {
        setup(() => {
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined, // connectionUI
                undefined, // accountStore
            );
        });
        test("should return cached token when valid", async () => {
            const params: RequestSecurityTokenParams = {
                resource: "test-resource",
                provider: "",
                authority: "",
                scopes: [],
            };
            const cachedToken: IToken = {
                key: "cached-key",
                token: "cached-token",
                tokenType: "test",
                expiresOn: Date.now() / 1000 + 3600, // 1 hour from now
            };

            connectionManager["_keyVaultTokenCache"].set(JSON.stringify(params), cachedToken);

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal(
                {
                    accountKey: cachedToken.key,
                    token: cachedToken.token,
                },
                "Should return cached token",
            );
        });

        test("should return new token when no valid cached token exists", async () => {
            const params: RequestSecurityTokenParams = {
                resource: "test-resource",
                provider: "",
                authority: "",
                scopes: [],
            };

            connectionManager["_keyVaultTokenCache"].clear();

            connectionManager["selectAccount"] = sandbox
                .stub()
                .resolves({ key: { providerId: azureCloudProviderId } });
            connectionManager["selectTenantId"] = sandbox.stub();

            const stubbedAzureController = sandbox.createStubInstance(MsalAzureController);
            const token: IToken = {
                key: "new-key",
                token: "new-token",
                tokenType: "test",
                expiresOn: Date.now() / 1000 + 3600, // 1 hour from now
            };
            stubbedAzureController.getAccountSecurityToken.resolves(token);
            connectionManager.azureController = stubbedAzureController;

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal(
                {
                    accountKey: "new-key",
                    token: "new-token",
                },
                "Should return new token",
            );

            // verify new token is cached
            expect(
                connectionManager["_keyVaultTokenCache"].get(JSON.stringify(params)),
            ).to.deep.equal(token, "New token should be cached");
        });

        test("confirmEntraTokenValidity should call findMatchingProfile when accountId is undefined", async () => {
            const mockAccountStore = sandbox.createStubInstance(AccountStore);
            const mockAzureController = sandbox.createStubInstance(MsalAzureController);

            connectionManager["_accountStore"] = mockAccountStore;
            connectionManager.azureController = mockAzureController;

            sandbox.stub(AzureController, "isTokenValid").returns(false);

            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                authenticationType: "AzureMFA",
                accountId: undefined,
                azureAccountToken: "expired-token",
                expiresOn: Date.now() - 3600000,
            } as unknown as IConnectionInfo;

            mockConnectionStore.findMatchingProfile.resolves({
                profile: undefined,
                score: 0,
            });

            try {
                await connectionManager.confirmEntraTokenValidity(mockConnectionInfo);
            } catch {
                // Expected to throw since no profile found
            }

            expect(mockConnectionStore.findMatchingProfile).to.have.been.calledOnce;
        });
    });

    suite("prepareConnectionInfo", () => {
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let mockAzureController: sinon.SinonStubbedInstance<AzureController>;
        let testConnectionManager: ConnectionManager;
        let handlePasswordBasedCredentialsStub: sinon.SinonStub;
        let confirmEntraTokenValidityStub: sinon.SinonStub;

        setup(() => {
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);
            mockAccountStore = sandbox.createStubInstance(AccountStore);
            mockAzureController = sandbox.createStubInstance(AzureController);

            const mockPrompter = sandbox.createStubInstance(TestPrompter);

            // Create a new connection manager instance for this test suite
            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                mockPrompter,
                mockLogger,
            );

            testConnectionManager.connectionStore = mockConnectionStore;
            testConnectionManager["_connectionUI"] = mockConnectionUI;
            testConnectionManager["_accountStore"] = mockAccountStore;
            testConnectionManager.azureController = mockAzureController;

            // Setup default behaviors
            mockConnectionStore.lookupPassword.resolves("");
            handlePasswordBasedCredentialsStub = sandbox
                .stub(testConnectionManager, "handlePasswordBasedCredentials")
                .resolves(true);
            confirmEntraTokenValidityStub = sandbox
                .stub(testConnectionManager, "confirmEntraTokenValidity")
                .resolves();
        });

        teardown(() => {
            sandbox.restore();
        });

        test("should throw error when neither server nor connectionString is provided", async () => {
            const mockConnectionInfo = {
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "testPass",
            } as unknown as IConnectionInfo;

            try {
                await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(error.message).to.contain("Server name not set");
            }
        });

        test("should handle Entra/Azure MFA authentication", async () => {
            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                authenticationType: "AzureMFA",
                user: "testUser",
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result).to.exist;
            expect(confirmEntraTokenValidityStub).to.have.been.calledOnceWith(mockConnectionInfo);
            expect(handlePasswordBasedCredentialsStub).to.have.been.calledOnceWith(
                mockConnectionInfo,
            );
        });

        test("should throw error when password handling fails", async () => {
            handlePasswordBasedCredentialsStub.resolves(false);

            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "testPass",
            } as unknown as IConnectionInfo;

            try {
                await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(error.message).to.contain("Cannot connect");
            }
        });

        test("should resolve credential-based connection string", async () => {
            const credentialConnectionString = `${ConnectionStore.CRED_PREFIX}|isConnectionString:true`;
            const resolvedConnectionString =
                "Server=testServer;Database=testDB;User=testUser;Password=testPass;";

            mockConnectionStore.lookupPassword.resolves(resolvedConnectionString);

            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                connectionString: credentialConnectionString,
                savePassword: true,
                user: "",
                password: "",
                email: "",
                accountId: "",
                tenantId: "",
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result.connectionString).to.equal(resolvedConnectionString);
            expect(mockConnectionStore.lookupPassword).to.have.been.calledOnceWith(
                mockConnectionInfo,
                true,
            );
        });

        test("should clear Azure account token for Integrated authentication", async () => {
            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                authenticationType: "Integrated",
                user: "",
                password: "",
                email: "",
                accountId: "",
                tenantId: "",
                azureAccountToken: "some-token",
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result.azureAccountToken).to.be.undefined;
            expect(result.server).to.equal("testServer");
        });

        test("should handle SQL Login authentication successfully", async () => {
            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "testPass",
                email: "",
                accountId: "",
                tenantId: "",
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result).to.exist;
            expect(result.server).to.equal("testServer");
            expect(result.user).to.equal("testUser");
            expect(handlePasswordBasedCredentialsStub).to.have.been.calledOnceWith(
                mockConnectionInfo,
            );
        });

        test("should handle connection string without credential prefix", async () => {
            const regularConnectionString =
                "Server=testServer;Database=testDB;Integrated Security=true;";

            const mockConnectionInfo = {
                connectionString: regularConnectionString,
                authenticationType: "",
                user: "",
                password: "",
                email: "",
                accountId: "",
                tenantId: "",
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result.connectionString).to.equal(regularConnectionString);
            expect(mockConnectionStore.lookupPassword).to.not.have.been.called;
        });

        test("should preserve other properties while processing", async () => {
            const mockConnectionInfo = {
                server: "testServer",
                database: "testDB",
                port: 1433,
                authenticationType: "SqlLogin",
                user: "testUser",
                password: "testPass",
                email: "test@example.com",
                accountId: "account123",
                tenantId: "tenant456",
                options: { encrypt: true },
            } as unknown as IConnectionInfo;

            const result = await testConnectionManager.prepareConnectionInfo(mockConnectionInfo);

            expect(result.server).to.equal("testServer");
            expect(result.database).to.equal("testDB");
            expect(result.port).to.equal(1433);
            expect(result.email).to.equal("test@example.com");
            expect(result.accountId).to.equal("account123");
            expect(result.tenantId).to.equal("tenant456");
        });
    });
});
