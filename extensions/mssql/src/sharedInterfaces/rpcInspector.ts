/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";

export type RpcCaptureChannel = "sqlToolsService" | "resourceProvider";

export type RpcMessageDirection = "extensionToService" | "serviceToExtension";

export type RpcMessageKind = "request" | "response" | "notification" | "unknown";

export type RpcCaptureStatus = "pending" | "succeeded" | "failed" | "notification" | "unknown";

export interface RpcRedactionSummary {
    counts: Record<string, number>;
    truncated: number;
}

export interface RpcCaptureEvent {
    eventId: string;
    timestamp: string;
    channel: RpcCaptureChannel;
    direction: RpcMessageDirection;
    kind: RpcMessageKind;
    method?: string;
    jsonRpcId?: string;
    relatedEventId?: string;
    durationMs?: number;
    status: RpcCaptureStatus;
    params?: unknown;
    result?: unknown;
    error?: unknown;
    redactionSummary: RpcRedactionSummary;
}

export interface RpcCaptureFilter {
    channels?: RpcCaptureChannel[];
    directions?: RpcMessageDirection[];
    kinds?: RpcMessageKind[];
    statuses?: RpcCaptureStatus[];
    method?: string;
    methods?: string[];
    domain?: string;
    search?: string;
}

export interface RpcCaptureSession {
    sessionId: string;
    name: string;
    startedAt: string;
    endedAt?: string;
    eventCount: number;
    droppedEventCount: number;
    isActive: boolean;
}

export interface RpcCaptureSummary {
    eventCount: number;
    requestCount: number;
    responseCount: number;
    notificationCount: number;
    failedCount: number;
    pendingCount: number;
    channels: Partial<Record<RpcCaptureChannel, number>>;
    methods: Record<string, number>;
    droppedEventCount: number;
}

export type RpcCaptureExportSource = "session" | "visible" | "import";

export interface RpcCaptureExport {
    schemaVersion: 1;
    exportedAt: string;
    source: RpcCaptureExportSource;
    session?: RpcCaptureSession;
    filters?: RpcCaptureFilter;
    summary: RpcCaptureSummary;
    events: RpcCaptureEvent[];
}

export interface RpcInspectorWebviewState {
    events: RpcCaptureEvent[];
    sessionEvents: Record<string, RpcCaptureEvent[]>;
    sessions: RpcCaptureSession[];
    activeSessionId?: string;
    filter: RpcCaptureFilter;
    summary: RpcCaptureSummary;
    bufferCapacity: number;
}

export interface RpcInspectorStartSessionParams {
    name?: string;
}

export interface RpcInspectorStopSessionParams {
    sessionId: string;
}

export interface RpcInspectorApplyFilterParams {
    filter: RpcCaptureFilter;
}

export interface RpcInspectorExportParams {
    source: "session" | "visible";
    sessionId?: string;
}

export interface RpcInspectorSaveExportParams {
    captureExport: RpcCaptureExport;
}

export namespace RpcInspectorStartSessionRequest {
    export const type = new RequestType<
        RpcInspectorStartSessionParams,
        RpcInspectorWebviewState,
        void
    >("rpcInspector/startSession");
}

export namespace RpcInspectorStopSessionRequest {
    export const type = new RequestType<
        RpcInspectorStopSessionParams,
        RpcInspectorWebviewState,
        void
    >("rpcInspector/stopSession");
}

export namespace RpcInspectorApplyFilterRequest {
    export const type = new RequestType<
        RpcInspectorApplyFilterParams,
        RpcInspectorWebviewState,
        void
    >("rpcInspector/applyFilter");
}

export namespace RpcInspectorClearRequest {
    export const type = new RequestType<void, RpcInspectorWebviewState, void>("rpcInspector/clear");
}

export namespace RpcInspectorExportRequest {
    export const type = new RequestType<
        RpcInspectorExportParams,
        RpcCaptureExport | undefined,
        void
    >("rpcInspector/export");
}

export namespace RpcInspectorImportRequest {
    export const type = new RequestType<void, RpcCaptureExport | undefined, void>(
        "rpcInspector/import",
    );
}

export namespace RpcInspectorSaveExportRequest {
    export const type = new RequestType<RpcInspectorSaveExportParams, boolean, void>(
        "rpcInspector/saveExport",
    );
}
