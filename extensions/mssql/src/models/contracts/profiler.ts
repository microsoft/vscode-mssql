/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";

// Profiler Types

/**
 * Template for creating a profiler session
 */
export interface ProfilerSessionTemplate {
    /** Template name */
    name: string;
    /** Default view configuration */
    defaultView: string;
    /** T-SQL CREATE EVENT SESSION statement (use {sessionName} as placeholder) */
    createStatement: string;
}

/**
 * Type of profiling session
 */
export enum ProfilingSessionType {
    /** Remote XEvent session on server */
    RemoteSession = 0,
    /** Local .xel file */
    LocalFile = 1,
}

/**
 * A single profiler event
 */
export interface ProfilerEvent {
    /** Unique identifier for the event (UUID from SQL Tools Service, or generated if not provided) */
    id?: string;
    /** Event sequence number from SQL Tools Service (or generated if not provided) */
    eventNumber?: number;
    /** Event name (e.g., "sql_statement_completed") */
    name: string;
    /** Event timestamp */
    timestamp: string;
    /** Key-value pairs of event data */
    values: Record<string, string>;
}

// Create XEvent Session Request

/**
 * Parameters for creating a new XEvent session
 */
export interface CreateXEventSessionParams {
    /** Connection URI identifier */
    ownerUri: string;
    /** Name for the new session */
    sessionName: string;
    /** Session template */
    template: ProfilerSessionTemplate;
}

/**
 * Result of creating an XEvent session (empty object)
 */
export interface CreateXEventSessionResult {}

export namespace CreateXEventSessionRequest {
    export const type = new RequestType<
        CreateXEventSessionParams,
        CreateXEventSessionResult,
        void,
        void
    >("profiler/createsession");
}

// Start Profiling Request

/**
 * Parameters for starting a profiling session
 */
export interface StartProfilingParams {
    /** Connection URI identifier */
    ownerUri: string;
    /** For RemoteSession: session name. For LocalFile: full path to .xel file */
    sessionName: string;
    /** Type of profiling session (default: RemoteSession) */
    sessionType?: ProfilingSessionType;
}

/**
 * Result of starting a profiling session
 */
export interface StartProfilingResult {
    /** Unique identifier for the session */
    uniqueSessionId: string;
    /** Whether pause operation is supported (false for local files) */
    canPause: boolean;
}

export namespace StartProfilingRequest {
    export const type = new RequestType<StartProfilingParams, StartProfilingResult, void, void>(
        "profiler/start",
    );
}

// Stop Profiling Request

/**
 * Parameters for stopping a profiling session
 */
export interface StopProfilingParams {
    /** Connection URI identifier */
    ownerUri: string;
}

/**
 * Result of stopping a profiling session (empty object)
 */
export interface StopProfilingResult {}

export namespace StopProfilingRequest {
    export const type = new RequestType<StopProfilingParams, StopProfilingResult, void, void>(
        "profiler/stop",
    );
}

// Pause Profiling Request

/**
 * Parameters for pausing a profiling session
 */
export interface PauseProfilingParams {
    /** Connection URI identifier */
    ownerUri: string;
}

/**
 * Result of pausing/resuming a profiling session
 */
export interface PauseProfilingResult {
    /** True if the session is now paused, false if resumed */
    isPaused: boolean;
}

export namespace PauseProfilingRequest {
    export const type = new RequestType<PauseProfilingParams, PauseProfilingResult, void, void>(
        "profiler/pause",
    );
}

// Get XEvent Sessions Request

/**
 * Parameters for getting available XEvent sessions
 */
export interface GetXEventSessionsParams {
    /** Connection URI identifier */
    ownerUri: string;
}

/**
 * Result containing list of available XEvent sessions
 */
export interface GetXEventSessionsResult {
    /** List of session names */
    sessions: string[];
}

export namespace GetXEventSessionsRequest {
    export const type = new RequestType<
        GetXEventSessionsParams,
        GetXEventSessionsResult,
        void,
        void
    >("profiler/getsessions");
}

// Disconnect Session Request

/**
 * Parameters for disconnecting from a profiling session
 */
export interface DisconnectSessionParams {
    /** Connection URI identifier */
    ownerUri: string;
}

/**
 * Result of disconnecting from a profiling session (empty object)
 */
export interface DisconnectSessionResult {}

export namespace DisconnectSessionRequest {
    export const type = new RequestType<
        DisconnectSessionParams,
        DisconnectSessionResult,
        void,
        void
    >("profiler/disconnect");
}

// Profiler Events Available Notification

/**
 * Parameters for profiler events available notification
 */
export interface ProfilerEventsAvailableParams {
    /** Connection URI identifier */
    ownerUri: string;
    /** Array of profiler events */
    events: ProfilerEvent[];
}

export namespace ProfilerEventsAvailableNotification {
    export const type = new NotificationType<ProfilerEventsAvailableParams, void>(
        "profiler/eventsavailable",
    );
}

// Profiler Session Stopped Notification

/**
 * Parameters for profiler session stopped notification
 */
export interface ProfilerSessionStoppedParams {
    /** Connection URI identifier */
    ownerUri: string;
    /** Numeric session ID (server-local) */
    sessionId: number;
    /** Unique cross-server session identifier */
    uniqueSessionId?: string;
    /** Error message if session stopped due to error */
    errorMessage?: string;
}

export namespace ProfilerSessionStoppedNotification {
    export const type = new NotificationType<ProfilerSessionStoppedParams, void>(
        "profiler/sessionstopped",
    );
}

// Profiler Session Created Notification

/**
 * Parameters for profiler session created notification
 */
export interface ProfilerSessionCreatedParams {
    /** Connection URI identifier */
    ownerUri: string;
    /** Name of created session */
    sessionName: string;
    /** Template used to create session */
    templateName: string;
}

export namespace ProfilerSessionCreatedNotification {
    export const type = new NotificationType<ProfilerSessionCreatedParams, void>(
        "profiler/sessioncreated",
    );
}
