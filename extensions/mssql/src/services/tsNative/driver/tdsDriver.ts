/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ITdsDriver — the ONLY seam between the ts-native query engine and a TDS
 * driver (TSQ2 addendum §5.2). `tediousDriver.ts` is the only module allowed
 * to import tedious; `fakeTdsDriver.ts` is the deterministic scripted twin.
 * No tedious type, Connection, Request, or metadata object crosses this port.
 *
 * Event model: the driver adapter owns listener installation/removal and
 * guarantees that `completed` resolves exactly once, AFTER every event it
 * already emitted for the generation. Events carry a monotonic `driverSeq`
 * so the support timeline can reconstruct driver → page → sink order without
 * timestamps.
 *
 * The engine imports neither vscode nor diagnostics singletons; clock,
 * scheduler, and ids are injected (virtual in tests).
 */

// ---------------------------------------------------------------------------
// Injected environment (virtualizable)
// ---------------------------------------------------------------------------

export interface EngineDisposable {
    dispose(): void;
}

/** Monotonic clock + scheduler; tests drive a virtual implementation. */
export interface EngineClock {
    /** Monotonic milliseconds (never wall clock). */
    now(): number;
    setTimeout(callback: () => void, ms: number): EngineDisposable;
    /** Yield to the host event loop (setImmediate in production). */
    yield(): Promise<void>;
}

export interface EngineIds {
    next(prefix: string): string;
}

