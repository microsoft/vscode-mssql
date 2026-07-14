/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagnostics core: the single emission path for all product instrumentation.
 * One event model, pluggable sinks, different gates:
 *
 *   PerfModeSink     — PERF_MODE=1 harness capture (exact legacy wire format)
 *   LiveTailSink     — bounded ring feeding the Debug Console live view
 *   SessionDiagSink  — user-enabled local Session Diag store (JSONL segments)
 *
 * Emission is near-zero cost when no sink is active: one array-length check.
 * Instrumentation must never throw into the product.
 */

import {
    CaptureMode,
    CapturePolicy,
    DIAG_SCHEMA_VERSION,
    DataClassification,
    DiagEvent,
    DiagKind,
    DiagProcess,
    DiagStatus,
    DiagTimingClass,
    GapRecord,
} from "../sharedInterfaces/debugConsole";
import { CAPTURE_POLICIES, classifyPayload } from "./redaction";

export interface RawField {
    raw: unknown;
    cls: DataClassification;
}

export interface EmitInput {
    feature: string;
    kind?: DiagKind;
    type: string;
    status?: DiagStatus;
    traceId?: string;
    causeEventId?: string;
    entity?: { kind: string; id: string };
    durationMs?: number;
    timingClass?: DiagTimingClass;
    /** Raw payload fields with classifications; redacted at this boundary. */
    fields?: Record<string, RawField>;
    tags?: string[];
    process?: DiagProcess;
    pid?: number;
    /** Override event time (e.g. webview-supplied clocks). */
    epochMs?: number;
    monotonicNs?: string;
    /** Rich enrichment block (attached by the core under rich mode only). */
    perf?: DiagEvent["perf"];
}

export interface DiagnosticSink {
    readonly id: string;
    /** Non-blocking; drops must be accounted for by the sink itself. */
    tryWrite(event: DiagEvent): void;
    flush?(): void;
    dispose?(): void;
    /** Health self-report — a sink may degrade, but never silently. */
    health?(): { id: string; healthy: boolean; detail: string; counters: Record<string, number> };
}

export interface DiagSpan {
    readonly traceId: string;
    end(status?: DiagStatus, fields?: Record<string, RawField>): void;
    fail(error: unknown): void;
}

const SAFE_ERROR_CODES = new Set([
    "SqlDataPlane.InvalidRequest",
    "SqlDataPlane.Busy",
    "SqlDataPlane.Unavailable",
    "SqlDataPlane.Auth",
    "SqlDataPlane.CapabilityUnsupported",
    "SqlDataPlane.PolicyDenied",
    "SqlDataPlane.ResourceLimit",
    "SqlDataPlane.Client.Aborted",
    "SqlDataPlane.Client.Timeout",
    "SqlDataPlane.Client.ProtocolViolation",
    "SqlDataPlane.Client.SinkError",
    "SqlDataPlane.Transport.Closed",
    "SqlDataPlane.Transport.Backpressure",
    "SqlDataPlane.Provider.Internal",
]);

const SAFE_ERROR_NAMES = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "AggregateError",
    "SqlDataPlaneError",
    "UnsupportedProfileAuthenticationError",
    "MissingEntraAuthAccountError",
    "UnsupportedEntraAccountStoreError",
    "EntraAccountMismatchError",
    "EntraTenantMismatchError",
    "EntraTokenExpiryError",
]);

/** Closed-shape error identifier for diagnostics; never returns provider text. */
export function diagnosticErrorClass(error: unknown): string {
    const code =
        error instanceof Error && "code" in error
            ? (error as Error & { code?: unknown }).code
            : undefined;
    if (typeof code === "string" && SAFE_ERROR_CODES.has(code)) {
        return code;
    }
    if (error instanceof Error && SAFE_ERROR_NAMES.has(error.name)) {
        return error.name;
    }
    return "UnknownError";
}

let traceCounter = 0;

/** New root trace id for a user action. */
export function newTraceId(hint?: string): string {
    traceCounter++;
    return `trace_${(hint ?? "act").replace(/[^a-z0-9]/gi, "").slice(0, 12)}_${Date.now().toString(36)}_${traceCounter.toString(36)}`;
}

