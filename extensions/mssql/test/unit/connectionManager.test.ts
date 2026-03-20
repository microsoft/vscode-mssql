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
import {
    AccountType,
    AzureAuthType,
    IAccount,
    RequestSecurityTokenParams,
} from "../../src/models/contracts/azure";
import { AzureController } from "../../src/azure/azureController";
import { azureCloudProviderId } from "../../src/azure/providerSettings";
import { ConnectionUI } from "../../src/views/connectionUI";
import { AccountStore } from "../../src/azure/accountStore";
import { TestPrompter } from "./stubs";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";
import { Deferred } from "../../src/protocol";
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as VscodeEntraMfaUtils from "../../src/azure/vscodeEntraMfaUtils";

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

    suite("confirmEntraTokenValidity", () => {
        let testConnectionManager: ConnectionManager;

        setup(() => {
            const mockPrompter = sandbox.createStubInstance(TestPrompter);

            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                mockPrompter,
                mockLogger,
            );
        });

        test("uses VS Code account tokens when VS Code account mode is enabled", async () => {
            sandbox.stub(VscodeEntraMfaUtils, "useVscodeAccountsForEntraMfa").returns(true);
            sandbox.stub(AzureController, "isTokenValid").returns(false);
            sandbox.stub(VscodeEntraMfaUtils, "acquireSqlAccessTokenFromVscodeAccount").resolves({
                account: {
                    id: "vscode-account-id.tenant-id",
                    label: "user@contoso.com",
                } as vscode.AuthenticationSessionAccountInformation,
                session: {
                    account: {
                        id: "vscode-account-id.tenant-id",
                        label: "user@contoso.com",
                    },
                } as vscode.AuthenticationSession,
                tenantId: "tenant-id",
                token: {
                    key: "vscode-account-id.tenant-id",
                    token: "vscode-token",
                    tokenType: "Bearer",
                    expiresOn: Date.now() / 1000 + 3600,
                },
            });

            const connectionInfo = {
                server: "testServer",
                authenticationType: "AzureMFA",
                accountId: "legacy-account-id",
                tenantId: "legacy-tenant-id",
                user: "legacy-user",
            } as IConnectionInfo;

            await testConnectionManager.confirmEntraTokenValidity(connectionInfo);

            expect(connectionInfo.azureAccountToken).to.equal("vscode-token");
            expect(connectionInfo.accountId).to.equal("vscode-account-id.tenant-id");
            expect(connectionInfo.tenantId).to.equal("tenant-id");
            expect(connectionInfo.user).to.equal("user@contoso.com");
            expect(connectionInfo.email).to.equal("user@contoso.com");
        });
    });

    suite("handlePasswordBasedCredentials", () => {
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let testConnectionManager: ConnectionManager;

        setup(() => {
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionUI = sandbox.createStubInstance(ConnectionUI);

            const mockPrompter = sandbox.createStubInstance(TestPrompter);

            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                mockPrompter,
                mockLogger,
            );

            testConnectionManager.connectionStore = mockConnectionStore;
            (testConnectionManager as any)._connectionUI = mockConnectionUI;
        });

        teardown(() => {
            sandbox.restore();
        });

        test("skips lookup and prompt when emptyPasswordInput is already set", async () => {
            const creds = {
                server: "testServer",
                authenticationType: "SqlLogin",
                password: "",
                emptyPasswordInput: true,
            } as unknown as IConnectionProfile;

            mockConnectionStore.lookupPassword.resolves("should-not-be-used");
            mockConnectionUI.promptForPassword.resolves("should-not-be-used");

            const result = await testConnectionManager.handlePasswordBasedCredentials(creds);

            expect(result).to.be.true;
            expect(mockConnectionStore.lookupPassword).to.not.have.been.called;
            expect(mockConnectionUI.promptForPassword).to.not.have.been.called;
            expect(creds.password).to.equal("");
        });

        test("prompts once, allows empty password, and sets flag", async () => {
            const creds = {
                server: "testServer",
                authenticationType: "SqlLogin",
                password: "",
                azureAccountToken: "token",
                emptyPasswordInput: false,
            } as unknown as IConnectionProfile;

            mockConnectionStore.lookupPassword.resolves(undefined);
            mockConnectionUI.promptForPassword.resolves("");

            const result = await testConnectionManager.handlePasswordBasedCredentials(creds);

            expect(result).to.be.true;
            expect(mockConnectionStore.lookupPassword).to.have.been.calledOnce;
            expect(mockConnectionUI.promptForPassword).to.have.been.calledOnce;
            expect(creds.emptyPasswordInput).to.be.true;
            expect(creds.password).to.equal("");
            expect(creds.azureAccountToken).to.be.undefined;
        });
    });

    suite("createAccountQuickPickItems", () => {
        let testConnectionManager: ConnectionManager;

        setup(() => {
            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
            );
        });

        function makeAccount(id: string, name: string, email: string): IAccount {
            return {
                key: { id, providerId: "azure" },
                displayInfo: {
                    accountType: AccountType.WorkSchool,
                    userId: email,
                    displayName: name,
                    name,
                    email,
                },
                properties: {
                    azureAuthType: AzureAuthType.AuthCodeGrant,
                    tenants: [undefined],
                    providerSettings: undefined,
                    isMsAccount: false,
                    owningTenant: undefined,
                },
                isStale: false,
            };
        }

        test("should include all accounts plus a sign-in item", () => {
            const accounts = [
                makeAccount("acc1", "Alice", "alice@contoso.com"),
                makeAccount("acc2", "Bob", "bob@contoso.com"),
            ];

            const items = testConnectionManager["createAccountQuickPickItems"](accounts);

            expect(items).to.have.lengthOf(3);
            expect(items[0].label).to.equal("Alice");
            expect(items[0].description).to.equal("alice@contoso.com");
            expect(items[0].account).to.equal(accounts[0]);
            expect(items[1].label).to.equal("Bob");
            expect(items[1].account).to.equal(accounts[1]);
            expect(items[2].account).to.be.undefined;
        });

        test("should mark the current account in the label", () => {
            const accounts = [
                makeAccount("acc1", "Alice", "alice@contoso.com"),
                makeAccount("acc2", "Bob", "bob@contoso.com"),
            ];

            const items = testConnectionManager["createAccountQuickPickItems"](accounts, "acc1");

            expect(items[0].label).to.equal(LocalizedConstants.Connection.currentAccount("Alice"));
            expect(items[1].label).to.equal("Bob");
        });

        test("should return only sign-in item when no accounts exist", () => {
            const items = testConnectionManager["createAccountQuickPickItems"]([]);

            expect(items).to.have.lengthOf(1);
            expect(items[0].account).to.be.undefined;
        });
    });

    suite("showAccountQuickPick", () => {
        let testConnectionManager: ConnectionManager;
        let createQuickPickStub: sinon.SinonStub;
        let mockQuickPick: {
            items: unknown[];
            selectedItems: unknown[];
            placeholder: string;
            onDidAccept: sinon.SinonStub;
            onDidHide: sinon.SinonStub;
            show: sinon.SinonStub;
            dispose: sinon.SinonStub;
        };
        let acceptHandler: () => void;
        let hideHandler: () => void;

        setup(() => {
            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
            );

            mockQuickPick = {
                items: [],
                selectedItems: [],
                placeholder: "",
                onDidAccept: sandbox.stub().callsFake((handler: () => void) => {
                    acceptHandler = handler;
                }),
                onDidHide: sandbox.stub().callsFake((handler: () => void) => {
                    hideHandler = handler;
                }),
                show: sandbox.stub(),
                dispose: sandbox.stub(),
            };

            createQuickPickStub = sandbox
                .stub(vscode.window, "createQuickPick")
                .returns(mockQuickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>);
        });

        function makeAccount(id: string, name: string, email: string): IAccount {
            return {
                key: { id, providerId: "azure" },
                displayInfo: {
                    accountType: AccountType.WorkSchool,
                    userId: email,
                    displayName: name,
                    name,
                    email,
                },
                properties: {
                    azureAuthType: AzureAuthType.AuthCodeGrant,
                    tenants: [undefined],
                    providerSettings: undefined,
                    isMsAccount: false,
                    owningTenant: undefined,
                },
                isStale: false,
            };
        }

        test("should return account when user selects an account item", async () => {
            const account = makeAccount("acc1", "Alice", "alice@contoso.com");
            const items = [{ label: "Alice", description: "alice@contoso.com", account }];

            const resultPromise = testConnectionManager["showAccountQuickPick"](items);

            // Simulate user selecting the account
            mockQuickPick.selectedItems = [items[0]];
            acceptHandler();

            const result = await resultPromise;
            expect(result).to.equal(account);
            expect(createQuickPickStub).to.have.been.calledOnce;
        });

        // eslint-disable-next-line no-restricted-syntax
        test("should return null when user selects the sign-in item", async () => {
            const items = [
                {
                    label: LocalizedConstants.Connection.signInToAzure,
                    description: LocalizedConstants.Connection.signInToAzure,
                    account: undefined,
                },
            ];

            const resultPromise = testConnectionManager["showAccountQuickPick"](items);

            // Simulate user selecting the sign-in item (account is undefined)
            mockQuickPick.selectedItems = [items[0]];
            acceptHandler();

            const result = await resultPromise;
            // eslint-disable-next-line no-restricted-syntax
            expect(result).to.be.null;
        });

        test("should return undefined when user dismisses the quick pick", async () => {
            const items = [
                {
                    label: "Alice",
                    description: "alice@contoso.com",
                    account: makeAccount("acc1", "Alice", "alice@contoso.com"),
                },
            ];

            const resultPromise = testConnectionManager["showAccountQuickPick"](items);

            // Simulate user pressing Escape
            hideHandler();

            const result = await resultPromise;
            expect(result).to.be.undefined;
        });

        test("should not resolve to undefined when onDidHide fires after onDidAccept", async () => {
            const account = makeAccount("acc1", "Alice", "alice@contoso.com");
            const items = [{ label: "Alice", description: "alice@contoso.com", account }];

            const resultPromise = testConnectionManager["showAccountQuickPick"](items);

            // Simulate accept then hide (dispose triggers hide)
            mockQuickPick.selectedItems = [items[0]];
            acceptHandler();
            hideHandler();

            const result = await resultPromise;
            // Should still be the account, not undefined from the hide handler
            expect(result).to.equal(account);
        });

        test("should return undefined when accept fires with no selected item", async () => {
            const items = [
                {
                    label: "Alice",
                    description: "alice@contoso.com",
                    account: makeAccount("acc1", "Alice", "alice@contoso.com"),
                },
            ];

            const resultPromise = testConnectionManager["showAccountQuickPick"](items);

            // Simulate accept with empty selection
            mockQuickPick.selectedItems = [];
            acceptHandler();

            const result = await resultPromise;
            expect(result).to.be.undefined;
        });
    });

    suite("selectAccount", () => {
        let testConnectionManager: ConnectionManager;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let showAccountQuickPickStub: sinon.SinonStub;
        let addAccountStub: sinon.SinonStub;

        function makeAccount(id: string, name: string, email: string): IAccount {
            return {
                key: { id, providerId: "azure" },
                displayInfo: {
                    accountType: AccountType.WorkSchool,
                    userId: email,
                    displayName: name,
                    name,
                    email,
                },
                properties: {
                    azureAuthType: AzureAuthType.AuthCodeGrant,
                    tenants: [undefined],
                    providerSettings: undefined,
                    isMsAccount: false,
                    owningTenant: undefined,
                },
                isStale: false,
            };
        }

        setup(() => {
            mockAccountStore = sandbox.createStubInstance(AccountStore);

            testConnectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined, // prompter
                mockLogger,
            );

            testConnectionManager["_accountStore"] = mockAccountStore;
            mockAccountStore.getAccounts.resolves([]);

            showAccountQuickPickStub = sandbox.stub(
                testConnectionManager as any, // eslint-disable-line @typescript-eslint/no-explicit-any
                "showAccountQuickPick",
            );
            addAccountStub = sandbox.stub(testConnectionManager, "addAccount");
        });

        test("should return the selected account", async () => {
            const account = makeAccount("acc1", "Alice", "alice@contoso.com");
            showAccountQuickPickStub.resolves(account);

            const result = await testConnectionManager["selectAccount"]();

            expect(result).to.equal(account);
            expect(addAccountStub).to.not.have.been.called;
        });

        // eslint-disable-next-line no-restricted-syntax
        test("should trigger sign-in and return new account when sign-in item is selected", async () => {
            const newAccount = makeAccount("new1", "NewUser", "new@contoso.com");
            // eslint-disable-next-line no-restricted-syntax
            showAccountQuickPickStub.resolves(null); // null = sign-in selected
            addAccountStub.resolves(newAccount);

            const result = await testConnectionManager["selectAccount"]();

            expect(result).to.equal(newAccount);
            expect(addAccountStub).to.have.been.calledOnce;
        });

        // eslint-disable-next-line no-restricted-syntax
        test("should throw when sign-in is selected but addAccount returns falsy", async () => {
            // eslint-disable-next-line no-restricted-syntax
            showAccountQuickPickStub.resolves(null);
            addAccountStub.resolves(undefined);

            try {
                await testConnectionManager["selectAccount"]();
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error.message).to.equal(LocalizedConstants.Connection.noAccountSelected);
            }
        });

        test("should throw when user dismisses the quick pick", async () => {
            showAccountQuickPickStub.resolves(undefined);

            try {
                await testConnectionManager["selectAccount"]();
                expect.fail("Should have thrown");
            } catch (error) {
                expect(error.message).to.equal(LocalizedConstants.Connection.noAccountSelected);
            }

            expect(addAccountStub).to.not.have.been.called;
        });
    });
});
