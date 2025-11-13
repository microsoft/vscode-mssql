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
import {
    mockAccounts,
    mockAzureResourceList,
    mockAzureResources,
    mockSubscriptions,
    mockTenants,
} from "./azureHelperStubs";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";
import { GenericResourceExpanded } from "@azure/arm-resources";
import { ConnectionDialogWebviewState } from "../../src/sharedInterfaces/connectionDialog";

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
        const getAccountStub = mockAzureAccountService.getAccount as sinon.SinonStub;
        // undefined tenants
        getAccountStub.resolves({
            displayInfo: {
                userId: "test-user-id",
            },
            properties: {
                tenants: undefined,
            },
        } as IAccount);

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
        getAccountStub.reset();
        (mockLogger.error as sinon.SinonStub).resetHistory();

        // undefined properties
        getAccountStub.resolves({
            displayInfo: {
                userId: "test-user-id",
            },
            properties: undefined,
        } as IAccount);

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

    test("fetchServersFromAzure", async () => {
        sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "fetchResourcesForSubscription")
            .resolves(mockAzureResourceList);

        const servers = await azureHelpers.VsCodeAzureHelper.fetchServersFromAzure(
            mockSubscriptions[0],
        );

        expect(servers).to.have.lengthOf(2);
        expect(servers[0].server).to.equal(mockAzureResources.azureSqlDbServer.name);
        expect(servers[0].databases).to.deep.equal(["master", "testDatabase"]);
        expect(servers[1].server).to.equal(mockAzureResources.azureSynapseAnalyticsServer.name);
    });

    test("buildServerUri", () => {
        const serverResource = {
            name: "test-server",
            kind: "v12",
        } as GenericResourceExpanded;

        // Case: Azure SQL DB server
        const uri = azureHelpers.buildServerUri(serverResource);
        expect(uri).to.equal(
            "test-server.database.windows.net",
            "Expected URI for Azure SQL DB is incorrect",
        );

        // Case: Azure Synapse server
        serverResource.kind = "v12,analytics";
        const analyticsUri = azureHelpers.buildServerUri(serverResource);
        expect(analyticsUri).to.equal(
            "test-server.sql.azuresynapse.net",
            "Expected URI for Azure Synapse is incorrect",
        );
    });

    suite("getSubscriptionQuickPickItems", () => {
        test("creates pick items with account-based composite keys", async () => {
            const mockAuth = {
                getSubscriptions: sandbox.stub().resolves([
                    {
                        name: "Subscription 1",
                        subscriptionId: "sub-id-1",
                        tenantId: "tenant-id-1",
                        account: { label: "user1@example.com" },
                    },
                    {
                        name: "Subscription 2",
                        subscriptionId: "sub-id-2",
                        tenantId: "tenant-id-2",
                        account: { label: "user2@example.com" },
                    },
                ]),
            } as unknown as MssqlVSCodeAzureSubscriptionProvider;

            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(undefined),
            } as unknown as vscode.WorkspaceConfiguration);

            const items = await azureHelpers.getSubscriptionQuickPickItems(mockAuth);

            // Expected: 2 separators (for user1 and user2 groups) + 2 subscriptions = 4 items
            expect(items).to.have.lengthOf(4);

            // Find the actual subscription items (not separators)
            const subscriptionItems = items.filter((i) => i.description !== undefined);
            expect(subscriptionItems).to.have.lengthOf(2);

            expect(subscriptionItems[0].label).to.equal("Subscription 1");
            expect(subscriptionItems[0].description).to.equal("sub-id-1 (user1@example.com)");
            expect(subscriptionItems[0].tenantId).to.equal("tenant-id-1");
            expect(subscriptionItems[0].subscriptionId).to.equal("sub-id-1");
            expect(subscriptionItems[0].group).to.equal("user1@example.com");
            expect(subscriptionItems[0].picked).to.be.true; // Default when no filter config exists
        });

        test("respects previous selection with account-based composite keys", async () => {
            const mockAuth = {
                getSubscriptions: sandbox.stub().resolves([
                    {
                        name: "Shared Subscription",
                        subscriptionId: "shared-sub-id",
                        tenantId: "shared-tenant-id",
                        account: { label: "user1@example.com" },
                    },
                    {
                        name: "Shared Subscription",
                        subscriptionId: "shared-sub-id",
                        tenantId: "shared-tenant-id",
                        account: { label: "user2@example.com" },
                    },
                ]),
            } as unknown as MssqlVSCodeAzureSubscriptionProvider;

            // Only user1's instance should be selected
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(["user1@example.com/shared-tenant-id/shared-sub-id"]),
            } as unknown as vscode.WorkspaceConfiguration);

            const items = await azureHelpers.getSubscriptionQuickPickItems(mockAuth);

            // Expected: 2 separators (for user1 and user2 groups) + 2 subscriptions = 4 items
            expect(items).to.have.lengthOf(4);

            // Find the actual subscription items (not separators)
            const subscriptionItems = items.filter((i) => i.description !== undefined);

            // user1@example.com instance should be picked
            const user1Item = subscriptionItems.find((i) => i.group === "user1@example.com");
            expect(user1Item?.picked).to.be.true;

            // user2@example.com instance should NOT be picked
            const user2Item = subscriptionItems.find((i) => i.group === "user2@example.com");
            expect(user2Item?.picked).to.be.false;
        });

        test("handles complex email addresses in composite keys", async () => {
            const mockAuth = {
                getSubscriptions: sandbox.stub().resolves([
                    {
                        name: "Test Subscription",
                        subscriptionId: "sub-id",
                        tenantId: "tenant-id",
                        account: { label: "user+tag@sub.domain.com" },
                    },
                ]),
            } as unknown as MssqlVSCodeAzureSubscriptionProvider;

            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns(["user+tag@sub.domain.com/tenant-id/sub-id"]),
            } as unknown as vscode.WorkspaceConfiguration);

            const items = await azureHelpers.getSubscriptionQuickPickItems(mockAuth);

            // Expected: 1 separator (for user+tag@sub.domain.com group) + 1 subscription = 2 items
            expect(items).to.have.lengthOf(2);

            // Find the actual subscription item (not separator)
            const subscriptionItems = items.filter((i) => i.description !== undefined);
            expect(subscriptionItems).to.have.lengthOf(1);
            expect(subscriptionItems[0].group).to.equal("user+tag@sub.domain.com");
            expect(subscriptionItems[0].picked).to.be.true;
        });
    });

    suite("promptForAzureSubscriptionFilter", () => {
        let mockState: Partial<ConnectionDialogWebviewState>;
        let showQuickPickStub: sinon.SinonStub;
        let updateConfigStub: sinon.SinonStub;

        setup(() => {
            mockState = {
                formMessage: undefined,
            };

            showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
            updateConfigStub = sandbox.stub();

            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().returns([]),
                update: updateConfigStub,
            } as unknown as vscode.WorkspaceConfiguration);

            const mockAuth = {
                getSubscriptions: sandbox.stub().resolves([
                    {
                        name: "Test Subscription",
                        subscriptionId: "sub-id-1",
                        tenantId: "tenant-id-1",
                        account: { label: "user@example.com" },
                    },
                ]),
            } as unknown as MssqlVSCodeAzureSubscriptionProvider;

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "signIn").resolves(mockAuth);
        });

        test("returns false when user cancels selection", async () => {
            showQuickPickStub.resolves(undefined);

            const result = await azureHelpers.promptForAzureSubscriptionFilter(
                mockState as ConnectionDialogWebviewState,
                mockLogger,
            );

            expect(result).to.be.false;
            expect(updateConfigStub.called).to.be.false;
        });

        test("returns true and updates config when user selects subscriptions", async () => {
            const selectedItems = [
                {
                    label: "Test Subscription",
                    group: "user@example.com",
                    tenantId: "tenant-id-1",
                    subscriptionId: "sub-id-1",
                },
            ];
            showQuickPickStub.resolves(selectedItems);

            const result = await azureHelpers.promptForAzureSubscriptionFilter(
                mockState as ConnectionDialogWebviewState,
                mockLogger,
            );

            expect(result).to.be.true;
            expect(updateConfigStub.calledOnce).to.be.true;
            expect(
                updateConfigStub.calledWith(
                    "mssql.selectedAzureSubscriptions",
                    ["user@example.com/tenant-id-1/sub-id-1"],
                    vscode.ConfigurationTarget.Global,
                ),
            ).to.be.true;
        });

        test("returns false and sets error message on exception", async () => {
            showQuickPickStub.rejects(new Error("Test error"));

            const result = await azureHelpers.promptForAzureSubscriptionFilter(
                mockState as ConnectionDialogWebviewState,
                mockLogger,
            );

            expect(result).to.be.false;
            expect(mockState.formMessage).to.not.be.undefined;
            expect(mockState.formMessage!.message).to.contain("Error loading Azure subscriptions");
            expect((mockLogger.error as sinon.SinonStub).called).to.be.true;
        });
    });
});
