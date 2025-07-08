/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { AzureAccountService } from "../../src/services/azureAccountService";
import * as sinon from "sinon";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import { Logger } from "../../src/models/logger";
import { IAccount } from "vscode-mssql";
import * as vscode from "vscode";
import { mockAccounts, mockSubscriptions, mockTenants } from "./azureHelperStubs";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";

suite("Azure Helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockAzureAccountService: AzureAccountService;
    let mockLogger: Logger;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockAzureAccountService = sandbox.createStubInstance(AzureAccountService);
        mockLogger = sandbox.createStubInstance(Logger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("VsCodeAzureHelpers", () => {
        test("getAccounts", async () => {
            sandbox.stub(vscode.authentication, "getAccounts").resolves([
                ...mockAccounts,
                {
                    id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                    label: "notSignedIn@notSignedInDomain.com",
                },
            ]);

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getTenants: (account) => {
                    if (account.id === mockAccounts[0].id) {
                        return Promise.resolve(mockTenants);
                    }
                    return Promise.reject("Not signed in");
                },
            } as MssqlVSCodeAzureSubscriptionProvider);

            const accounts = await azureHelpers.VsCodeAzureHelper.getAccounts(
                true /* onlyAllowedForExtension */,
            );

            expect(accounts, "Only signed-in accounts should be returned").to.deep.equal(
                mockAccounts,
            );
        });

        test("signIn", async () => {
            const signInStub = sandbox.stub().resolves(true);
            const isSignedInStub = sandbox.stub();

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                signIn: signInStub,
                isSignedIn: isSignedInStub,
            } as unknown as MssqlVSCodeAzureSubscriptionProvider);

            // Case: user should be prompted to sign in when not already signed in
            isSignedInStub.resolves(false);
            let result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should not be prompted to sign in when already signed in
            signInStub.resetHistory();
            isSignedInStub.reset();
            isSignedInStub.resolves(true);

            result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.notCalled, "signIn should not be called").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should be prompted to sign in when forceSignInPrompt is true
            signInStub.resetHistory();
            isSignedInStub.reset();
            isSignedInStub.resolves(false);

            result = await azureHelpers.VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(
                isSignedInStub.notCalled,
                "isSignedIn should not be called because the prompt is being forced",
            ).to.be.true;
        });

        test("getTenantsForAccount", async () => {
            const account = mockAccounts[0];

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getTenants: (account) => {
                    // only the first account is signed in for this mock
                    if (account.id === mockAccounts[0].id) {
                        return Promise.resolve(
                            mockTenants.filter((t) => t.account.id === account.id),
                        );
                    }
                    return Promise.reject("Not signed in");
                },
            } as MssqlVSCodeAzureSubscriptionProvider);

            const tenants = await azureHelpers.VsCodeAzureHelper.getTenantsForAccount(account);
            expect(tenants).to.deep.equal([mockTenants[1], mockTenants[0]]); // Tenants are returned alphabetically
        });

        test("getSubscriptionsForTenant", async () => {
            const tenant = mockTenants[0];

            sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
                getSubscriptions: () => Promise.resolve(mockSubscriptions),
            } as MssqlVSCodeAzureSubscriptionProvider);

            const subscriptions =
                await azureHelpers.VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
            expect(subscriptions).to.have.lengthOf(1);
            expect(subscriptions[0].displayName).to.equal(mockSubscriptions[0].name);
        });
    });

    test("getTenants handles error cases", async () => {
        const getAccountsStub = mockAzureAccountService.getAccounts as sinon.SinonStub;
        // undefined tenants
        getAccountsStub.resolves([
            {
                displayInfo: {
                    userId: "test-user-id",
                },
                properties: {
                    tenants: undefined,
                },
            } as IAccount,
        ]);

        let result = await azureHelpers.getTenants(
            mockAzureAccountService,
            "test-user-id",
            mockLogger,
        );
        expect(result).to.be.an("array").that.is.empty;
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined tenants"),
            "logger should have been called with 'undefined tenants'",
        ).to.be.true;

        // reset mocks for next case
        getAccountsStub.reset();
        (mockLogger.error as sinon.SinonStub).resetHistory();

        // undefined properties
        getAccountsStub.resolves([
            {
                displayInfo: {
                    userId: "test-user-id",
                },
                properties: undefined,
            } as IAccount,
        ]);

        result = await azureHelpers.getTenants(mockAzureAccountService, "test-user-id", mockLogger);
        expect(result).to.be.an("array").that.is.empty;
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined properties"),
            "logger should have been called with 'undefined properties'",
        ).to.be.true;
    });

    test("extractFromResourceId", () => {
        const resourceId =
            "subscriptions/test-subscription/resourceGroups/test-resource-group/providers/Microsoft.Sql/servers/test-server/databases/test-database";
        let result = azureHelpers.extractFromResourceId(resourceId, "servers");
        expect(result).to.equal("test-server");

        result = azureHelpers.extractFromResourceId(resourceId, "databases");
        expect(result).to.equal("test-database");

        result = azureHelpers.extractFromResourceId(resourceId, "fakeProperty");
        expect(result).to.be.undefined;
    });
});
