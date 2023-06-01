/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import AdsTelemetryReporter, { TelemetryEventMeasures, TelemetryEventProperties } from '@microsoft/ads-extension-telemetry';
import { IServerInfo } from 'vscode-mssql';
import { IConnectionProfile } from './models/interfaces';
import * as vscode from 'vscode';

const packageJson = vscode.extensions.getExtension('ms-mssql.mssql').packageJSON;

let packageInfo = {
	name: packageJson.name,
	version: packageJson.version,
	aiKey: packageJson.aiKey
};

export enum TelemetryViews {
	ObjectExplorer = 'ObjectExplorer',
	CommandPallet = 'CommandPallet',
	SqlProjects = 'SqlProjects',
	QueryEditor = 'QueryEditor',
	ResultsGrid = 'ResultsGrid',
	ConnectionPrompt = 'ConnectionPrompt'
}

export enum TelemetryActions {
	Scripting = 'Scripting',
	Refresh = 'Refresh',
	CreateProject = 'CreateProject',
	RemoveConnection = 'RemoveConnection',
	Disconnect = 'Disconnect',
	NewQuery = 'NewQuery',
	RunQuery = 'RunQuery',
	QueryExecutionCompleted = 'QueryExecutionCompleted',
	ResultPaneAction = 'ResultPaneAction',
	CreateConnection = 'CreateConnection',
	ConnectionCreated = 'ConnectionCreated',
	ConnectionFailed = 'ConnectionFailed',
	ExpandNode = 'ExpandNode'
}

const telemetryReporter = new AdsTelemetryReporter<TelemetryViews | string, TelemetryActions | string>(packageInfo.name, packageInfo.version, packageInfo.aiKey);

/**
 * Sends a telemetry event to the telemetry reporter
 * @param telemetryView View in which the event occurred
 * @param telemetryAction Action that was being performed when the event occurred
 * @param additionalProps Error that occurred
 * @param additionalMeasurements Error that occurred
 * @param connectionInfo connectionInfo for the event
 * @param serverInfo serverInfo for the event
 */
export function sendActionEvent(
	telemetryView: TelemetryViews | string,
	telemetryAction: TelemetryActions | string,
	additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
	additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
	connectionInfo?: IConnectionProfile,
	serverInfo?: IServerInfo): void {

	let actionEvent = telemetryReporter.createActionEvent(telemetryView, telemetryAction)
		.withAdditionalProperties(additionalProps)
		.withAdditionalMeasurements(additionalMeasurements);

	if (connectionInfo) {
		actionEvent = actionEvent.withConnectionInfo({ ...connectionInfo, providerName: 'MSSQL' });
	}
	if (serverInfo) {
		actionEvent = actionEvent.withServerInfo(serverInfo);
	}
	actionEvent.send();
}


/**
 * Sends an error event to the telemetry reporter
 * @param telemetryView View in which the error occurred
 * @param telemetryAction Action that was being performed when the error occurred
 * @param error Error that occurred
 * @param includeErrorMessage Whether to include the error message in the telemetry event. Defaults to false
 * @param errorCode Error code for the error
 * @param errorType Error type for the error
 * @param additionalProps Additional properties to include in the telemetry event
 * @param additionalMeasurements Additional measurements to include in the telemetry event
 * @param connectionInfo connectionInfo for the error
 * @param serverInfo serverInfo for the error
 */
export function sendErrorEvent(
	telemetryView: TelemetryViews | string,
	telemetryAction: TelemetryActions | string,
	error: Error,
	includeErrorMessage: boolean = false,
	errorCode?: string,
	errorType?: string,
	additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
	additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
	connectionInfo?: IConnectionProfile,
	serverInfo?: IServerInfo): void {
	let errorEvent = telemetryReporter.createErrorEvent2(
		telemetryView,
		telemetryAction,
		error,
		includeErrorMessage,
		errorCode,
		errorType).withAdditionalProperties(additionalProps).withAdditionalMeasurements(additionalMeasurements);

	if (connectionInfo) {
		errorEvent = errorEvent.withConnectionInfo(<any>connectionInfo);
	}
	if (serverInfo) {
		errorEvent = errorEvent.withServerInfo(<any>serverInfo);
	}
	errorEvent.send();
}
