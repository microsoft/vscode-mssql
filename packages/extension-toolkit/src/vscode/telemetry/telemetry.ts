/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import TelemetryReporter, {
    ConnectionInfo,
    ServerInfo,
    TelemetryEventMeasures,
    TelemetryEventProperties,
} from "./telemetryReporter";

export interface ActivityObject {
    startTime: number;
    correlationId: string;
    update(
        additionalProperties?: TelemetryEventProperties,
        additionalMeasurements?: TelemetryEventMeasures,
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
    ): void;
    end(
        activityStatus: string,
        additionalProperties?: TelemetryEventProperties,
        additionalMeasurements?: TelemetryEventMeasures,
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
    ): void;
    endFailed(
        error?: Error,
        includeErrorMessage?: boolean,
        errorCode?: string,
        errorType?: string,
        additionalProperties?: TelemetryEventProperties,
        additionalMeasurements?: TelemetryEventMeasures,
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
    ): void;
}

/** Options shared by telemetry events and activities. */
export interface TelemetryEventOptions {
    /** Additional properties to include in the telemetry event. */
    additionalProps?: TelemetryEventProperties | { [key: string]: string };
    /** Additional measurements to include in the telemetry event. */
    additionalMeasurements?: TelemetryEventMeasures | { [key: string]: number };
    /** Connection information to include in the telemetry event. */
    connectionInfo?: ConnectionInfo;
    /** Server information to include in the telemetry event. */
    serverInfo?: ServerInfo;
}

/** Options for sending an action telemetry event. */
export interface SendActionEventOptions extends TelemetryEventOptions {
    /** Whether to capture and include the call stack. Defaults to false. */
    includeCallStack?: boolean;
}

/** Options for sending an error telemetry event. */
export interface SendErrorEventOptions extends TelemetryEventOptions {
    /** The error associated with the telemetry event. */
    error?: Error;
    /** Whether to include the error message in the telemetry event. Defaults to false. */
    includeErrorMessage?: boolean;
    /** Error code to include in the telemetry event. */
    errorCode?: string;
    /** Error type to include in the telemetry event. */
    errorType?: string;
    /** Whether to capture and include the call stack. Defaults to true. */
    includeCallStack?: boolean;
}

/** Options for starting a telemetry activity. */
export interface StartActivityOptions extends TelemetryEventOptions {
    /** Correlation ID for the activity. A new UUID is generated when omitted. */
    correlationId?: string;
    /** Whether to capture and include call stacks for the activity. Defaults to false. */
    includeCallStack?: boolean;
}

export let telemetryReporter = new TelemetryReporter(undefined);

export function initializeTelemetryReporter(
    connectionString: string | undefined,
): TelemetryReporter {
    telemetryReporter = new TelemetryReporter(connectionString);
    return telemetryReporter;
}

