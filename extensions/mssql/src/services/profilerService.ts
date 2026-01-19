/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    CreateXEventSessionParams,
    CreateXEventSessionRequest,
    CreateXEventSessionResult,
    DisconnectSessionParams,
    DisconnectSessionRequest,
    DisconnectSessionResult,
    GetXEventSessionsParams,
    GetXEventSessionsRequest,
    GetXEventSessionsResult,
    PauseProfilingParams,
    PauseProfilingRequest,
    PauseProfilingResult,
    ProfilerEventsAvailableNotification,
    ProfilerEventsAvailableParams,
    ProfilerSessionCreatedNotification,
    ProfilerSessionCreatedParams,
    ProfilerSessionStoppedNotification,
    ProfilerSessionStoppedParams,
    ProfilerSessionTemplate,
    ProfilingSessionType,
    StartProfilingParams,
    StartProfilingRequest,
    StartProfilingResult,
    StopProfilingParams,
    StopProfilingRequest,
    StopProfilingResult,
} from "../models/contracts/profiler";

/**
 * Handler function type for profiler events available notification
 */
export type ProfilerEventsAvailableHandler = (params: ProfilerEventsAvailableParams) => void;

/**
 * Handler function type for profiler session stopped notification
 */
export type ProfilerSessionStoppedHandler = (params: ProfilerSessionStoppedParams) => void;

/**
 * Handler function type for profiler session created notification
 */
export type ProfilerSessionCreatedHandler = (params: ProfilerSessionCreatedParams) => void;

/**
 * Service for interacting with the SQL Tools Service ProfilerService.
 * Provides XEvent profiling capabilities including session management and event streaming.
 */
export class ProfilerService {
    private _eventsAvailableHandlers: Map<string, ProfilerEventsAvailableHandler[]> = new Map();
    private _sessionStoppedHandlers: Map<string, ProfilerSessionStoppedHandler[]> = new Map();
    private _sessionCreatedHandlers: Map<string, ProfilerSessionCreatedHandler[]> = new Map();

    constructor(private _client: SqlToolsServiceClient) {
        this.registerNotificationHandlers();
    }

    /**
     * Registers handlers for server-to-client notifications
     */
    private registerNotificationHandlers(): void {
        // Handle profiler events available notifications
        this._client.onNotification(
            ProfilerEventsAvailableNotification.type,
            (params: ProfilerEventsAvailableParams) => {
                const handlers = this._eventsAvailableHandlers.get(params.ownerUri);
                if (handlers) {
                    handlers.forEach((handler) => handler(params));
                }
            },
        );

        // Handle profiler session stopped notifications
        this._client.onNotification(
            ProfilerSessionStoppedNotification.type,
            (params: ProfilerSessionStoppedParams) => {
                const handlers = this._sessionStoppedHandlers.get(params.ownerUri);
                if (handlers) {
                    handlers.forEach((handler) => handler(params));
                }
            },
        );

        // Handle profiler session created notifications
        this._client.onNotification(
            ProfilerSessionCreatedNotification.type,
            (params: ProfilerSessionCreatedParams) => {
                const handlers = this._sessionCreatedHandlers.get(params.ownerUri);
                if (handlers) {
                    handlers.forEach((handler) => handler(params));
                }
            },
        );
    }

    /**
     * Creates a new XEvent session on the server
     * @param ownerUri Connection URI identifier
     * @param sessionName Name for the new session
     * @param template Session template containing the CREATE EVENT SESSION statement
     * @returns Promise that resolves when the session is created
     */
    public async createXEventSession(
        ownerUri: string,
        sessionName: string,
        template: ProfilerSessionTemplate,
    ): Promise<CreateXEventSessionResult> {
        const params: CreateXEventSessionParams = {
            ownerUri,
            sessionName,
            template,
        };

        try {
            return await this._client.sendRequest(CreateXEventSessionRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to create XEvent session: ${e}`);
            throw e;
        }
    }

    /**
     * Starts profiling on an existing XEvent session or opens a local XEL file
     * @param ownerUri Connection URI identifier
     * @param sessionName For RemoteSession: session name. For LocalFile: full path to .xel file
     * @param sessionType Type of profiling session (default: RemoteSession)
     * @returns Promise containing the unique session ID and pause capability
     */
    public async startProfiling(
        ownerUri: string,
        sessionName: string,
        sessionType: ProfilingSessionType = ProfilingSessionType.RemoteSession,
    ): Promise<StartProfilingResult> {
        const params: StartProfilingParams = {
            ownerUri,
            sessionName,
            sessionType,
        };

        try {
            return await this._client.sendRequest(StartProfilingRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to start profiling: ${e}`);
            throw e;
        }
    }

