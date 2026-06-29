/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — diagnostic event catalog.
 *
 * Pure type declarations: the vocabulary of "things that can happen in
 * Cloud Deploy" that subsystems publish through the diagnostic event bus.
 *
 * `DiagnosticEvent` is a CLOSED discriminated union. Subscribers narrow by
 * the `type` discriminator, which gives them the right `payload` shape with
 * no manual casts. The bus class (`eventBus.ts`) is generic over this union,
 * so adding a new event later is purely additive — only
 * this file changes; the bus class and barrel never do.
 *
 * Payloads carry ids and counts, not domain objects. Events end up in logs
 * and (eventually) telemetry; we don't leak full record shapes, and we don't
 * pin payload size to the size of in-memory state.
 */

import type { ValidationType } from "../environments/types";
import type { CancellationReason, RunStatus, ValidationStatus } from "../runs/types";

// =============================================================================
// Source / severity unions (closed, expand additively)
// =============================================================================

/** Subsystem that produced an event. Closed; expand as new subsystems land. */
export type DiagnosticEventSource =
    | "environment-store"
    | "run-store"
    | "runner"
    | "service"
    | "validation";

/**
 * Hint to subscribers, not a gate. The bus delivers all severities; consumers
 * decide what to do (filter for a UI, forward to telemetry, log at a level).
 */
export type DiagnosticEventSeverity = "debug" | "info" | "warn" | "error";

// =============================================================================
// Envelope
// =============================================================================

/**
 * Fields every event carries. `id` and `timestampMs` are stamped by the bus,
 * not the caller — eliminates forgotten timestamps and duplicate ids.
 *
 * `readonly` everywhere: the bus delivers one object to N subscribers; a
 * subscriber that mutates the event would break the others.
 */
export interface DiagnosticEventEnvelope {
    /** Unique per emission. Stamped by the bus. */
    readonly id: string;
    /** `Date.now()` at emission. Stamped by the bus. */
    readonly timestampMs: number;
    /** Subsystem that emitted the event. */
    readonly source: DiagnosticEventSource;
    /** Severity hint. Defaulted to `"info"` by the bus when the caller omits it. */
    readonly severity: DiagnosticEventSeverity;
    /** Optional id tying multi-step flows together. */
    readonly correlationId?: string;
}

// =============================================================================
// Catalog (closed discriminated union)
// =============================================================================

/**
 * The complete catalog of events Cloud Deploy can emit. Discriminator: `type`.
 * Adding a new event = adding a new arm here. Nothing else changes.
 */
export type DiagnosticEvent =
    | EnvironmentsLoadedEvent
    | EnvironmentsChangedEvent
    | EnvironmentsFileParseFailedEvent
    | DefaultEnvironmentChangedEvent
    | RunPersistedEvent
    | RunPersistFailedEvent
    | ValidationRunStartedEvent
    | ValidationStartedEvent
    | ValidationProgressEvent
    | ValidationFinishedEvent
    | ValidationRunFinishedEvent
    | ErrorEvent;

/** Env file was successfully loaded (or determined to be empty/absent). */
export interface EnvironmentsLoadedEvent extends DiagnosticEventEnvelope {
    readonly source: "environment-store";
    readonly type: "environments-loaded";
    readonly payload: {
        readonly count: number;
    };
}

/** One or more environments were added, updated, or removed in the store. */
export interface EnvironmentsChangedEvent extends DiagnosticEventEnvelope {
    readonly source: "environment-store";
    readonly type: "environments-changed";
    readonly payload: {
        readonly addedIds: readonly string[];
        readonly updatedIds: readonly string[];
        readonly removedIds: readonly string[];
    };
}

/** The env file existed but was malformed; init re-throws after emitting. */
export interface EnvironmentsFileParseFailedEvent extends DiagnosticEventEnvelope {
    readonly source: "environment-store";
    readonly severity: "error";
    readonly type: "environments-file-parse-failed";
    readonly payload: {
        readonly filePath: string;
        readonly issueCount: number;
    };
}

/** The user's default environment selection changed (or was cleared). */
export interface DefaultEnvironmentChangedEvent extends DiagnosticEventEnvelope {
    readonly source: "environment-store";
    readonly type: "default-environment-changed";
    readonly payload: {
        readonly id: string | undefined;
    };
}

/** A run artifact was successfully persisted to its final on-disk location. */
export interface RunPersistedEvent extends DiagnosticEventEnvelope {
    readonly source: "run-store";
    readonly type: "run-persisted";
    readonly payload: {
        readonly runId: string;
        readonly path: string;
        readonly sizeBytes: number;
    };
}

/** Writing a run artifact failed; the writer re-throws after emitting. */
export interface RunPersistFailedEvent extends DiagnosticEventEnvelope {
    readonly source: "run-store";
    readonly severity: "error";
    readonly type: "run-persist-failed";
    readonly payload: {
        readonly runId: string;
        readonly path: string;
        /** Stringified error message; the full error object is not retained. */
        readonly cause: string;
    };
}

