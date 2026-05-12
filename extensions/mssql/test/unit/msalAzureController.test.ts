/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ILoggerCallback } from "@azure/msal-common";
import {
    AzureAuthType,
    ISuccessfulLoginResult,
    IFailedLoginResult,
    IAccount,
    AccountType,
    IProviderSettings,
} from "../../src/models/contracts/azure";
import { CloudId } from "../../src/azure/providerSettings";
import { MsalCachePluginProvider } from "../../src/azure/msal/msalCachePlugin";
import { MsalAzureCodeGrant } from "../../src/azure/msal/msalAzureCodeGrant";
import { MsalAzureDeviceCode } from "../../src/azure/msal/msalAzureDeviceCode";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { Logger } from "../../src/models/logger";
import {
    CloudAuthApplication,
    MsalAzureController,
} from "../../src/azure/msal/msalAzureController";
import { IMsalLoginOptions, MsalAzureAuth } from "../../src/azure/msal/msalAzureAuth";
import * as providerSettings from "../../src/azure/providerSettings";
import * as msalNode from "@azure/msal-node";
import * as azureUtils from "../../src/azure/utils";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import { AccountStore } from "../../src/azure/accountStore";
import CodeAdapter from "../../src/prompts/adapter";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

const homeAccountId = "uid.home-tenant";
const localAccountId = "local-id";
const homeTenantId = "home-tenant";
const targetTenantId = "target-tenant";

function createExtensionAccount(tenantId: string = homeTenantId): IAccount {
    return {
        key: {
            id: homeAccountId,
            providerId: providerSettings.azureCloudProviderId,
            accountVersion: "1.0",
        },
        displayInfo: {
            displayName: "Test User",
            accountType: AccountType.WorkSchool,
            userId: "test-user@example.com",
            name: "Test User",
            email: "test-user@example.com",
        },
        properties: {
            azureAuthType: AzureAuthType.AuthCodeGrant,
            owningTenant: { id: tenantId, displayName: "Test Tenant" },
            tenants: [],
            providerSettings: providerSettings.publicAzureProviderSettings,
            isMsAccount: false,
        },
        isStale: false,
    };
}

function createMsalAccount(tenantId: string): msalNode.AccountInfo {
    return {
        homeAccountId,
        localAccountId,
        tenantId,
        environment: "login.microsoftonline.com",
        username: "test-user@example.com",
        name: "Test User",
        idTokenClaims: {
            tid: tenantId,
            exp: 111,
        },
    };
}

function createAuthenticationResult(
    account: msalNode.AccountInfo,
    expiresOn: Date,
    idTokenExpiry: number = 111,
): msalNode.AuthenticationResult {
    return {
        authority: `https://login.microsoftonline.com/${account.tenantId}`,
        uniqueId: "uid",
        tenantId: account.tenantId,
        scopes: ["https://database.windows.net/.default"],
        account: {
            ...account,
            idTokenClaims: {
                ...account.idTokenClaims,
                exp: idTokenExpiry,
            },
        },
        idToken: "id-token",
        idTokenClaims: {
            tid: account.tenantId,
            exp: idTokenExpiry,
        },
        accessToken: "header.payload.signature",
        fromCache: false,
        expiresOn,
        tokenType: "Bearer",
        correlationId: "correlation-id",
    };
}

class TestMsalAzureAuth extends MsalAzureAuth {
    public loginCalls: Array<{ tenant: unknown; options?: IMsalLoginOptions }> = [];

    protected async login(
        tenant: any,
        options?: IMsalLoginOptions,
    ): Promise<{
        response: msalNode.AuthenticationResult | null;
        authComplete: { resolve: () => void; reject: (error: Error) => void };
    }> {
        this.loginCalls.push({ tenant, options });
        return {
            response: null,
            authComplete: {
                resolve: () => undefined,
                reject: () => undefined,
            },
        };
    }
}

