/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
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
import { ConnectionUI } from "../../src/views/connectionUI";
import { AccountStore } from "../../src/azure/accountStore";
import { TestPrompter } from "./stubs";

chai.use(sinonChai);

suite("ConnectionManager Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: ConnectionManager;

    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockCredentialStore: TypeMoq.IMock<CredentialStore>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockConnectionStore: TypeMoq.IMock<ConnectionStore>;
    let mockServiceClient: TypeMoq.IMock<SqlToolsServerClient>;
    let mockStatusView: TypeMoq.IMock<StatusView>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
        mockLogger = TypeMoq.Mock.ofType<Logger>();
        mockConnectionStore = TypeMoq.Mock.ofType<ConnectionStore>();
        mockCredentialStore = TypeMoq.Mock.ofType<CredentialStore>();
        mockServiceClient = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Loose);
        mockStatusView = TypeMoq.Mock.ofType<StatusView>(undefined, TypeMoq.MockBehavior.Loose);

        mockConnectionStore
            .setup((c) => c.readAllConnections(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve([]);
            });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization Tests", () => {
        test("Initializes correctly", async () => {
            expect(() => {
                connectionManager = new ConnectionManager(
                    mockContext.object,
                    mockStatusView.object,
                    undefined, // prompter
                    true, // isRichExperiencesEnabled
                    mockLogger.object,
                    mockServiceClient.object,
                    mockVscodeWrapper.object,
                    mockConnectionStore.object,
                    mockCredentialStore.object,
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

            mockCredentialStore
                .setup((cs) => cs.readCredential(TypeMoq.It.isAny()))
                .returns((credId: string) => {
                    return Promise.resolve({
                        credentialId: credId,
                        password: testConnectionString,
                    });
                });

            mockConnectionStore.reset();

            mockConnectionStore
                .setup((cs) => cs.readAllConnections(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve([
                        {
                            id: testConnectionId,
                            connectionString: testCredentialId,
                            server: testServer,
                            database: testDatabase,
                            user: testUser,
                        } as IConnectionProfileWithSource,
                    ]);
                });

            mockConnectionStore
                .setup((cs) => cs.lookupPassword(TypeMoq.It.isAny(), true))
                .returns(() => {
                    return Promise.resolve(testConnectionString);
                });

            let savedProfile: IConnectionProfile;

            mockConnectionStore
                .setup((cs) => cs.saveProfile(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((profile: IConnectionProfile) => {
                    savedProfile = profile;
                    return Promise.resolve(profile);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve({
                        options: {
                            server: testServer,
                            database: testDatabase,
                            user: testUser,
                            password: testPassword,
                        },
                    } as ConnectionDetails);
                });

            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
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
            mockCredentialStore
                .setup((cs) => cs.readCredential(TypeMoq.It.isAny()))
                .returns((credId: string) => {
                    return Promise.resolve({
                        credentialId: credId,
                        password: testConnectionString,
                    });
                });

            mockConnectionStore.reset();

            mockConnectionStore
                .setup((cs) => cs.readAllConnections(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve([
                        {
                            id: testConnectionId,
                            connectionString: testConnectionString,
                            server: testServer,
                            database: testDatabase,
                        } as IConnectionProfileWithSource,
                    ]);
                });

            let savedProfile: IConnectionProfile;

            mockConnectionStore
                .setup((cs) => cs.saveProfile(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                .returns((profile: IConnectionProfile) => {
                    savedProfile = profile;
                    return Promise.resolve(profile);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve({
                        options: {
                            server: testServer,
                            database: testDatabase,
                            authenticationType: "Integrated",
                        },
                    } as ConnectionDetails);
                });

            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
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
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
                undefined, // connectionUI
                undefined, // accountStore
            );
        });

        test("User is informed when legacy connection migration fails", async () => {
            const erroringConnProfile: IConnectionProfile = {
                connectionString: "some test connection string",
                id: "00000000-1111-2222-3333-444444444444",
            } as IConnectionProfile;

            mockVscodeWrapper
                .setup((x) => x.showErrorMessage(TypeMoq.It.isAny()))
                .returns(() => {
                    return Promise.resolve(undefined);
                });

            mockServiceClient
                .setup((sc) =>
                    sc.sendRequest(
                        TypeMoq.It.isValue(ParseConnectionStringRequest.type),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    throw new Error("Test error!");
                });

            const result = await connectionManager["migrateLegacyConnection"](erroringConnProfile);

            expect(result, "Migration should return that it errored instead of throwing").to.equal(
                "error",
            );

            mockVscodeWrapper.verify(
                (v) => v.showErrorMessage(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });

    suite("Token request handling", () => {
        setup(() => {
            connectionManager = new ConnectionManager(
                mockContext.object,
                mockStatusView.object,
                undefined, // prompter
                true, // isRichExperiencesEnabled
                mockLogger.object,
                mockServiceClient.object,
                mockVscodeWrapper.object,
                mockConnectionStore.object,
                mockCredentialStore.object,
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
            connectionManager["selectAccount"] = sinon.stub();
            connectionManager["selectTenantId"] = sinon.stub();
            const stubbedAzureController = TypeMoq.Mock.ofType<AzureController>();
            const token: IToken = {
                key: "new-key",
                token: "new-token",
                tokenType: "test",
                expiresOn: Date.now() / 1000 + 3600, // 1 hour from now
            };
            stubbedAzureController
                .setup((x) =>
                    x.getAccountSecurityToken(
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(() => {
                    return Promise.resolve(token);
                });
            connectionManager.azureController = stubbedAzureController.object;

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
                mockContext.object,
                mockStatusView.object,
                mockPrompter,
                false, // useLegacyConnectionExperience
                mockLogger.object,
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
