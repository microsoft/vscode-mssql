/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProviderSettings } from "../models/contracts/azure";

// TODO: source these values from ms-rest-azure-env package where possible

const publicAzureSettings: IProviderSettings = {
    displayName: "publicCloudDisplayName",
    id: "azure_publicCloud",
    clientId: "a69788c6-1d43-44ed-9ca3-b83e194da255",
    loginEndpoint: "https://login.microsoftonline.com/",
    portalEndpoint: "https://portal.azure.com",
    redirectUri: "http://localhost",
    resources: {
        windowsManagementResource: {
            id: "marm",
            resource: "MicrosoftResourceManagement",
            endpoint: "https://management.core.windows.net/",
        },
        azureManagementResource: {
            id: "arm",
            resource: "AzureResourceManagement",
            endpoint: "https://management.azure.com/",
        },
        databaseResource: {
            id: "sql",
            resource: "Sql",
            endpoint: "https://database.windows.net/",
            dnsSuffix: "database.windows.net",
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
        "https://management.azure.com/user_impersonation",
    ],
};

const allSettings = publicAzureSettings;
export default allSettings;
