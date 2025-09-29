/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import { ILoggerCallback } from "@azure/msal-common";
import { AzureAuthType } from "../../src/models/contracts/azure";
import { CloudId } from "../../src/azure/providerSettings";
import { MsalCachePluginProvider } from "../../src/azure/msal/msalCachePlugin";
import { MsalAzureCodeGrant } from "../../src/azure/msal/msalAzureCodeGrant";
import { MsalAzureDeviceCode } from "../../src/azure/msal/msalAzureDeviceCode";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { Logger } from "../../src/models/logger";
import { CloudAuthApplication } from "../../src/azure/msal/msalAzureController";
import * as providerSettings from "../../src/azure/providerSettings";
import * as msalNode from "@azure/msal-node";

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

        // Create mock context
        mockContext = {
            extensionUri: vscode.Uri.file("/test/path"),
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
            },
            subscriptions: [],
            workspaceState: {} as vscode.Memento,
            secrets: {} as vscode.SecretStorage,
            extensionPath: "/test/path",
        } as unknown as vscode.ExtensionContext;

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

        sandbox.stub(providerSettings, "getCloudSettings").callsFake(getCloudSettingsStub);

        // Create mock token cache for this test
        const mockTokenCache = {
            getAllAccounts: sandbox.stub().resolves([]),
        };

        const publicClientApplicationStub = sandbox.stub().returns({
            getTokenCache: sandbox.stub().returns(mockTokenCache),
        });

        sandbox.stub(msalNode, "PublicClientApplication").callsFake(publicClientApplicationStub);

        const cloudAuthApp = new CloudAuthApplication(
            cloudId,
            mockCachePluginProvider,
            loggerCallback,
            mockContext,
            mockVscodeWrapper,
            mockLogger,
        );

        // Act
        await cloudAuthApp.initialize();

        // Assert
        expect(publicClientApplicationStub).to.have.been.calledOnce;
        expect(getCloudSettingsStub).to.have.been.calledWithExactly(); // Called with no arguments
        expect(cloudAuthApp.clientApplication).to.exist;

        await cloudAuthApp.loadTokenCache();

        expect(mockTokenCache.getAllAccounts).to.have.been.calledOnce;
    });

    test("should create and cache MsalAzureCodeGrant instance", () => {
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
            "Should be initialized with default auth type",
        ).to.equal(1);

        // Validate caching behavior
        const codeGrantInstance1 = cloudAuthApp.msalAuthInstance(AzureAuthType.AuthCodeGrant);
        const codeGrantInstance2 = cloudAuthApp.msalAuthInstance(AzureAuthType.AuthCodeGrant);

        expect(codeGrantInstance1).to.be.instanceOf(MsalAzureCodeGrant);
        expect(codeGrantInstance1).to.equal(codeGrantInstance2);

        // Validate different auth type creates new msalAuth instance
        const deviceCodeInstance = cloudAuthApp.msalAuthInstance(AzureAuthType.DeviceCode);
        expect(deviceCodeInstance).to.be.instanceOf(MsalAzureDeviceCode);
        expect(deviceCodeInstance).to.not.equal(codeGrantInstance1);
    });

    test("should return clientApplication getter correctly", async () => {
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

        // Act
        await cloudAuthApp.initialize();
        const clientApp = cloudAuthApp.clientApplication;

        // Assert
        expect(clientApp).to.exist;
        expect(clientApp.getTokenCache).to.be.a("function");
    });
});
