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
 * so adding a new event in a future deliverable is purely additive — only
 * this file changes; the bus class and barrel never do.
 *
 * Payloads carry ids and counts, not domain objects. Events end up in logs
 * and (eventually) telemetry; we don't leak full record shapes, and we don't
 * pin payload size to the size of in-memory state.
 */

// =============================================================================
// Source / severity unions (closed, expand additively)
// =============================================================================

/** Subsystem that produced an event. Closed; expand as new subsystems land. */
export type DiagnosticEventSource = "environment-store" | "run-store" | "service";

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
