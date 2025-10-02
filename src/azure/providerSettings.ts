/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IProviderSettings } from "../models/contracts/azure";
import * as AzureEnvironments from "@azure/ms-rest-azure-env";
import { Azure as Loc } from "../constants/locConstants";
import { parseEnum } from "../utils/utils";
import {
    configCustomEnvironment,
    configSovereignCloudCustomEnvironment,
    customEnvironmentSettingName,
    environmentSettingName,
    sovereignCloudSectionName,
} from "../constants/constants";

/**
 * Identifiers for the various Azure clouds.  Values must match the "microsoft-sovereign-cloud.environment" setting values.
 */
export enum CloudId {
    /**
     * `microsoft-sovereign-cloud.environment` doesn't actually have a value for the public cloud; default is to use public Azure if setting is not set
     */
    AzureCloud = "AzureCloud",
    USGovernment = "USGovernment",
    ChinaCloud = "ChinaCloud",
    /**
     * Requires reading from the `microsoft-sovereign-cloud.customEnvironment` setting
     */
    Custom = "custom",
}

export const azureCloudProviderId = "azure_publicCloud"; // ID from previous version of extension; keep for backwards compatibility
const azureCloudInfo = getAzureEnvironment(CloudId.AzureCloud);
const usGovernmentCloudInfo = getAzureEnvironment(CloudId.USGovernment);
const chinaCloudInfo = getAzureEnvironment(CloudId.ChinaCloud);

