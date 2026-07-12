/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Performance-harness instrumentation facade.
 *
 * Since Phase 4 this is a thin facade over the unified diagnostics core
 * (src/diagnostics): every Perf.marker call becomes a diagnostic event that
 * routes to whichever sinks are active — the PERF_MODE harness sink (exact
 * legacy wire format, gated on PERF_MODE=1), the Debug Console live tail, and
 * the user-enabled Session Diag store. One emission path, several gates.
 *
 * The public API is unchanged from Phases 1-3 and the PERF_MODE wire contract
 * is preserved bit-for-bit by PerfModeSink. When no sink is active a marker
 * call costs one array-length check.
 */

import { diag } from "../diagnostics/diagnosticsCore";
import { PerfModeSink } from "../diagnostics/sinks";
import { DataClassification } from "../sharedInterfaces/debugConsole";

export type PerfMarkerPhase = "instant" | "begin" | "end" | "counter";

export interface PerfState {
    perfMode: boolean;
    activationState: "inactive" | "activating" | "activated" | "failed";
    extensionHostPid: number;
    stsPid?: number;
    markersQueued: number;
    markersDropped: number;
}

export interface IPerfTelemetry {
    readonly enabled: boolean;
    marker(
        name: string,
        phase?: PerfMarkerPhase,
        attrs?: Record<string, string | number | boolean | null>,
        correlationId?: string,
    ): void;
    webviewMark(
        mark: {
            name: string;
            timestampUnixNs: string;
            monotonicNs: string;
            attrs?: Record<string, string | number | boolean | null>;
        },
        webviewName: string,
    ): void;
    setActivationState(state: PerfState["activationState"]): void;
    setStsPid(pid: number | undefined): void;
    getState(): PerfState;
    flush(): void;
}

/** Marker-name prefix → console feature bucket. */
export function featureFor(name: string): string {
    if (name.startsWith("mssql.connection") || name.startsWith("mssql.sts")) return "connection";
    if (name.startsWith("mssql.queryResults")) return "queryResults";
    if (name.startsWith("mssql.query")) return "query";
    if (name.startsWith("mssql.resultsGrid")) return "resultsGrid";
    if (name.startsWith("mssql.oe")) return "objectExplorer";
    if (name.startsWith("mssql.activate") || name.startsWith("mssql.extension")) return "system";
    if (name.startsWith("mssql.command")) return "command";
    if (name.startsWith("driver.")) return "harness";
    return "system";
}

/**
 * Attr-key classification for normal-use capture. Under PERF_MODE the
 * database is synthetic by harness contract, so attrs are diagnostic
 * metadata; in normal use, name-bearing keys are classified so the
 * redaction policy governs them.
 */
const ATTR_CLASSIFICATION: Record<string, DataClassification> = {
    nodePath: "object.name",
    nodeType: "diagnostic.metadata",
    objectName: "object.name",
    documentUri: "source.path",
    uri: "source.path",
    messages: "user.text",
    error: "diagnostic.metadata",
};

class PerfFacade implements IPerfTelemetry {
    public readonly enabled: boolean;
    private readonly perfSink: PerfModeSink | undefined;
    private activationState: PerfState["activationState"] = "inactive";
    private stsPid: number | undefined;

    constructor() {
        this.enabled = process.env.PERF_MODE === "1";
        if (this.enabled) {
            const markerUrl = process.env.PERF_MARKER_URL;
            const token = process.env.PERF_CONTROL_TOKEN;
            if (markerUrl && token) {
                this.perfSink = new PerfModeSink(
                    markerUrl,
                    token,
                    process.env.PERF_RUN_ID ?? "unknown-run",
                    Number(process.env.PERF_REP_ID ?? "0"),
                    process.env.PERF_SCENARIO_ID ?? "unknown-scenario",
                );
                diag.addSink(this.perfSink);
            }
        }
    }

    public marker(
        name: string,
        phase: PerfMarkerPhase = "instant",
        attrs?: Record<string, string | number | boolean | null>,
        correlationId?: string,
    ): void {
        if (!diag.anySinkActive) {
            return;
        }
        try {
            const fields: Record<string, { raw: unknown; cls: DataClassification }> = {};
            if (attrs) {
                for (const [key, value] of Object.entries(attrs)) {
                    fields[key] = {
                        raw: value,
                        cls: this.enabled
                            ? "diagnostic.metadata"
                            : (ATTR_CLASSIFICATION[key] ?? "diagnostic.metadata"),
                    };
                }
            }
            const tags = ["perfMarker", `phase:${phase}`];
            if (correlationId) {
                tags.push("perfCorrelation");
            }
            diag.emit({
                feature: featureFor(name),
                kind: phase === "counter" ? "metric" : "event",
                type: name,
                status: attrs?.["error"] === true ? "error" : "ok",
                ...(correlationId ? { traceId: correlationId } : {}),
                ...(Object.keys(fields).length > 0 ? { fields } : {}),
                tags,
            });
        } catch {
            // Instrumentation must never surface into the product.
        }
    }

    public webviewMark(
        mark: {
            name: string;
            timestampUnixNs: string;
            monotonicNs: string;
            attrs?: Record<string, string | number | boolean | null>;
        },
        webviewName: string,
    ): void {
        if (!diag.anySinkActive) {
            return;
        }
        try {
            if (!/^[0-9]+$/.test(mark.timestampUnixNs) || !/^[0-9]+$/.test(mark.monotonicNs)) {
                return;
            }
            const fields: Record<string, { raw: unknown; cls: DataClassification }> = {};
            if (mark.attrs) {
                for (const [key, value] of Object.entries(mark.attrs)) {
                    fields[key] = {
                        raw: value,
                        cls: this.enabled
                            ? "diagnostic.metadata"
                            : (ATTR_CLASSIFICATION[key] ?? "diagnostic.metadata"),
                    };
                }
            }
            diag.emit({
                feature: featureFor(mark.name),
                kind: "event",
                type: mark.name,
                process: "webview",
                pid: 0,
                epochMs: Number(BigInt(mark.timestampUnixNs) / 1000000n),
                monotonicNs: mark.monotonicNs,
                ...(Object.keys(fields).length > 0 ? { fields } : {}),
                tags: ["perfMarker", "phase:instant", `webview:${webviewName}`],
            });
        } catch {
            // Instrumentation must never surface into the product.
        }
    }

    public setActivationState(state: PerfState["activationState"]): void {
        this.activationState = state;
    }

    public setStsPid(pid: number | undefined): void {
        this.stsPid = pid;
        if (pid !== undefined) {
            diag.emit({
                feature: "connection",
                type: "mssql.sts.pid",
                fields: { pid: { raw: pid, cls: "diagnostic.metadata" } },
            });
        }
    }

    public getState(): PerfState {
        const state: PerfState = {
            perfMode: this.enabled,
            activationState: this.activationState,
            extensionHostPid: process.pid,
            markersQueued: this.perfSink?.queuedCount ?? 0,
            markersDropped: this.perfSink?.droppedCount ?? 0,
        };
        if (this.stsPid !== undefined) {
            state.stsPid = this.stsPid;
        }
        return state;
    }

    public flush(): void {
        diag.flushAll();
    }
}

/**
 * The singleton perf telemetry surface. `enabled` reflects PERF_MODE exactly
 * as before; marker emission also feeds the Debug Console and Session Diag
 * sinks when those are active.
 */
export const Perf: IPerfTelemetry = new PerfFacade();
