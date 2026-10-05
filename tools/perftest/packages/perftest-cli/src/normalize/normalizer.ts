/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rep normalizer (design §20): turns the raw signals of one repetition —
 * markers, scenario outcome, calibration, environment — into a schema-valid
 * result.json.
 *
 * Honesty rules enforced here (§A3, §12.2):
 *  - scenario.wallclock exists ONLY if both required markers were observed.
 *  - A missing required marker ⇒ status `invalid`, no official metrics, ever.
 *  - `official: true` only in a measurement pass on a passed rep.
 *  - Durations come from one process's monotonic clock when possible; the
 *    fallback (epoch diff) is recorded via the `aggregation`-independent
 *    `tags.timePlane` so a reader can always tell how a number was derived.
 */

import type {
    Marker,
    Metric,
    PerfResult,
    PassType,
    RepStatus,
    ValidationRecord,
    ErrorRecord,
    GitRepoInfo,
    EnvironmentInfo,
    ArtifactRef,
    ScenarioSpec,
} from "@mssqlperf/contracts";
import { validateResult } from "@mssqlperf/contracts";
import { deriveEligibility } from "@mssqlperf/observability-contracts";
import type { CalibrationResult, ScenarioOutcome } from "../control/controlServer";
import {
    analyzeSoak,
    extractIterations,
    memorySeriesFromMarkers,
    soakMetrics,
} from "../regression/soakAnalysis";

export interface NormalizeInputs {
    runId: string;
    repId: number;
    attemptId: number;
    scenarioId: string;
    passType: PassType;
    traceId: string;
    rootTraceparent: string;
    markers: Marker[];
    markersRejected: number;
    outcome: ScenarioOutcome | undefined;
    /** Set when the rep infrastructure broke (timeout, no connect, crash). */
    infrastructureError?: string;
    calibration?: CalibrationResult;
    environment: EnvironmentInfo;
    git: GitRepoInfo[];
    artifacts: ArtifactRef[];
    /** Scenario spec, for declared marker-pair metrics. */
    spec?: ScenarioSpec;
    /** Collector-produced metrics; forced official:false regardless of input. */
    extraMetrics?: Metric[];
    /** Collector validations (availability warnings etc.). */
    extraValidations?: ValidationRecord[];
    /**
     * Orchestrator-clock timings (§11.2 official wall-clock plane): spawn→ready
     * feeds the ext-first-launch scenario's startup metric.
     */
    orchestratorTimings?: { spawnToReadyMs: number };
}

/** Metric sources produced by diagnostic collectors — never measurement. */
const COLLECTOR_SOURCES = new Set([
    "sqlServerXEvents",
    "sqlStatistics",
    "processSampler",
    "dotnetCounters",
    "dotnetTrace",
    "cdp",
    "etw",
]);

/**
 * Duration between two markers, honest about the timing plane: same-process
 * monotonic when both markers allow it, epoch otherwise (tagged).
 */
function markerPairDuration(
    begin: Marker,
    end: Marker,
): { valueMs: number; timePlane: "monotonic" | "epoch" } {
    const samePlane = begin.process.pid === end.process.pid && begin.monotonicNs && end.monotonicNs;
    if (samePlane) {
        return {
            valueMs:
                Number(BigInt(end.monotonicNs as string) - BigInt(begin.monotonicNs as string)) /
                1e6,
            timePlane: "monotonic",
        };
    }
    return {
        valueMs: Number(BigInt(end.timestampUnixNs) - BigInt(begin.timestampUnixNs)) / 1e6,
        timePlane: "epoch",
    };
}

function markerTimestamp(marker: Marker | undefined): bigint | undefined {
    if (!marker) return undefined;
    try {
        return BigInt(marker.timestampUnixNs);
    } catch {
        return undefined;
    }
}

function compareMarkerTime(a: Marker, b: Marker): number {
    const aTime = markerTimestamp(a);
    const bTime = markerTimestamp(b);
    if (aTime === undefined) return bTime === undefined ? 0 : 1;
    if (bTime === undefined) return -1;
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
}

