/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { AzureAccountService } from "../../src/services/azureAccountService";
import * as sinon from "sinon";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import { ILogger } from "../../src/models/logger";
import { IAccount } from "vscode-mssql";
import * as vscode from "vscode";
import * as armStorage from "@azure/arm-storage";
import {
    mockAccounts,
    mockSqlDbList,
    mockAzureResources,
    mockManagedInstanceList,
    mockSubscriptions,
    mockTenants,
} from "./azureHelperStubs";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import * as utils from "../../src/utils/utils";
import { BlobServiceClient } from "@azure/storage-blob";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

suite("Azure Helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockAzureAccountService: AzureAccountService;
    let mockLogger: sinon.SinonStubbedInstance<ILogger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockAzureAccountService = sandbox.createStubInstance(AzureAccountService);
        mockLogger = createStubLogger(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("VsCodeAzureHelpers", () => {
        test("getAccounts", async () => {
            sandbox
                .stub(vscode.authentication, "getAccounts")
                .resolves([mockAccounts.signedInAccount, mockAccounts.notSignedInAccount]);

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getTenants: (account) => {
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(mockTenants);
                    }
                    return Promise.reject("Not signed in");
                },
            } as unknown as VSCodeAzureSubscriptionProvider);

            const accounts = await azureHelpers.VsCodeAzureHelper.getAccounts(
                true /* onlyAllowedForExtension */,
            );

            expect(accounts, "Only signed-in accounts should be returned").to.deep.equal([
                mockAccounts.signedInAccount,
            ]);
        });

        test("signIn", async () => {
            const signInStub = sandbox.stub().resolves(true);
            const isSignedInStub = sandbox.stub();

            const mockAuthProvider = {
                signIn: signInStub,
                isSignedIn: isSignedInStub,
            };
            sandbox
                .stub(azureHelpers.VsCodeAzureHelper, "getProvider")
                .returns(mockAuthProvider as unknown as VSCodeAzureSubscriptionProvider);

            // Stub getAccounts so signIn can diff before/after to identify the new account
            const getAccountsStub = sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccounts");

            // Case: user should be prompted to sign in when not already signed in
            isSignedInStub.resolves(false);
            getAccountsStub.onFirstCall().resolves([]);
            getAccountsStub.onSecondCall().resolves([mockAccounts.signedInAccount]);

            let result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.auth).to.equal(mockAuthProvider);
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the newly added account",
            );
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should not be prompted to sign in when already signed in
            signInStub.resetHistory();
            isSignedInStub.reset();
            getAccountsStub.reset();
            isSignedInStub.resolves(true);
            getAccountsStub.resolves([mockAccounts.signedInAccount]);

            result = await azureHelpers.VsCodeAzureHelper.signIn(false /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.auth).to.equal(mockAuthProvider);
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the first existing account",
            );
            expect(signInStub.notCalled, "signIn should not be called").to.be.true;
            expect(isSignedInStub.calledOnce, "isSignedIn should be called once").to.be.true;

            // Case: user should be prompted to sign in when forceSignInPrompt is true
            signInStub.resetHistory();
            isSignedInStub.reset();
            getAccountsStub.reset();
            getAccountsStub.onFirstCall().resolves([]);
            getAccountsStub.onSecondCall().resolves([mockAccounts.signedInAccount]);

            result = await azureHelpers.VsCodeAzureHelper.signIn(true /* forceSignInPrompt */);

            expect(result).to.not.be.undefined;
            expect(result!.newAccountId).to.equal(
                mockAccounts.signedInAccount.id,
                "accountId should be the newly added account",
            );
            expect(signInStub.calledOnce, "signIn should be called once").to.be.true;
            expect(
                isSignedInStub.notCalled,
                "isSignedIn should not be called because the prompt is being forced",
            ).to.be.true;
        });

        test("getTenantsForAccount", async () => {
            const account = mockAccounts.signedInAccount;

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getTenants: (account) => {
                    // only the first account is signed in for this mock
                    if (account.id === mockAccounts.signedInAccount.id) {
                        return Promise.resolve(
                            mockTenants.filter((t) => t.account.id === account.id),
                        );
                    }
                    return Promise.reject("Not signed in");
                },
            } as unknown as VSCodeAzureSubscriptionProvider);

            const tenants = await azureHelpers.VsCodeAzureHelper.getTenantsForAccount(account);
            expect(tenants).to.deep.equal([mockTenants[1], mockTenants[0]]); // Tenants are returned alphabetically
        });

        test("getSubscriptionsForTenant", async () => {
            const tenant = mockTenants[0];

            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getProvider").returns({
                getSubscriptions: () => Promise.resolve(mockSubscriptions),
            } as unknown as VSCodeAzureSubscriptionProvider);

            const subscriptions =
                await azureHelpers.VsCodeAzureHelper.getSubscriptionsForTenant(tenant);
            expect(subscriptions).to.have.lengthOf(1);
            expect(subscriptions[0].name).to.equal(mockSubscriptions[0].name);
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
            .stub(azureHelpers.VsCodeAzureHelper, "fetchSqlResourcesForSubscription")
            .callsFake(async (sub, listServers /*, listDatabasesFactory */) => {
                const fnText = String(listServers);
                if (fnText.includes("managedInstances")) {
                    return mockManagedInstanceList;
                } else {
                    return mockSqlDbList;
                }
            });

        const servers = await azureHelpers.VsCodeAzureHelper.fetchServersFromAzure(
            mockSubscriptions[0],
        );

        expect(servers).to.have.lengthOf(4); // 1 SQL DB servers + 1 Synapse + 2 MI servers (public and private endpoints)
        expect(servers[0].displayName).to.equal(mockAzureResources.azureSqlDbServer.name);
        expect(servers[0].databases).to.deep.equal(["master", "testDatabase"]);
        expect(servers[1].displayName).to.equal(
            mockAzureResources.azureSynapseAnalyticsServer.name,
        );
        expect(servers[1].type).to.equal("AzureSynapseAnalytics");
        expect(servers[1].server).to.equal(
            `${mockAzureResources.azureSynapseAnalyticsServer.name}.sql.azuresynapse.net`,
        );
        const managedInstances = servers.filter((s) =>
            s.displayName.startsWith(mockAzureResources.azureManagedInstance.name),
        );

        expect(managedInstances).to.have.lengthOf(2);
        expect(managedInstances[0].displayName).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Private)`,
        );
        expect(managedInstances[0].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[0].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net`,
        );

        expect(managedInstances[1].displayName).to.equal(
            `${mockAzureResources.azureManagedInstance.name} (Public)`,
        );
        expect(managedInstances[1].databases).to.deep.equal(["managedInstanceDb"]);
        expect(managedInstances[1].server).to.equal(
            `${mockAzureResources.azureManagedInstance.name}.public.${mockAzureResources.azureManagedInstance.dnsZone}.database.windows.net,${azureHelpers.MANAGED_INSTANCE_PUBLIC_PORT}`,
        );
    });

    test("fetchSqlResourcesForSubscription", async () => {
        const listServersFactory = sandbox.stub().callsFake(
            () =>
                async function* () {
                    yield mockAzureResources.azureSqlDbServer;
                } as unknown as any,
        );

        const listDatabasesFactory = sandbox.stub().callsFake(
            () =>
                async function* (_resourceGroup?: string, _serverName?: string) {
                    yield mockAzureResources.azureSqlDbDatabase1;
                    yield mockAzureResources.azureSqlDbDatabase2;
                } as unknown as any,
        );

        const result = await azureHelpers.VsCodeAzureHelper.fetchSqlResourcesForSubscription(
            mockSubscriptions[0],
            listServersFactory,
            listDatabasesFactory,
        );

        const expectedResult = {
            servers: [mockAzureResources.azureSqlDbServer],
            databases: [
                {
                    ...mockAzureResources.azureSqlDbDatabase1,
                    server: mockAzureResources.azureSqlDbServer.name,
                },
                {
                    ...mockAzureResources.azureSqlDbDatabase2,
                    server: mockAzureResources.azureSqlDbServer.name,
                },
            ],
        };

        expect(result).to.deep.equal(expectedResult);
        expect(listServersFactory).to.have.been.calledOnce;
        expect(listDatabasesFactory).to.have.been.calledOnce;
    });

    test("fetchStorageAccountsForSubscription", async () => {
        const mockAccounts = [mockAzureResources.storageAccount];

        const clientStub = {
            storageAccounts: {
                list: sinon.stub().resolves(mockAccounts),
            },
        };

        const listStub = sandbox.stub(utils, "listAllIterator").callsFake((input) => input as any);

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        let result = await azureHelpers.VsCodeAzureHelper.fetchStorageAccountsForSubscription(
            mockSubscriptions[0],
            clientStub as unknown as armStorage.StorageManagementClient,
        );

        expect(result).to.deep.equal(mockAccounts);
        expect(listStub.calledOnce, "listAllIterator should be called once").to.be.true;
        expect(
            clientStub.storageAccounts.list.calledOnce,
            "storageAccounts.list should be called once",
        ).to.be.true;

        clientStub.storageAccounts.list = sinon.stub().rejects(new Error("Test error"));

        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchStorageAccountsForSubscription(
                mockSubscriptions[0],
                clientStub as unknown as armStorage.StorageManagementClient,
            );
            expect.fail("Expected fetchStorageAccountsForSubscription to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    test("fetchBlobContainersForStorageAccount", async () => {
        const mockBlobs = [mockAzureResources.blobContainer];

        const clientStub = {
            blobContainers: {
                list: sinon.stub().resolves(mockBlobs),
            },
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        const listStub = sandbox.stub(utils, "listAllIterator").callsFake((input) => input as any);

        let result = await azureHelpers.VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            clientStub as unknown as armStorage.StorageManagementClient,
        );

        expect(result).to.deep.equal([mockAzureResources.blobContainer]);
        expect(listStub.calledOnce, "listAllIterator should be called once").to.be.true;
        expect(
            clientStub.blobContainers.list.calledOnce,
            "blobContainers.list should be called once",
        ).to.be.true;

        clientStub.blobContainers.list = sinon.stub().rejects(new Error("Test error"));
        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchBlobContainersForStorageAccount(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                clientStub as unknown as armStorage.StorageManagementClient,
            );
            expect.fail("Expected fetchBlobContainersForStorageAccount to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    test("getStorageAccountKeys", async () => {
        const mockKeys: armStorage.StorageAccountKey[] = [
            { keyName: "key1", value: "value1" },
            { keyName: "key2", value: "value2" },
        ];

        const clientStub = {
            storageAccounts: {
                listKeys: sinon
                    .stub()
                    .resolves({ keys: mockKeys } as armStorage.StorageAccountsListKeysResponse),
            },
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(armStorage, "StorageManagementClient").callsFake(() => clientStub);

        let result = (await azureHelpers.VsCodeAzureHelper.getStorageAccountKeys(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            clientStub as unknown as armStorage.StorageManagementClient,
        )) as armStorage.StorageAccountsListKeysResponse;

        expect(result.keys).to.deep.equal(mockKeys);
        expect(
            clientStub.storageAccounts.listKeys.calledOnce,
            "storageAccounts.listKeys should be called once",
        ).to.be.true;

        clientStub.storageAccounts.listKeys = sinon.stub().rejects(new Error("Test error"));

        try {
            result = (await azureHelpers.VsCodeAzureHelper.getStorageAccountKeys(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                clientStub as unknown as armStorage.StorageManagementClient,
            )) as armStorage.StorageAccountsListKeysResponse;
            expect.fail("Expected getStorageAccountKeys to throw");
        } catch (e) {
            expect(e.message).to.equal("Test error");
        }
    });

    suite("getDefaultTenantId", () => {
        test("should return empty string when accountId is empty", () => {
            const result = azureHelpers.getDefaultTenantId("", mockTenants);
            expect(result).to.equal("");
        });

        test("should return empty string when tenants array is empty", () => {
            const result = azureHelpers.getDefaultTenantId("some-account.some-tenant", []);
            expect(result).to.equal("");
        });

        test("should return home tenant ID when it matches a tenant in the list", () => {
            const accountId = `someAccountPart.${mockTenants[0].tenantId}`;
            const result = azureHelpers.getDefaultTenantId(accountId, mockTenants);
            expect(result).to.equal(mockTenants[0].tenantId);
        });

        test("should return first tenant ID when home tenant is not in the list", () => {
            const accountId = "someAccountPart.non-existent-tenant-id";
            const result = azureHelpers.getDefaultTenantId(accountId, mockTenants);
            expect(result).to.equal(mockTenants[0].tenantId);
        });

        test("should return first tenant ID when accountId has no dot separator", () => {
            const accountId = "no-dot-account";
            const result = azureHelpers.getDefaultTenantId(accountId, mockTenants);
            expect(result).to.equal(mockTenants[0].tenantId);
        });
    });

    suite("getHomeTenantIdForAccount", () => {
        test("should extract tenant ID from account ID string with dot separator", () => {
            const result =
                azureHelpers.VsCodeAzureHelper.getHomeTenantIdForAccount("accountPart.tenantPart");
            expect(result).to.equal("tenantPart");
        });

        test("should extract tenant ID from AuthenticationSessionAccountInformation", () => {
            const result = azureHelpers.VsCodeAzureHelper.getHomeTenantIdForAccount(
                mockAccounts.signedInAccount,
            );
            expect(result).to.equal("11111111-1111-1111-1111-111111111111");
        });

        test("should return undefined when account ID has no dot separator", () => {
            const result =
                azureHelpers.VsCodeAzureHelper.getHomeTenantIdForAccount("no-dot-account");
            expect(result).to.be.undefined;
        });

        test("should return undefined when account ID is empty", () => {
            const result = azureHelpers.VsCodeAzureHelper.getHomeTenantIdForAccount("");
            expect(result).to.be.undefined;
        });
    });

    suite("getAccountObjectId", () => {
        test("should extract OID from a valid JWT access token", async () => {
            const tokenPayload = { oid: "test-object-id-123", sub: "subject" };
            const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString("base64");
            const mockToken = `header.${encodedPayload}.signature`;

            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().resolves({ accessToken: mockToken }),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result = await azureHelpers.VsCodeAzureHelper.getAccountObjectId(
                mockSubscription,
                { id: "fallback-id.tenant" },
            );
            expect(result).to.equal("test-object-id-123");
        });

        test("should handle base64url-encoded token payload", async () => {
            const tokenPayload = { oid: "url-safe-oid" };
            const encodedPayload = Buffer.from(JSON.stringify(tokenPayload))
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_");
            const mockToken = `header.${encodedPayload}.signature`;

            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().resolves({ accessToken: mockToken }),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result = await azureHelpers.VsCodeAzureHelper.getAccountObjectId(
                mockSubscription,
                { id: "fallback.tenant" },
            );
            expect(result).to.equal("url-safe-oid");
        });

        test("should fall back to account ID first segment when token decode fails", async () => {
            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().rejects(new Error("session error")),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result = await azureHelpers.VsCodeAzureHelper.getAccountObjectId(
                mockSubscription,
                { id: "fallback-oid.tenant-id" },
            );
            expect(result).to.equal("fallback-oid");
        });

        test("should fall back when access token has no OID claim", async () => {
            const tokenPayload = { sub: "subject-only" };
            const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString("base64");
            const mockToken = `header.${encodedPayload}.signature`;

            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().resolves({ accessToken: mockToken }),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result = await azureHelpers.VsCodeAzureHelper.getAccountObjectId(
                mockSubscription,
                { id: "fallback-oid.tenant-id" },
            );
            expect(result).to.equal("fallback-oid");
        });

        test("should return undefined when no account is provided and token fails", async () => {
            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().rejects(new Error("fail")),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result =
                await azureHelpers.VsCodeAzureHelper.getAccountObjectId(mockSubscription);
            expect(result).to.be.undefined;
        });

        test("should fall back when session returns null access token", async () => {
            const mockSubscription = {
                ...mockSubscriptions[0],
                authentication: {
                    getSession: sandbox.stub().resolves({ accessToken: null }),
                },
            } as unknown as import("@microsoft/vscode-azext-azureauth").AzureSubscription;

            const result = await azureHelpers.VsCodeAzureHelper.getAccountObjectId(
                mockSubscription,
                { id: "fallback-oid.tenant" },
            );
            expect(result).to.equal("fallback-oid");
        });
    });

    suite("getAccounts (standalone)", () => {
        test("should return mapped account options on success", async () => {
            const mockAccountService = sandbox.createStubInstance(AzureAccountService);
            (mockAccountService.getAccounts as sinon.SinonStub).resolves([
                {
                    displayInfo: { displayName: "Account 1" },
                    key: { id: "acct-1" },
                },
                {
                    displayInfo: { displayName: "Account 2" },
                    key: { id: "acct-2" },
                },
            ]);

            const result = await azureHelpers.getAccounts(mockAccountService, mockLogger);

            expect(result).to.have.lengthOf(2);
            expect(result[0]).to.deep.equal({ displayName: "Account 1", value: "acct-1" });
            expect(result[1]).to.deep.equal({ displayName: "Account 2", value: "acct-2" });
        });

        test("should return empty array and log error on failure", async () => {
            sandbox.stub(require("../../src/telemetry/telemetry"), "sendErrorEvent");
            const mockAccountService = sandbox.createStubInstance(AzureAccountService);
            (mockAccountService.getAccounts as sinon.SinonStub).rejects(
                new Error("Service unavailable"),
            );

            const result = await azureHelpers.getAccounts(mockAccountService, mockLogger);

            expect(result).to.be.an("array").that.is.empty;
            expect(mockLogger.error).to.have.been.calledWithMatch("Error loading Azure accounts");
        });
    });

    suite("getTenants", () => {
        test("should return empty array when accountId is empty", async () => {
            const result = await azureHelpers.getTenants(mockAzureAccountService, "", mockLogger);
            expect(result).to.be.an("array").that.is.empty;
            expect(mockLogger.error).to.have.been.calledWithMatch("undefined accountId");
        });

        test("should return mapped tenant options on success", async () => {
            (mockAzureAccountService.getAccount as sinon.SinonStub).resolves({
                displayInfo: { userId: "test-user" },
                properties: {
                    tenants: [
                        { displayName: "Tenant A", id: "tid-a" },
                        { displayName: "Tenant B", id: "tid-b" },
                    ],
                },
            });

            const result = await azureHelpers.getTenants(
                mockAzureAccountService,
                "test-user",
                mockLogger,
            );

            expect(result).to.have.lengthOf(2);
            expect(result[0]).to.deep.equal({
                displayName: "Tenant A (tid-a)",
                value: "tid-a",
            });
            expect(result[1]).to.deep.equal({
                displayName: "Tenant B (tid-b)",
                value: "tid-b",
            });
        });

        test("should return empty array when getAccount throws", async () => {
            sandbox.stub(require("../../src/telemetry/telemetry"), "sendErrorEvent");
            (mockAzureAccountService.getAccount as sinon.SinonStub).rejects(
                new Error("Network error"),
            );

            const result = await azureHelpers.getTenants(
                mockAzureAccountService,
                "test-user",
                mockLogger,
            );

            expect(result).to.be.an("array").that.is.empty;
            expect(mockLogger.error).to.have.been.calledWithMatch("Error loading Azure tenants");
        });

        test("should return empty array when account is undefined", async () => {
            sandbox.stub(require("../../src/telemetry/telemetry"), "sendErrorEvent");
            (mockAzureAccountService.getAccount as sinon.SinonStub).resolves(undefined);

            const result = await azureHelpers.getTenants(
                mockAzureAccountService,
                "test-user",
                mockLogger,
            );

            expect(result).to.be.an("array").that.is.empty;
            expect(mockLogger.error).to.have.been.calledWithMatch("undefined account");
        });
    });

    test("fetchBlobsForContainer", async () => {
        const mockBlobs = [mockAzureResources.blob];

        const listBlobsFlatStub = sinon.stub().returns({
            [Symbol.asyncIterator]: async function* () {
                for (const blob of mockBlobs) {
                    yield blob;
                }
            },
        });

        const containerClientStub = {
            listBlobsFlat: listBlobsFlatStub,
        };

        const clientStub = {
            getContainerClient: sinon.stub().returns(containerClientStub),
        };

        // Stub the class constructor to return your stub instance
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getStorageAccountKeys").resolves({
            keys: [{ keyName: "key1", value: "value1" }],
        } as armStorage.StorageAccountsListKeysResponse);

        let result = await azureHelpers.VsCodeAzureHelper.fetchBlobsForContainer(
            mockSubscriptions[0],
            mockAzureResources.storageAccount,
            mockAzureResources.blobContainer,
            clientStub as unknown as BlobServiceClient,
        );

        expect(result).to.deep.equal(mockBlobs);
        expect(
            clientStub.getContainerClient().listBlobsFlat.calledOnce,
            "listBlobsFlat should be called once",
        ).to.be.true;

        const testError = new Error("Test error");
        clientStub.getContainerClient().listBlobsFlat = sinon.stub().returns({
            [Symbol.asyncIterator]: async function* () {
                throw testError;
            },
        });

        try {
            result = await azureHelpers.VsCodeAzureHelper.fetchBlobsForContainer(
                mockSubscriptions[0],
                mockAzureResources.storageAccount,
                mockAzureResources.blobContainer,
                clientStub as unknown as BlobServiceClient,
            );
            expect.fail("Expected fetchBlobsForContainer to throw");
        } catch (e) {
            expect(e).to.equal(testError);
        }
    });
});
