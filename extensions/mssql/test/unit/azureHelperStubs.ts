/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import Sinon from "sinon";
import { AzureSubscription, AzureTenant } from "@microsoft/vscode-azext-azureauth";

import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import { AzureSqlServerInfo } from "../../src/sharedInterfaces/connectionDialog";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";
import { GenericResourceExpanded } from "@azure/arm-resources";
import { Database, ManagedDatabase, ManagedInstance, Server } from "@azure/arm-sql";

export const mockSubscriptions = [
    {
        name: "Ten0Sub1",
        subscriptionId: "00000000-0000-0000-0000-111111111111",
        credential: "credential-placeholder",
        tenantId: "00000000-0000-0000-0000-000000000000",
    } as any,
    {
        name: "Ten1Sub1",
        subscriptionId: "11111111-0000-0000-0000-111111111111",
        credential: "credential-placeholder",
        tenantId: "11111111-1111-1111-1111-111111111111",
    } as any,
] as AzureSubscription[];

export const mockAccounts = {
    signedInAccount: {
        id: "00000000-0000-0000-0000-000000000000.11111111-1111-1111-1111-111111111111",
        label: "testAccount@testDomain.com",
    } as vscode.AuthenticationSessionAccountInformation,
    notSignedInAccount: {
        id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        label: "notSignedInAccount@testDomain.com",
    } as vscode.AuthenticationSessionAccountInformation,
};

export const mockTenants = [
    {
        displayName: "Tenant Zero",
        tenantId: "00000000-0000-0000-0000-000000000000",
        account: {
            id: mockAccounts.signedInAccount.id,
        },
    },
    {
        displayName: "Tenant One",
        tenantId: "11111111-1111-1111-1111-111111111111",
        account: {
            id: mockAccounts.signedInAccount.id,
        },
    },
    {
        displayName: "NotSignedInAccount Tenant A",
        tenantId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        account: {
            id: mockAccounts.notSignedInAccount.id,
        },
    },
] as AzureTenant[];

export const mockServerName = "testServer";
export const mockManagedInstanceName = "testManagedInstance";
export const mockUserName = "testUser";

export const mockAzureResources = {
    azureSqlDbServer: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}`,
        name: mockServerName,
        type: "Microsoft.Sql/servers",
        location: "eastus2",
        tags: {},
        kind: "v12.0",
    } as Server,
    azureSqlDbDatabase1: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}/databases/master`,
        name: "master",
        type: "Microsoft.Sql/servers/databases",
        location: "eastus2",
        kind: "v12.0,system",
        server: mockServerName,
    } as Database & { server: string },
    azureSqlDbDatabase2: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}/databases/testDatabase`,
        name: "testDatabase",
        type: "Microsoft.Sql/servers/databases",
        location: "eastus2",
        tags: {},
        kind: "v12.0,user,vcore,serverless",
        server: mockServerName,
    } as Database & { server: string },
    azureSynapseAnalyticsServer: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/synapseworkspace-managedrg-c84a69f0-b14e-4c86-b27a-1cefe6d68262/providers/Microsoft.Sql/servers/${mockServerName}-synapse`,
        name: `${mockServerName}-synapse`,
        type: "Microsoft.Sql/servers",
        location: "eastus2",
        kind: "v12.0,analytics",
    } as Server,
    azureManagedInstance: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/managedInstances/${mockManagedInstanceName}`,
        name: mockManagedInstanceName,
        type: "Microsoft.Sql/managedInstances",
        location: "eastus2",
        publicDataEndpointEnabled: true,
        dnsZone: "abcd12345678",
        fullyQualifiedDomainName: `${mockManagedInstanceName}.abcd12345678.database.windows.net`,
    } as ManagedInstance,
    azureManagedInstanceDatabase: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/managedInstances/${mockManagedInstanceName}/databases/managedInstanceDb`,
        name: "managedInstanceDb",
        type: "Microsoft.Sql/managedInstances/databases",
        location: "eastus2",
        server: mockManagedInstanceName,
    } as ManagedDatabase & { server: string },
    nonDatabaseResource: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Storage/storageAccounts/testStorage`,
        name: `testStorage`,
        type: "Microsoft.Storage/storageAccounts",
        location: "eastus2",
        kind: "StorageV2",
    } as GenericResourceExpanded,
    storageAccount: {
        name: "testStorageAccount",
        location: "eastus2",
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Storage/storageAccounts/testStorageAccount`,
        type: "Microsoft.Storage/storageAccounts",
    },
    blobContainer: {
        name: "testContainer",
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Storage/storageAccounts/testStorageAccount/blobServices/default/containers/testContainer`,
    },
};

export const mockSqlDbList = {
    servers: [mockAzureResources.azureSqlDbServer, mockAzureResources.azureSynapseAnalyticsServer],
    databases: [mockAzureResources.azureSqlDbDatabase1, mockAzureResources.azureSqlDbDatabase2],
};

export const mockManagedInstanceList = {
    servers: [mockAzureResources.azureManagedInstance],
    databases: [mockAzureResources.azureManagedInstanceDatabase],
};

export function stubIsSignedIn(sandbox: Sinon.SinonSandbox, result: boolean) {
    return sandbox.stub(AzureHelpers.VsCodeAzureHelper, "isSignedIn").resolves(result);
}

export function stubVscodeAzureSignIn(sandbox: sinon.SinonSandbox) {
    return sandbox.stub(AzureHelpers.VsCodeAzureHelper, "signIn").resolves({
        getSubscriptions: () => Promise.resolve(mockSubscriptions),
        getTenants: () =>
            Promise.resolve(
                mockTenants.filter((t) => t.account.id === mockAccounts.signedInAccount.id),
            ),
    } as unknown as MssqlVSCodeAzureSubscriptionProvider);
}

export function stubVscodeAzureHelperGetAccounts(sandbox: sinon.SinonSandbox) {
    return sandbox
        .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
        .resolves([mockAccounts.signedInAccount]);
}

export function stubFetchServersFromAzure(sandbox: sinon.SinonSandbox) {
    return sandbox
        .stub(AzureHelpers.VsCodeAzureHelper, "fetchServersFromAzure")
        .callsFake(async (sub: AzureSubscription) => {
            return [
                {
                    location: "TestRegion",
                    resourceGroup: `testResourceGroup-${sub.name}`,
                    server: `testServer-${sub.name}-1`,
                    databases: ["testDatabase1", "testDatabase2"],
                    subscription: `${sub.name} (${sub.subscriptionId})`,
                },
                {
                    location: "TestRegion",
                    resourceGroup: `testResourceGroup-${sub.name}`,
                    server: `testServer-${sub.name}-2`,
                    databases: ["testDatabase1", "testDatabase2"],
                    subscription: `${sub.name} (${sub.subscriptionId})`,
                },
            ] as AzureSqlServerInfo[];
        });
}

export function stubPromptForAzureSubscriptionFilter(sandbox: Sinon.SinonSandbox, result: boolean) {
    return sandbox.stub(AzureHelpers, "promptForAzureSubscriptionFilter").resolves(result);
}
