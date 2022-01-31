/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthenticationTypes } from '../models/interfaces';

export function getConnectionString(server: string, authType: string, database: string, userName: string, password: string): string {
	const serverDatabasePart = `Server=${server};Database=${database};`;
	switch (authType) {
		case AuthenticationTypes[AuthenticationTypes.SqlLogin]:
			return `${serverDatabasePart}User Id=${userName};Password=${password}`;
		case AuthenticationTypes[AuthenticationTypes.Integrated]:
			return `${serverDatabasePart}Trusted_Connection=True;`;
		case AuthenticationTypes[AuthenticationTypes.AzureMFA]:
			return `${serverDatabasePart}Authentication=True;`;
		default:
			throw new Error(`Unknown authentication type: ${authType}`);
	}
}
