/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native observability wiring (TSQ2 addendum §9). The ENGINE stays free of
 * diagnostics singletons — this module adapts EngineObserver callbacks onto
 * the diag substrate at the composition edge (providerEntry).
 *
 * Emission discipline (§9.2): no per-cell or per-pause events. Exact
 * aggregate counters ride ONE terminal event per query
 * (sqlDataPlane.tsNative.query.terminal); invariant violations are emitted
 * individually (rare by construction); drop counters surface through the
 * status snapshot, not the event stream. Emission is a no-op with zero
 * sinks (diag core guarantee), so an idle Debug Console costs nothing.
 *
 * Privacy: every field is protocol metadata (ids/counts/durations/status).
 * SQL text, rows, server names, and credentials never appear here (§9.6).
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import { QueryCompleteSummary } from "../sqlDataPlane/api";
import { EngineAggregates, EngineObserver } from "./queryEngine";

export interface TsNativeObservabilityCounters {
    terminals: number;
    invariantViolations: number;
    droppedAfterTerminal: number;
}

const counters: TsNativeObservabilityCounters = {
    terminals: 0,
    invariantViolations: 0,
    droppedAfterTerminal: 0,
};

export function tsNativeObservabilityCounters(): TsNativeObservabilityCounters {
    return { ...counters };
}

function statusOf(summary: QueryCompleteSummary): "ok" | "warning" | "error" {
    switch (summary.status) {
        case "succeeded":
            return "ok";
        case "failed":
        case "connectionLost":
            return "error";
        default:
            return "warning";
    }
}

export function createDiagEngineObserver(): EngineObserver {
    return {
        onTerminal: (summary: QueryCompleteSummary, aggregates: EngineAggregates): void => {
            counters.terminals++;
            diag.emit({
                feature: "sqlDataPlane",
                kind: "event",
                type: "sqlDataPlane.tsNative.query.terminal",
                status: statusOf(summary),
                entity: { kind: "query", id: summary.clientQueryId },
                ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
                fields: {
                    // One aggregate event per query (§9.3) — never per cell.
                    queryStatus: { raw: summary.status, cls: "diagnostic.metadata" },
                    resultSets: { raw: aggregates.resultSets, cls: "diagnostic.metadata" },
                    rows: { raw: aggregates.rows, cls: "diagnostic.metadata" },
                    pages: { raw: aggregates.pages, cls: "diagnostic.metadata" },
                    driverEvents: { raw: aggregates.driverEvents, cls: "diagnostic.metadata" },
                    logicalEncodedBytes: {
                        raw: aggregates.logicalEncodedBytes,
                        cls: "diagnostic.metadata",
                    },
                    encodeMsTotal: {
                        raw: round2(aggregates.encodeMsTotal),
                        cls: "diagnostic.metadata",
                    },
                    sinkWaitMsTotal: {
                        raw: round2(aggregates.sinkWaitMsTotal),
                        cls: "diagnostic.metadata",
                    },
                    pauseMsBackpressure: {
                        raw: round2(aggregates.pauseMsByReason["sinkBackpressure"] ?? 0),
                        cls: "diagnostic.metadata",
                    },
                    pauseMsCpuYield: {
                        raw: round2(aggregates.pauseMsByReason["cpuYield"] ?? 0),
                        cls: "diagnostic.metadata",
                    },
                    yields: { raw: aggregates.yields, cls: "diagnostic.metadata" },
                    maxSynchronousSliceMs: {
                        raw: round2(aggregates.maxSynchronousSliceMs),
                        cls: "diagnostic.metadata",
                    },
                    ...(aggregates.firstMetadataMs !== undefined
                        ? {
                              firstMetadataMs: {
                                  raw: round2(aggregates.firstMetadataMs),
                                  cls: "diagnostic.metadata",
                              },
                          }
                        : {}),
                    ...(aggregates.firstPageProducedMs !== undefined
                        ? {
                              firstPageProducedMs: {
                                  raw: round2(aggregates.firstPageProducedMs),
                                  cls: "diagnostic.metadata",
                              },
                          }
                        : {}),
                    ...(aggregates.firstPageAcceptedMs !== undefined
                        ? {
                              firstPageAcceptedMs: {
                                  raw: round2(aggregates.firstPageAcceptedMs),
                                  cls: "diagnostic.metadata",
                              },
                          }
                        : {}),
                    ...(summary.outcomeCertainty !== undefined
                        ? {
                              outcomeCertainty: {
                                  raw: summary.outcomeCertainty,
                                  cls: "diagnostic.metadata",
                              },
                          }
                        : {}),
                    ...(summary.error?.code !== undefined
                        ? { errorCode: { raw: summary.error.code, cls: "diagnostic.metadata" } }
                        : {}),
                },
            });
        },
        onProtocolViolation: (observation: string): void => {
            counters.invariantViolations++;
            diag.emit({
                feature: "sqlDataPlane",
                kind: "event",
                type: "sqlDataPlane.tsNative.invariantViolation",
                status: "error",
                fields: {
                    // Engine-generated observation text (no SQL/user content).
                    observation: { raw: observation, cls: "diagnostic.metadata" },
                },
            });
        },
        onDroppedAfterTerminal: (): void => {
            // Post-terminal drops can be numerous (dispose mid-stream):
            // counted, surfaced via status — never one event each (§9.2).
            counters.droppedAfterTerminal++;
        },
    };
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