    /**
     * Stops a profiling session and the server-side XEvent session
     * @param ownerUri Connection URI identifier
     * @returns Promise that resolves when the session is stopped
     */
    public async stopProfiling(ownerUri: string): Promise<StopProfilingResult> {
        const params: StopProfilingParams = {
            ownerUri,
        };

        try {
            return await this._client.sendRequest(StopProfilingRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to stop profiling: ${e}`);
            throw e;
        }
    }

    /**
     * Pauses event delivery for a profiling session (viewer-side only, session continues on server)
     * Calling this again will resume the session (toggle behavior).
     * Note: This is not supported for local file sessions
     * @param ownerUri Connection URI identifier
     * @returns Promise that resolves when the session is paused/resumed
     */
    public async pauseProfiling(ownerUri: string): Promise<PauseProfilingResult> {
        const params: PauseProfilingParams = {
            ownerUri,
        };

        try {
            return await this._client.sendRequest(PauseProfilingRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to pause profiling: ${e}`);
            throw e;
        }
    }

    /**
     * Gets a list of all XEvent sessions on the connected server
     * @param ownerUri Connection URI identifier
     * @returns Promise containing the list of session names
     */
    public async getXEventSessions(ownerUri: string): Promise<GetXEventSessionsResult> {
        const params: GetXEventSessionsParams = {
            ownerUri,
        };

        try {
            return await this._client.sendRequest(GetXEventSessionsRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to get XEvent sessions: ${e}`);
            throw e;
        }
    }

    /**
     * Disconnects from a profiling session without stopping the server-side session
     * @param ownerUri Connection URI identifier
     * @returns Promise that resolves when disconnected
     */
    public async disconnectSession(ownerUri: string): Promise<DisconnectSessionResult> {
        const params: DisconnectSessionParams = {
            ownerUri,
        };

        try {
            return await this._client.sendRequest(DisconnectSessionRequest.type, params);
        } catch (e) {
            this._client.logger.error(`Failed to disconnect session: ${e}`);
            throw e;
        }
    }

    /**
     * Registers a handler for profiler events available notifications
     * @param ownerUri Connection URI to listen for events on
     * @param handler Function to call when events are available
     * @returns Disposable to unregister the handler
     */
    public onEventsAvailable(
        ownerUri: string,
        handler: ProfilerEventsAvailableHandler,
    ): vscode.Disposable {
        if (!this._eventsAvailableHandlers.has(ownerUri)) {
            this._eventsAvailableHandlers.set(ownerUri, []);
        }
        this._eventsAvailableHandlers.get(ownerUri)!.push(handler);

        return new vscode.Disposable(() => {
            const handlers = this._eventsAvailableHandlers.get(ownerUri);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
                if (handlers.length === 0) {
                    this._eventsAvailableHandlers.delete(ownerUri);
                }
            }
        });
    }

    /**
     * Registers a handler for profiler session stopped notifications
     * @param ownerUri Connection URI to listen for events on
     * @param handler Function to call when the session stops
     * @returns Disposable to unregister the handler
     */
    public onSessionStopped(
        ownerUri: string,
        handler: ProfilerSessionStoppedHandler,
    ): vscode.Disposable {
        if (!this._sessionStoppedHandlers.has(ownerUri)) {
            this._sessionStoppedHandlers.set(ownerUri, []);
        }
        this._sessionStoppedHandlers.get(ownerUri)!.push(handler);

        return new vscode.Disposable(() => {
            const handlers = this._sessionStoppedHandlers.get(ownerUri);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
                if (handlers.length === 0) {
                    this._sessionStoppedHandlers.delete(ownerUri);
                }
            }
        });
    }

    /**
     * Registers a handler for profiler session created notifications
     * @param ownerUri Connection URI to listen for events on
     * @param handler Function to call when a session is created
     * @returns Disposable to unregister the handler
     */
    public onSessionCreated(
        ownerUri: string,
        handler: ProfilerSessionCreatedHandler,
    ): vscode.Disposable {
        if (!this._sessionCreatedHandlers.has(ownerUri)) {
            this._sessionCreatedHandlers.set(ownerUri, []);
        }
        this._sessionCreatedHandlers.get(ownerUri)!.push(handler);

        return new vscode.Disposable(() => {
            const handlers = this._sessionCreatedHandlers.get(ownerUri);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
                if (handlers.length === 0) {
                    this._sessionCreatedHandlers.delete(ownerUri);
                }
            }
        });
    }

    /**
     * Cleans up all registered handlers for a specific connection
     * @param ownerUri Connection URI to clean up handlers for
     */
    public cleanupHandlers(ownerUri: string): void {
        this._eventsAvailableHandlers.delete(ownerUri);
        this._sessionStoppedHandlers.delete(ownerUri);
        this._sessionCreatedHandlers.delete(ownerUri);
    }
}
