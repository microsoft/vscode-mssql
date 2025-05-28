/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType } from "vscode-languageclient";

export enum TraceEventType {
    Critical = 1,
    Error = 2,
    Warning = 4,
    Information = 8,
    Verbose = 16,
    Start = 256,
    Stop = 512,
    Suspend = 1024,
    Resume = 2048,
    Transfer = 4096,
}

export enum LogEvent {
    Default = 0,
    IoFileSystem = 1,
    OsSubSystem = 2,
}

export interface LogEventNotificationParams {
    /**
     * The message to log
     */
    traceEventType: TraceEventType;

    /**
     * The level of the log message
     */
    logEvent: LogEvent;

    /**
     * The message to log
     */
    message: string;
}

export namespace LoggerEventNotification {
    export const type = new NotificationType<LogEventNotificationParams, void>("logger/event");
}