export const publicAzureProviderSettings: IProviderSettings = {
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
            analyticsDnsSuffix: ".sql.azuresynapse.net",
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.azure.net/",
        },
    },
    fabric: {
        fabricApiUriBase: "https://api.fabric.microsoft.com/v1/",
        fabricScopeUriBase: "https://analysis.windows.net/powerbi/api/",
        sqlDbDnsSuffix: ".database.fabric.microsoft.com",
        dataWarehouseDnsSuffix: ".datawarehouse.fabric.microsoft.com",
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${azureCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

const usGovernmentCloudProviderSettings: IProviderSettings = {
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
            analyticsDnsSuffix: ".sql.azuresynapse.usgovcloudapi.net",
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.usgovcloudapi.net/",
        },
    },
    fabric: {
        fabricApiUriBase: undefined,
        fabricScopeUriBase: undefined,
        sqlDbDnsSuffix: undefined,
        dataWarehouseDnsSuffix: undefined,
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${usGovernmentCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

const chinaCloudProviderSettings: IProviderSettings = {
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
            analyticsDnsSuffix: ".sql.azuresynapse.chinacloudapi.cn",
        },
        azureKeyVaultResource: {
            id: "vault",
            resource: "AzureKeyVault",
            endpoint: "https://vault.chinacloudapi.cn/",
        },
    },
    fabric: {
        fabricApiUriBase: undefined,
        fabricScopeUriBase: undefined,
        sqlDbDnsSuffix: undefined,
        dataWarehouseDnsSuffix: undefined,
    },
    scopes: [
        "openid",
        "email",
        "profile",
        "offline_access",
        `${chinaCloudInfo.resourceManagerEndpointUrl}/user_impersonation`,
    ],
};

interface MssqlEnvironmentAdditions {
    clientId?: string;
    sqlEndpoint?: string;
    sqlDnsSuffix?: string;
    analyticsDnsSuffix?: string;
    keyVaultEndpoint?: string;
    fabricApiUriBase?: string;
    fabricScopeUriBase?: string;
    fabricSqlDbDnsSuffix?: string;
    fabricDataWarehouseDnsSuffix?: string;
}

interface MssqlEnvironment extends AzureEnvironments.Environment, MssqlEnvironmentAdditions {
    isCustomCloud: boolean;
}

function getCustomCloudProviderSettings(): IProviderSettings {
    let customCloud: MssqlEnvironment = getAzureEnvironment(CloudId.Custom); // just the base cloud info at first
    const mssqlCustomCloud: MssqlEnvironmentAdditions = getAzureEnvironmentAdditions();

    customCloud = {
        ...customCloud,
        ...mssqlCustomCloud,
    };

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
                analyticsDnsSuffix: customCloud.analyticsDnsSuffix,
            },
            azureKeyVaultResource: {
                id: "vault",
                resource: "AzureKeyVault",
                endpoint: customCloud.keyVaultEndpoint,
            },
        },
        fabric: {
            fabricApiUriBase: customCloud.fabricApiUriBase,
            fabricScopeUriBase: customCloud.fabricScopeUriBase,
            sqlDbDnsSuffix: customCloud.fabricSqlDbDnsSuffix,
            dataWarehouseDnsSuffix: customCloud.fabricDataWarehouseDnsSuffix,
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
export function getCloudProviderSettings(cloud?: CloudId | string): IProviderSettings {
    const cloudId = getCloudId(cloud);

    switch (cloudId) {
        case CloudId.AzureCloud:
            return publicAzureProviderSettings;
        case CloudId.USGovernment:
            return usGovernmentCloudProviderSettings;
        case CloudId.ChinaCloud:
            return chinaCloudProviderSettings;
        case CloudId.Custom:
            return getCustomCloudProviderSettings();
        default:
            throw new Error(`Unexpected cloud ID: '${cloud}'.`);
    }
}

export function getAzureEnvironment(cloud?: CloudId | string): AzureEnvironments.Environment & {
    isCustomCloud: boolean;
} {
    const cloudId = getCloudId(cloud);

    switch (cloudId) {
        case CloudId.AzureCloud:
            return {
                ...AzureEnvironments.Environment.AzureCloud,
                isCustomCloud: false,
            };
        case CloudId.USGovernment:
            return {
                ...AzureEnvironments.Environment.USGovernment,
                isCustomCloud: false,
            };
        case CloudId.ChinaCloud:
            return {
                ...AzureEnvironments.Environment.ChinaCloud,
                isCustomCloud: false,
            };
        case CloudId.Custom:
            const customCloud = vscode.workspace
                .getConfiguration(sovereignCloudSectionName)
                .get<
                    AzureEnvironments.EnvironmentParameters | undefined
                >(customEnvironmentSettingName);

            if (customCloud) {
                return {
                    ...new AzureEnvironments.Environment(customCloud),
                    isCustomCloud: true,
                };
            }

            throw new Error(Loc.customCloudNotConfigured(configSovereignCloudCustomEnvironment));
        default:
            throw new Error(`Unexpected cloud ID: '${cloud}'`);
    }
}

export function getAzureEnvironmentAdditions(): MssqlEnvironmentAdditions {
    const mssqlCustomCloud = vscode.workspace
        .getConfiguration("mssql")
        .get<MssqlEnvironmentAdditions>("customEnvironment");

    if (mssqlCustomCloud) {
        return mssqlCustomCloud;
    } else {
        throw new Error(Loc.customCloudNotConfigured(configCustomEnvironment));
    }
}

export function getCloudId(cloud?: CloudId | string): CloudId {
    if (!cloud) {
        // if microsoft-sovereign-cloud.environment is set, return the corresponding settings, otherwise return public Azure settings
        //check microsoft-sovereign-cloud.environment setting
        const config = vscode.workspace.getConfiguration(sovereignCloudSectionName);
        const cloudFromConfig = config.get<CloudId.AzureCloud>(environmentSettingName);

        return cloudFromConfig || CloudId.AzureCloud;
    } else {
        // Map from provider names to VS Code setting values
        const cloudId = parseEnum(CloudId, cloud);

        if (cloudId !== undefined) {
            return cloudId;
        }

        if (cloud === azureCloudProviderId || cloud === "") {
            return CloudId.AzureCloud;
        }

        throw new Error(`Unexpected cloud ID: '${cloud}'`);
    }
}
