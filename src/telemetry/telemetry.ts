/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import AdsTelemetryReporter, { TelemetryEventMeasures, TelemetryEventProperties } from '@microsoft/ads-extension-telemetry';
import * as vscodeMssql from 'vscode-mssql';
import { IConnectionProfile } from '../models/interfaces';
import * as vscode from 'vscode';
import { TelemetryActions, TelemetryViews } from './telemetryInterfaces';

const packageJson = vscode.extensions.getExtension(vscodeMssql.extension.name).packageJSON;

let packageInfo = {
	name: packageJson.name,
	version: packageJson.version,
	aiKey: packageJson.aiKey
};

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
	telemetryView: TelemetryViews,
	telemetryAction: TelemetryActions,
	additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
	additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
	connectionInfo?: IConnectionProfile,
	serverInfo?: vscodeMssql.IServerInfo): void {

	let actionEvent = telemetryReporter.createActionEvent(telemetryView, telemetryAction)
		.withAdditionalProperties(additionalProps)
		.withAdditionalMeasurements(additionalMeasurements);

	if (connectionInfo) {
		actionEvent = actionEvent.withConnectionInfo(connectionInfo);
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
	telemetryView: TelemetryViews,
	telemetryAction: TelemetryActions,
	error: Error,
	includeErrorMessage: boolean = false,
	errorCode?: string,
	errorType?: string,
	additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
	additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
	connectionInfo?: IConnectionProfile,
	serverInfo?: vscodeMssql.IServerInfo): void {
	let errorEvent = telemetryReporter.createErrorEvent2(
		telemetryView,
		telemetryAction,
		error,
		includeErrorMessage,
		errorCode,
		errorType).withAdditionalProperties(additionalProps).withAdditionalMeasurements(additionalMeasurements);

	if (connectionInfo) {
		errorEvent = errorEvent.withConnectionInfo(connectionInfo);
	}
	if (serverInfo) {
		errorEvent = errorEvent.withServerInfo(serverInfo);
	}
	errorEvent.send();
}