class DiagnosticsCore {
    private sinks: DiagnosticSink[] = [];
    private seq = 0;
    private eventCounter = 0;
    public readonly sessionId: string;
    private policy: CapturePolicy = CAPTURE_POLICIES.off;
    private storePolicy: CapturePolicy = CAPTURE_POLICIES.off;
    private policyRevertTimer: NodeJS.Timeout | undefined;
    /** Ambient trace for synchronous scopes; async work passes traceId explicitly. */
    private ambientTrace: string | undefined;
    /** Entity-keyed correlation: feature code registers uri->trace bindings. */
    private entityTraces = new Map<string, string>();
    private listeners: Array<(mode: CaptureMode) => void> = [];
    /**
     * Root-action auto-correlation for normal use: a root-begin event (query
     * submit, connection begin, OE expand, command begin) opens a trace that
     * subsequent traceless events inherit until the next root begins or the
     * window times out. IDE usage is mostly sequential, so this yields honest
     * action grouping without invasive plumbing; explicitly-passed traceIds
     * always win.
     */
    private rootTrace: string | undefined;
    private rootTraceStartedMs = 0;
    private static readonly ROOT_WINDOW_MS = 120_000;
    private static readonly ROOT_BEGINNERS: RegExp[] = [
        /^mssql\.command\.invoked$/,
        /^mssql\.query\.submit$/,
        /^mssql\.connection\.begin$/,
        /^mssql\.oe\.expand\.begin$/,
        /^mssql\.oe\.session\.create\.begin$/,
        /^command\..+\.begin$/,
        /^userAction\./,
    ];

    constructor() {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        this.sessionId = `sess_${stamp}_${process.pid}`;
    }

    // --- sinks ---------------------------------------------------------------

    public addSink(sink: DiagnosticSink): void {
        this.sinks.push(sink);
    }

    public removeSink(id: string): void {
        const sink = this.sinks.find((s) => s.id === id);
        this.sinks = this.sinks.filter((s) => s.id !== id);
        try {
            sink?.dispose?.();
        } catch {
            // sink failures never propagate
        }
    }

    public hasSink(id: string): boolean {
        return this.sinks.some((s) => s.id === id);
    }

    /** Health rows from every sink that self-reports (registration order). */
    public sinkHealthSnapshot(): Array<{
        id: string;
        healthy: boolean;
        detail: string;
        counters: Record<string, number>;
    }> {
        const rows: Array<{
            id: string;
            healthy: boolean;
            detail: string;
            counters: Record<string, number>;
        }> = [];
        for (const sink of this.sinks) {
            try {
                rows.push(
                    sink.health?.() ?? {
                        id: sink.id,
                        healthy: true,
                        detail: "no self-report",
                        counters: {},
                    },
                );
            } catch {
                rows.push({
                    id: sink.id,
                    healthy: false,
                    detail: "health() threw",
                    counters: {},
                });
            }
        }
        return rows;
    }

    public get anySinkActive(): boolean {
        return this.sinks.length > 0;
    }

    // --- rich collection (COLLECT_ALL_THE_DATA) --------------------------------

    private richModeEnabled = false;
    /** Cheap metric snapshot provider installed by the rich collector. */
    private richProvider: (() => Record<string, number>) | undefined;

    public get richMode(): boolean {
        return this.richModeEnabled;
    }

    /**
     * Toggle rich enrichment. Enrichment is diagnostic-only metadata (counts,
     * bytes, delays) — it never changes capture policy or redaction.
     */
    public setRichMode(enabled: boolean, reason?: string): void {
        if (this.richModeEnabled === enabled) {
            return;
        }
        this.richModeEnabled = enabled;
        this.emit({
            feature: "sessionDiag",
            type: enabled ? "richCollection.enabled" : "richCollection.disabled",
            status: "info",
            ...(reason ? { fields: { reason: { raw: reason, cls: "diagnostic.metadata" } } } : {}),
        });
    }

    public setRichProvider(provider: (() => Record<string, number>) | undefined): void {
        this.richProvider = provider;
    }

    // --- capture policy --------------------------------------------------------

    public get captureMode(): CaptureMode {
        return this.storePolicy.mode;
    }

    public get capturePolicy(): CapturePolicy {
        return this.storePolicy;
    }

    public get captureExpiresEpochMs(): number | undefined {
        return this.storePolicy.expiresEpochMs;
    }

