/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";

import {
    ActivityStatus,
    ActivityObject,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import AdsTelemetryReporter, {
    TelemetryEventMeasures,
    TelemetryEventProperties,
} from "@microsoft/ads-extension-telemetry";

import { IConnectionProfile } from "../models/interfaces";
import { v4 as uuidv4 } from "uuid";

const packageJson = vscode.extensions.getExtension(vscodeMssql.extension.name).packageJSON;

let packageInfo = {
    name: "vscode-mssql", // Differentiate this from the mssql extension in ADS
    version: packageJson.version,
    aiKey: packageJson.aiKey,
};

const telemetryReporter = new AdsTelemetryReporter<
    TelemetryViews | string,
    TelemetryActions | string
>(packageInfo.name, packageInfo.version, packageInfo.aiKey);

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
    serverInfo?: vscodeMssql.IServerInfo,
): void {
    let actionEvent = telemetryReporter
        .createActionEvent(telemetryView, telemetryAction)
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
    serverInfo?: vscodeMssql.IServerInfo,
): void {
    let errorEvent = telemetryReporter
        .createErrorEvent2(
            telemetryView,
            telemetryAction,
            error,
            includeErrorMessage,
            errorCode,
            errorType,
        )
        .withAdditionalProperties(additionalProps)
        .withAdditionalMeasurements(additionalMeasurements);

    if (connectionInfo) {
        errorEvent = errorEvent.withConnectionInfo(connectionInfo);
    }
    if (serverInfo) {
        errorEvent = errorEvent.withServerInfo(serverInfo);
    }
    errorEvent.send();
}

export function startActivity(
    telemetryView: TelemetryViews,
    telemetryAction: TelemetryActions,
    correlationId?: string,
    additionalProps: TelemetryEventProperties = {},
    additionalMeasurements: TelemetryEventMeasures = {},
): ActivityObject {
    const startTime = performance.now();
    if (!correlationId) {
        correlationId = uuidv4();
    }

    sendActionEvent(telemetryView, telemetryAction, additionalProps, {
        ...additionalMeasurements,
        startTime: Math.round(startTime),
    });

    function update(
        additionalProps: TelemetryEventProperties,
        additionalMeasurements: TelemetryEventMeasures,
    ): void {
        sendActionEvent(
            telemetryView,
            telemetryAction,
            {
                ...additionalProps,
                activityStatus: ActivityStatus.Pending,
            },
            {
                ...additionalMeasurements,
                timeElapsedMs: Math.round(performance.now() - startTime),
            },
        );
    }

    function end(
        activityStatus: ActivityStatus,
        additionalProps: TelemetryEventProperties,
        additionalMeasurements: TelemetryEventMeasures,
    ) {
        sendActionEvent(
            telemetryView,
            telemetryAction,
            {
                ...additionalProps,
                activityStatus: activityStatus,
            },
            {
                ...additionalMeasurements,
                durationMs: Math.round(performance.now() - startTime),
            },
        );
    }

    function endFailed(
        error?: Error,
        includeErrorMessage?: boolean,
        errorCode?: string,
        errorType?: string,
        additionalProps?: TelemetryEventProperties,
        additionalMeasurements?: TelemetryEventMeasures,
    ) {
        sendErrorEvent(
            telemetryView,
            telemetryAction,
            error,
            includeErrorMessage,
            errorCode,
            errorType,
            {
                ...additionalProps,
                activityStatus: ActivityStatus.Failed,
            },
            {
                ...additionalMeasurements,
                durationMs: Math.round(performance.now() - startTime),
            },
        );
    }

    return {
        startTime,
        correlationId,
        update,
        end,
        endFailed,
    };
}
