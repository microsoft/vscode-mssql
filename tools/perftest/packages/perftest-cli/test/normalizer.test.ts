/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import type { Marker, ScenarioSpec } from "@mssqlperf/contracts";
import { normalizeRep, type NormalizeInputs } from "../src/normalize/normalizer";
import type { ScenarioOutcome } from "../src/control/controlServer";

function marker(name: string, overrides: Partial<Marker> = {}): Marker {
    return {
        schemaVersion: 1,
        runId: "run-1",
        repId: 0,
        scenarioId: "test-scenario",
        name,
        phase: "instant",
        timestampUnixNs: "1000000000000000000",
        monotonicNs: "1000000000",
        process: { role: "extensionHost", pid: 42, name: "driver" },
        ...overrides,
    };
}

function completedOutcome(): ScenarioOutcome {
    return {
        kind: "completed",
        completed: {
            schemaVersion: 1,
            kind: "scenarioCompleted",
            runId: "run-1",
            repId: 0,
            scenarioId: "test-scenario",
            timestampUnixNs: "1",
            sender: { role: "automationExtension", pid: 42, name: "driver" },
            payload: { successChecks: [], steps: [] },
        },
    };
}

function baseInputs(overrides: Partial<NormalizeInputs> = {}): NormalizeInputs {
    return {
        runId: "run-1",
        repId: 0,
        attemptId: 0,
        scenarioId: "test-scenario",
        passType: "measurement",
        traceId: "0af7651916cd43dd8448eb211c80319c",
        rootTraceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        markers: [
            marker("scenario.start", { monotonicNs: "1000000000" }),
            marker("scenario.end", { monotonicNs: "1250000000" }),
        ],
        markersRejected: 0,
        outcome: completedOutcome(),
        environment: { environmentHash: "sha256:test" },
        git: [],
        artifacts: [{ kind: "markers", path: "markers.jsonl" }],
        ...overrides,
    };
}