export function normalizeRep(inputs: NormalizeInputs): PerfResult {
    const validations: ValidationRecord[] = [];
    const errors: ErrorRecord[] = [];
    const metrics: Metric[] = [];

    const starts = inputs.markers.filter((m) => m.name === "scenario.start");
    const ends = inputs.markers.filter((m) => m.name === "scenario.end");
    const start = starts[0];
    const end = ends[0];
    let wallclock: ReturnType<typeof markerPairDuration> | undefined;
    let requiredMarkerError: string | undefined;
    if (starts.length !== 1 || ends.length !== 1) {
        requiredMarkerError = `expected exactly one scenario.start and scenario.end (start=${starts.length}, end=${ends.length})`;
    } else {
        try {
            wallclock = markerPairDuration(start!, end!);
            if (wallclock.valueMs < 0) {
                requiredMarkerError = `scenario.end precedes scenario.start (${wallclock.valueMs}ms)`;
                wallclock = undefined;
            }
        } catch (error) {
            requiredMarkerError = `invalid scenario marker timestamps: ${String(error)}`;
        }
    }
    const requiredPresent = wallclock !== undefined;

    validations.push({
        name: "requiredMarkersPresent",
        status: requiredPresent ? "passed" : "failed",
        ...(requiredPresent
            ? {}
            : {
                  message: requiredMarkerError ?? "required scenario markers are invalid",
              }),
    });

    if (inputs.calibration) {
        const rttMs = Number(BigInt(inputs.calibration.roundTripNs)) / 1e6;
        validations.push({
            name: "clockCalibration",
            status: rttMs <= 50 ? "passed" : "warning",
            message: `offset=${inputs.calibration.offsetNs}ns roundTrip=${rttMs.toFixed(2)}ms over ${inputs.calibration.samples} samples`,
            details: { ...inputs.calibration },
        });
    } else {
        validations.push({
            name: "clockCalibration",
            status: "skipped",
            message: "no calibration performed",
        });
    }

    validations.push({
        name: "markerSinkClean",
        status: inputs.markersRejected === 0 ? "passed" : "warning",
        ...(inputs.markersRejected > 0
            ? { message: `${inputs.markersRejected} marker(s) rejected by schema validation` }
            : {}),
    });

    // --- Status determination (design §9.3 failure policy) -------------------
    let status: RepStatus;
    if (inputs.infrastructureError) {
        status = "invalid";
        errors.push({
            kind: "infrastructure",
            message: inputs.infrastructureError,
            source: "harness",
        });
    } else if (!inputs.outcome) {
        status = "invalid";
        errors.push({
            kind: "control",
            message: "no scenario outcome received",
            source: "harness",
        });
    } else if (!requiredPresent) {
        // Even a "completed" scenario without its required markers is untrusted.
        // Preserve the driver's failure reason so the report explains WHY.
        status = "invalid";
        if (inputs.outcome.kind === "failed") {
            const failed = inputs.outcome.failed;
            errors.push({
                kind: "scenario",
                message: failed?.payload.reason ?? "scenario failed",
                ...(failed?.payload.stack ? { stack: failed.payload.stack } : {}),
                source: "automationExtension",
            });
        }
    } else if (inputs.outcome.kind === "failed") {
        status = "failed";
        const failed = inputs.outcome.failed;
        errors.push({
            kind: "scenario",
            message: failed?.payload.reason ?? "scenario failed",
            ...(failed?.payload.stack ? { stack: failed.payload.stack } : {}),
            source: "automationExtension",
        });
    } else {
        const checks = inputs.outcome.completed?.payload.successChecks ?? [];
        const failedCheck = checks.find((c) => c.status === "failed");
        if (failedCheck) {
            status = "failed";
            errors.push({
                kind: "successCriterion",
                message: failedCheck.message ?? `success check failed: ${failedCheck.step}`,
                source: "automationExtension",
            });
        } else {
            status = "passed";
        }
        for (const check of checks) {
            validations.push({
                name: `success:${check.step}`,
                status: check.status === "passed" ? "passed" : "failed",
                ...(check.message ? { message: check.message } : {}),
            });
        }
    }

    // --- Official wall-clock (only from real markers) -------------------------
    const officialEligible = inputs.passType === "measurement" && status === "passed";
    // Scenarios may opt wallclock OUT of officialness (e.g. ext-first-launch,
    // where the headline metric is the startup timer and the noop wallclock is
    // meaningless). Default remains official.
    const wallclockDeclared =
        inputs.spec?.metrics?.find((m) => m.name === "scenario.wallclock")?.official ?? true;
    if (wallclock && start && end) {
        const { valueMs, timePlane } = wallclock;
        metrics.push({
            name: "scenario.wallclock",
            value: valueMs,
            unit: "ms",
            component: "scenario",
            processRole: "boundary",
            source: "marker",
            official: officialEligible && wallclockDeclared,
            lowerIsBetter: true,
            traceId: inputs.traceId,
            startUnixNs: start.timestampUnixNs,
            endUnixNs: end.timestampUnixNs,
            tags: { timePlane },
        });
    }

    // --- Orchestrator startup timing (§8 ext-first-launch, §11.2 plane 1) ------
    // Official ONLY when the scenario declares vscode.startup.ready official.
    if (inputs.orchestratorTimings) {
        const declared = inputs.spec?.metrics?.find((m) => m.name === "vscode.startup.ready");
        metrics.push({
            name: "vscode.startup.ready",
            value: Number(inputs.orchestratorTimings.spawnToReadyMs.toFixed(1)),
            unit: "ms",
            component: "vscode",
            processRole: "boundary",
            source: "manual",
            official: (declared?.official ?? false) && officialEligible,
            lowerIsBetter: true,
            tags: { basis: "orchestrator spawn→driver ready (single clock)" },
        });
    }

    // --- Declared marker-pair metrics (design §7 scenario metric definitions) --
    // withinMeasuredWindow scopes the pair search to scenario.start…scenario.end
    // (declared per metric): scenarios whose SETUP emits the same product
    // markers as the measured action (e.g. Query Studio's unmeasured session
    // preflight) must not have the setup pair timed as the metric.
    // Marker delivery is asynchronous across extension host and webviews. A
    // preflight event can arrive after scenario.start in FILE ORDER while its
    // event timestamp is correctly earlier. Scope and order by event time so
    // delayed delivery cannot poison the measured pair.
    const startNs = markerTimestamp(start);
    const endNs = markerTimestamp(end);
    const windowMarkers =
        startNs !== undefined && endNs !== undefined && endNs >= startNs
            ? inputs.markers
                  .filter((marker) => {
                      const timestamp = markerTimestamp(marker);
                      return timestamp !== undefined && timestamp >= startNs && timestamp <= endNs;
                  })
                  .sort((a, b) => compareMarkerTime(a, b))
            : [];
    for (const metricSpec of inputs.spec?.metrics ?? []) {
        if (!metricSpec.beginMarker || !metricSpec.endMarker) {
            continue;
        }
        const searchMarkers = metricSpec.withinMeasuredWindow ? windowMarkers : inputs.markers;
        // Pair the LAST begin preceding the FIRST end: retry paths can emit
        // multiple begins (e.g. sts spawn re-attempts) and the tightest pair is
        // the honest duration of the attempt that completed.
        const endIndex = searchMarkers.findIndex((m) => m.name === metricSpec.endMarker);
        const endMarker = endIndex >= 0 ? searchMarkers[endIndex] : undefined;
        const begin =
            endIndex >= 0
                ? [...searchMarkers.slice(0, endIndex)]
                      .reverse()
                      .find((m) => m.name === metricSpec.beginMarker)
                : undefined;
        if (!begin || !endMarker) {
            // No fabrication: a declared metric whose markers were not observed is
            // simply absent, and that absence is recorded as a validation.
            validations.push({
                name: `metricMarkers:${metricSpec.name}`,
                status: "warning",
                message: `markers ${metricSpec.beginMarker}/${metricSpec.endMarker} not both observed`,
            });
            continue;
        }
        const { valueMs, timePlane } = markerPairDuration(begin, endMarker);
        metrics.push({
            name: metricSpec.name,
            value: valueMs,
            unit: "ms",
            component: metricSpec.component ?? "extension",
            processRole: metricSpec.processRole ?? begin.process.role,
            source: "marker",
            official: metricSpec.official && officialEligible,
            lowerIsBetter: metricSpec.lowerIsBetter ?? true,
            traceId: inputs.traceId,
            startUnixNs: begin.timestampUnixNs,
            endUnixNs: endMarker.timestampUnixNs,
            tags: { timePlane },
        });
    }

    // --- Soak analysis (Phase-2 M10): iteration markers → latency/reliability/
    // leak metrics. Latency/reliability/RSS-slope are official-eligible on the
    // marker plane; verdicts carry slope+CI+R²+samples in tags (never a bare
    // "no leak"). The full per-iteration record set is the soak-iterations.jsonl
    // artifact written by the pipeline.
    if (inputs.spec?.loop) {
        const iterations = extractIterations(inputs.markers);
        if (iterations.length > 0) {
            const memorySeries = memorySeriesFromMarkers(inputs.markers, iterations);
            const analysis = analyzeSoak(iterations, memorySeries);
            metrics.push(...soakMetrics(analysis, officialEligible));
            if (analysis.memory) {
                validations.push({
                    name: "soakMemoryVerdict",
                    status: analysis.memory.verdict === "growing" ? "warning" : "passed",
                    message: `${analysis.memory.verdict}: ${analysis.memory.reason}`,
                });
            }
            if (analysis.reliability.failures > 0) {
                validations.push({
                    name: "soakReliability",
                    status: "warning",
                    message: `${analysis.reliability.failures}/${analysis.reliability.steadyStateIterations} iterations failed (first at #${analysis.reliability.firstFailureIndex}); taxonomy: ${JSON.stringify(analysis.reliability.errorTaxonomy)}`,
                });
            }
        } else {
            validations.push({
                name: "soakIterations",
                status: "warning",
                message: "loop scenario produced no iteration markers",
            });
        }
    }

    // --- Counter-marker summaries (memory timelines etc., design M7) ---------
    // Counter markers carry a numeric attrs.value; summarize peak + final per
    // counter name. The full timeline stays in markers.jsonl.
    const counters = new Map<string, Array<{ value: number; marker: Marker }>>();
    for (const m of inputs.markers) {
        if (m.phase === "counter" && typeof m.attrs?.["value"] === "number") {
            const list = counters.get(m.name) ?? [];
            list.push({ value: m.attrs["value"], marker: m });
            counters.set(m.name, list);
        }
    }
    for (const [name, series] of counters) {
        const peak = Math.max(...series.map((s) => s.value));
        const final = series[series.length - 1]!.value;
        const isBytes = /memory|rss|heap/i.test(name);
        const scale = isBytes ? 1 / (1024 * 1024) : 1;
        const unit = isBytes ? "MB" : "count";
        const role = series[0]!.marker.process.role;
        metrics.push({
            name: `${name}.peak`,
            value: Number((peak * scale).toFixed(1)),
            unit,
            component: "process",
            processRole: role,
            source: "marker",
            official: false,
            lowerIsBetter: true,
            tags: { samples: series.length },
        });
        metrics.push({
            name: `${name}.final`,
            value: Number((final * scale).toFixed(1)),
            unit,
            component: "process",
            processRole: role,
            source: "marker",
            official: false,
            lowerIsBetter: true,
            tags: { samples: series.length },
        });
    }

    // --- Query Studio webview health checkpoints ----------------------------
    // Product-owned post-paint snapshots make renderer heap/long-task/grid/DOM
    // state available even when a diagnostic CDP trace is disabled. Only the
    // measured window participates, so an interaction scenario's setup query
    // cannot pollute the reported resource state.
    const health = windowMarkers.filter((m) => m.name === "mssql.queryStudio.webview.health");
    const healthFields: Array<{
        attr: string;
        name: string;
        unit: string;
        scale: number;
        summary: "max" | "final" | "both";
    }> = [
        {
            attr: "usedJsHeapBytes",
            name: "queryStudio.webview.usedJsHeap",
            unit: "MB",
            scale: 1 / (1024 * 1024),
            summary: "both",
        },
        {
            attr: "totalJsHeapBytes",
            name: "queryStudio.webview.totalJsHeap",
            unit: "MB",
            scale: 1 / (1024 * 1024),
            summary: "both",
        },
        {
            attr: "longestTaskMs",
            name: "queryStudio.webview.longestTask",
            unit: "ms",
            scale: 1,
            summary: "max",
        },
        {
            attr: "longTaskTotalMs",
            name: "queryStudio.webview.longTaskTotal",
            unit: "ms",
            scale: 1,
            summary: "final",
        },
        {
            attr: "longTaskCount",
            name: "queryStudio.webview.longTaskCount",
            unit: "count",
            scale: 1,
            summary: "final",
        },
        {
            attr: "gridInstances",
            name: "queryStudio.webview.gridInstances",
            unit: "count",
            scale: 1,
            summary: "both",
        },
        {
            attr: "mountedTabs",
            name: "queryStudio.webview.mountedTabs",
            unit: "count",
            scale: 1,
            summary: "final",
        },
        {
            attr: "domNodes",
            name: "queryStudio.webview.domNodes",
            unit: "count",
            scale: 1,
            summary: "both",
        },
    ];
    for (const field of healthFields) {
        const values = health.flatMap((m) =>
            typeof m.attrs?.[field.attr] === "number" ? [m.attrs[field.attr] as number] : [],
        );
        if (values.length === 0) continue;
        const addMetric = (suffix: "peak" | "final", raw: number): void => {
            metrics.push({
                name: `${field.name}.${suffix}`,
                value: Number((raw * field.scale).toFixed(field.unit === "count" ? 0 : 2)),
                unit: field.unit,
                component: "queryStudio",
                processRole: "webview",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                tags: { samples: values.length, scope: "measuredWindowPostPaint" },
            });
        };
        if (field.summary === "max" || field.summary === "both") {
            addMetric("peak", Math.max(...values));
        }
        if (field.summary === "final" || field.summary === "both") {
            addMetric("final", values[values.length - 1]!);
        }
    }

    // --- ts-native engine terminal aggregates -------------------------------
    // The provider emits exactly one privacy-safe diagnostic event per query.
    // Project the measured-window terminal's attributes into result metrics so
    // A/B reports and historical queries do not need to re-parse markers.jsonl.
    // `source: derived` without a derivation block is deliberate: these remain
    // diagnostic-only even in a passing measurement rep.
    const measuredQueryCompleteIndex = windowMarkers.findIndex(
        (marker) => marker.name === "mssql.queryStudio.query.complete",
    );
    const precedingQueryMarkers =
        measuredQueryCompleteIndex >= 0 ? windowMarkers.slice(0, measuredQueryCompleteIndex) : [];
    const reversedSubmitIndex = [...precedingQueryMarkers]
        .reverse()
        .findIndex((marker) => marker.name === "mssql.queryStudio.query.submit");
    const measuredQuerySubmitIndex =
        reversedSubmitIndex >= 0 ? precedingQueryMarkers.length - 1 - reversedSubmitIndex : -1;
    const nativeTerminal =
        measuredQuerySubmitIndex >= 0 && measuredQueryCompleteIndex > measuredQuerySubmitIndex
            ? [...windowMarkers.slice(measuredQuerySubmitIndex + 1, measuredQueryCompleteIndex + 1)]
                  .reverse()
                  .find((marker) => marker.name === "sqlDataPlane.tsNative.query.terminal")
            : undefined;
    if (nativeTerminal) {
        const nativeFields: Array<{
            attr: string;
            name: string;
            unit: string;
            digits: number;
        }> = [
            {
                attr: "durationMs",
                name: "sqlDataPlane.tsNative.query.duration",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "firstMetadataMs",
                name: "sqlDataPlane.tsNative.query.firstMetadata",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "firstPageProducedMs",
                name: "sqlDataPlane.tsNative.query.firstPageProduced",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "firstPageAcceptedMs",
                name: "sqlDataPlane.tsNative.query.firstPageAccepted",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "encodeMsTotal",
                name: "sqlDataPlane.tsNative.query.encode",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "sinkWaitMsTotal",
                name: "sqlDataPlane.tsNative.query.sinkWait",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "pauseMsBackpressure",
                name: "sqlDataPlane.tsNative.query.pause.backpressure",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "pauseMsCpuYield",
                name: "sqlDataPlane.tsNative.query.pause.cpuYield",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "maxSynchronousSliceMs",
                name: "sqlDataPlane.tsNative.query.maxSynchronousSlice",
                unit: "ms",
                digits: 2,
            },
            {
                attr: "logicalEncodedBytes",
                name: "sqlDataPlane.tsNative.query.logicalEncodedBytes",
                unit: "bytes",
                digits: 0,
            },
            { attr: "pages", name: "sqlDataPlane.tsNative.query.pages", unit: "count", digits: 0 },
            {
                attr: "driverEvents",
                name: "sqlDataPlane.tsNative.query.driverEvents",
                unit: "count",
                digits: 0,
            },
            {
                attr: "yields",
                name: "sqlDataPlane.tsNative.query.yields",
                unit: "count",
                digits: 0,
            },
            {
                attr: "processHeapUsedPeakBytes",
                name: "sqlDataPlane.tsNative.query.processHeapUsedPeakBytes",
                unit: "bytes",
                digits: 0,
            },
            {
                attr: "processExternalPeakBytes",
                name: "sqlDataPlane.tsNative.query.processExternalPeakBytes",
                unit: "bytes",
                digits: 0,
            },
            {
                attr: "processRssPeakBytes",
                name: "sqlDataPlane.tsNative.query.processRssPeakBytes",
                unit: "bytes",
                digits: 0,
            },
            {
                attr: "processArrayBuffersPeakBytes",
                name: "sqlDataPlane.tsNative.query.processArrayBuffersPeakBytes",
                unit: "bytes",
                digits: 0,
            },
        ];
        for (const field of nativeFields) {
            const raw = nativeTerminal.attrs?.[field.attr];
            if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
            metrics.push({
                name: field.name,
                value: Number(raw.toFixed(field.digits)),
                unit: field.unit,
                component: "sqlDataPlane",
                processRole: nativeTerminal.process.role,
                source: "derived",
                official: false,
                lowerIsBetter: true,
                tags: {
                    basis: "tsNativeTerminalAggregate",
                    ...(typeof nativeTerminal.attrs?.["queryStatus"] === "string"
                        ? { queryStatus: nativeTerminal.attrs["queryStatus"] as string }
                        : {}),
                },
            });
        }
    }

    // Collector metrics: structurally incapable of being official (§12.2).
    for (const metric of inputs.extraMetrics ?? []) {
        metrics.push({ ...metric, official: false });
    }
    for (const validation of inputs.extraValidations ?? []) {
        validations.push(validation);
    }

    // --- Derived network/driver time (design §19.3) ---------------------------
    // Requires BOTH a client-side query span (product markers) and the
    // server-side XEvents total. Confidence is LOW until STS SqlClient timing
    // exists: the client span includes RPC transit, STS handling, and driver
    // work — the derivation says so instead of pretending precision.
    const clientQuery = metrics.find((m) => m.name === "mssql.query.toComplete");
    const serverDuration = metrics.find((m) => m.name === "sqlserver.duration");
    if (clientQuery && serverDuration && serverDuration.value >= 0) {
        metrics.push({
            name: "sql.networkDriver.duration",
            value: Number(Math.max(0, clientQuery.value - serverDuration.value).toFixed(3)),
            unit: "ms",
            component: "driver",
            processRole: "boundary",
            source: "derived",
            official: false,
            lowerIsBetter: true,
            confidence: "low",
            derivation: {
                formula: "max(0, mssql.query.toComplete - sqlserver.duration)",
                inputs: ["mssql.query.toComplete", "sqlserver.duration"],
                confidence: "low",
                limitations: [
                    "client span includes JSON-RPC transit, STS handling, and driver work (no STS SqlClient timing yet)",
                    "multiple statements in the window are summed on the server side",
                    "async row streaming can overlap server and client time",
                ],
            },
        });
    }

    // Stamp the structured eligibility decision on every metric (Shared
    // Observability Contract). The CLI harness is the controlled environment;
    // collectors and epoch-plane durations come out diagnostic-only by rule,
    // not by convention. `official` stays authoritative for the gate — the
    // consistency between the two is asserted by contract tests.
    for (let i = 0; i < metrics.length; i++) {
        const metric = metrics[i];
        if (!metric) {
            continue;
        }
        const timePlane =
            (metric.tags?.timePlane as "monotonic" | "epoch" | undefined) ??
            (metric.source === "derived" ? "derived" : "monotonic");
        const candidateInputs = metric.derivation?.inputs.map(
            (name) => metrics.find((candidate) => candidate.name === name)?.eligibility,
        );
        const resolvedInputs = candidateInputs?.every(
            (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
        )
            ? candidateInputs
            : [];
        const eligibility = deriveEligibility({
            source: metric.source,
            passType: inputs.passType,
            environment: "controlledHarness",
            timePlane,
            repStatus: status,
            richCollection: false,
            fromCollector: COLLECTOR_SOURCES.has(metric.source),
            hasDerivation: metric.derivation !== undefined,
            ...(metric.derivation ? { inputs: resolvedInputs } : {}),
        });
        metrics[i] = { ...metric, eligibility };
        // Legacy flag vs structured decision disagreement is surfaced, never
        // silent — e.g. a declared-official metric whose markers landed on the
        // epoch plane. The gate keeps `official` for now; the warning is the
        // honest record that the number's trust label says otherwise.
        if (metric.official && !eligibility.measurementEligible) {
            validations.push({
                name: `eligibility:${metric.name}`,
                status: "warning",
                message: `official flag set but eligibility says diagnostic-only (${eligibility.reason})`,
            });
        }
    }

    const result: PerfResult = {
        schemaVersion: 2,
        runId: inputs.runId,
        repId: inputs.repId,
        scenarioId: inputs.scenarioId,
        attemptId: inputs.attemptId,
        passType: inputs.passType,
        status,
        trace: { traceId: inputs.traceId, rootTraceparent: inputs.rootTraceparent },
        git: inputs.git,
        environment: inputs.environment,
        metrics,
        artifacts: inputs.artifacts,
        validations,
        errors,
    };

    // A result that fails its own schema is a harness bug — fail loudly. The
    // schema requires metrics to be non-empty; a rep with no markers gets a
    // metric-less placeholder that documents the absence explicitly.
    if (metrics.length === 0) {
        metrics.push({
            name: "harness.noOfficialSignal",
            value: 0,
            unit: "count",
            component: "harness",
            processRole: "orchestrator",
            source: "manual",
            official: false,
            lowerIsBetter: false,
            tags: { reason: "required markers missing; no timing can be derived" },
        });
    }
    const outcome = validateResult(result);
    if (!outcome.valid) {
        throw new Error(`Normalizer produced an invalid result.json: ${outcome.errors.join("; ")}`);
    }
    return result;
}