    /**
     * The store policy governs what the Session Diag sink persists. The
     * envelope itself is built with the MOST permissive active policy needed;
     * v1 keeps it simple: one policy applied at emission covering all sinks,
     * with PERF_MODE (synthetic data by contract) treated as full-capture.
     */
    public setCaptureMode(mode: CaptureMode, options?: { reason?: string; durationMs?: number }) {
        if (this.policyRevertTimer) {
            clearTimeout(this.policyRevertTimer);
            this.policyRevertTimer = undefined;
        }
        if (mode === "full") {
            const durationMs = Math.min(options?.durationMs ?? 15 * 60_000, 60 * 60_000);
            const expires = Date.now() + durationMs;
            this.storePolicy = CAPTURE_POLICIES.full(options?.reason ?? "elevated", expires);
            this.policyRevertTimer = setTimeout(() => {
                this.setCaptureMode("redacted", { reason: "elevation expired" });
                this.emit({
                    feature: "sessionDiag",
                    type: "sessionDiag.elevation.expired",
                    status: "info",
                });
            }, durationMs);
            this.policyRevertTimer.unref?.();
        } else {
            this.storePolicy = CAPTURE_POLICIES[mode];
        }
        this.policy =
            this.storePolicy.mode === "off" ? CAPTURE_POLICIES.redacted : this.storePolicy;
        for (const listener of this.listeners) {
            try {
                listener(mode);
            } catch {
                // listeners never break emission
            }
        }
    }

    public onCaptureModeChanged(listener: (mode: CaptureMode) => void): void {
        this.listeners.push(listener);
    }

    // --- trace context ---------------------------------------------------------

    public withTrace<T>(traceId: string, fn: () => T): T {
        const previous = this.ambientTrace;
        this.ambientTrace = traceId;
        try {
            return fn();
        } finally {
            this.ambientTrace = previous;
        }
    }

    public get currentTrace(): string | undefined {
        return this.ambientTrace;
    }

    /** Bind an entity (e.g. a document uri digest) to a trace for async joins. */
    public bindEntityTrace(entityId: string, traceId: string): void {
        if (this.entityTraces.size > 500) {
            const first = this.entityTraces.keys().next().value;
            if (first !== undefined) {
                this.entityTraces.delete(first);
            }
        }
        this.entityTraces.set(entityId, traceId);
    }

    public traceForEntity(entityId: string): string | undefined {
        return this.entityTraces.get(entityId);
    }

    // --- emission ----------------------------------------------------------------

    public emit(input: EmitInput): string | undefined {
        if (this.sinks.length === 0) {
            return undefined;
        }
        try {
            this.seq++;
            this.eventCounter++;
            const { payload, maxClassification, redactedFields } = input.fields
                ? classifyPayload(input.fields, this.policy)
                : { payload: undefined, maxClassification: "public" as const, redactedFields: 0 };
            let traceId =
                input.traceId ??
                this.ambientTrace ??
                (input.entity ? this.entityTraces.get(input.entity.id) : undefined);
            if (traceId === undefined) {
                const isRoot = DiagnosticsCore.ROOT_BEGINNERS.some((pattern) =>
                    pattern.test(input.type),
                );
                if (isRoot) {
                    this.rootTrace = newTraceId(input.type.split(".").slice(-2).join(""));
                    this.rootTraceStartedMs = Date.now();
                    traceId = this.rootTrace;
                } else if (
                    this.rootTrace !== undefined &&
                    Date.now() - this.rootTraceStartedMs < DiagnosticsCore.ROOT_WINDOW_MS
                ) {
                    traceId = this.rootTrace;
                }
            }
            const event: DiagEvent = {
                schemaVersion: DIAG_SCHEMA_VERSION,
                eventId: `evt_${this.eventCounter.toString(36).padStart(6, "0")}`,
                sessionId: this.sessionId,
                seq: this.seq,
                epochMs: input.epochMs ?? Date.now(),
                process: input.process ?? "extensionHost",
                pid: input.pid ?? process.pid,
                feature: input.feature,
                kind: input.kind ?? "event",
                type: input.type,
                status: input.status ?? "ok",
                cls: {
                    max: maxClassification,
                    redactedFields,
                    policyId: this.policy.policyId,
                },
            };
            if (input.monotonicNs !== undefined) {
                event.monotonicNs = input.monotonicNs;
            } else if ((input.process ?? "extensionHost") === "extensionHost") {
                event.monotonicNs = process.hrtime.bigint().toString();
            }
            if (traceId !== undefined) {
                event.traceId = traceId;
            }
            if (input.causeEventId !== undefined) {
                event.causeEventId = input.causeEventId;
            }
            if (input.entity !== undefined) {
                event.entity = input.entity;
            }
            if (input.durationMs !== undefined) {
                event.durationMs = input.durationMs;
            }
            if (input.timingClass !== undefined) {
                event.timingClass = input.timingClass;
            }
            if (payload !== undefined) {
                event.payload = payload;
            }
            if (input.tags !== undefined) {
                event.tags = input.tags;
            }
            if (input.perf !== undefined) {
                event.perf = input.perf;
            }
            for (const sink of this.sinks) {
                try {
                    sink.tryWrite(event);
                } catch {
                    // A sink failure must never break the product or other sinks.
                }
            }
            return event.eventId;
        } catch {
            return undefined;
        }
    }

