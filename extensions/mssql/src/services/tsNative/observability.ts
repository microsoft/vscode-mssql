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
// Type-only: this module is imported from the ACTIVATION bundle
// (sqlDataPlaneService) so the observer is built against the real diag
// singleton — its sinks live in the activation bundle, not the lazy provider
// chunk (which bundles its own sink-less diag copy). Keeping the engine/api
// imports type-only guarantees no engine runtime leaks into activation.
import type { QueryCompleteSummary } from "../sqlDataPlane/api";
import type { EngineAggregates, EngineObserver } from "./queryEngine";

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

interface ProcessMemoryPoint {
    heapUsedBytes: number;
    externalBytes: number;
    rssBytes: number;
    arrayBuffersBytes?: number;
}

interface QueryMemoryWindow {
    start: ProcessMemoryPoint;
    peak: ProcessMemoryPoint;
    last: ProcessMemoryPoint;
    samples: number;
    lastSampleAt: number;
}

/** Prevent tiny pages from turning diagnostic memory reads into per-row work. */
const MEMORY_SAMPLE_INTERVAL_MS = 25;

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
    const memoryWindows = new Map<string, QueryMemoryWindow>();

    const sampleMemory = (clientQueryId: string, force = false): QueryMemoryWindow | undefined => {
        if (!diag.anySinkActive) {
            return memoryWindows.get(clientQueryId);
        }
        const now = Date.now();
        const current = memoryWindows.get(clientQueryId);
        if (current && !force && now - current.lastSampleAt < MEMORY_SAMPLE_INTERVAL_MS) {
            return current;
        }
        try {
            const usage = process.memoryUsage();
            const point: ProcessMemoryPoint = {
                heapUsedBytes: usage.heapUsed,
                externalBytes: usage.external,
                rssBytes: usage.rss,
                ...(typeof usage.arrayBuffers === "number"
                    ? { arrayBuffersBytes: usage.arrayBuffers }
                    : {}),
            };
            if (!current) {
                const created: QueryMemoryWindow = {
                    start: point,
                    peak: { ...point },
                    last: point,
                    samples: 1,
                    lastSampleAt: now,
                };
                memoryWindows.set(clientQueryId, created);
                return created;
            }
            current.last = point;
            current.samples++;
            current.lastSampleAt = now;
            current.peak.heapUsedBytes = Math.max(current.peak.heapUsedBytes, point.heapUsedBytes);
            current.peak.externalBytes = Math.max(current.peak.externalBytes, point.externalBytes);
            current.peak.rssBytes = Math.max(current.peak.rssBytes, point.rssBytes);
            if (point.arrayBuffersBytes !== undefined) {
                current.peak.arrayBuffersBytes = Math.max(
                    current.peak.arrayBuffersBytes ?? point.arrayBuffersBytes,
                    point.arrayBuffersBytes,
                );
            }
            return current;
        } catch {
            return current;
        }
    };

    return {
        onQueryStarted: (clientQueryId: string): void => {
            sampleMemory(clientQueryId, true);
        },
        onPageProduced: (clientQueryId: string): void => {
            sampleMemory(clientQueryId);
        },
        onTerminal: (summary: QueryCompleteSummary, aggregates: EngineAggregates): void => {
            counters.terminals++;
            const memory = sampleMemory(summary.clientQueryId, true);
            memoryWindows.delete(summary.clientQueryId);
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
                    ...(memory ? processMemoryFields(memory) : {}),
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

function processMemoryFields(
    memory: QueryMemoryWindow,
): Record<string, { raw: number | boolean; cls: "diagnostic.metadata" }> {
    const fields: Record<string, { raw: number | boolean; cls: "diagnostic.metadata" }> = {
        processMemorySamples: { raw: memory.samples, cls: "diagnostic.metadata" },
        processHeapUsedStartBytes: {
            raw: memory.start.heapUsedBytes,
            cls: "diagnostic.metadata",
        },
        processHeapUsedPeakBytes: {
            raw: memory.peak.heapUsedBytes,
            cls: "diagnostic.metadata",
        },
        processHeapUsedFinalBytes: {
            raw: memory.last.heapUsedBytes,
            cls: "diagnostic.metadata",
        },
        processExternalStartBytes: {
            raw: memory.start.externalBytes,
            cls: "diagnostic.metadata",
        },
        processExternalPeakBytes: {
            raw: memory.peak.externalBytes,
            cls: "diagnostic.metadata",
        },
        processExternalFinalBytes: {
            raw: memory.last.externalBytes,
            cls: "diagnostic.metadata",
        },
        processRssStartBytes: { raw: memory.start.rssBytes, cls: "diagnostic.metadata" },
        processRssPeakBytes: { raw: memory.peak.rssBytes, cls: "diagnostic.metadata" },
        processRssFinalBytes: { raw: memory.last.rssBytes, cls: "diagnostic.metadata" },
        processArrayBuffersAvailable: {
            raw: memory.start.arrayBuffersBytes !== undefined,
            cls: "diagnostic.metadata",
        },
    };
    if (
        memory.start.arrayBuffersBytes !== undefined &&
        memory.peak.arrayBuffersBytes !== undefined &&
        memory.last.arrayBuffersBytes !== undefined
    ) {
        fields["processArrayBuffersStartBytes"] = {
            raw: memory.start.arrayBuffersBytes,
            cls: "diagnostic.metadata",
        };
        fields["processArrayBuffersPeakBytes"] = {
            raw: memory.peak.arrayBuffersBytes,
            cls: "diagnostic.metadata",
        };
        fields["processArrayBuffersFinalBytes"] = {
            raw: memory.last.arrayBuffersBytes,
            cls: "diagnostic.metadata",
        };
    }
    return fields;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
