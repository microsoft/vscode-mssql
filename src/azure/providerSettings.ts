/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProviderSettings } from '../models/contracts/azure';

const publicAzureSettings: IProviderSettings = {
	configKey: 'enablePublicCloud',
	metadata: {
		displayName: 'publicCloudDisplayName',
		id: 'azure_publicCloud',
		clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
		loginEndpoint: 'https://login.microsoftonline.com/',
		portalEndpoint: 'https://portal.azure.com',
		redirectUri: 'https://vscode-redirect.azurewebsites.net/',
		resources: {
			windowsManagementResource: {
				id: 'marm',
				resource: 'MicrosoftResourceManagement',
				endpoint: 'https://management.core.windows.net/'
			},
			azureManagementResource: {
				id: 'arm',
				resource: 'AzureResourceManagement',
				endpoint: 'https://management.azure.com/'
			},
			databaseResource: {
				id: 'sql',
				resource: 'Sql',
				endpoint: 'https://database.windows.net/'
			}
		},
		scopes: [
			'openid', 'email', 'profile', 'offline_access',
			'https://management.azure.com/user_impersonation'
		]
	}
};

const usGovAzureSettings: IProviderSettings = {
	configKey: 'enableUsGovCloud',
	metadata: {
		displayName: 'usGovCloudDisplayName',
		id: 'azure_usGovtCloud',
		clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
		loginEndpoint: 'https://login.microsoftonline.us/',
		portalEndpoint: 'https://portal.azure.us',
		redirectUri: 'https://vscode-redirect.azurewebsites.net/',
		resources: {
			windowsManagementResource: {
				id: 'marm',
				resource: 'MicrosoftResourceManagement',
				endpoint: 'https://management.core.usgovcloudapi.net/'
			},
			azureManagementResource: {
				id: 'arm',
				resource: 'AzureResourceManagement',
				endpoint: 'https://management.usgovcloudapi.net/'
			},
			databaseResource: {
				id: 'sql',
				resource: 'Sql',
				endpoint: 'https://database.usgovcloudapi.net/'
			}
		},
		scopes: [
			'openid', 'email', 'profile', 'offline_access',
			'https://management.usgovcloudapi.net/user_impersonation'
		]
	}
};

const chinaAzureSettings: IProviderSettings = {
	configKey: 'enableChinaCloud',
	metadata: {
		displayName: 'chinaCloudDisplayName',
		id: 'azure_chinaCloud',
		clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
		loginEndpoint: 'https://login.partner.microsoftonline.cn/',
		portalEndpoint: 'https://portal.azure.cn/',
		redirectUri: 'https://vscode-redirect.azurewebsites.net/',
		resources: {
			windowsManagementResource: {
				id: 'marm',
				resource: 'MicrosoftResourceManagement',
				endpoint: 'https://management.core.chinacloudapi.cn/'
			},
			azureManagementResource: {
				id: 'arm',
				resource: 'AzureResourceManagement',
				endpoint: 'https://management.chinacloudapi.cn'
			},
			databaseResource: {
				id: 'sql',
				resource: 'Sql',
				endpoint: 'https://database.chinacloudapi.cn/'
			}
		},
		scopes: [
			'openid', 'email', 'profile', 'offline_access',
			'https://management.chinacloudapi.cn/user_impersonation'
		]
	}
};


const allSettings = [ publicAzureSettings, usGovAzureSettings, chinaAzureSettings ];
export default allSettings;
