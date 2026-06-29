/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — diagnostic event bus.
 *
 * In-process, typed publish/subscribe over the closed `DiagnosticEvent`
 * catalog (`./types`). One instance per `CloudDeployService`; subscribers
 * reach it as `cloudDeployService.diagnostics`.
 *
 * Design properties:
 *   - **Generic over the catalog.** Every method signature references the
 *     `DiagnosticEvent` union as a whole — never a specific arm. New events
 *     are added by extending the union; this file does not change.
 *   - **Two subscription shapes.** `onDidEmit` is the firehose (telemetry,
 *     log forwarder, tests); `on(type, handler)` is selective and narrows
 *     the handler argument to the matching arm.
 *   - **Bus stamps the envelope.** Callers provide `source`, `type`, and
 *     `payload`. The bus generates a fresh `id`, stamps `timestampMs`, and
 *     defaults `severity` to `"info"`.
 *   - **Synchronous delivery.** Subscribers run inline on `emit()`. A
 *     subscriber that needs to do async work queues internally.
 *   - **Per-subscriber error isolation.** Inherited from `vscode.EventEmitter`:
 *     a thrown subscriber is logged by VS Code and does not stop delivery to
 *     the rest.
 */

import * as vscode from "vscode";

import { DiagnosticEvent, DiagnosticEventInput, DiagnosticEventSink } from "./types";
import { stampEnvelope } from "./eventEnvelope";

export class DiagnosticEventBus implements vscode.Disposable, DiagnosticEventSink {
    private readonly _emitter = new vscode.EventEmitter<DiagnosticEvent>();
    private _disposed = false;

    /**
     * Firehose subscription — every event the bus emits, in emission order.
     * Use this for cross-cutting consumers (telemetry, logging, tests).
     */
    public readonly onDidEmit: vscode.Event<DiagnosticEvent> = this._emitter.event;

    /**
     * Selective subscription — fires only for events whose `type` discriminator
     * matches `type`. The handler's argument is narrowed to the matching arm,
     * so `event.payload` has the right shape with no manual cast.
     */
    public on<T extends DiagnosticEvent["type"]>(
        type: T,
        handler: (event: Extract<DiagnosticEvent, { type: T }>) => void,
    ): vscode.Disposable {
        return this._emitter.event((event) => {
            if (event.type === type) {
                handler(event as Extract<DiagnosticEvent, { type: T }>);
            }
        });
    }

    /**
     * Publishes an event. The bus stamps `id` and `timestampMs`, and defaults
     * `severity` to `"info"` when the caller omits it (arms whose severity is
     * a literal in the catalog — e.g. `"error"` — keep that literal).
     *
     * No-ops after `dispose()` so late emissions during extension shutdown
     * don't throw.
     */
    public emit(input: DiagnosticEventInput): void {
        if (this._disposed) {
            return;
        }
        const stamped = stampEnvelope(input);
        this._emitter.fire(stamped);
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._emitter.dispose();
    }
}
