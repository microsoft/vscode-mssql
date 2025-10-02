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
import * as providerSettings from "../../src/azure/providerSettings";
import * as msalNode from "@azure/msal-node";
import * as azureUtils from "../../src/azure/utils";
import { CredentialStore } from "../../src/credentialstore/credentialstore";
import CodeAdapter from "../../src/prompts/adapter";

chai.use(sinonChai);

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
        mockLogger = sandbox.createStubInstance(Logger);
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

    test("init should enable SQL authentication provider only if config is true", () => {
        // Arrange
        const getEnableSqlAuthProviderConfigStub = sandbox
            .stub(azureUtils, "getEnableSqlAuthenticationProviderConfig")
            .returns(false);

        const controller = new MsalAzureController(
            mockContext,
            mockPrompter,
            mockCredentialStore,
            mockSubscriptionClientFactory,
        );

        // Act
        controller.init();

        expect(controller["_isSqlAuthProviderEnabled"]).to.be.false;

        getEnableSqlAuthProviderConfigStub.reset();
        getEnableSqlAuthProviderConfigStub.returns(true);

        controller.init();

        expect(controller["_isSqlAuthProviderEnabled"]).to.be.true;
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
});
