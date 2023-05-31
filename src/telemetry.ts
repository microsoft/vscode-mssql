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
export function sendActionEvent(
	telemetryView: TelemetryViews | string,
	telemetryAction: TelemetryActions | string,
	additionalProps: TelemetryEventProperties | { [key: string]: string },
	additionalMeasurements: TelemetryEventMeasures | {[key: string]: number},
	connectionInfo?: IConnectionProfile,
	serverInfo?: IServerInfo): void {

	let actionEvent = telemetryReporter.createActionEvent(telemetryView, telemetryAction)
	.withAdditionalProperties(additionalProps)
	.withAdditionalMeasurements(additionalMeasurements);

	if(connectionInfo){
		actionEvent = actionEvent.withConnectionInfo(connectionInfo);
	}
	if (serverInfo) {
		actionEvent = actionEvent.withServerInfo(serverInfo);
	}
	actionEvent.send();
}