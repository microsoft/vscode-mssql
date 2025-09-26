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
    AzureCloud = "AzureCloud", // "microsoft-sovereign-cloud.environment" doesn't actually have a value for the public cloud; default is to use public Azure if setting is not set
    USGovernment = "USGovernment",
    // ChinaCloud = "ChinaCloud",
    // Custom = "Custom", // requires reading from the "microsoft-sovereign-cloud.customCloud" setting
}

const azureCloudProviderId = "azure_publicCloud"; // ID from previous version of extension; keep for backwards compatibility
const azureCloudInfo = AzureEnvironments.Environment.get(CloudId.AzureCloud);
const usGovernmentCloudInfo = AzureEnvironments.Environment.get(CloudId.USGovernment);
// const chinaCloudInfo = AzureEnvironments.Environment.get("AzureChinaCloud");

export const publicAzureSettings: IProviderSettings = {
    displayName: Loc.PublicCloud,
    id: azureCloudProviderId, // ID from previous version of extension; keep for backwards compatibility
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
    id: CloudId.USGovernment,
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
        `${usGovernmentCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
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
        case CloudId.AzureCloud:
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
        const cloudFromConfig = config.get<CloudId.AzureCloud>(
            "microsoft-sovereign-cloud.environment",
        );

        return cloudFromConfig || CloudId.AzureCloud;
    } else {
        // Map from provider names in cache to VS Code setting values

        const cloudId = CloudId[cloud as keyof typeof CloudId];

        if (cloudId !== undefined) {
            return cloudId;
        }

        if (cloud === azureCloudProviderId || cloud === "") {
            return CloudId.AzureCloud;
        }

        throw new Error(`Unexpected cloud ID: '${cloud}'`);
    }
}
