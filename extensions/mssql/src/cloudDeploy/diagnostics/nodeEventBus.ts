/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — headless diagnostic event bus.
 *
 * `DiagnosticEventSink` implementation for contexts with no extension host
 * (the CLI / CI runner). Mirrors `DiagnosticEventBus`'s producer contract —
 * the same envelope stamping via the shared `stampEnvelope` — but is backed by
 * a plain in-memory buffer instead of `vscode.EventEmitter`, so it loads in a
 * bare `node` process with no `vscode` dependency.
 *
 * Unlike the VS Code bus it is also a *collector*: every emitted event is
 * buffered in emission order so the CLI can (a) stream live progress through
 * `on()` and (b) drain the full stream into the run artifact's `events.jsonl`
 * via `drain()`. A run is bounded (one user, one run), so buffering the whole
 * stream is safe. Per-listener errors are isolated so one bad subscriber does
 * not stop delivery to the rest — matching the VS Code bus's behavior.
 */

import { DiagnosticEvent, DiagnosticEventInput, DiagnosticEventSink } from "./types";
import { stampEnvelope } from "./eventEnvelope";

export class NodeDiagnosticEventBus implements DiagnosticEventSink {
    private readonly _events: DiagnosticEvent[] = [];
    private readonly _listeners = new Set<(event: DiagnosticEvent) => void>();

    /**
     * Publishes an event: stamps the envelope, buffers it, then notifies every
     * listener. A throwing listener is swallowed so it cannot break delivery to
     * the others or abort the run.
     */
    public emit(input: DiagnosticEventInput): void {
        const event = stampEnvelope(input);
        this._events.push(event);
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch {
                // Per-listener isolation: a bad subscriber never breaks emit.
            }
        }
    }

    /**
     * Subscribes to every subsequently emitted event (live progress). Returns
     * an unsubscribe function.
     */
    public on(listener: (event: DiagnosticEvent) => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Every event emitted so far, in emission order (for `events.jsonl`). */
    public drain(): readonly DiagnosticEvent[] {
        return this._events;
    }
}
