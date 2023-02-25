/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NetworkResponse } from '@azure/msal-common';

export class NetworkUtils {
	static getNetworkResponse<T>(headers: Record<string, string>, body: T, statusCode: number): NetworkResponse<T> {
		return {
			headers: headers,
			body: body,
			status: statusCode
		};
	}
}
