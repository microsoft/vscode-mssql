/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import {
    AccountInfo,
    AuthenticationResult,
    InteractionRequiredAuthError,
    PublicClientApplication,
    ServerError,
} from "@azure/msal-node";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { Logger } from "../../src/models/logger";
import {
    AzureAuthType,
    AccountType,
    IAADResource,
    IAccount,
    IProviderSettings,
    ITenant,
} from "../../src/models/contracts/azure";
import { MsalAzureAuth } from "../../src/azure/msal/msalAzureAuth";
import * as Constants from "../../src/azure/constants";
import { IDeferred } from "../../src/models/interfaces";

chai.use(sinonChai);

class TestMsalAzureAuth extends MsalAzureAuth {
    protected async login(_tenant: ITenant): Promise<{
        response: AuthenticationResult | null;
        authComplete: IDeferred<void, Error>;
    }> {
        throw new Error("Not implemented in tests");
    }
}

suite("MsalAzureAuth Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockTokenCache: {
        removeAccount: sinon.SinonStub;
    };
    let mockClientApplication: PublicClientApplication;
    let auth: TestMsalAzureAuth;
    let providerSettings: IProviderSettings;
    let account: IAccount;
    let accountInfo: AccountInfo;
    let settings: IAADResource;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockLogger = sandbox.createStubInstance(Logger);

        mockTokenCache = {
            removeAccount: sandbox.stub().resolves(),
        };

        mockClientApplication = {
            acquireTokenSilent: sandbox.stub(),
            getTokenCache: sandbox.stub().returns(mockTokenCache),
        } as unknown as PublicClientApplication;

        providerSettings = {
            scopes: ["https://management.azure.com/.default"],
            displayName: "Azure",
            id: "azure",
            clientId: "client-id",
            loginEndpoint: "https://login.microsoftonline.com/",
            portalEndpoint: "https://portal.azure.com/",
            redirectUri: "http://localhost",
            settings: {
                windowsManagementResource: {
                    id: "windows-management",
                    resource: "https://management.core.windows.net/",
                    endpoint: "https://management.core.windows.net/",
                },
                armResource: {
                    id: "arm",
                    resource: "https://management.azure.com/",
                    endpoint: "https://management.azure.com/",
                },
            },
            fabric: {
                fabricApiUriBase: "",
                fabricScopeUriBase: "",
                sqlDbDnsSuffix: "",
                dataWarehouseDnsSuffix: "",
            },
            dataverse: {
                dynamicsCrmDnsSuffix: "",
            },
        };

        account = {
            key: {
                id: "home.account.id",
                providerId: "azure",
                accountVersion: "2.0",
            },
            displayInfo: {
                displayName: "Test User",
                accountType: AccountType.WorkSchool,
                userId: "test.user@contoso.com",
                email: "test.user@contoso.com",
                name: "Test User",
            },
            properties: {
                azureAuthType: AzureAuthType.AuthCodeGrant,
                providerSettings,
                isMsAccount: false,
                owningTenant: {
                    id: "tenant-id",
                    displayName: "Tenant",
                },
                tenants: [],
            },
            isStale: false,
        };

        accountInfo = {
            homeAccountId: "home.account.id",
            environment: "login.microsoftonline.com",
            tenantId: "tenant-id",
            username: "test.user@contoso.com",
            localAccountId: "local-account-id",
            name: "Test User",
        };

        settings = {
            id: "sql",
            resource: "https://database.windows.net/",
            endpoint: "https://database.windows.net/",
        };

        auth = new TestMsalAzureAuth(
            providerSettings,
            {} as vscode.ExtensionContext,
            mockClientApplication,
            AzureAuthType.AuthCodeGrant,
            {} as VscodeWrapper,
            mockLogger,
        );

        sandbox.stub(auth, "getAccountFromMsalCache").resolves(accountInfo);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("clears cached account before interactive reauthentication when refresh token is expired", async () => {
        const acquireTokenSilent =
            mockClientApplication.acquireTokenSilent as unknown as sinon.SinonStub;
        const interactionResult = {} as AuthenticationResult;
        acquireTokenSilent.rejects(
            new ServerError(
                "invalid_grant",
                `Error(s): 70043 - Description: ${Constants.AADSTS70043}: Refresh token expired.`,
                "token_expired",
                "70043",
            ),
        );

        const handleInteractionRequired = sandbox
            .stub(auth, "handleInteractionRequired")
            .resolves(interactionResult);

        await auth.getToken(account, "tenant-id", settings);

        expect(mockTokenCache.removeAccount).to.have.been.calledOnceWithExactly(accountInfo);
        expect(handleInteractionRequired).to.have.been.calledOnceWithExactly(
            { id: "tenant-id", displayName: "" },
            settings,
        );
        sinon.assert.callOrder(mockTokenCache.removeAccount, handleInteractionRequired);
    });

    test("does not clear cached account for generic interaction-required errors", async () => {
        const acquireTokenSilent =
            mockClientApplication.acquireTokenSilent as unknown as sinon.SinonStub;
        const interactionResult = {} as AuthenticationResult;
        acquireTokenSilent.rejects(
            new InteractionRequiredAuthError(
                "interaction_required",
                "claims challenge required",
                "basic_action",
            ),
        );

        const handleInteractionRequired = sandbox
            .stub(auth, "handleInteractionRequired")
            .resolves(interactionResult);

        await auth.getToken(account, "tenant-id", settings);

        expect(mockTokenCache.removeAccount).to.not.have.been.called;
        expect(handleInteractionRequired).to.have.been.calledOnceWithExactly(
            { id: "tenant-id", displayName: "" },
            settings,
        );
    });
});