suite("CloudAuthApplication Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockCachePluginProvider: sinon.SinonStubbedInstance<MsalCachePluginProvider>;
    let loggerCallback: ILoggerCallback;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {} as vscode.ExtensionContext;

        // Create stubs for dependencies
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = createStubLogger(sandbox);
        mockCachePluginProvider = sandbox.createStubInstance(MsalCachePluginProvider);

        loggerCallback = sandbox.stub();

        // Create mock cache plugin
        const mockCachePlugin = {
            beforeCacheAccess: sandbox.stub(),
            afterCacheAccess: sandbox.stub(),
        };
        mockCachePluginProvider.getCachePlugin.returns(mockCachePlugin);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should construct CloudAuthApplication with all dependencies", () => {
        // Arrange
        const cloudId = CloudId.AzureCloud;

        // Act
        const cloudAuthApp = new CloudAuthApplication(
            cloudId,
            mockCachePluginProvider,
            loggerCallback,
            mockContext,
            mockVscodeWrapper,
            mockLogger,
        );

        // Assert
        expect(cloudAuthApp.cloudId).to.equal(cloudId);
    });

    test("should initialize and create client application", async () => {
        // Arrange
        const cloudId = CloudId.AzureCloud;

        // Stub getCloudSettings for this test
        const getCloudSettingsStub = sandbox.stub().returns({
            clientId: "test-client-id",
            loginEndpoint: "https://login.microsoftonline.com/",
            scopes: ["https://database.windows.net/.default"],
        });

        sandbox.stub(providerSettings, "getCloudProviderSettings").callsFake(getCloudSettingsStub);

        // Create mock token cache for this test
        const mockTokenCache = {
            getAllAccounts: sandbox.stub().resolves([]),
        };

        const publicClientApplicationStub = sandbox.stub().returns({
            getTokenCache: sandbox.stub().returns(mockTokenCache),
        });

        sandbox.stub(msalNode, "PublicClientApplication").callsFake(publicClientApplicationStub);

        // Act
        const cloudAuthApp = new CloudAuthApplication(
            cloudId,
            mockCachePluginProvider,
            loggerCallback,
            mockContext,
            mockVscodeWrapper,
            mockLogger,
        );

        // Assert
        expect(publicClientApplicationStub).to.have.been.calledOnce;
        expect(getCloudSettingsStub).to.have.been.calledTwice.calledWithExactly(cloudId);
        expect(cloudAuthApp.clientApplication).to.exist;

        await cloudAuthApp.loadTokenCache();

        expect(mockTokenCache.getAllAccounts).to.have.been.calledOnce;
    });

    test("should create and cache MsalAzureCodeGrant instance", async () => {
        // Arrange
        const cloudId = CloudId.AzureCloud;
        const cloudAuthApp = new CloudAuthApplication(
            cloudId,
            mockCachePluginProvider,
            loggerCallback,
            mockContext,
            mockVscodeWrapper,
            mockLogger,
        );

        expect(
            cloudAuthApp["_authMappings"].size,
            "Should be initialized with no auth instances",
        ).to.equal(0);

        // Validate caching behavior
        const codeGrantInstance1 = cloudAuthApp.msalAuthInstance(AzureAuthType.AuthCodeGrant);
        const codeGrantInstance2 = cloudAuthApp.msalAuthInstance(AzureAuthType.AuthCodeGrant);

        expect(codeGrantInstance1).to.be.instanceOf(MsalAzureCodeGrant);
        expect(codeGrantInstance1).to.equal(codeGrantInstance2);

        expect(
            cloudAuthApp["_authMappings"].size,
            "Should be have one auth instance after AuthCodeGrant was fetched multiple times",
        ).to.equal(1);

        // Validate different auth type creates new msalAuth instance
        const deviceCodeInstance = cloudAuthApp.msalAuthInstance(AzureAuthType.DeviceCode);
        expect(deviceCodeInstance).to.be.instanceOf(MsalAzureDeviceCode);
        expect(deviceCodeInstance).to.not.equal(codeGrantInstance1);

        expect(
            cloudAuthApp["_authMappings"].size,
            "Should have two auth instances after both AuthcodeGrant and DeviceCode were fetched",
        ).to.equal(2);
    });
});

