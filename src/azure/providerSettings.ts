/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IProviderSettings } from "../models/contracts/azure";
import * as AzureEnvironments from "@azure/ms-rest-azure-env";
import { Azure as Loc } from "../constants/locConstants";

/**
 * Identifiers for the various Azure clouds.  Settings should match the "microsoft-sovereign-cloud.environment" setting values.
 */
export enum CloudId {
    PublicCloud = "PublicCloud", // also unset/empty value for "microsoft-sovereign-cloud.environment"
    USGovernment = "USGovernment",
    // ChinaCloud = "ChinaCloud",
    // GermanyCloud = "GermanyCloud",
    // Custom = "Custom", // requires reading from the "microsoft-sovereign-cloud.customCloud" setting
}

const azureCloudInfo = AzureEnvironments.Environment.get("AzureCloud");
const usGovernmentCloudInfo = AzureEnvironments.Environment.get("USGovernment");
// const chinaCloudInfo = AzureEnvironments.Environment.get("AzureChinaCloud");
// const germanyCloudInfo = AzureEnvironments.Environment.get("AzureGermanCloud");

export const publicAzureSettings: IProviderSettings = {
    displayName: Loc.PublicCloud,
    id: "azure_publicCloud",
    clientId: "a69788c6-1d43-44ed-9ca3-b83e194da255",
    loginEndpoint: azureCloudInfo.activeDirectoryEndpointUrl,
    portalEndpoint: azureCloudInfo.portalUrl,
    redirectUri: "http://localhost",
    settings: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: azureCloudInfo.managementEndpointUrl,
        },
        armResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: azureCloudInfo.resourceManagerEndpointUrl,
        },
        sqlResource: {
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
    settings: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: usGovernmentCloudInfo.managementEndpointUrl,
        },
        armResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: usGovernmentCloudInfo.resourceManagerEndpointUrl,
        },
        sqlResource: {
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

/**
 * Fetches the provider settings for the specified cloud.
 * If not specified, the default cloud is determined by the "microsoft-sovereign-cloud.environment".
 * If that is not set, then the public Azure settings are returned.
 * @param cloud (optional) the cloud environment name.  Valid values are the options for the "microsoft-sovereign-cloud.environment" setting.
 * @returns Provider settings for the specified cloud
 */
export function getCloudSettings(cloud?: CloudId | string): IProviderSettings {
    const cloudId = getCloudId(cloud);

    switch (cloudId) {
        case CloudId.USGovernment:
            return usGovernmentAzureSettings;
        // case "ChinaCloud":
        // case "GermanyCloud":
        // case "Custom":
        //     throw new Error(`${cloud} is not supported yet.`);
        case CloudId.PublicCloud:
            return publicAzureSettings;
        default:
            throw new Error(`Unexpected cloud ID: '${cloud}'`);
    }
}

export function getCloudId(cloud?: CloudId | string): CloudId {
    if (!cloud) {
        // if microsoft-sovereign-cloud.environment is set, return the corresponding settings, otherwise return public Azure settings
        //check microsoft-sovereign-cloud.environment setting
        const config = vscode.workspace.getConfiguration();
        const cloudFromConfig = config.get<CloudId.PublicCloud>(
            "microsoft-sovereign-cloud.environment",
        );

        return cloudFromConfig || CloudId.PublicCloud;
    } else {
        // Map from provider names in cache to VS Code setting values
        if (cloud === "azure_publicCloud") {
            return CloudId.PublicCloud;
        } else {
            // If cloud is already a CloudId value, return it. Otherwise throw.
            if ((Object.values(CloudId) as string[]).includes(cloud)) {
                return cloud as CloudId;
            }
            throw new Error(`Unexpected cloud ID: '${cloud}'`);
        }
    }
}
