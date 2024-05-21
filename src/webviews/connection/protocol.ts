// import type { Config } from '../../config';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification } from '../protocol';

export const scope: IpcScope = 'connection';


export interface State extends WebviewState {
	version: string;
	config: {
		codeLens: boolean
		currentLine: boolean
	};
	serverName?: string;
	databaseName?: string;
	username?: string;
	password?: string;
}

// COMMANDS

export interface UpdateConfigurationParams {
	type: 'codeLens' | 'currentLine';
	value: boolean;
}
export const UpdateConfigurationCommand = new IpcCommand<UpdateConfigurationParams>(scope, 'configuration/update');

export const ConnectCommand = new IpcCommand(scope, 'connection/connect');
export const CancelCommand = new IpcCommand(scope, 'connection/cancel');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);