suite("MsalAzureAuth Token Acquisition Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;

    function createAuth(accounts: msalNode.AccountInfo[]) {
        const tokenCache = {
            getAllAccounts: sandbox.stub().resolves(accounts),
            removeAccount: sandbox.stub().resolves(),
        };
        const acquireTokenSilent = sandbox.stub();
        const clientApplication = {
            acquireTokenSilent,
            getTokenCache: sandbox.stub().returns(tokenCache),
        } as unknown as msalNode.PublicClientApplication;

        const auth = new TestMsalAzureAuth(
            providerSettings.publicAzureProviderSettings,
            mockContext,
            clientApplication,
            AzureAuthType.AuthCodeGrant,
            mockVscodeWrapper,
            mockLogger,
        );

        return { acquireTokenSilent, auth, tokenCache };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {} as vscode.ExtensionContext;
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = createStubLogger(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getToken uses the tenant-specific account without forcing refresh", async () => {
        const targetAccount = createMsalAccount(targetTenantId);
        const { acquireTokenSilent, auth } = createAuth([
            createMsalAccount(homeTenantId),
            targetAccount,
        ]);
        acquireTokenSilent.resolves(
            createAuthenticationResult(targetAccount, new Date(Date.now() + 3600_000)),
        );

        await auth.getToken(
            createExtensionAccount(),
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );

        expect(acquireTokenSilent).to.have.been.calledOnce;
        const request = acquireTokenSilent.firstCall.args[0] as msalNode.SilentFlowRequest;
        expect(request.account).to.equal(targetAccount);
        expect(request.forceRefresh).to.be.undefined;
        expect(request.authority).to.equal(
            `${providerSettings.publicAzureProviderSettings.loginEndpoint}${targetTenantId}`,
        );
        expect(request.scopes).to.deep.equal(["https://database.windows.net/.default"]);
    });

    test("getToken uses forceRefresh only when falling back across tenants", async () => {
        const homeAccount = createMsalAccount(homeTenantId);
        const { acquireTokenSilent, auth } = createAuth([homeAccount]);
        acquireTokenSilent.resolves(
            createAuthenticationResult(homeAccount, new Date(Date.now() + 3600_000)),
        );

        await auth.getToken(
            createExtensionAccount(),
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );

        expect(acquireTokenSilent).to.have.been.calledOnce;
        const request = acquireTokenSilent.firstCall.args[0] as msalNode.SilentFlowRequest;
        expect(request.account).to.equal(homeAccount);
        expect(request.forceRefresh).to.equal(true);
    });

    test("getToken returns null without interactive login when account is missing from cache", async () => {
        const { acquireTokenSilent, auth } = createAuth([]);

        const result = await auth.getToken(
            createExtensionAccount(),
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );

        expect(result).to.be.null;
        expect(acquireTokenSilent).not.to.have.been.called;
        expect(auth.loginCalls).to.be.empty;
    });

    test("getToken rethrows interaction-required errors without interactive login", async () => {
        const targetAccount = createMsalAccount(targetTenantId);
        const { acquireTokenSilent, auth } = createAuth([targetAccount]);
        const interactionError = new msalNode.InteractionRequiredAuthError(
            "interaction_required",
            "User interaction is required",
        );
        acquireTokenSilent.rejects(interactionError);

        let thrownError: unknown;
        try {
            await auth.getToken(
                createExtensionAccount(),
                targetTenantId,
                providerSettings.publicAzureProviderSettings.settings.sqlResource!,
            );
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).to.equal(interactionError);
        expect(auth.loginCalls).to.be.empty;
    });

    test("reauthenticate uses tenant account and login hint without forcing account picker", async () => {
        const targetAccount = createMsalAccount(targetTenantId);
        const { auth } = createAuth([targetAccount]);

        const result = await auth.reauthenticate(createExtensionAccount(), targetTenantId);

        expect(result).to.be.undefined;
        expect(auth.loginCalls).to.have.length(1);
        const loginCall = auth.loginCalls[0];
        expect((loginCall.tenant as { id: string }).id).to.equal(targetTenantId);
        expect(loginCall.options?.account).to.equal(targetAccount);
        expect(loginCall.options?.loginHint).to.equal("test-user@example.com");
        expect(loginCall.options?.prompt).to.be.undefined;
    });
});

