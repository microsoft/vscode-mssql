/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IProviderSettings } from "../models/contracts/azure";
import * as AzureEnvironments from "@azure/ms-rest-azure-env";
import { Azure as Loc } from "../constants/locConstants";
import * as AzureAuth from "@microsoft/vscode-azext-azureauth";

/**
 * Identifiers for the various Azure clouds.  Settings should match the "microsoft-sovereign-cloud.environment" setting values.
 */
export enum CloudId {
    /**
     * `microsoft-sovereign-cloud.environment` doesn't actually have a value for the public cloud; default is to use public Azure if setting is not set
     */
    AzureCloud = "AzureCloud",
    USGovernment = "USGovernment",
    ChinaCloud = "ChinaCloud",
    /**
     * Requires reading from the "microsoft-sovereign-cloud.customCloud" setting
     */
    Custom = "custom",
}

export const azureCloudProviderId = "azure_publicCloud"; // ID from previous version of extension; keep for backwards compatibility
const azureCloudInfo = AzureEnvironments.Environment.AzureCloud;
const usGovernmentCloudInfo = AzureEnvironments.Environment.USGovernment;
const chinaCloudInfo = AzureEnvironments.Environment.ChinaCloud;

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

const usGovernmentCloudSettings: IProviderSettings = {
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
        sqlDbDnsSuffix: undefined,
        dataWarehouseSuffix: undefined,
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${usGovernmentCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

const chinaCloudSettings: IProviderSettings = {
    displayName: Loc.ChinaCloud,
    id: CloudId.ChinaCloud,
    clientId: "a69788c6-1d43-44ed-9ca3-b83e194da255",
    loginEndpoint: chinaCloudInfo.activeDirectoryEndpointUrl,
    portalEndpoint: chinaCloudInfo.portalUrl,
    redirectUri: "http://localhost",
    settings: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: chinaCloudInfo.managementEndpointUrl,
        },
        armResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: chinaCloudInfo.resourceManagerEndpointUrl,
        },
        sqlResource: {
            id: "sql",
            resource: "Sql",
            endpoint: "https://database.chinacloudapi.cn/",
            dnsSuffix: chinaCloudInfo.sqlServerHostnameSuffix,
            analyticsDnsSuffix: undefined, // TODO: check what this should be for China
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.chinacloudapi.cn/",
        },
    },
    fabric: {
        sqlDbDnsSuffix: undefined,
        dataWarehouseSuffix: undefined,
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${chinaCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

interface MssqlEnvironment extends AzureEnvironments.Environment {
    isCustomCloud: boolean;
    clientId?: string;
    sqlEndpoint?: string;
    sqlDnsSuffix?: string;
    analyticsDnsSuffix?: string;
    keyVaultEndpoint?: string;
    fabricSqlDbDnsSuffix?: string;
    fabricDataWarehouseSuffix?: string;
}

function getCustomCloudSettings(): IProviderSettings {
    const customCloud: MssqlEnvironment = AzureAuth.getConfiguredAzureEnv();

    if (!customCloud.isCustomCloud) {
        throw new Error("Attempted to read custom cloud, but got preconfigured one instead.");
    }

    return {
        displayName: customCloud.name,
        id: CloudId.Custom,
        clientId: customCloud.clientId || "a69788c6-1d43-44ed-9ca3-b83e194da255",
        loginEndpoint: customCloud.activeDirectoryEndpointUrl,
        portalEndpoint: customCloud.portalUrl,
        redirectUri: "http://localhost",
        settings: {
            windowsManagementResource: {
                id: "marm",
                resource: "MicrosoftResourceManagement",
                endpoint: customCloud.managementEndpointUrl,
            },
            armResource: {
                id: "arm",
                resource: "AzureResourceManagement",
                endpoint: customCloud.resourceManagerEndpointUrl,
            },
            sqlResource: {
                id: "sql",
                resource: "Sql",
                endpoint: customCloud.sqlEndpoint,
                dnsSuffix: customCloud.sqlServerHostnameSuffix,
                analyticsDnsSuffix: undefined, // TODO: check what this shoudl be for USGov
            },
            azureKeyVaultResource: {
                id: "vault",
                resource: "AzureKeyVault",
                endpoint: customCloud.keyVaultEndpoint,
            },
        },
        fabric: {
            sqlDbDnsSuffix: customCloud.fabricSqlDbDnsSuffix,
            dataWarehouseSuffix: customCloud.fabricDataWarehouseSuffix,
        },
        scopes: [
            "openid",
            "email",
            "profile",
            "offline_access",
            `${customCloud.resourceManagerEndpointUrl}/user_impersonation`,
        ],
    };
}

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
        case CloudId.AzureCloud:
            return publicAzureSettings;
        case CloudId.USGovernment:
            return usGovernmentCloudSettings;
        case CloudId.ChinaCloud:
            return chinaCloudSettings;
        case CloudId.Custom:
            return getCustomCloudSettings();
        default:
            throw new Error(`Unexpected cloud ID: '${cloud}'.  It may not be supported yet.`);
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
