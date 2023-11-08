/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResource, IProviderSettings } from '../models/contracts/azure';

const publicAzureSettings: IProviderSettings = {
	configKey: 'enablePublicCloud',
	metadata: {
		displayName: 'Azure Public',
		id: 'azure_publicCloud',
		settings: {
			host: 'https://login.microsoftonline.com/',
			clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
			microsoftResource: {
				id: 'marm',
				resource: AzureResource.MicrosoftResourceManagement,
				endpoint: 'https://management.core.windows.net/'
			},
			armResource: {
				id: 'arm',
				resource: AzureResource.ResourceManagement,
				endpoint: 'https://management.azure.com/'
			},
			sqlResource: {
				id: 'sql',
				resource: AzureResource.Sql,
				endpoint: 'https://database.windows.net/'
			},
			redirectUri: 'http://localhost',
			scopes: [
				'openid', 'email', 'profile', 'offline_access',
				'https://management.azure.com/user_impersonation'
			],
			portalEndpoint: 'https://portal.azure.com'
		}
	}
};

const usGovAzureSettings: IProviderSettings = {
	configKey: 'enableUsGovCloud',
	metadata: {
		displayName: 'Azure US Gov',
		id: 'azure_usGovtCloud',
		settings: {
			clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
			host: 'https://login.microsoftonline.us/',
			microsoftResource: {
				id: 'marm',
				resource: AzureResource.MicrosoftResourceManagement,
				endpoint: 'https://management.core.usgovcloudapi.net/'
			},
			armResource: {
				id: 'arm',
				resource: AzureResource.ResourceManagement,
				endpoint: 'https://management.usgovcloudapi.net/'
			},
			sqlResource: {
				id: 'sql',
				resource: AzureResource.Sql,
				endpoint: 'https://database.usgovcloudapi.net/'
			},
			redirectUri: 'http://localhost',
			scopes: [
				'openid', 'email', 'profile', 'offline_access',
				'https://management.usgovcloudapi.net/user_impersonation'
			],
			portalEndpoint: 'https://portal.azure.us'
		}
	}
};

const chinaAzureSettings: IProviderSettings = {
	configKey: 'enableChinaCloud',
	metadata: {
		displayName: 'Azure China',
		id: 'azure_chinaCloud',
		settings: {
			clientId: 'a69788c6-1d43-44ed-9ca3-b83e194da255',
			host: 'https://login.partner.microsoftonline.cn/',
			microsoftResource: {
				id: 'marm',
				resource: AzureResource.MicrosoftResourceManagement,
				endpoint: 'https://management.core.chinacloudapi.cn/'
			},
			armResource: {
				id: 'arm',
				resource: AzureResource.ResourceManagement,
				endpoint: 'https://management.chinacloudapi.cn'
			},
			sqlResource: {
				id: 'sql',
				resource: AzureResource.Sql,
				endpoint: 'https://database.chinacloudapi.cn/'
			},
			redirectUri: 'https://vscode-redirect.azurewebsites.net/',
			scopes: [
				'openid', 'email', 'profile', 'offline_access',
				'https://management.chinacloudapi.cn/user_impersonation'
			],
			portalEndpoint: 'https://portal.azure.cn/'
		}

	}
};


const allSettings = [ publicAzureSettings, usGovAzureSettings, chinaAzureSettings ];
export default allSettings;