suite("MsalAzureController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockPrompter: sinon.SinonStubbedInstance<CodeAdapter>;
    let mockCredentialStore: sinon.SinonStubbedInstance<CredentialStore>;
    let mockSubscriptionClientFactory: azureUtils.SubscriptionClientFactory;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = {} as vscode.ExtensionContext;
        mockPrompter = sandbox.createStubInstance(CodeAdapter);
        mockCredentialStore = sandbox.createStubInstance(CredentialStore);

        mockSubscriptionClientFactory = sandbox.stub() as azureUtils.SubscriptionClientFactory;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should construct MsalAzureController", async () => {
        // Arrange & Act
        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );

        await controller.initialized;

        // Assert
        expect(controller).to.exist;
    });

    test("clearTokenCache should clear cache for all cloud auth mappings", async () => {
        // Arrange
        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );

        const mockClientApplication = sandbox.createStubInstance(msalNode.PublicClientApplication);
        const mockCloudAuth = sandbox.createStubInstance(CloudAuthApplication);

        sandbox.stub(mockCloudAuth, "clientApplication").get(() => mockClientApplication);

        controller["_cloudAuthMappings"] = new Map();
        controller["_cloudAuthMappings"].set(CloudId.AzureCloud, mockCloudAuth);

        const mockCachePluginProvider = sandbox.createStubInstance(MsalCachePluginProvider);
        controller["_cachePluginProvider"] = mockCachePluginProvider;

        // Act
        await controller.clearTokenCache();

        // Assert
        expect(mockClientApplication.clearCache).to.have.been.calledOnce;
        expect(mockCachePluginProvider.unlinkMsalCache).to.have.been.calledOnce;
        expect(mockCachePluginProvider.clearCacheEncryptionKeys).to.have.been.calledOnce;
    });

    test("login should return account on successful login", async () => {
        // Arrange
        const mockAccount: IAccount = {
            key: {
                id: "test-account-id",
                providerId: "test-provider",
                accountVersion: "1.0",
            },
            displayInfo: {
                displayName: "Test User",
                accountType: AccountType.Microsoft,
                userId: "test-user@example.com",
                name: "Test User",
            },
            properties: {
                azureAuthType: AzureAuthType.AuthCodeGrant,
                owningTenant: { id: "test-tenant", displayName: "Test Tenant" },
                tenants: [],
                providerSettings: {} as IProviderSettings,
                isMsAccount: true,
            },
            isStale: false,
        };

        const mockResponse: ISuccessfulLoginResult = {
            success: true,
            account: mockAccount,
        };

        const mockMsalAuth = sandbox.createStubInstance(MsalAzureCodeGrant);
        mockMsalAuth.startLogin.resolves(mockResponse);

        const mockCloudAuth = sandbox.createStubInstance(CloudAuthApplication);
        mockCloudAuth.msalAuthInstance.returns(mockMsalAuth);

        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );

        // Set up the cloud auth mapping
        controller["_cloudAuthMappings"] = new Map();
        controller["_cloudAuthMappings"].set(CloudId.AzureCloud, mockCloudAuth);

        sandbox.stub(providerSettings, "getCloudId").returns(CloudId.AzureCloud);

        // Act
        const result = await controller.login(AzureAuthType.AuthCodeGrant);

        // Assert
        expect(result).to.equal(mockAccount);
        expect(mockMsalAuth.startLogin).to.have.been.calledOnce;
    });

    test("login should return proper error on failed login", async () => {
        // Arrange
        const mockResponse: IFailedLoginResult = {
            success: false,
            error: "Login failed",
            canceled: false,
        };

        const mockMsalAuth = sandbox.createStubInstance(MsalAzureCodeGrant);
        mockMsalAuth.startLogin.resolves(mockResponse);

        const mockCloudAuth = sandbox.createStubInstance(CloudAuthApplication);
        mockCloudAuth.msalAuthInstance.returns(mockMsalAuth);

        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );

        // Set up the cloud auth mapping
        controller["_cloudAuthMappings"] = new Map();
        controller["_cloudAuthMappings"].set(CloudId.AzureCloud, mockCloudAuth);

        sandbox.stub(providerSettings, "getCloudId").returns(CloudId.AzureCloud);

        // Act
        const result = await controller.login(AzureAuthType.AuthCodeGrant);

        // Assert
        expect(result).to.be.undefined;
        expect(mockMsalAuth.startLogin).to.have.been.calledOnce;
    });

    test("getAccountSecurityToken should use MSAL access token expiration", async () => {
        const accessTokenExpiry = Math.floor(Date.now() / 1000) + 3600;
        const idTokenExpiry = accessTokenExpiry + 7200;
        const msalAccount = createMsalAccount(targetTenantId);
        const mockResult = createAuthenticationResult(
            msalAccount,
            new Date(accessTokenExpiry * 1000),
            idTokenExpiry,
        );

        const mockMsalAuth = sandbox.createStubInstance(MsalAzureCodeGrant);
        mockMsalAuth.getToken.resolves(mockResult);

        const mockCloudAuth = sandbox.createStubInstance(CloudAuthApplication);
        mockCloudAuth.msalAuthInstance.returns(mockMsalAuth);

        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );
        controller["_cloudAuthMappings"] = new Map();
        controller["_cloudAuthMappings"].set(CloudId.AzureCloud, mockCloudAuth);

        sandbox.stub(providerSettings, "getCloudId").returns(CloudId.AzureCloud);

        const token = await controller.getAccountSecurityToken(
            createExtensionAccount(),
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );

        expect(token!.expiresOn).to.equal(accessTokenExpiry);
        expect(token!.expiresOn).not.to.equal(idTokenExpiry);
    });

    test("refreshAccessToken reauthenticates once when silent refresh requires interaction", async () => {
        const accessTokenExpiry = Math.floor(Date.now() / 1000) + 3600;
        const originalAccount = createExtensionAccount(homeTenantId);
        const reauthenticatedAccount = createExtensionAccount(targetTenantId);
        const mockResult = createAuthenticationResult(
            createMsalAccount(targetTenantId),
            new Date(accessTokenExpiry * 1000),
        );
        const interactionError = new msalNode.InteractionRequiredAuthError(
            "interaction_required",
            "User interaction is required",
        );

        const mockMsalAuth = sandbox.createStubInstance(MsalAzureCodeGrant);
        mockMsalAuth.refreshAccessToken.rejects(interactionError);
        mockMsalAuth.reauthenticate.resolves(reauthenticatedAccount);
        mockMsalAuth.getToken.resolves(mockResult);

        const mockCloudAuth = sandbox.createStubInstance(CloudAuthApplication);
        mockCloudAuth.msalAuthInstance.returns(mockMsalAuth);

        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );
        controller["_cloudAuthMappings"] = new Map();
        controller["_cloudAuthMappings"].set(CloudId.AzureCloud, mockCloudAuth);

        const mockAccountStore = {
            addAccount: sandbox.stub().resolves(),
        } as unknown as AccountStore;

        const token = await controller.refreshAccessToken(
            originalAccount,
            mockAccountStore,
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );

        expect(mockMsalAuth.refreshAccessToken).to.have.been.calledOnce;
        expect(mockMsalAuth.reauthenticate).to.have.been.calledOnceWith(
            originalAccount,
            targetTenantId,
        );
        expect(mockAccountStore.addAccount).to.have.been.calledOnceWith(reauthenticatedAccount);
        expect(mockMsalAuth.getToken).to.have.been.calledOnceWith(
            reauthenticatedAccount,
            targetTenantId,
            providerSettings.publicAzureProviderSettings.settings.sqlResource!,
        );
        expect(token!.expiresOn).to.equal(accessTokenExpiry);
    });
});
