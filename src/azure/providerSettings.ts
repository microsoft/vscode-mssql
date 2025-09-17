/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IProviderSettings } from "../models/contracts/azure";
import * as AzureEnvironments from "@azure/ms-rest-azure-env";
import { Azure as Loc } from "../constants/locConstants";

const azureCloudInfo = AzureEnvironments.Environment.get("AzureCloud");
const usGovernmentCloudInfo = AzureEnvironments.Environment.get("USGovernment");
const chinaCloudInfo = AzureEnvironments.Environment.get("AzureChinaCloud");
const germanyCloudInfo = AzureEnvironments.Environment.get("AzureGermanCloud");

export const publicAzureSettings: IProviderSettings = {
    displayName: Loc.PublicCloud,
    id: "azure_publicCloud",
    clientId: "a69788c6-1d43-44ed-9ca3-b83e194da255",
    loginEndpoint: azureCloudInfo.activeDirectoryEndpointUrl,
    portalEndpoint: azureCloudInfo.portalUrl,
    redirectUri: "http://localhost",
    resources: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: azureCloudInfo.managementEndpointUrl,
        },
        azureManagementResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: azureCloudInfo.resourceManagerEndpointUrl,
        },
        databaseResource: {
            id: "sql",
            resource: "Sql",
            endpoint: "https://database.windows.net/",
            dnsSuffix: azureCloudInfo.sqlServerHostnameSuffix,
            analyticsDnsSuffix: "sql.azuresynapse.net",
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.azure.net/",
        },
    },
    fabric: {
        sqlDbDnsSuffix: "database.fabric.microsoft.com",
        dataWarehouseSuffix: "datawarehouse.fabric.microsoft.com",
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${azureCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

const usGovernmentAzureSettings: IProviderSettings = {
    displayName: Loc.USGovernmentCloud,
    id: "azure_usGovtCloud",
    clientId: "a69788c6-1d43-44ed-9ca3-b83e194da255",
    loginEndpoint: usGovernmentCloudInfo.activeDirectoryEndpointUrl,
    portalEndpoint: usGovernmentCloudInfo.portalUrl,
    redirectUri: "http://localhost",
    resources: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: usGovernmentCloudInfo.managementEndpointUrl,
        },
        azureManagementResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: usGovernmentCloudInfo.resourceManagerEndpointUrl,
        },
        databaseResource: {
            id: "sql",
            resource: "Sql",
            endpoint: "https://database.usgovcloudapi.net/",
            dnsSuffix: usGovernmentCloudInfo.sqlServerHostnameSuffix,
            analyticsDnsSuffix: undefined, // TODO: check what this shoudl be for USGov
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.usgovcloudapi.net/",
        },
    },
    fabric: {
        sqlDbDnsSuffix: "database.fabric.microsoft.com",
        dataWarehouseSuffix: "datawarehouse.fabric.microsoft.com",
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${azureCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

const allSettings = publicAzureSettings;
export default allSettings;

export function getCurrentCloudSettings(): IProviderSettings {
    // if microsoft-sovereign-cloud.environment is set, return the corresponding settings, otherwise return public Azure settings
    //check microsoft-sovereign-cloud.environment setting
    const config = vscode.workspace.getConfiguration();
    const cloud = config.get<string>("microsoft-sovereign-cloud.environment");

    switch (cloud) {
        case "USGovernment":
            return usGovernmentAzureSettings;
        case "ChinaCloud":
        case "GermanyCloud":
            throw new Error(`${cloud} is not supported yet.`);
        case "PublicCloud":
        default:
            return publicAzureSettings;
    }
}
