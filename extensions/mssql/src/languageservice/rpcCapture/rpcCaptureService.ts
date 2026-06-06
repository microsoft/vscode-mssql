/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    RpcCaptureChannel,
    RpcCaptureEvent,
    RpcCaptureExport,
    RpcCaptureFilter,
    RpcCaptureSession,
    RpcCaptureStatus,
    RpcCaptureSummary,
    RpcInspectorWebviewState,
    RpcMessageDirection,
    RpcMessageKind,
    RpcRedactionSummary,
} from "../../sharedInterfaces/rpcInspector";
import { RpcPayloadRedactor } from "./rpcPayloadRedactor";

interface PendingRequest {
    event: RpcCaptureEvent;
    timestampMs: number;
}

interface CaptureServiceOptions {
    bufferCapacity?: number;
    sessionCapacity?: number;
    redactor?: RpcPayloadRedactor;
}

interface JsonRpcMessageShape {
    id?: string | number | null;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
}

const DEFAULT_BUFFER_CAPACITY = 5000;
const DEFAULT_SESSION_CAPACITY = 10000;

export class RpcCaptureService implements vscode.Disposable {
    private static _instance: RpcCaptureService | undefined;

    private readonly _bufferCapacity: number;
    private readonly _sessionCapacity: number;
    private readonly _redactor: RpcPayloadRedactor;
    private readonly _events: RpcCaptureEvent[] = [];
    private readonly _sessions = new Map<string, RpcCaptureSession>();
    private readonly _sessionEvents = new Map<string, RpcCaptureEvent[]>();
    private readonly _pendingRequests = new Map<string, PendingRequest>();
    private readonly _onDidChange = new vscode.EventEmitter<RpcInspectorWebviewState>();
    private _nextEventId = 1;
    private _nextSessionId = 1;
    private _filter: RpcCaptureFilter = {};

    public readonly onDidChange = this._onDidChange.event;

    public static getInstance(): RpcCaptureService {
        if (!RpcCaptureService._instance) {
            RpcCaptureService._instance = new RpcCaptureService();
        }
        return RpcCaptureService._instance;
    }

    public constructor(options: CaptureServiceOptions = {}) {
        this._bufferCapacity = options.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY;
        this._sessionCapacity = options.sessionCapacity ?? DEFAULT_SESSION_CAPACITY;
        this._redactor = options.redactor ?? new RpcPayloadRedactor();
    }

    public recordMessage(
        channel: RpcCaptureChannel,
        direction: RpcMessageDirection,
        message: unknown,
    ): void {
        if (Array.isArray(message)) {
            for (const item of message) {
                this.recordMessage(channel, direction, item);
            }
            return;
        }

        const shape = this.toJsonRpcMessage(message);
        if (!shape) {
            const params = this.sanitize(message);
            this.addEvent({
                eventId: this.nextEventId(),
                timestamp: new Date().toISOString(),
                channel,
                direction,
                kind: "unknown",
                status: "unknown",
                params: params.value,
                redactionSummary: params.summary,
            });
            return;
        }

        const kind = this.getMessageKind(shape);
        const timestampMs = Date.now();
        const timestamp = new Date(timestampMs).toISOString();
        const jsonRpcId = this.normalizeJsonRpcId(shape.id);
        const method = typeof shape.method === "string" ? shape.method : undefined;

        if (kind === "request") {
            const params = this.sanitize(shape.params, method);
            const event: RpcCaptureEvent = {
                eventId: this.nextEventId(),
                timestamp,
                channel,
                direction,
                kind,
                method,
                jsonRpcId,
                status: "pending",
                params: params.value,
                redactionSummary: params.summary,
            };
            this.addEvent(event);
            if (jsonRpcId !== undefined) {
                this._pendingRequests.set(this.pendingKey(channel, direction, jsonRpcId), {
                    event,
                    timestampMs,
                });
            }
            return;
        }

        if (kind === "notification") {
            const params = this.sanitize(shape.params, method);
            this.addEvent({
                eventId: this.nextEventId(),
                timestamp,
                channel,
                direction,
                kind,
                method,
                status: "notification",
                params: params.value,
                redactionSummary: params.summary,
            });
            return;
        }

        if (kind === "response") {
            const related = jsonRpcId
                ? this._pendingRequests.get(
                      this.pendingKey(channel, this.oppositeDirection(direction), jsonRpcId),
                  )
                : undefined;
            const effectiveMethod = related?.event.method;
            const result = shape.error
                ? this.sanitize(shape.error, effectiveMethod, true)
                : this.sanitize(shape.result, effectiveMethod);
            const status: RpcCaptureStatus = shape.error ? "failed" : "succeeded";
            const durationMs = related ? timestampMs - related.timestampMs : undefined;
            const event: RpcCaptureEvent = {
                eventId: this.nextEventId(),
                timestamp,
                channel,
                direction,
                kind,
                method: effectiveMethod,
                jsonRpcId,
                relatedEventId: related?.event.eventId,
                durationMs,
                status,
                result: shape.error ? undefined : result.value,
                error: shape.error ? result.value : undefined,
                redactionSummary: result.summary,
            };

            this.addEvent(event);

            if (related) {
                related.event.relatedEventId = event.eventId;
                related.event.durationMs = durationMs;
                related.event.status = status;
                this._pendingRequests.delete(
                    this.pendingKey(channel, this.oppositeDirection(direction), jsonRpcId!),
                );
            }
        }
    }