    /**
     * Trace for a non-root span: explicit > ambient > the active root action
     * (so RPC spans nest under the user action that caused them) > fresh.
     */
    private resolveSpanTrace(feature: string, explicit?: string): string {
        if (explicit !== undefined) {
            return explicit;
        }
        if (this.ambientTrace !== undefined) {
            return this.ambientTrace;
        }
        if (
            this.rootTrace !== undefined &&
            Date.now() - this.rootTraceStartedMs < DiagnosticsCore.ROOT_WINDOW_MS
        ) {
            return this.rootTrace;
        }
        return newTraceId(feature);
    }

    /** Span helper: emits type.begin now and type.end (with duration) on end(). */
    public startSpan(input: EmitInput): DiagSpan {
        const traceId = this.resolveSpanTrace(input.feature, input.traceId);
        const startMono = process.hrtime.bigint();
        // Rich mode: capture a begin heap reading so span ends can report the
        // allocation delta. One memoryUsage() call per span, rich mode only.
        const beginHeap = this.richModeEnabled ? process.memoryUsage().heapUsed : undefined;
        const beginId = this.emit({
            ...input,
            traceId,
            kind: input.kind ?? "span",
            type: `${input.type}.begin`,
        });
        const core = this;
        const richBlock = (): DiagEvent["perf"] | undefined => {
            if (!core.richModeEnabled) {
                return undefined;
            }
            const metrics: Record<string, number> = { ...(core.richProvider?.() ?? {}) };
            if (beginHeap !== undefined) {
                metrics["heapDeltaKB"] = Number(
                    ((process.memoryUsage().heapUsed - beginHeap) / 1024).toFixed(1),
                );
            }
            return {
                captureLevel: "rich",
                officialEligible: false,
                metrics,
                collectionCost: "low",
            };
        };
        return {
            traceId,
            end(status?: DiagStatus, fields?: Record<string, RawField>): void {
                const durationMs = Number(process.hrtime.bigint() - startMono) / 1e6;
                const perf = richBlock();
                core.emit({
                    ...input,
                    ...(fields ? { fields: { ...input.fields, ...fields } } : {}),
                    traceId,
                    kind: input.kind ?? "span",
                    type: `${input.type}.end`,
                    status: status ?? "ok",
                    durationMs: Number(durationMs.toFixed(2)),
                    timingClass: "officialSameProcess",
                    ...(beginId ? { causeEventId: beginId } : {}),
                    ...(perf ? { perf } : {}),
                });
            },
            fail(error: unknown): void {
                const durationMs = Number(process.hrtime.bigint() - startMono) / 1e6;
                core.emit({
                    ...input,
                    traceId,
                    kind: input.kind ?? "span",
                    type: `${input.type}.end`,
                    status: "error",
                    durationMs: Number(durationMs.toFixed(2)),
                    fields: {
                        ...input.fields,
                        error: {
                            raw: error instanceof Error ? error.message : String(error),
                            cls: "diagnostic.metadata",
                        },
                    },
                    ...(beginId ? { causeEventId: beginId } : {}),
                });
            },
        };
    }

    public flushAll(): void {
        for (const sink of this.sinks) {
            try {
                sink.flush?.();
            } catch {
                // never throw
            }
        }
    }

    public get lastSeq(): number {
        return this.seq;
    }
}

/** Singleton core. Import cost is trivial; no I/O happens until a sink registers. */
export const diag = new DiagnosticsCore();

export type { GapRecord };
