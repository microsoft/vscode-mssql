/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Utils from './models/utils';
import { IConnectionInfo } from 'vscode-mssql';

enum Command {
	connect = '/connect',
	openConnectionDialog = '/openConnectionDialog'
}

export class MssqlProtocolHandler {
	constructor() {

	}

	public handleUri(uri: vscode.Uri): IConnectionInfo | undefined {
		Utils.logDebug(`[MssqlProtocolHandler][handleUri] URI: ${uri.toString()}`);

		switch (uri.path) {
			case Command.connect:
				Utils.logDebug(`[MssqlProtocolHandler][handleUri] connect: ${uri.path}`);
				return this.connect(uri);

			case Command.openConnectionDialog:
				return undefined;

			default:
				Utils.logDebug(`[MssqlProtocolHandler][handleUri] Unknown URI path, defaulting to connect: ${uri.path}`);
				return this.connect(uri);
		}
	}

	private connect(uri: vscode.Uri): IConnectionInfo {
		return this.readProfileFromArgs(uri.query);
	}

	private readProfileFromArgs(query: string): IConnectionInfo {
		const args = new URLSearchParams(query);
		const server = args.get('server');
		const database = args.get('database');
		const user = args.get('user');
		/*
			Authentication Type:
			1. Take --authenticationType, if not
			2. Take --integrated, if not
			3. take --aad, if not
			4. If user exists, and user has @, then it's azureMFA
			5. If user exists but doesn't have @, then its SqlLogin
			6. If user doesn't exist, then integrated
		*/
		const authenticationType =
			args.get('authenticationType') ? args.get('authenticationType') :
				args.get('integrated') ? 'Integrated' :
					args.get('aad') ? 'AzureMFA' :
						(user && user.length > 0) ? user.includes('@') ? 'AzureMFA' : 'SqlLogin' :
							'Integrated';

		const applicationName = args.get('applicationName') ? `${args.get('applicationName')}-azdata` : 'azdata';

		return {
			server,
			database,
			user,
			authenticationType,
			applicationName
		} as IConnectionInfo;
	}
}