export function productionClock(): EngineClock {
    return {
        now: () => performance.now(),
        setTimeout: (callback, ms) => {
            const timer = setTimeout(callback, ms);
            (timer as { unref?: () => void }).unref?.();
            return { dispose: () => clearTimeout(timer) };
        },
        yield: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

/**
 * Sanitized open request. Secrets arrive as opaque strings resolved by the
 * caller immediately before open and are NEVER retained by the adapter after
 * the driver config is handed to the socket (TSQ2 §7.2).
 */
export interface TdsOpenRequest {
    server: string;
    /** Instance name when `server` carried `host\\instance` (SQL Browser). */
    instanceName?: string;
    port?: number;
    database?: string;
    applicationName: string;
    encrypt: boolean | "strict";
    trustServerCertificate: boolean;
    connectTimeoutMs: number;
    auth:
        | { kind: "sqlLogin"; user: string; password: string }
        | { kind: "accessToken"; token: string };
}

export interface TdsServerFacts {
    /** Raw server version string when the driver exposes one. */
    serverVersion?: string;
    /** TDS negotiated version label (diagnostic). */
    tdsVersion?: string;
}

// ---------------------------------------------------------------------------
// Columns / cells
// ---------------------------------------------------------------------------

/** Normalized column facts (no driver metadata objects). */
export interface TdsColumn {
    name: string;
    /** Lowercased engine type name (e.g. "int", "decimal", "geometry", "vector"). */
    typeName: string;
    /** UDT assembly-qualified or db-qualified name when typeName is "udt". */
    udtName?: string;
    precision?: number;
    scale?: number;
    /** Declared length in bytes/chars; undefined for MAX/PLP. */
    maxLength?: number;
    nullable?: boolean;
}

/**
 * Raw driver cell value. Allowed shapes (documented contract, pinned by
 * driver tests): null, boolean, number, string, Buffer, Date. Sub-ms
 * fractions for time/datetime2/datetimeoffset ride `nanosecondsDelta` (the
 * tedious hidden property, surfaced explicitly here so the encoder never
 * reaches into driver objects).
 */
export interface TdsCell {
    value: unknown;
    /** Fraction-of-second remainder in NANOSECONDS beyond Date's ms, if any. */
    nanosecondsDelta?: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TdsServerMessage {
    number: number;
    /** Severity class (errors > 10). */
    severity: number;
    state?: number;
    message: string;
    procedure?: string;
    lineNumber?: number;
    isError: boolean;
}

export type TdsDoneToken = "done" | "doneInProc" | "doneProc";

export type TdsQueryEvent =
    | { kind: "metadata"; driverSeq: number; columns: TdsColumn[] }
    | { kind: "row"; driverSeq: number; cells: readonly TdsCell[] }
    | {
          kind: "done";
          driverSeq: number;
          token: TdsDoneToken;
          /** Row count when the DONE carried a valid count (NOCOUNT ⇒ undefined). */
          rowCount?: number;
          more: boolean;
      }
    | { kind: "message"; driverSeq: number; message: TdsServerMessage }
    | { kind: "databaseChanged"; driverSeq: number; database: string };

export interface TdsQueryObserver {
    /** Events arrive strictly in driverSeq order, never after completed. */
    onEvent(event: TdsQueryEvent): void;
}

export interface TdsConnectionObserver {
    /** Socket/fatal loss. Fired at most once; adapter removes listeners. */
    onLost(reason: TdsErrorCategory, detail?: TdsError): void;
    /** ENVCHANGE database outside any active query generation. */
    onDatabaseChanged(database: string): void;
    /** Connection-scoped message with no active query lease (diagnostic). */
    onOrphanMessage(message: TdsServerMessage): void;
}

// ---------------------------------------------------------------------------
// Errors (stable categories; driver text is diagnostics, never contract)
// ---------------------------------------------------------------------------

export type TdsErrorCategory =
    | "auth"
    | "network"
    | "timeout"
    | "cancel"
    | "server"
    | "protocol"
    | "resource"
    | "internal";

export interface TdsError {
    category: TdsErrorCategory;
    /** Diagnostic-only driver/server text (whitelisted mapping happens above). */
    message: string;
    serverDetail?: {
        number?: number;
        severity?: number;
        state?: number;
        line?: number;
        procedure?: string;
    };
}

export interface TdsCompletion {
    /** True when the request callback reported no driver-level error. */
    ok: boolean;
    /** Set when !ok (also for cancel: category "cancel"). */
    error?: TdsError;
}

export interface TdsCancelResult {
    delivered: boolean;
}

export type TdsPauseReason = "sinkBackpressure" | "cpuYield" | "memoryPressure" | "debugFault";

export type TdsCancelReason = "user" | "timeout" | "dispose" | "sessionClose";

// ---------------------------------------------------------------------------
// Operation context
// ---------------------------------------------------------------------------

export interface DataPlaneOperationContext {
    /** Random, client-owned operation id (correlates diagnostics). */
    operationId: string;
    deadlineEpochMs?: number;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface TdsExecuteRequest {
    /** Raw batch text — submitted via SQL_BATCH semantics (execSqlBatch). */
    batchText: string;
}

export interface ITdsQueryLease {
    /** Monotonic per-connection generation (event routing identity). */
    readonly generation: number;
    /** Resolves when the driver accepts ownership of the request; rejects on
     *  submission failure (busy socket, invalid state). */
    readonly accepted: Promise<void>;
    /** Resolves exactly once after all events for this generation. */
    readonly completed: Promise<TdsCompletion>;
    pause(reason: TdsPauseReason): void;
    resume(reason: TdsPauseReason): void;
    cancel(reason: TdsCancelReason): Promise<TdsCancelResult>;
}

export interface ITdsConnection {
    readonly id: string;
    readonly state: "open" | "closing" | "closed" | "lost";
    readonly serverFacts: TdsServerFacts;
    /** One active lease per connection; a second execute is a caller bug the
     *  adapter rejects with category "internal" (the engine enforces Busy
     *  ABOVE this port). */
    execute(
        request: TdsExecuteRequest,
        observer: TdsQueryObserver,
        context: DataPlaneOperationContext,
    ): ITdsQueryLease;
    close(context: DataPlaneOperationContext): Promise<void>;
    /** Immediate socket teardown (forced abort path). Idempotent. */
    destroy(reason: string): void;
}

export interface ITdsDriver {
    readonly name: "tedious" | "fake";
    readonly version: string;
    open(
        request: TdsOpenRequest,
        observer: TdsConnectionObserver,
        context: DataPlaneOperationContext,
    ): Promise<ITdsConnection>;
}

// ---------------------------------------------------------------------------
// Fault vocabulary (TSQ2 addendum §11) — fake implements natively; the live
// driver is wrapped by a decorator using the SAME knobs. Deterministic from
// `seed`; unknown keys are ignored with a diagnostic by the parser above.
// ---------------------------------------------------------------------------

export interface TsNativeFaultProfile {
    seed: number;
    openDelayMs?: number;
    openFailure?: "auth" | "network" | "timeout";
    delayEveryRows?: { rows: number; ms: number };
    delayEveryPageMs?: number;
    dropAfterDriverEvents?: number;
    dropAfterPages?: number;
    hangOnCancel?: boolean;
    hangOnClose?: boolean;
    malformedEventAt?: number;
    memoryPressureAfterBytes?: number;
    sinkDelayMs?: number;
}
