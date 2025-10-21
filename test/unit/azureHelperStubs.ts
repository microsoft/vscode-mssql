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

export const mockSubscriptions = [
    {
        name: "Ten0Sub1",
        subscriptionId: "00000000-0000-0000-0000-111111111111",
        tenantId: "00000000-0000-0000-0000-000000000000",
    },
    {
        name: "Ten1Sub1",
        subscriptionId: "11111111-0000-0000-0000-111111111111",
        tenantId: "11111111-1111-1111-1111-111111111111",
    },
] as AzureSubscription[];

export const mockTenants = [
    {
        displayName: "Tenant Zero",
        tenantId: "00000000-0000-0000-0000-000000000000",
        account: {
            id: "00000000-0000-0000-0000-000000000000.11111111-1111-1111-1111-111111111111",
        },
    },
    {
        displayName: "Tenant One",
        tenantId: "11111111-1111-1111-1111-111111111111",
        account: {
            id: "00000000-0000-0000-0000-000000000000.11111111-1111-1111-1111-111111111111",
        },
    },
    {
        displayName: "NotSignedInAccount Tenant A",
        tenantId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        account: {
            id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        },
    },
] as AzureTenant[];

export const mockAccounts = [
    {
        id: "00000000-0000-0000-0000-000000000000.11111111-1111-1111-1111-111111111111",
        label: "testAccount@testDomain.com",
    },
] as vscode.AuthenticationSessionAccountInformation[];

export const mockServerName = "testServer";
export const mockUserName = "testUser";

export const mockAzureResources = {
    azureSqlDbServer: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}`,
        name: mockServerName,
        type: "Microsoft.Sql/servers",
        location: "eastus2",
        tags: {},
        kind: "v12.0",
    } as GenericResourceExpanded,
    azureSqlDbDatabase1: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}/databases/master`,
        name: `${mockServerName}/master`,
        type: "Microsoft.Sql/servers/databases",
        location: "eastus2",
        kind: "v12.0,system",
    } as GenericResourceExpanded,
    azureSqlDbDatabase2: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Sql/servers/${mockServerName}/databases/testDatabase`,
        name: `${mockServerName}/testDatabase`,
        type: "Microsoft.Sql/servers/databases",
        location: "eastus2",
        tags: {},
        kind: "v12.0,user,vcore,serverless",
    } as GenericResourceExpanded,
    azureSynapseAnalyticsServer: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/synapseworkspace-managedrg-c84a69f0-b14e-4c86-b27a-1cefe6d68262/providers/Microsoft.Sql/servers/${mockServerName}-synapse`,
        name: `${mockServerName}-synapse`,
        type: "Microsoft.Sql/servers",
        location: "eastus2",
        kind: "v12.0,analytics",
    } as GenericResourceExpanded,
    nonDatabaseResource: {
        id: `/subscriptions/${mockSubscriptions[0].subscriptionId}/resourceGroups/DefaultResourceGroup/providers/Microsoft.Storage/storageAccounts/testStorage`,
        name: `testStorage`,
        type: "Microsoft.Storage/storageAccounts",
        location: "eastus2",
        kind: "StorageV2",
    } as GenericResourceExpanded,
};

export const mockAzureResourceList = [
    mockAzureResources.azureSqlDbServer,
    mockAzureResources.azureSqlDbDatabase1,
    mockAzureResources.azureSqlDbDatabase2,
    mockAzureResources.azureSynapseAnalyticsServer,
    mockAzureResources.nonDatabaseResource,
];

export function stubIsSignedIn(sandbox: Sinon.SinonSandbox, result: boolean) {
    return sandbox.stub(AzureHelpers.VsCodeAzureHelper, "isSignedIn").resolves(result);
}

export function stubVscodeAzureSignIn(sandbox: sinon.SinonSandbox) {
    return sandbox.stub(AzureHelpers.VsCodeAzureHelper, "signIn").resolves({
        getSubscriptions: () => Promise.resolve(mockSubscriptions),
        getTenants: () =>
            Promise.resolve(mockTenants.filter((t) => t.account.id === mockAccounts[0].id)),
    } as unknown as MssqlVSCodeAzureSubscriptionProvider);
}

export function stubVscodeAzureHelperGetAccounts(sandbox: sinon.SinonSandbox) {
    return sandbox.stub(AzureHelpers.VsCodeAzureHelper, "getAccounts").resolves(mockAccounts);
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
