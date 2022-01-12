/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProviderSettings } from '@microsoft/ads-adal-library';


const publicAzureSettings: ProviderSettings = {
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
			endpoint: 'https://management.azure.com'
		},
		// graphResource: {
		//     id: '',
		//     resource: '',
		//     endpoint: ''
		// },
		databaseResource: {
			id: 'sql',
			resource: 'Sql',
			endpoint: 'https://database.windows.net/'
		}
		// ossRdbmsResource: {
		//     id: '',
		//     resource: '',
		//     endpoint: ''
		// },
		// azureKeyVaultResource: {
		//     id: '',
		//     resource: '',
		//     endpoint: ''
		// },
		// azureDevopsResource: {
		//     id: '',
		//     resource: '',
		//     endpoint: ''
		// }
	}
};

const allSettings = publicAzureSettings;
export default allSettings;
