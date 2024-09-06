/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Utils from './models/utils';

enum Command {
	connect = '/connect',
	openConnectionDialog = '/openConnectionDialog'
}

interface NativeParsedArgs {
	/**
	 * Optional for Azure Data Studio to support URI conversion.
	 * Used to determine file paths to be opened with SQL Editor.
	 * If provided, we connect the given profile to it.
	 * More than one file can be passed to connect to provided profile.
	 */
	_?: string[];
	/**
	 * Deprecated - used by SSMS - authenticationType should be used instead
	 */
	aad?: boolean;
	/**
	 * Supports providing applicationName that will be used for connection profile app name.
	 */
	applicationName?: string;
	/**
	 * Provide authenticationType to be used.
	 * accepted values: AzureMFA, SqlLogin, Integrated, etc.
	 */
	authenticationType?: string
	/**
	 * Operation to perform:
	 * accepted values: connect (default), openConnectionDialog or Id of a command supported by Azure Data Studio.
	 */
	command?: string;
	/**
	 *  Supports providing advanced connection properties that providers support.
	 *  Value must be a json object containing key-value pairs in format: '{"key1":"value1","key2":"value2",...}'
	 */
	connectionProperties?: string;
	/**
	 * Name of database
	 */
	database?: string;
	/**
	 * Deprecated - used by SSMS - authenticationType should be used instead.
	 */
	integrated?: boolean;
	/**
	 * Name of connection provider,
	 * accepted values: mssql (by default), pgsql, etc.
	 */
	provider?: string;
	/**
	 * Name of server
	 */
	server?: string;
	/**
	 * Whether or not to show dashboard
	 * accepted values: true, false (by default).
	 */
	showDashboard?: boolean;
	/**
	 * User name/email address
	 */
	user?: string;
}

export class MssqlProtocolHandler {
	constructor() {

	}

	public handleUri(uri: vscode.Uri): void {
		Utils.logDebug(`[MssqlProtocolHandler][handleUri] URI: ${uri.toString()}`);

		switch (uri.path) {
			case Command.connect:
				this.connect(uri);
			break;
			case Command.openConnectionDialog:
				this.openConnectionDialog(uri);
				break;
			default:
				Utils.logDebug(`[MssqlProtocolHandler][handleUri] Unknown URI path: ${uri.path}`);
				break;
		}
	}

	private connect(uri: vscode.Uri): void {
		vscode.window.showInformationMessage(`URI handled: ${uri.toString()}`);
		this.readProfileFromArgs(uri.query);
	}

	private openConnectionDialog(uri: vscode.Uri): void {
		vscode.window.showInformationMessage(`URI handled: ${uri.toString()}`);
	}

	private readProfileFromArgs(query: string): void {
		const args = new URLSearchParams(query);
		const provider = args.get('provider');
		const server = args.get('server');
		const database = args.get('database');
		const userName = args.get('user');
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
						(userName && userName.length > 0) ? userName.includes('@') ? 'AzureMFA' : 'SqlLogin' :
							'Integrated';

		const applicationName = args.get('applicationName') ? `${args.get('applicationName')}-azdata` : 'azdata';
	}
}
