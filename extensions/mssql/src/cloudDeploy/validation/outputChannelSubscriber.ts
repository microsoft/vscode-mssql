/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — output-channel subscriber.
 *
 * Wraps a `vscode.OutputChannel` (or any `OutputChannelLike` for tests) and
 * subscribes to a `DiagnosticEventBus`, formatting every event into a
 * single line. The shape mirrors the design doc's example:
 *
 *   `[12:34:56.789] [info] [runner] validation-run-started: runId=abc env=my-env validations=[connectivity,...]`
 *
 * The subscriber owns the bus subscription only; it does NOT own the
 * channel. Callers (the service layer) construct the channel and pass it
 * in so the channel's lifetime can match the service's, not the
 * subscriber's, and so tests can substitute a recording stub.
 */

import type * as vscode from "vscode";

import type { DiagnosticEvent, DiagnosticEventBus } from "../diagnostics";

// =============================================================================
// Public API
// =============================================================================

/**
 * Minimal shape from `vscode.OutputChannel` we depend on. Lets unit tests
 * pass a recording stub without faking the full VS Code API.
 */
export interface OutputChannelLike {
    appendLine(value: string): void;
}

/**
 * Subscribes a channel-like sink to a bus. Returns a `Disposable`; callers
 * dispose to unsubscribe. The subscriber drops the high-volume `debug`
 * arms (currently `validation-progress`) by default — tracing those is a
 * separate developer-mode concern.
 */
export class OutputChannelSubscriber implements vscode.Disposable {
    private readonly _subscription: vscode.Disposable;

    public constructor(
        private readonly _channel: OutputChannelLike,
        bus: DiagnosticEventBus,
        private readonly _options: { readonly includeDebug?: boolean } = {},
    ) {
        this._subscription = bus.onDidEmit((e) => this._onEvent(e));
    }

    public dispose(): void {
        this._subscription.dispose();
    }

    private _onEvent(event: DiagnosticEvent): void {
        if (event.severity === "debug" && !this._options.includeDebug) {
            return;
        }
        this._channel.appendLine(formatEvent(event));
    }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Formats a single event onto one line. The payload is rendered with a
 * shallow `key=value` projection so common cases (run-id, env-id, status)
 * land on a single line; nested fields are JSON-stringified inline.
 *
 * Exported for unit tests that exercise the formatter directly without
 * spinning up a bus.
 */
export function formatEvent(event: DiagnosticEvent): string {
    const stamp = formatTimestamp(event.timestampMs);
    const payloadStr = formatPayload(event);
    return `[${stamp}] [${event.severity}] [${event.source}] ${event.type}${payloadStr}`;
}

function formatTimestamp(timestampMs: number): string {
    const d = new Date(timestampMs);
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const ms = pad3(d.getMilliseconds());
    return `${hh}:${mm}:${ss}.${ms}`;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

function pad3(n: number): string {
    if (n < 10) {
        return `00${n}`;
    }
    if (n < 100) {
        return `0${n}`;
    }
    return `${n}`;
}

function formatPayload(event: DiagnosticEvent): string {
    const payload = (event as { payload?: Record<string, unknown> }).payload;
    if (payload === undefined) {
        return "";
    }
    const parts: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
        parts.push(`${key}=${formatValue(value)}`);
    }
    return parts.length === 0 ? "" : `: ${parts.join(" ")}`;
}

function formatValue(value: unknown): string {
    if (value === undefined || value === null) {
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((v) => formatValue(v)).join(",")}]`;
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}
