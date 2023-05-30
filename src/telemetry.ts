/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import AdsTelemetryReporter, { TelemetryEventMeasures, TelemetryEventProperties } from '@microsoft/ads-extension-telemetry';
import { IServerInfo } from 'vscode-mssql';
import * as fs from 'fs';
import * as path from 'path';

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
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
	ResultPaneAction = 'ResultPaneAction'
}

export const TelemetryReporter = new AdsTelemetryReporter<TelemetryViews, TelemetryActions>(packageInfo.name, packageInfo.version, packageInfo.aiKey);

export function sendTelemetryEvent(
	telemetryView: TelemetryViews,
	telemetryAction: TelemetryActions,
	additionalProps: TelemetryEventProperties,
	additionalMeasurements: TelemetryEventMeasures,
	serverInfo?: IServerInfo): void {
	if (serverInfo) {
		fillServerInfo(additionalProps, serverInfo);
	}
	TelemetryReporter.createActionEvent(telemetryView, telemetryAction)
		.withAdditionalProperties(additionalProps)
		.withAdditionalMeasurements(additionalMeasurements)
		.send();
}

/**
 * Collects server information from ServerInfo to put into a
 * property bag
 */
export function fillServerInfo(telemetryInfo: { [key: string]: string }, serverInfo: IServerInfo): void {
	telemetryInfo['serverEdition'] = serverInfo?.serverEdition;
	telemetryInfo['serverLevel'] = serverInfo?.serverLevel;
	telemetryInfo['serverMajorVersion'] = serverInfo?.serverMajorVersion?.toString() || '';
	telemetryInfo['serverMinorVersion'] = serverInfo?.serverMinorVersion?.toString() || '';
	telemetryInfo['isCloud'] = serverInfo?.isCloud.toString();
}