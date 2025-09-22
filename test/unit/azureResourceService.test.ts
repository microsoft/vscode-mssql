/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
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
import { TokenCredentialWrapper } from "../../src/azure/credentialWrapper";
import { getCloudSettings } from "../../src/azure/providerSettings";
import { IAzureAccountSession } from "vscode-mssql";

export interface ITestContext {
    azureAccountService: TypeMoq.IMock<AzureAccountService>;
    accounts: IAccount[];
    session: IAzureAccountSession;
    subscriptionClient: TypeMoq.IMock<SubscriptionClient>;
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
                providerSettings: getCloudSettings(),
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
    const azureAccountService = TypeMoq.Mock.ofType(AzureAccountService, undefined, undefined);
    azureAccountService.setup((x) => x.getAccounts()).returns(() => Promise.resolve(accounts));
    azureAccountService.setup((x) => x.addAccount()).returns(() => Promise.resolve(accounts[0]));
    azureAccountService
        .setup((x) => x.getAccountSecurityToken(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .returns(() =>
            Promise.resolve({
                key: "",
                token: "",
                tokenType: "",
            }),
        );
    azureAccountService
        .setup((x) => x.getAccountSessions(TypeMoq.It.isAny()))
        .returns(() => Promise.resolve([session0, session1]));

    return {
        groups: groups,
        locations: locations,
        subscriptions: subscriptions,
        subscriptionClient: TypeMoq.Mock.ofType(
            SubscriptionClient,
            undefined,
            new TokenCredentialWrapper(session0.token),
        ),
        session: session0,
        accounts: accounts,
        azureAccountService: azureAccountService,
    };
}

suite("Azure SQL client", function (): void {
    test("Should return locations successfully", async function (): Promise<void> {
        const testContext = createContext();
        const azureSqlClient = new AzureResourceController(
            () => testContext.subscriptionClient.object,
        );

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
        testContext.subscriptionClient.setup((x) => x.subscriptions).returns(() => subscriptions);

        const result = await azureSqlClient.getLocations(testContext.session);
        assert.deepStrictEqual(result.length, testContext.locations.length);
    });

    test("Should return resource groups successfully", async function (): Promise<void> {
        const testContext = createContext();
        const azureSqlClient = new AzureResourceController(undefined, () => groupClient.object);

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
        const groupClient = TypeMoq.Mock.ofType(
            ResourceManagementClient,
            undefined,
            new TokenCredentialWrapper(testContext.session.token),
            testContext.subscriptions[0].subscriptionId,
        );
        groupClient.setup((x) => x.resourceGroups).returns(() => resourceGroups);

        const result = await azureSqlClient.getResourceGroups(testContext.session);
        assert.deepStrictEqual(result.length, testContext.groups.length);
        assert.deepStrictEqual(result[0].location, testContext.groups[0].location);
    });
});