describe("normalizeRep", () => {
    it("derives official wallclock from same-process monotonic markers", () => {
        const result = normalizeRep(baseInputs());
        expect(result.status).toBe("passed");
        const wallclock = result.metrics.find((m) => m.name === "scenario.wallclock");
        expect(wallclock?.value).toBeCloseTo(250);
        expect(wallclock?.official).toBe(true);
        expect(wallclock?.tags?.["timePlane"]).toBe("monotonic");
    });

    it("falls back to the epoch plane across processes and tags it", () => {
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("scenario.start", { timestampUnixNs: "1000000000000000000" }),
                    marker("scenario.end", {
                        timestampUnixNs: "1000000000300000000",
                        process: { role: "webview", pid: 99, name: "grid" },
                    }),
                ],
            }),
        );
        const wallclock = result.metrics.find((m) => m.name === "scenario.wallclock");
        expect(wallclock?.value).toBeCloseTo(300);
        expect(wallclock?.tags?.["timePlane"]).toBe("epoch");
    });

    it("missing required marker => invalid, no wallclock, never a fast number", () => {
        const result = normalizeRep(baseInputs({ markers: [marker("scenario.start")] }));
        expect(result.status).toBe("invalid");
        expect(result.metrics.find((m) => m.name === "scenario.wallclock")).toBeUndefined();
        expect(result.metrics.some((m) => m.official)).toBe(false);
        expect(result.validations.find((v) => v.name === "requiredMarkersPresent")?.status).toBe(
            "failed",
        );
    });

    it("duplicate required markers invalidate the rep instead of widening the window", () => {
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("scenario.start", { monotonicNs: "1000000000" }),
                    marker("scenario.start", { monotonicNs: "1100000000" }),
                    marker("scenario.end", { monotonicNs: "1250000000" }),
                ],
            }),
        );
        expect(result.status).toBe("invalid");
        expect(result.metrics.find((m) => m.name === "scenario.wallclock")).toBeUndefined();
        expect(
            result.validations.find((v) => v.name === "requiredMarkersPresent")?.message,
        ).toMatch(/exactly one/);
    });

    it("an inverted required-marker interval is invalid and never emits a negative metric", () => {
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("scenario.start", { monotonicNs: "1250000000" }),
                    marker("scenario.end", { monotonicNs: "1000000000" }),
                ],
            }),
        );
        expect(result.status).toBe("invalid");
        expect(result.metrics.find((m) => m.name === "scenario.wallclock")).toBeUndefined();
    });

    it("scenario failure => failed status and unofficial metrics", () => {
        const result = normalizeRep(
            baseInputs({
                outcome: {
                    kind: "failed",
                    failed: {
                        schemaVersion: 1,
                        kind: "scenarioFailed",
                        runId: "run-1",
                        repId: 0,
                        scenarioId: "test-scenario",
                        timestampUnixNs: "1",
                        sender: { role: "automationExtension", pid: 42, name: "driver" },
                        payload: { reason: "success criterion failed: rowCount" },
                    },
                },
            }),
        );
        expect(result.status).toBe("failed");
        const wallclock = result.metrics.find((m) => m.name === "scenario.wallclock");
        expect(wallclock).toBeDefined();
        expect(wallclock?.official).toBe(false);
    });

    it("diagnostic pass metrics are never official", () => {
        const result = normalizeRep(baseInputs({ passType: "diagnostic" }));
        expect(result.status).toBe("passed");
        expect(result.metrics.every((m) => !m.official)).toBe(true);
    });

    it("normalizes extension-host external and ArrayBuffer counter peaks", () => {
        const mib = 1024 * 1024;
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("scenario.start", { monotonicNs: "1000000000" }),
                    marker("exthost.memory.external", {
                        phase: "counter",
                        attrs: { value: 12 * mib },
                    }),
                    marker("exthost.memory.arrayBuffers", {
                        phase: "counter",
                        attrs: { value: 3 * mib },
                    }),
                    marker("exthost.memory.external", {
                        phase: "counter",
                        attrs: { value: 20 * mib },
                    }),
                    marker("exthost.memory.arrayBuffers", {
                        phase: "counter",
                        attrs: { value: 5 * mib },
                    }),
                    marker("scenario.end", { monotonicNs: "1250000000" }),
                ],
            }),
        );
        const metric = (name: string) =>
            result.metrics.find((candidate) => candidate.name === name);
        expect(metric("exthost.memory.external.peak")).toMatchObject({
            value: 20,
            unit: "MB",
            official: false,
        });
        expect(metric("exthost.memory.external.final")?.value).toBe(20);
        expect(metric("exthost.memory.arrayBuffers.peak")?.value).toBe(5);
        expect(metric("exthost.memory.arrayBuffers.final")?.value).toBe(5);
    });

    it("normalizes measured-window Query Studio webview health checkpoints", () => {
        const webview = { role: "webview", pid: 99, name: "queryStudio" };
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("mssql.queryStudio.webview.health", {
                        timestampUnixNs: "999999999900000000",
                        process: webview,
                        attrs: { usedJsHeapBytes: 999 * 1024 * 1024, gridInstances: 99 },
                    }),
                    marker("scenario.start", { monotonicNs: "1000000000" }),
                    marker("mssql.queryStudio.webview.health", {
                        process: webview,
                        attrs: {
                            checkpoint: "interactionPaint",
                            usedJsHeapBytes: 10 * 1024 * 1024,
                            totalJsHeapBytes: 30 * 1024 * 1024,
                            longestTaskMs: 55,
                            longTaskTotalMs: 80,
                            longTaskCount: 2,
                            gridInstances: 4,
                            mountedTabs: 2,
                            domNodes: 1000,
                        },
                    }),
                    marker("mssql.queryStudio.webview.health", {
                        process: webview,
                        attrs: {
                            checkpoint: "interactionPaint",
                            usedJsHeapBytes: 20 * 1024 * 1024,
                            totalJsHeapBytes: 40 * 1024 * 1024,
                            longestTaskMs: 75,
                            longTaskTotalMs: 120,
                            longTaskCount: 3,
                            gridInstances: 2,
                            mountedTabs: 3,
                            domNodes: 900,
                        },
                    }),
                    marker("scenario.end", { monotonicNs: "1250000000" }),
                ],
            }),
        );

        const value = (name: string) =>
            result.metrics.find((metric) => metric.name === name)?.value;
        expect(value("queryStudio.webview.usedJsHeap.peak")).toBe(20);
        expect(value("queryStudio.webview.usedJsHeap.final")).toBe(20);
        expect(value("queryStudio.webview.longestTask.peak")).toBe(75);
        expect(value("queryStudio.webview.longTaskCount.final")).toBe(3);
        expect(value("queryStudio.webview.gridInstances.peak")).toBe(4);
        expect(value("queryStudio.webview.gridInstances.final")).toBe(2);
        expect(value("queryStudio.webview.domNodes.final")).toBe(900);
        expect(
            result.metrics
                .filter((metric) => metric.name.startsWith("queryStudio.webview."))
                .every((metric) => metric.official === false),
        ).toBe(true);
    });

    it("derives declared marker-pair metrics and warns when markers are absent", () => {
        const spec: ScenarioSpec = {
            scenarioId: "test-scenario",
            displayName: "t",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [],
                end: { type: "afterLastAction" },
                timeoutMs: 1000,
            },
            metrics: [
                {
                    name: "extension.activate",
                    source: "marker",
                    official: true,
                    beginMarker: "mssql.activate.begin",
                    endMarker: "mssql.activate.end",
                    component: "extension",
                },
                {
                    name: "extension.stsSpawn",
                    source: "marker",
                    official: false,
                    beginMarker: "mssql.sts.spawn.begin",
                    endMarker: "mssql.sts.spawn.end",
                },
            ],
        };
        const result = normalizeRep(
            baseInputs({
                spec,
                markers: [
                    marker("scenario.start", { monotonicNs: "1000000000" }),
                    marker("mssql.activate.begin", { monotonicNs: "1010000000", phase: "begin" }),
                    marker("mssql.activate.end", { monotonicNs: "1110000000", phase: "end" }),
                    marker("scenario.end", { monotonicNs: "1250000000" }),
                ],
            }),
        );
        const activate = result.metrics.find((m) => m.name === "extension.activate");
        expect(activate?.value).toBeCloseTo(100);
        expect(activate?.official).toBe(true);
        expect(activate?.component).toBe("extension");
        // stsSpawn markers absent: no metric, a warning validation instead.
        expect(result.metrics.find((m) => m.name === "extension.stsSpawn")).toBeUndefined();
        expect(
            result.validations.find((v) => v.name === "metricMarkers:extension.stsSpawn")?.status,
        ).toBe("warning");
    });

    it("withinMeasuredWindow rejects delayed preflight markers by event timestamp", () => {
        const spec: ScenarioSpec = {
            scenarioId: "test-scenario",
            displayName: "t",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [],
                end: { type: "afterLastAction" },
                timeoutMs: 1000,
            },
            metrics: [
                {
                    name: "mssql.queryStudio.query.toComplete",
                    source: "marker",
                    official: false,
                    beginMarker: "mssql.queryStudio.query.submit",
                    endMarker: "mssql.queryStudio.query.complete",
                    withinMeasuredWindow: true,
                },
            ],
        };
        const result = normalizeRep(
            baseInputs({
                spec,
                markers: [
                    // Setup preflight emits the SAME marker family before the window.
                    marker("mssql.queryStudio.query.submit", {
                        timestampUnixNs: "999999999900000000",
                        monotonicNs: "100000000",
                        phase: "begin",
                    }),
                    marker("scenario.start", {
                        timestampUnixNs: "1000000000000000000",
                        monotonicNs: "1000000000",
                    }),
                    // Its end arrives AFTER scenario.start in file order, but carries
                    // the correct pre-window event timestamp (the live rep-3 race).
                    marker("mssql.queryStudio.query.complete", {
                        timestampUnixNs: "999999999905000000",
                        monotonicNs: "105000000",
                        phase: "end",
                    }),
                    marker("mssql.queryStudio.query.submit", {
                        timestampUnixNs: "1000000000010000000",
                        monotonicNs: "1010000000",
                        phase: "begin",
                    }),
                    marker("mssql.queryStudio.query.complete", {
                        timestampUnixNs: "1000000000510000000",
                        monotonicNs: "1510000000",
                        phase: "end",
                    }),
                    marker("scenario.end", {
                        timestampUnixNs: "1000000000600000000",
                        monotonicNs: "1600000000",
                    }),
                ],
            }),
        );
        const toComplete = result.metrics.find(
            (m) => m.name === "mssql.queryStudio.query.toComplete",
        );
        // The measured pair (500ms), never the 5ms setup preflight pair.
        expect(toComplete?.value).toBeCloseTo(500);
    });

    it("projects the measured ts-native terminal into diagnostic stage metrics", () => {
        const result = normalizeRep(
            baseInputs({
                markers: [
                    marker("sqlDataPlane.tsNative.query.terminal", {
                        timestampUnixNs: "999999999900000000",
                        attrs: { durationMs: 1, encodeMsTotal: 99 },
                    }),
                    marker("scenario.start", { timestampUnixNs: "1000000000000000000" }),
                    marker("mssql.queryStudio.query.submit", {
                        timestampUnixNs: "1000000000050000000",
                        phase: "begin",
                    }),
                    marker("sqlDataPlane.tsNative.query.terminal", {
                        timestampUnixNs: "1000000000100000000",
                        attrs: {
                            queryStatus: "succeeded",
                            durationMs: 152.536,
                            firstMetadataMs: 4.16,
                            firstPageProducedMs: 23.52,
                            firstPageAcceptedMs: 24.06,
                            encodeMsTotal: 20.05,
                            sinkWaitMsTotal: 6.67,
                            pauseMsBackpressure: 1.25,
                            pauseMsCpuYield: 0.5,
                            maxSynchronousSliceMs: 12.05,
                            logicalEncodedBytes: 2_901_127,
                            pages: 12,
                            driverEvents: 10_100,
                            yields: 3,
                            processHeapUsedPeakBytes: 120_000_000,
                            processExternalPeakBytes: 80_000_000,
                            processRssPeakBytes: 400_000_000,
                            processArrayBuffersAvailable: false,
                        },
                    }),
                    marker("mssql.queryStudio.query.complete", {
                        timestampUnixNs: "1000000000150000000",
                        phase: "end",
                    }),
                    // A later provider-owned metadata query must never replace the
                    // measured user query's terminal attribution.
                    marker("sqlDataPlane.tsNative.query.terminal", {
                        timestampUnixNs: "1000000000170000000",
                        attrs: { durationMs: 2.3, encodeMsTotal: 0, rows: 0 },
                    }),
                    marker("scenario.end", { timestampUnixNs: "1000000000200000000" }),
                ],
            }),
        );

        const byName = new Map(result.metrics.map((metric) => [metric.name, metric]));
        expect(byName.get("sqlDataPlane.tsNative.query.duration")?.value).toBe(152.54);
        expect(byName.get("sqlDataPlane.tsNative.query.encode")?.value).toBe(20.05);
        expect(byName.get("sqlDataPlane.tsNative.query.logicalEncodedBytes")?.value).toBe(
            2_901_127,
        );
        expect(byName.get("sqlDataPlane.tsNative.query.pages")?.value).toBe(12);
        expect(byName.get("sqlDataPlane.tsNative.query.processHeapUsedPeakBytes")?.value).toBe(
            120_000_000,
        );
        expect(byName.get("sqlDataPlane.tsNative.query.processExternalPeakBytes")?.value).toBe(
            80_000_000,
        );
        expect(byName.has("sqlDataPlane.tsNative.query.processArrayBuffersPeakBytes")).toBe(false);
        expect(byName.get("sqlDataPlane.tsNative.query.duration")?.official).toBe(false);
        expect(
            byName.get("sqlDataPlane.tsNative.query.duration")?.eligibility?.diagnosticOnly,
        ).toBe(true);
        expect(byName.get("sqlDataPlane.tsNative.query.duration")?.tags).toEqual({
            basis: "tsNativeTerminalAggregate",
            queryStatus: "succeeded",
        });
    });

    it("infrastructure error => invalid with the error recorded", () => {
        const result = normalizeRep(
            baseInputs({
                markers: [],
                outcome: undefined,
                infrastructureError: "VS Code exited early with code 1",
            }),
        );
        expect(result.status).toBe("invalid");
        expect(result.errors.some((e) => e.kind === "infrastructure")).toBe(true);
    });
});