    public startSession(name?: string): RpcInspectorWebviewState {
        const sessionId = `rpc-session-${this._nextSessionId++}`;
        const session: RpcCaptureSession = {
            sessionId,
            name: name?.trim() || `Session ${this._sessions.size + 1}`,
            startedAt: new Date().toISOString(),
            eventCount: 0,
            droppedEventCount: 0,
            isActive: true,
        };
        this._sessions.set(sessionId, session);
        this._sessionEvents.set(sessionId, []);
        return this.emitState();
    }

    public stopSession(sessionId: string): RpcInspectorWebviewState {
        const session = this._sessions.get(sessionId);
        if (session) {
            session.isActive = false;
            session.endedAt = new Date().toISOString();
        }
        return this.emitState();
    }

    public setFilter(filter: RpcCaptureFilter): RpcInspectorWebviewState {
        this._filter = this.normalizeFilter(filter);
        return this.emitState();
    }

    public clear(): RpcInspectorWebviewState {
        this._events.length = 0;
        this._pendingRequests.clear();
        return this.emitState();
    }

    public getState(filter: RpcCaptureFilter = this._filter): RpcInspectorWebviewState {
        const normalizedFilter = this.normalizeFilter(filter);
        const events = this.getVisibleEvents(normalizedFilter);
        const sessions = this.getSessions();
        const activeSession = sessions.find((session) => session.isActive);

        return {
            events,
            sessionEvents: this.getSessionEventsById(),
            sessions,
            activeSessionId: activeSession?.sessionId,
            filter: normalizedFilter,
            summary: this.summarize(events),
            bufferCapacity: this._bufferCapacity,
        };
    }

    public exportVisibleEvents(): RpcCaptureExport {
        const events = this.getVisibleEvents(this._filter);
        return this.createExport("visible", events, undefined, this._filter);
    }

    public exportSession(sessionId: string): RpcCaptureExport | undefined {
        const session = this._sessions.get(sessionId);
        if (!session) {
            return undefined;
        }

        const events = this._sessionEvents.get(sessionId) ?? [];
        return this.createExport("session", events, { ...session });
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }

    private addEvent(event: RpcCaptureEvent): void {
        this._events.push(event);

        while (this._events.length > this._bufferCapacity) {
            this._events.shift();
        }

        for (const session of this._sessions.values()) {
            if (!session.isActive) {
                continue;
            }

            const sessionEvents = this._sessionEvents.get(session.sessionId);
            if (!sessionEvents) {
                continue;
            }

            sessionEvents.push(event);
            session.eventCount++;
            if (sessionEvents.length > this._sessionCapacity) {
                sessionEvents.shift();
                session.droppedEventCount++;
            }
        }

        this.emitState();
    }

    private emitState(): RpcInspectorWebviewState {
        const state = this.getState();
        this._onDidChange.fire(state);
        return state;
    }

    private createExport(
        source: "session" | "visible",
        events: RpcCaptureEvent[],
        session?: RpcCaptureSession,
        filters?: RpcCaptureFilter,
    ): RpcCaptureExport {
        return {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            source,
            session,
            filters,
            summary: this.summarize(events),
            events: events.map((event) => ({ ...event })),
        };
    }

    private getVisibleEvents(filter: RpcCaptureFilter): RpcCaptureEvent[] {
        return this._events.filter((event) => this.matchesFilter(event, filter));
    }

    private getSessions(): RpcCaptureSession[] {
        return [...this._sessions.values()].map((session) => ({ ...session }));
    }

