/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import { AzureAuthType, IAccount } from "../../src/models/contracts/azure";
import {
    SubscriptionClient,
    Subscription,
    Subscriptions,
    Location,
} from "@azure/arm-subscriptions";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import { ResourceGroup, ResourceGroups, ResourceManagementClient } from "@azure/arm-resources";
import { AzureResourceController } from "../../src/azure/azureResourceController";
import { AzureAccountService } from "../../src/services/azureAccountService";
import allSettings from "../../src/azure/providerSettings";
import { IAzureAccountSession } from "vscode-mssql";

export interface ITestContext {
    azureAccountService: sinon.SinonStubbedInstance<AzureAccountService>;
    accounts: IAccount[];
    session: IAzureAccountSession;
    subscriptionClient: sinon.SinonStubbedInstance<SubscriptionClient>;
    subscriptions: Subscription[];
    locations: Location[];
    groups: ResourceGroup[];
}

export function createContext(): ITestContext {
    const accounts = [
        {
            key: undefined!,
            displayInfo: undefined!,
            properties: {
                tenants: [
                    {
                        id: "",
                        displayName: "",
                    },
                ],
                azureAuthType: AzureAuthType.AuthCodeGrant,
                isMsAccount: false,
                owningTenant: {
                    id: "",
                    displayName: "",
                },
                providerSettings: allSettings,
            },
            isStale: false,
            isSignedIn: true,
        },
    ];
    const subscriptions: Subscription[] = [{ subscriptionId: "id1" }, { subscriptionId: "id2" }];
    const locations: Location[] = [{ id: "id1" }, { id: "id2" }];
    const groups: ResourceGroup[] = [
        { id: "id1", location: "l1" },
        { id: "id2", location: "l2" },
    ];
    const session0: IAzureAccountSession = {
        account: accounts[0],
        subscription: subscriptions[0],
        tenantId: "tenantId",
        token: {
            key: "",
            token: "",
            tokenType: "",
        },
    };
    const session1: IAzureAccountSession = {
        account: accounts[0],
        subscription: subscriptions[1],
        tenantId: "tenantId",
        token: {
            key: "",
            token: "",
            tokenType: "",
        },
    };

    const azureAccountService = sinon.createStubInstance(AzureAccountService);
    azureAccountService.getAccounts.resolves(accounts);
    azureAccountService.addAccount.resolves(accounts[0]);
    azureAccountService.getAccountSecurityToken.resolves({
        key: "",
        token: "",
        tokenType: "",
    });
    azureAccountService.getAccountSessions.resolves([session0, session1]);

    const subscriptionClient = sinon.createStubInstance(SubscriptionClient);

    return {
        groups: groups,
        locations: locations,
        subscriptions: subscriptions,
        subscriptionClient,
        session: session0,
        accounts: accounts,
        azureAccountService,
    };
}

suite("Azure SQL client", function (): void {
    test("Should return locations successfully", async function (): Promise<void> {
        const testContext = createContext();
        const azureSqlClient = new AzureResourceController(() => testContext.subscriptionClient);

        let index = 0;
        let maxLength = testContext.locations.length;
        const pages: PagedAsyncIterableIterator<Location> = {
            next: () => {
                if (index < maxLength) {
                    return Promise.resolve({
                        done: false,
                        value: testContext.locations[index++],
                    });
                } else {
                    return Promise.resolve({ done: true, value: undefined });
                }
            },
            byPage: () => undefined!,
            [Symbol.asyncIterator]: undefined!,
        };
        const subscriptions: Subscriptions = {
            listLocations: () => pages,
            list: () => undefined!,
            get: () => undefined!,
        };

        Object.defineProperty(testContext.subscriptionClient, "subscriptions", {
            get: () => subscriptions,
        });

        const result = await azureSqlClient.getLocations(testContext.session);
        assert.deepStrictEqual(result.length, testContext.locations.length);
    });

    test("Should return resource groups successfully", async function (): Promise<void> {
        const testContext = createContext();
        const groupClient = sinon.createStubInstance(ResourceManagementClient);
        const azureSqlClient = new AzureResourceController(undefined, () => groupClient);

        let index = 0;
        let maxLength = testContext.groups.length;
        const pages: PagedAsyncIterableIterator<ResourceGroup> = {
            next: () => {
                if (index < maxLength) {
                    return Promise.resolve({
                        done: false,
                        value: testContext.groups[index++],
                    });
                } else {
                    return Promise.resolve({ done: true, value: undefined });
                }
            },
            byPage: () => undefined!,
            [Symbol.asyncIterator]: undefined!,
        };
        const resourceGroups: ResourceGroups = {
            list: () => pages,
            get: () => undefined!,
            beginDelete: undefined!,
            beginDeleteAndWait: undefined!,
            beginExportTemplate: undefined!,
            beginExportTemplateAndWait: undefined!,
            checkExistence: undefined!,
            createOrUpdate: undefined!,
            update: undefined!,
        };

        Object.defineProperty(groupClient, "resourceGroups", {
            get: () => resourceGroups,
        });

        const result = await azureSqlClient.getResourceGroups(testContext.session);
        assert.deepStrictEqual(result.length, testContext.groups.length);
        assert.deepStrictEqual(result[0].location, testContext.groups[0].location);
    });
});