/**
 * A generic failure surface for the service layer. Used for errors that
 * don't have a dedicated arm (yet). The catch-all keeps the catalog from
 * needing a new arm for every one-off failure path.
 */
export interface ErrorEvent extends DiagnosticEventEnvelope {
    readonly source: "service";
    readonly severity: "error";
    readonly type: "error";
    readonly payload: {
        readonly message: string;
        /** Serializable shadow of the original `Error` (Error itself doesn't JSON-stringify cleanly). */
        readonly cause?: {
            readonly name: string;
            readonly message: string;
            readonly stack?: string;
        };
    };
}

// =============================================================================
// Validation runner lifecycle
// =============================================================================

/**
 * The validation runner emits run- and validation-level lifecycle events so
 * the output channel, progress UI, and future telemetry can observe a run
 * without polling. `correlationId` on every arm carries the `runId` so a
 * subscriber can stitch events from a single run together.
 *
 * Severity rule: lifecycle events default to `"info"`; `validation-progress`
 * defaults to `"debug"` because it can be high-volume. The finish events
 * (`validation-finished` and `validation-run-finished`) do NOT carry a
 * literal severity — the runner stamps `"warn"` or `"error"` based on the
 * resulting status so subscribers can filter at the bus level.
 */

/** A validation run is starting. Emitted by the runner before any per-validation event. */
export interface ValidationRunStartedEvent extends DiagnosticEventEnvelope {
    readonly source: "runner";
    readonly type: "validation-run-started";
    readonly payload: {
        readonly runId: string;
        readonly environmentId: string;
        /** The validation types about to be dispatched, in dispatch order. */
        readonly validationTypes: readonly ValidationType[];
    };
}

/** A single validation is starting. Emitted by the validator (or runner on skip) immediately before `run()`. */
export interface ValidationStartedEvent extends DiagnosticEventEnvelope {
    readonly source: "validation";
    readonly type: "validation-started";
    readonly payload: {
        readonly runId: string;
        readonly validationType: ValidationType;
    };
}

/**
 * Optional progress update from inside a long-running validation. High-volume;
 * defaulted to `"debug"` so the output channel can elide it by default.
 */
export interface ValidationProgressEvent extends DiagnosticEventEnvelope {
    readonly source: "validation";
    readonly type: "validation-progress";
    readonly payload: {
        readonly runId: string;
        readonly validationType: ValidationType;
        readonly message: string;
        /** Optional 0-100 progress percentage. */
        readonly percent?: number;
    };
}

/**
 * A single validation has finished. Severity tracks `status` so subscribers
 * can filter without inspecting payload (the runner stamps `"warn"` for
 * `Warning`, `"error"` for `Failed` / `Errored`, `"info"` otherwise).
 */
export interface ValidationFinishedEvent extends DiagnosticEventEnvelope {
    readonly source: "validation";
    readonly type: "validation-finished";
    readonly payload: {
        readonly runId: string;
        readonly validationType: ValidationType;
        readonly status: ValidationStatus;
        readonly findingsCount: number;
        readonly durationMs: number;
        readonly cancellationReason?: CancellationReason;
    };
}

/**
 * The whole validation run has finished. Severity tracks `status` per the
 * same rule as `ValidationFinishedEvent`.
 */
export interface ValidationRunFinishedEvent extends DiagnosticEventEnvelope {
    readonly source: "runner";
    readonly type: "validation-run-finished";
    readonly payload: {
        readonly runId: string;
        readonly status: RunStatus;
        readonly durationMs: number;
        readonly validationCount: number;
    };
}

// =============================================================================
// Producer input shape
// =============================================================================

/**
 * What producers pass to `bus.emit(...)`. The bus stamps `id` and `timestampMs`,
 * and defaults `severity` to `"info"` when the caller omits it.
 */
export type DiagnosticEventInput = {
    [E in DiagnosticEvent as E["type"]]: Omit<E, "id" | "timestampMs" | "severity"> & {
        readonly severity?: E["severity"];
    };
}[DiagnosticEvent["type"]];

// =============================================================================
// Producer seam
// =============================================================================

/**
 * The minimal producer surface the engine depends on: "publish an event." The
 * runner, the validators, and the run-artifact writer accept a
 * `DiagnosticEventSink` (not the concrete `DiagnosticEventBus`) so the same
 * engine runs in the extension host — where `DiagnosticEventBus` wraps
 * `vscode.EventEmitter` — and in a headless `node` process — where
 * `NodeDiagnosticEventBus` implements this interface with no `vscode`
 * dependency. Consumers that also subscribe (`onDidEmit` / `on`) keep depending
 * on the concrete bus.
 */
export interface DiagnosticEventSink {
    /**
     * Publishes an event. The implementation stamps `id` / `timestampMs` and
     * defaults `severity` to `"info"` when the caller omits it.
     */
    emit(input: DiagnosticEventInput): void;
}