// Function names to skip in call stack (telemetry internals)
const SKIP_FUNCTIONS = new Set([
    "captureCallStack",
    "sendActionEvent",
    "sendActionEventWithOptions",
    "sendErrorEvent",
    "sendErrorEventWithOptions",
    "startActivity",
    "startActivityWithOptions",
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

        const match = line.match(/at ((?:async )?\S+)/);
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
    telemetryView: string,
    telemetryAction: string,
    additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
    additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
    connectionInfo?: ConnectionInfo,
    serverInfo?: ServerInfo,
    includeCallStack: boolean = false,
): void {
    sendActionEventWithOptions(telemetryView, telemetryAction, {
        additionalProps,
        additionalMeasurements,
        connectionInfo,
        serverInfo,
        includeCallStack,
    });
}

/**
 * Sends an action event to the telemetry reporter using named options.
 * @param telemetryView View in which the event occurred.
 * @param telemetryAction Action that was being performed when the event occurred.
 * @param options Optional event properties, measurements, connection metadata, and call stack behavior.
 */
export function sendActionEventWithOptions(
    telemetryView: string,
    telemetryAction: string,
    {
        additionalProps = {},
        additionalMeasurements = {},
        connectionInfo,
        serverInfo,
        includeCallStack = false,
    }: SendActionEventOptions = {},
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
 * @param includeCallStack Whether to capture and include the call stack. Defaults to true
 */
export function sendErrorEvent(
    telemetryView: string,
    telemetryAction: string,
    error: Error | undefined,
    includeErrorMessage: boolean = false,
    errorCode?: string,
    errorType?: string,
    additionalProps: TelemetryEventProperties | { [key: string]: string } = {},
    additionalMeasurements: TelemetryEventMeasures | { [key: string]: number } = {},
    connectionInfo?: ConnectionInfo,
    serverInfo?: ServerInfo,
    includeCallStack: boolean = true,
): void {
    sendErrorEventWithOptions(telemetryView, telemetryAction, {
        error,
        includeErrorMessage,
        errorCode,
        errorType,
        additionalProps,
        additionalMeasurements,
        connectionInfo,
        serverInfo,
        includeCallStack,
    });
}

/**
 * Sends an error event to the telemetry reporter using named options.
 * @param telemetryView View in which the error occurred.
 * @param telemetryAction Action that was being performed when the error occurred.
 * @param options Optional error details, event data, connection metadata, and call stack behavior.
 */
export function sendErrorEventWithOptions(
    telemetryView: string,
    telemetryAction: string,
    {
        error,
        includeErrorMessage = false,
        errorCode,
        errorType,
        additionalProps = {},
        additionalMeasurements = {},
        connectionInfo,
        serverInfo,
        includeCallStack = true,
    }: SendErrorEventOptions = {},
): void {
    const callStack = includeCallStack ? captureCallStack() : undefined;
    let errorEvent = telemetryReporter
        .createErrorEvent(
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
    telemetryView: string,
    telemetryAction: string,
    correlationId?: string,
    startActivityAdditionalProps: TelemetryEventProperties = {},
    startActivityAdditionalMeasurements: TelemetryEventMeasures = {},
    connectionInfo?: ConnectionInfo,
    serverInfo?: ServerInfo,
    includeCallStack: boolean = false,
): ActivityObject {
    return startActivityWithOptions(telemetryView, telemetryAction, {
        correlationId,
        additionalProps: startActivityAdditionalProps,
        additionalMeasurements: startActivityAdditionalMeasurements,
        connectionInfo,
        serverInfo,
        includeCallStack,
    });
}

/**
 * Starts a telemetry activity using named options.
 * @param telemetryView View in which the activity occurs.
 * @param telemetryAction Action performed by the activity.
 * @param options Optional correlation ID, event data, connection metadata, and call stack behavior.
 * @returns An object used to update and complete the activity.
 */
export function startActivityWithOptions(
    telemetryView: string,
    telemetryAction: string,
    {
        correlationId,
        additionalProps: startActivityAdditionalProps = {},
        additionalMeasurements: startActivityAdditionalMeasurements = {},
        connectionInfo,
        serverInfo,
        includeCallStack = false,
    }: StartActivityOptions = {},
): ActivityObject {
    const startTime = performance.now();
    if (!correlationId) {
        correlationId = randomUUID();
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
        connectionInfo,
        serverInfo,
    );

    const activityUpdateAdditionalPropsBase: TelemetryEventProperties = {
        correlationId,
        ...startActivityAdditionalProps,
    };

    const activityUpdateAdditionalMeasurementsBase: TelemetryEventMeasures = {
        ...startActivityAdditionalMeasurements,
    };

    function update(
        additionalProps: TelemetryEventProperties = {},
        additionalMeasurements: TelemetryEventMeasures = {},
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
    ): void {
        const updateCallStack = includeCallStack ? captureCallStack() : undefined;
        sendActionEvent(
            telemetryView,
            telemetryAction,
            {
                ...activityUpdateAdditionalPropsBase,
                ...additionalProps,
                activityStatus: "Pending",
                ...(updateCallStack && { callStack: updateCallStack }),
            },
            {
                ...activityUpdateAdditionalMeasurementsBase,
                ...additionalMeasurements,
                timeElapsedMs: Math.round(performance.now() - startTime),
            },
            connectionInfo,
            serverInfo,
        );
    }

    function end(
        activityStatus: string,
        additionalProps: TelemetryEventProperties = {},
        additionalMeasurements: TelemetryEventMeasures = {},
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
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
            connectionInfo,
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
        connectionInfo?: ConnectionInfo,
        serverInfo?: ServerInfo,
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
                activityStatus: "Failed",
                ...(endFailedCallStack && { callStack: endFailedCallStack }),
            },
            {
                ...activityUpdateAdditionalMeasurementsBase,
                ...additionalMeasurements,
                durationMs: Math.round(performance.now() - startTime),
            },
            connectionInfo,
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