    private getSessionEventsById(): Record<string, RpcCaptureEvent[]> {
        const sessionEventsById: Record<string, RpcCaptureEvent[]> = {};
        for (const [sessionId, events] of this._sessionEvents) {
            sessionEventsById[sessionId] = events.map((event) => ({ ...event }));
        }
        return sessionEventsById;
    }

    private summarize(events: RpcCaptureEvent[]): RpcCaptureSummary {
        const summary: RpcCaptureSummary = {
            eventCount: events.length,
            requestCount: 0,
            responseCount: 0,
            notificationCount: 0,
            failedCount: 0,
            pendingCount: 0,
            channels: {},
            methods: {},
            droppedEventCount: 0,
        };

        for (const event of events) {
            if (event.kind === "request") {
                summary.requestCount++;
            } else if (event.kind === "response") {
                summary.responseCount++;
            } else if (event.kind === "notification") {
                summary.notificationCount++;
            }

            if (event.status === "failed") {
                summary.failedCount++;
            }

            if (event.status === "pending") {
                summary.pendingCount++;
            }

            summary.channels[event.channel] = (summary.channels[event.channel] ?? 0) + 1;
            if (event.method) {
                summary.methods[event.method] = (summary.methods[event.method] ?? 0) + 1;
            }
        }

        for (const session of this._sessions.values()) {
            summary.droppedEventCount += session.droppedEventCount;
        }

        return summary;
    }

    private matchesFilter(event: RpcCaptureEvent, filter: RpcCaptureFilter): boolean {
        if (filter.channels?.length && !filter.channels.includes(event.channel)) {
            return false;
        }

        if (filter.directions?.length && !filter.directions.includes(event.direction)) {
            return false;
        }

        if (filter.kinds?.length && !filter.kinds.includes(event.kind)) {
            return false;
        }

        if (filter.statuses?.length && !filter.statuses.includes(event.status)) {
            return false;
        }

        if (filter.method && !event.method?.toLowerCase().includes(filter.method.toLowerCase())) {
            return false;
        }

        if (filter.methods && !filter.methods.includes(event.method ?? "")) {
            return false;
        }

        if (filter.domain && this.methodDomain(event.method) !== filter.domain) {
            return false;
        }

        if (filter.search) {
            const searchTarget = JSON.stringify(event).toLowerCase();
            if (!searchTarget.includes(filter.search.toLowerCase())) {
                return false;
            }
        }

        return true;
    }

    private methodDomain(method: string | undefined): string | undefined {
        if (!method) {
            return undefined;
        }

        const slashIndex = method.indexOf("/");
        if (slashIndex > 0) {
            return method.substring(0, slashIndex);
        }

        const dotIndex = method.indexOf(".");
        if (dotIndex > 0) {
            return method.substring(0, dotIndex);
        }

        return method;
    }

    private toJsonRpcMessage(message: unknown): JsonRpcMessageShape | undefined {
        if (!message || typeof message !== "object") {
            return undefined;
        }

        return message as JsonRpcMessageShape;
    }

    private getMessageKind(message: JsonRpcMessageShape): RpcMessageKind {
        if (typeof message.method === "string") {
            return message.id !== undefined && message.id !== null ? "request" : "notification";
        }

        if (message.id !== undefined && message.id !== null) {
            return "response";
        }

        return "unknown";
    }

    private sanitize(
        value: unknown,
        method?: string,
        errorPayload?: boolean,
    ): { value: unknown; summary: RpcRedactionSummary } {
        return this._redactor.sanitize(value, method, errorPayload);
    }

    private normalizeJsonRpcId(id: unknown): string | undefined {
        if (id === undefined || id === null) {
            return undefined;
        }

        return String(id);
    }

    private pendingKey(
        channel: RpcCaptureChannel,
        direction: RpcMessageDirection,
        jsonRpcId: string,
    ): string {
        return `${channel}:${direction}:${jsonRpcId}`;
    }

    private oppositeDirection(direction: RpcMessageDirection): RpcMessageDirection {
        return direction === "extensionToService" ? "serviceToExtension" : "extensionToService";
    }

    private nextEventId(): string {
        return `rpc-event-${this._nextEventId++}`;
    }

    private normalizeFilter(filter: RpcCaptureFilter): RpcCaptureFilter {
        return {
            ...filter,
            method: filter.method?.trim() || undefined,
            methods: filter.methods?.map((method) => method.trim()).filter(Boolean),
            domain: filter.domain?.trim() || undefined,
            search: filter.search?.trim() || undefined,
        };
    }
}

export const rpcCaptureService = RpcCaptureService.getInstance();
