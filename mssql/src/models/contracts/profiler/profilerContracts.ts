/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType, NotificationType } from "vscode-languageclient";
import * as mssql from "vscode-mssql";

export namespace CreateXEventSessionRequest {
    export const type = new RequestType<
        mssql.CreateXEventSessionParams,
        mssql.CreateXEventSessionResponse,
        void,
        void
    >("profiler/createsession");
}

export namespace StartProfilingRequest {
    export const type = new RequestType<
        mssql.StartProfilingParams,
        mssql.StartProfilingResponse,
        void,
        void
    >("profiler/start");
}

export namespace StopProfilingRequest {
    export const type = new RequestType<
        mssql.StopProfilingParams,
        mssql.StopProfilingResponse,
        void,
        void
    >("profiler/stop");
}

export namespace PauseProfilingRequest {
    export const type = new RequestType<
        mssql.PauseProfilingParams,
        mssql.PauseProfilingResponse,
        void,
        void
    >("profiler/pause");
}

export namespace GetXEventSessionsRequest {
    export const type = new RequestType<
        mssql.GetXEventSessionsParams,
        mssql.GetXEventSessionsResponse,
        void,
        void
    >("profiler/getsessions");
}

export namespace DisconnectSessionRequest {
    export const type = new RequestType<
        mssql.DisconnectSessionParams,
        mssql.DisconnectSessionResponse,
        void,
        void
    >("profiler/disconnect");
}

// Notification type definitions

export namespace ProfilerEventsAvailableNotification {
    export const type = new NotificationType<mssql.ProfilerEventsAvailableParams, void>(
        "profiler/eventsavailable",
    );
}

export namespace ProfilerSessionStoppedNotification {
    export const type = new NotificationType<mssql.ProfilerSessionStoppedParams, void>(
        "profiler/sessionstopped",
    );
}

export namespace ProfilerSessionCreatedNotification {
    export const type = new NotificationType<mssql.ProfilerSessionCreatedParams, void>(
        "profiler/sessioncreated",
    );
}
