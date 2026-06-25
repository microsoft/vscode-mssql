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
import { ILogger } from "../../src/sharedInterfaces/logger";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import StatusView from "../../src/views/statusView";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { IConnectionProfile, IConnectionProfileWithSource } from "../../src/models/interfaces";
import { ParseConnectionStringRequest } from "../../src/models/contracts/connection";
import * as ConnectionContracts from "../../src/models/contracts/connection";
import { IAccount, RequestSecurityTokenParams } from "../../src/models/contracts/azure";
import { AzureController } from "../../src/azure/azureController";
import {
    azureCloudProviderId,
    publicAzureProviderSettings,
} from "../../src/azure/providerSettings";
import { ConnectionUI } from "../../src/views/connectionUI";
import { AccountStore } from "../../src/azure/accountStore";
import { TestPrompter } from "./stubs";
import {
    stubExtensionContext,
    stubPreviewService,
    stubVscodeWrapper,
    createStubLogger,
} from "./utils";
import { Deferred } from "../../src/protocol";
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";
import { PreviewFeature } from "../../src/previews/previewService";
import * as vscodeEntraMfaUtils from "../../src/azure/vscodeEntraMfaUtils";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import * as telemetry from "../../src/telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";

chai.use(sinonChai);

suite("ConnectionManager Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: ConnectionManager;

    let mockContext: vscode.ExtensionContext;
    let mockLogger: sinon.SinonStubbedInstance<ILogger>;
    let mockCredentialStore: sinon.SinonStubbedInstance<CredentialStore>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockServiceClient: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let mockStatusView: sinon.SinonStubbedInstance<StatusView>;
    let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
    let mockAzureController: sinon.SinonStubbedInstance<MsalAzureController>;

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = stubExtensionContext(sandbox);
        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockLogger = createStubLogger(sandbox);
        mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
        mockCredentialStore = sandbox.createStubInstance(CredentialStore);
        mockServiceClient = sandbox.createStubInstance(SqlToolsServerClient);
        mockStatusView = sandbox.createStubInstance(StatusView);
        mockAccountStore = sandbox.createStubInstance(AccountStore);
        mockAzureController = sandbox.createStubInstance(MsalAzureController);

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
                    mockAccountStore,
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

        test("parseConnectionString sends object params to the service", async () => {
            const testConnectionString =
                "Server=localhost,14335;User Id=sa;Password=Aasimkhan30@a;TrustServerCertificate=True;\n";
            const expectedResult = {
                options: {
                    server: "localhost,14335",
                    user: "sa",
                    password: "Aasimkhan30@a",
                    authenticationType: "SqlLogin",
                    trustServerCertificate: true,
                },
            } as ConnectionDetails;

            mockServiceClient.sendRequest
                .withArgs(ParseConnectionStringRequest.type, {
                    connectionString: testConnectionString,
                })
                .resolves(expectedResult);

            const result = await connectionManager.parseConnectionString(testConnectionString);

            expect(result).to.equal(expectedResult);
        });
    });

    suite("Token request handling", () => {
        setup(() => {
            // Test the MSAL (non-VS-Code-accounts) path
            stubPreviewService(sandbox, { [PreviewFeature.UseVscodeAccountsForEntraMFA]: false });
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
                    expiresOn: cachedToken.expiresOn,
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

            // selectAccount and selectTenantId return string IDs in the new delegate-based flow
            connectionManager["selectAccount"] = sandbox.stub().resolves("account-key");
            connectionManager["selectTenantId"] = sandbox.stub().resolves("tenant-id");

            // _accountStore is needed by the getAccounts and getTenants delegates
            const mockAccountStore = sandbox.createStubInstance(AccountStore);
            const mockAccount = {
                key: { id: "account-key", providerId: azureCloudProviderId },
                displayInfo: { name: "Test User", email: "test@contoso.com" },
                properties: { tenants: [] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccounts.resolves([mockAccount]);
            mockAccountStore.getAccount.resolves(mockAccount);
            connectionManager["_accountStore"] = mockAccountStore;

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
                    expiresOn: token.expiresOn,
                },
                "Should return new token",
            );

            // verify new token is cached
            expect(
                connectionManager["_keyVaultTokenCache"].get(JSON.stringify(params)),
            ).to.deep.equal(token, "New token should be cached");
        });
    });

    suite("handleSecurityTokenRequest - VS Code accounts path", () => {
        let acquireTokenStub: sinon.SinonStub;

        setup(() => {
            stubPreviewService(sandbox, {
                [PreviewFeature.UseVscodeAccountsForEntraMFA]: true,
            });
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined,
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined,
                undefined,
            );
            acquireTokenStub = sandbox.stub(
                vscodeEntraMfaUtils,
                "acquireTokenFromVscodeAccountForResource",
            );
        });

        test("Should acquire token for SQL when accountId is specified", async () => {
            const expiresOn = Math.floor(Date.now() / 1000) + 3600;
            acquireTokenStub.resolves({ token: { token: "vscode-token", expiresOn } });

            const params: RequestSecurityTokenParams = {
                accountId: "account-id",
                tenantId: "tenant-id",
                resource: "",
                provider: "",
                authority: "",
                scopes: [],
            };

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal({
                accountKey: "account-id",
                token: "vscode-token",
                expiresOn,
            });
            expect(acquireTokenStub).to.have.been.calledWithMatch(
                publicAzureProviderSettings.settings.sqlResource.endpoint,
                "account-id",
                "tenant-id",
            );
        });

        test("should return empty token on failure", async () => {
            acquireTokenStub.rejects(new Error("auth failed"));

            const params: RequestSecurityTokenParams = {
                accountId: "account-id",
                tenantId: "tenant-id",
                resource: "",
                provider: "",
                authority: "",
                scopes: [],
            };

            const result = await connectionManager["handleSecurityTokenRequest"](params);

            expect(result).to.deep.equal({ accountKey: "", token: "", expiresOn: 0 });
        });

        test("should acquire token using AKV resource when accountId is not specified", async () => {
            const expiresOn = Math.floor(Date.now() / 1000) + 3600;
            acquireTokenStub.resolves({
                token: { key: "akv-key", token: "akv-token", tokenType: "bearer", expiresOn },
            });
            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccounts").resolves([]);
            connectionManager["selectAccount"] = sandbox.stub().resolves("account-id");
            connectionManager["selectTenantId"] = sandbox.stub().resolves("tenant-id");

            const params: RequestSecurityTokenParams = {
                accountId: undefined,
                tenantId: "",
                resource: "",
                provider: "",
                authority: "",
                scopes: [],
            };

            await connectionManager["handleSecurityTokenRequest"](params);

            expect(acquireTokenStub).to.have.been.calledWithMatch(
                publicAzureProviderSettings.settings.azureKeyVaultResource.endpoint,
                "account-id",
                "tenant-id",
            );
        });
    });

    suite("should acquire token for AKV when accountId is not specified (MSAL)", () => {
        let sendNotificationStub: sinon.SinonStub;

        function invokeHandler(params: ConnectionContracts.RefreshTokenParams): Promise<void> {
            const handler = connectionManager.handleRefreshTokenNotification();
            handler(params);
            return new Promise((resolve) => setTimeout(resolve, 0));
        }

        function makeParams(
            overrides: Partial<ConnectionContracts.RefreshTokenParams> = {},
        ): ConnectionContracts.RefreshTokenParams {
            return {
                accountId: "account-id",
                tenantId: "tenant-id",
                uri: "file:///test.sql",
                provider: "Azure",
                resource: "SQL",
                ...overrides,
            };
        }

        setup(() => {
            stubPreviewService(sandbox, {
                [PreviewFeature.UseVscodeAccountsForEntraMFA]: false,
            });
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined,
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined,
                mockAccountStore,
            );
            sendNotificationStub = mockServiceClient.sendNotification as sinon.SinonStub;
            sendNotificationStub.reset();
            connectionManager["client"] = mockServiceClient;
        });

        test("happy path: sends TokenRefreshedNotification with token and expiresOn", async () => {
            const expiresOn = Math.floor(Date.now() / 1000) + 3600;
            const mockAccount = {
                key: { id: "account-id", providerId: azureCloudProviderId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccount.resolves(mockAccount);
            mockAzureController.refreshAccessToken.resolves({
                token: "refreshed-token",
                expiresOn,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            connectionManager.azureController = mockAzureController;

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "refreshed-token",
                expiresOn,
                uri: "file:///test.sql",
            });
        });

        test("missing accountId: sends failure notification", async () => {
            await invokeHandler(makeParams({ accountId: undefined }));

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "",
                expiresOn: 0,
                uri: "file:///test.sql",
            });
        });

        test("account not found: sends failure notification", async () => {
            mockAccountStore.getAccount.resolves(undefined);

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "",
                expiresOn: 0,
                uri: "file:///test.sql",
            });
        });

        test("refreshAccessToken returns nothing: sends failure notification", async () => {
            const mockAccount = {
                key: { id: "account-id", providerId: azureCloudProviderId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccount.resolves(mockAccount);
            mockAzureController.refreshAccessToken.resolves(undefined);
            connectionManager.azureController = mockAzureController;

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "",
                expiresOn: 0,
                uri: "file:///test.sql",
            });
        });

        test("unexpected exception: sends failure notification", async () => {
            const mockAccount = {
                key: { id: "account-id", providerId: azureCloudProviderId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccount.resolves(mockAccount);
            mockAzureController.refreshAccessToken.rejects(new Error("unexpected"));
            connectionManager.azureController = mockAzureController;

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "",
                expiresOn: 0,
                uri: "file:///test.sql",
            });
        });

        test("client unavailable: sends serviceClientUnavailable error event", async () => {
            const sendErrorEventStub = sandbox.stub(telemetry, "sendErrorEvent");

            const mockAccount = {
                key: { id: "account-id", providerId: azureCloudProviderId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccount.resolves(mockAccount);
            mockAzureController.refreshAccessToken.resolves({
                token: "refreshed-token",
                expiresOn: Math.floor(Date.now() / 1000) + 3600,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
            connectionManager.azureController = mockAzureController;
            connectionManager["client"] = undefined; // no client

            await invokeHandler(makeParams());

            expect(sendErrorEventStub).to.have.been.calledWithMatch(
                TelemetryViews.ConnectionManager,
                TelemetryActions.RefreshTokenNotification,
                sinon.match.instanceOf(Error),
                sinon.match.any,
                "serviceClientUnavailable",
            );
            expect(sendNotificationStub).to.not.have.been.called;
        });

        test("getAccountSecurityToken is called with AKV resource", async () => {
            const expiresOn = Math.floor(Date.now() / 1000) + 3600;
            const mockAccount = {
                key: { id: "account-id", providerId: azureCloudProviderId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            mockAccountStore.getAccounts.resolves([]);
            mockAccountStore.getAccount.resolves(mockAccount);
            const token: IToken = {
                key: "akv-key",
                token: "akv-token",
                tokenType: "bearer",
                expiresOn,
            };
            mockAzureController.getAccountSecurityToken.resolves(token);
            connectionManager.azureController = mockAzureController;
            connectionManager["selectAccount"] = sandbox.stub().resolves("account-id");
            connectionManager["selectTenantId"] = sandbox.stub().resolves("tenant-id");

            const params: RequestSecurityTokenParams = {
                accountId: undefined,
                tenantId: "",
                resource: "",
                provider: "",
                authority: "",
                scopes: [],
            };

            await connectionManager["handleSecurityTokenRequest"](params);

            expect(mockAzureController.getAccountSecurityToken).to.have.been.calledWithMatch(
                sinon.match.any,
                "tenant-id",

                publicAzureProviderSettings.settings.azureKeyVaultResource,
            );
        });
    });

    suite("handleRefreshTokenNotification - VS Code accounts path", () => {
        let sendNotificationStub: sinon.SinonStub;
        let acquireTokenStub: sinon.SinonStub;

        function invokeHandler(params: ConnectionContracts.RefreshTokenParams): Promise<void> {
            const handler = connectionManager.handleRefreshTokenNotification();
            handler(params);
            return new Promise((resolve) => setTimeout(resolve, 0));
        }

        function makeParams(
            overrides: Partial<ConnectionContracts.RefreshTokenParams> = {},
        ): ConnectionContracts.RefreshTokenParams {
            return {
                accountId: "account-id",
                tenantId: "tenant-id",
                uri: "file:///test.sql",
                provider: "Azure",
                resource: "SQL",
                ...overrides,
            };
        }

        setup(() => {
            stubPreviewService(sandbox, {
                [PreviewFeature.UseVscodeAccountsForEntraMFA]: true,
            });
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined,
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined,
                undefined,
            );
            acquireTokenStub = sandbox.stub(
                vscodeEntraMfaUtils,
                "acquireTokenFromVscodeAccountForResource",
            );
            sendNotificationStub = mockServiceClient.sendNotification as sinon.SinonStub;
            sendNotificationStub.reset();
            connectionManager["client"] = mockServiceClient;
        });

        test("happy path: sends TokenRefreshedNotification with token and expiresOn", async () => {
            const expiresOn = Math.floor(Date.now() / 1000) + 3600;
            acquireTokenStub.resolves({ token: { token: "vscode-token", expiresOn } });

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "vscode-token",
                expiresOn,
                uri: "file:///test.sql",
            });
        });

        test("exception thrown: sends failure notification", async () => {
            acquireTokenStub.rejects(new Error("token error"));

            await invokeHandler(makeParams());

            expect(sendNotificationStub).to.have.been.calledOnce;
            const [, sentParams] = sendNotificationStub.firstCall.args;
            expect(sentParams).to.deep.equal({
                token: "",
                expiresOn: 0,
                uri: "file:///test.sql",
            });
        });
    });

    suite("refreshEntraTokenIfNeeded - self-managed auth", () => {
        let withProgressStub: sinon.SinonStub;

        const account = {
            key: { id: "account-1", providerId: azureCloudProviderId },
            displayInfo: {
                displayName: "Test User",
                email: "user@example.com",
                name: "Test User",
            },
            properties: {
                owningTenant: { id: "tenant-1" },
            },
        } as IAccount;

        function createAzureMfaConnectionInfo(overrides: Partial<IConnectionInfo> = {}) {
            return {
                server: "test-server",
                authenticationType: "AzureMFA",
                accountId: "account-1",
                tenantId: "tenant-1",
                azureAccountToken: "expired-token",
                expiresOn: Math.floor(Date.now() / 1000) - 1000, // default to expired token
                ...overrides,
            } as IConnectionInfo;
        }

        setup(() => {
            // Test the MSAL (non-VS-Code-accounts) path
            stubPreviewService(sandbox, { [PreviewFeature.UseVscodeAccountsForEntraMFA]: false });
            connectionManager = new ConnectionManager(
                mockContext,
                mockStatusView,
                undefined,
                mockLogger,
                mockServiceClient,
                mockVscodeWrapper,
                mockConnectionStore,
                mockCredentialStore,
                undefined,
                undefined,
            );

            mockAccountStore = sandbox.createStubInstance(AccountStore);
            mockAzureController = sandbox.createStubInstance(MsalAzureController);
            connectionManager.accountStore = mockAccountStore;
            connectionManager.azureController = mockAzureController;

            mockAccountStore.getAccount.resolves(account);

            withProgressStub = sandbox.stub(vscode.window, "withProgress").callsFake((_, task) =>
                task(
                    {} as vscode.Progress<{}>,
                    {
                        onCancellationRequested: () => ({ dispose: () => {} }),
                        isCancellationRequested: false,
                    } as vscode.CancellationToken,
                ),
            );
        });

        test("refreshes MSAL account cache and clears outbound SQL token fields", async () => {
            const connectionInfo = createAzureMfaConnectionInfo();
            await connectionManager.refreshEntraTokenIfNeeded(connectionInfo);

            expect(mockAzureController.refreshAccessToken).to.have.been.calledOnce;
            expect(mockAzureController.refreshAccessToken.firstCall.args[0]).to.equal(account);
            expect(mockAzureController.refreshAccessToken.firstCall.args[1]).to.equal(
                mockAccountStore,
            );
            expect(mockAzureController.refreshAccessToken.firstCall.args[2]).to.equal("tenant-1");
            expect(withProgressStub).to.not.have.been.called;
            expect(connectionInfo.user).to.equal("user@example.com");
            expect(connectionInfo.email).to.equal("user@example.com");
            expect(connectionInfo.azureAccountToken).to.be.undefined;
            expect(connectionInfo.expiresOn).to.be.undefined;
        });

        test("is a no-op for non-Azure MFA auth", async () => {
            const connectionInfo = createAzureMfaConnectionInfo({
                authenticationType: "SqlLogin",
            });

            await connectionManager.refreshEntraTokenIfNeeded(connectionInfo);

            expect(mockAccountStore.getAccount).to.not.have.been.called;
            expect(mockAzureController.refreshAccessToken).to.not.have.been.called;
            expect(withProgressStub).to.not.have.been.called;
        });

        test("onClearAzureTokenCache clears the MSAL token cache", async () => {
            connectionManager.onClearAzureTokenCache();

            expect(mockAzureController.clearTokenCache).to.have.been.calledOnce;
        });
    });

    suite("prepareConnectionInfo", () => {
        let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
        let mockConnectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
        let mockAccountStore: sinon.SinonStubbedInstance<AccountStore>;
        let mockAzureController: sinon.SinonStubbedInstance<AzureController>;
        let testConnectionManager: ConnectionManager;
        let handlePasswordBasedCredentialsStub: sinon.SinonStub;
        let refreshEntraTokenIfNeededStub: sinon.SinonStub;

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
            refreshEntraTokenIfNeededStub = sandbox
                .stub(testConnectionManager, "refreshEntraTokenIfNeeded")
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
            expect(refreshEntraTokenIfNeededStub).to.have.been.calledOnceWith(mockConnectionInfo);
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
});
