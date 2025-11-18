/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as profilerContracts from "../models/contracts/profiler/profilerContracts";
import type * as mssql from "vscode-mssql";

export class ProfilerService implements mssql.IProfilerService {
    constructor(private _client: SqlToolsServiceClient) {}

    public createSession(
        ownerUri: string,
        sessionName: string,
        template: mssql.ProfilerSessionTemplate,
    ): Thenable<boolean> {
        const params: mssql.CreateXEventSessionParams = {
            ownerUri,
            sessionName,
            template,
        };
        return this._client
            .sendRequest(profilerContracts.CreateXEventSessionRequest.type, params)
            .then(
                () => true,
                (e) => {
                    console.error("CreateXEventSession request failed:", e);
                    return Promise.reject(e);
                },
            );
    }

    public startSession(
        ownerUri: string,
        sessionName: string,
        sessionType: mssql.ProfilingSessionType = 1, // ProfilingSessionType.RemoteSession
    ): Thenable<boolean> {
        const params: mssql.StartProfilingParams = {
            ownerUri,
            sessionName,
            sessionType,
        };
        return this._client.sendRequest(profilerContracts.StartProfilingRequest.type, params).then(
            () => true,
            (e) => {
                console.error("StartProfiling request failed:", e);
                return Promise.reject(e);
            },
        );
    }

    public stopSession(ownerUri: string): Thenable<boolean> {
        const params: mssql.StopProfilingParams = { ownerUri };
        return this._client.sendRequest(profilerContracts.StopProfilingRequest.type, params).then(
            () => true,
            (e) => {
                console.error("StopProfiling request failed:", e);
                return Promise.reject(e);
            },
        );
    }

    public pauseSession(ownerUri: string): Thenable<boolean> {
        const params: mssql.PauseProfilingParams = { ownerUri };
        return this._client.sendRequest(profilerContracts.PauseProfilingRequest.type, params).then(
            () => true,
            (e) => {
                console.error("PauseProfiling request failed:", e);
                return Promise.reject(e);
            },
        );
    }

    public getXEventSessions(ownerUri: string): Thenable<string[]> {
        const params: mssql.GetXEventSessionsParams = { ownerUri };
        return this._client
            .sendRequest(profilerContracts.GetXEventSessionsRequest.type, params)
            .then(
                (r) => r.sessions,
                (e) => {
                    console.error("GetXEventSessions request failed:", e);
                    return Promise.reject(e);
                },
            );
    }

    public connectSession(_sessionId: string): Thenable<boolean> {
        // Not implemented in MSSQL backend
        return Promise.resolve(false);
    }

    public disconnectSession(ownerUri: string): Thenable<boolean> {
        const params: mssql.DisconnectSessionParams = { ownerUri };
        return this._client
            .sendRequest(profilerContracts.DisconnectSessionRequest.type, params)
            .then(
                () => true,
                (e) => {
                    console.error("DisconnectSession request failed:", e);
                    return Promise.reject(e);
                },
            );
    }

    public registerOnSessionEventsAvailable(
        handler: (response: mssql.ProfilerSessionEvents) => void,
    ): void {
        this._client.onNotification(
            profilerContracts.ProfilerEventsAvailableNotification.type,
            (params) => {
                handler({
                    sessionId: params.ownerUri,
                    events: params.events,
                    eventsLost: params.eventsLost,
                });
            },
        );
    }

    public registerOnSessionStopped(
        handler: (response: mssql.ProfilerSessionStoppedParams) => void,
    ): void {
        this._client.onNotification(
            profilerContracts.ProfilerSessionStoppedNotification.type,
            (params) => {
                handler({
                    ownerUri: params.ownerUri,
                    sessionId: params.sessionId,
                });
            },
        );
    }

    public registerOnProfilerSessionCreated(
        handler: (response: mssql.ProfilerSessionCreatedParams) => void,
    ): void {
        this._client.onNotification(
            profilerContracts.ProfilerSessionCreatedNotification.type,
            (params) => {
                handler({
                    ownerUri: params.ownerUri,
                    sessionName: params.sessionName,
                    templateName: params.templateName,
                });
            },
        );
    }
}
