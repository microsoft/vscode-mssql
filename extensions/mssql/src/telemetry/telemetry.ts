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

// Reusable error object for stack capture - avoids allocation overhead
const stackCaptureError = { stack: "" };

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
 * Captures a call stack with minimal overhead.
 * Uses V8's captureStackTrace for fastest possible capture.
 * Filters out telemetry internal functions.
 */
function captureCallStack(): string {
    // V8 optimization: reuse object, skip this function in trace
    Error.captureStackTrace(stackCaptureError, captureCallStack);
    const raw = stackCaptureError.stack;

    // Fast extraction using indexOf/slice - avoids regex overhead
    let result = "";
    let count = 0;
    let pos = 0;

    while (count < 8 && pos < raw.length) {
        // Find "at "
        const atPos = raw.indexOf("at ", pos);
        if (atPos === -1) break;

        // Find end of line
        let lineEnd = raw.indexOf("\n", atPos);
        if (lineEnd === -1) lineEnd = raw.length;

        // Find opening paren (if exists) to know where function name ends
        let nameEnd = raw.indexOf(" (", atPos + 3);
        if (nameEnd === -1 || nameEnd > lineEnd) {
            nameEnd = lineEnd;
        }

        const name = raw.slice(atPos + 3, nameEnd).trim();

        // Skip empty, anonymous, Object. prefixed, and telemetry internal functions
        if (name && name !== "<anonymous>" && !name.startsWith("Object.")) {
            // Extract base function name for filtering (handle "new ClassName", "async funcName", etc.)
            const baseName = name.split(" ").pop() || name;
            const funcName = baseName.split(".").pop() || baseName;

            if (!SKIP_FUNCTIONS.has(funcName)) {
                if (result) result += " < ";
                result += name;
                count++;
            }
        }

        pos = lineEnd + 1;
    }

    return result;
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
    includeCallStack: boolean = false,
): void {
    const callStack = includeCallStack ? captureCallStack() : undefined;
    let errorEvent = telemetryReporter
        .createErrorEvent2(
            telemetryView,
            telemetryAction,
            error,
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
