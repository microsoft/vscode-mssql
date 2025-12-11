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
import { extensionId } from "../constants/constants";

const packageJson = vscode.extensions.getExtension(extensionId).packageJSON;

let packageInfo = {
    name: "vscode-mssql", // Differentiate this from the mssql extension in ADS
    version: packageJson.version,
    aiKey: packageJson.aiKey,
};

const telemetryReporter = new AdsTelemetryReporter<
    TelemetryViews | string,
    TelemetryActions | string
>(packageInfo.name, packageInfo.version, packageInfo.aiKey);

// Function names to skip in call stack (telemetry internals)
const SKIP_FUNCTIONS = new Set([
    "captureCallStack",
    "sendActionEvent",
    "sendErrorEvent",
    "startActivity",
    "update",
    "end",
    "endFailed",
]);

/**
 * Filters a stack trace string to remove internal telemetry functions
 * and limit the number of frames.
 * @param stack The stack trace string to filter
 */
export function filterStack(stack: string): string {
    const frames: string[] = [];
    for (const line of stack.split("\n")) {
        if (frames.length >= 20) break;

        const match = line.match(/at (\S+)/);
        if (!match) continue;

        const name = match[1];

        // Extract the last part of the name for filtering (e.g., "Foo.bar" -> "bar")
        const funcName = name.split(".").pop() || name;
        if (SKIP_FUNCTIONS.has(funcName)) {
            // Only skip if the function is global
            // This prevents skipping user methods that happen to share names with internal functions (e.g. 'update')
            if (name === funcName) {
                continue;
            }
        }

        frames.push(name);
    }

    return frames.join(" < ");
}

/**
 * Captures a call stack and filters out internal telemetry functions
 * and user file paths.
 */
export function captureCallStack(): string {
    const err = { stack: "" };
    Error.captureStackTrace(err, captureCallStack);
    return filterStack(err.stack || "");
}

/**
 * Sends a telemetry event to the telemetry reporter
 * @param telemetryView View in which the event occurred
 * @param telemetryAction Action that was being performed when the event occurred
 * @param additionalProps Additional properties to include
 * @param additionalMeasurements Additional measurements to include
 * @param connectionInfo connectionInfo for the event
 * @param serverInfo serverInfo for the event
 * @param includeCallStack Whether to capture and include the call stack. Defaults to false
 */
export function sendActionEvent(
    telemetryView: TelemetryViews,
    telemetryAction: TelemetryActions,
    additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
    additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
    connectionInfo?: IConnectionProfile,
    serverInfo?: vscodeMssql.IServerInfo,
    includeCallStack: boolean = false,
): void {
    const callStack = includeCallStack ? captureCallStack() : undefined;
    let actionEvent = telemetryReporter
        .createActionEvent(telemetryView, telemetryAction)
        .withAdditionalProperties({
            ...additionalProps,
            ...(callStack && { callStack }),
        })
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
 * @param includeCallStack Whether to capture and include the call stack. Defaults to false
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
    includeCallStack: boolean = true,
): void {
    const callStack = includeCallStack ? captureCallStack() : undefined;
    let errorEvent = telemetryReporter
        .createErrorEvent2(
            telemetryView,
            telemetryAction,
            includeErrorMessage ? error : new Error("Event generated error"),
            includeErrorMessage,
            errorCode,
            errorType,
        )
        .withAdditionalProperties({
            ...additionalProps,
            ...(callStack && { callStack }),
        })
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
    startActivityAdditionalProps: TelemetryEventProperties = {},
    startActivityAdditionalMeasurements: TelemetryEventMeasures = {},
    includeCallStack: boolean = false,
): ActivityObject {
    const startTime = performance.now();
    if (!correlationId) {
        correlationId = uuidv4();
    }

    // Capture call stack if requested
    const callStack = includeCallStack ? captureCallStack() : undefined;

    sendActionEvent(
        telemetryView,
        telemetryAction,
        {
            ...startActivityAdditionalProps,
            ...(callStack && { callStack }),
        },
        {
            ...startActivityAdditionalMeasurements,
            startTime: Math.round(startTime),
        },
    );

    const activityUpdateAdditionalPropsBase: TelemetryEventProperties = {
        correlationId,
        ...startActivityAdditionalProps,
    };

    const activityUpdateAdditionalMeasurementsBase: TelemetryEventMeasures = {
        ...startActivityAdditionalMeasurements,
    };

    function update(
        additionalProps: TelemetryEventProperties,
        additionalMeasurements: TelemetryEventMeasures,
        connectionInfo?: vscodeMssql.IConnectionInfo,
        serverInfo?: vscodeMssql.IServerInfo,
    ): void {
        const updateCallStack = includeCallStack ? captureCallStack() : undefined;
        sendActionEvent(
            telemetryView,
            telemetryAction,
            {
                ...activityUpdateAdditionalPropsBase,
                ...additionalProps,
                activityStatus: ActivityStatus.Pending,
                ...(updateCallStack && { callStack: updateCallStack }),
            },
            {
                ...activityUpdateAdditionalMeasurementsBase,
                ...additionalMeasurements,
                timeElapsedMs: Math.round(performance.now() - startTime),
            },
            connectionInfo as IConnectionProfile,
            serverInfo,
        );
    }

    function end(
        activityStatus: ActivityStatus,
        additionalProps: TelemetryEventProperties,
        additionalMeasurements: TelemetryEventMeasures,
        connectionInfo?: vscodeMssql.IConnectionInfo,
        serverInfo?: vscodeMssql.IServerInfo,
    ) {
        const endCallStack = includeCallStack ? captureCallStack() : undefined;
        sendActionEvent(
            telemetryView,
            telemetryAction,
            {
                ...activityUpdateAdditionalPropsBase,
                ...additionalProps,
                activityStatus: activityStatus,
                ...(endCallStack && { callStack: endCallStack }),
            },
            {
                ...activityUpdateAdditionalMeasurementsBase,
                ...additionalMeasurements,
                durationMs: Math.round(performance.now() - startTime),
            },
            connectionInfo as IConnectionProfile,
            serverInfo,
        );
    }

    function endFailed(
        error?: Error,
        includeErrorMessage?: boolean,
        errorCode?: string,
        errorType?: string,
        additionalProps?: TelemetryEventProperties,
        additionalMeasurements?: TelemetryEventMeasures,
        connectionInfo?: vscodeMssql.IConnectionInfo,
        serverInfo?: vscodeMssql.IServerInfo,
    ) {
        includeErrorMessage = includeErrorMessage ?? false; // Default to false if undefined
        const endFailedCallStack = includeCallStack ? captureCallStack() : undefined;
        sendErrorEvent(
            telemetryView,
            telemetryAction,
            error,
            includeErrorMessage,
            errorCode,
            errorType,
            {
                ...activityUpdateAdditionalPropsBase,
                ...additionalProps,
                activityStatus: ActivityStatus.Failed,
                ...(endFailedCallStack && { callStack: endFailedCallStack }),
            },
            {
                ...activityUpdateAdditionalMeasurementsBase,
                ...additionalMeasurements,
                durationMs: Math.round(performance.now() - startTime),
            },
            connectionInfo as IConnectionProfile,
            serverInfo,
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
