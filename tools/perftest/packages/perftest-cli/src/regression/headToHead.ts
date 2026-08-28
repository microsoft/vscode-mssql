/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Head-to-head scenario comparison (B7.7): two SCENARIOS (default: the classic
 * query editor gate vs its Query Studio counterpart), each represented by its
 * most recent run whose reps passed with official samples. Explicitly
 * NON-GATING — the sides are different code paths with different maturity, so
 * this is an investigation view, never a regression verdict. Phase rows map
 * marker-pair metrics that share SEMANTICS (submit→complete, submit→render)
 * across differently-named metric families.
 */

import type { PerfStore } from "../store/sqliteStore";
import type { HarnessLogger } from "../telemetry/logger";
import { summarize, type SampleSummary } from "./statistics";

export class HeadToHeadError extends Error {}

export interface PhaseMapping {
    /** Human label for the shared semantics, e.g. "submit → render". */
    phase: string;
    baselineMetric: string;
    candidateMetric: string;
}

/** The canonical pairing this command exists for. */
export const DEFAULT_BASELINE_SCENARIO = "query-10k-results";
export const DEFAULT_CANDIDATE_SCENARIO = "querystudio-query-10k";
export const DEFAULT_PHASE_MAP: PhaseMapping[] = [
    {
        phase: "submit → complete",
        baselineMetric: "mssql.query.toComplete",
        candidateMetric: "mssql.queryStudio.query.toComplete",
    },
    {
        phase: "submit → render",
        baselineMetric: "mssql.query.toRender",
        candidateMetric: "mssql.queryStudio.query.toRender",
    },
];

/**
 * Schema Designer (DacFx/STS v1) vs Schema Visualizer (MetadataStore/data
 * plane) — schema-visualizer addendum §14.2: the HOST/MODEL phase compares
 * DacFx session+model load against metadata acquire+adaptation; the
 * RENDERED phase compares to each surface's first-meaningful-paint mark.
 * Auto-selected when the designer pair is compared; every other pairing
 * falls through to metric-presence inference below.
 */
export const DESIGNER_PHASE_MAP: PhaseMapping[] = [
    {
        phase: "host/model ready",
        baselineMetric: "mssql.schemaDesigner.init",
        candidateMetric: "mssql.schemaVisualizer.open",
    },
    {
        phase: "open → rendered",
        baselineMetric: "mssql.schemaDesigner.init.toReady",
        candidateMetric: "mssql.schemaVisualizer.open.toReady",
    },
];

/** Fixed map for KNOWN scenario pairings; undefined = infer from metrics. */
export function phaseMapForScenarios(
    baselineScenario: string,
    candidateScenario: string,
): PhaseMapping[] | undefined {
    if (
        baselineScenario === "schema-designer-open" &&
        candidateScenario === "schema-visualizer-open"
    ) {
        return DESIGNER_PHASE_MAP;
    }
    return undefined;
}

interface PhaseFamily {
    phase: string;
    baselineCandidates: string[];
    candidateCandidates: string[];
}

/**
 * Resolve each side from what the selected scenarios actually recorded. This
 * preserves the classic-vs-Query-Studio default while making Query-Studio
 * backend A/B pairs compare like-for-like instead of looking for absent
 * classic-editor metrics on the baseline side.
 */
const AUTO_PHASE_FAMILIES: PhaseFamily[] = [
    {
        phase: "submit → first accepted page",
        baselineCandidates: ["mssql.queryStudio.query.toFirstPage"],
        candidateCandidates: ["mssql.queryStudio.query.toFirstPage"],
    },
    {
        phase: "submit → complete",
        baselineCandidates: ["mssql.query.toComplete", "mssql.queryStudio.query.toComplete"],
        candidateCandidates: ["mssql.queryStudio.query.toComplete", "mssql.query.toComplete"],
    },
    {
        phase: "submit → render",
        baselineCandidates: ["mssql.query.toRender", "mssql.queryStudio.query.toRender"],
        candidateCandidates: ["mssql.queryStudio.query.toRender", "mssql.query.toRender"],
    },
];

/**
 * An interaction-only phase. It is inferred only when either selected run
 * actually recorded it, so ordinary query A/B reports do not acquire a
 * misleading "missing copy" note.
 */
const GRID_COPY_PHASE: PhaseFamily = {
    phase: "grid exact copy",
    baselineCandidates: ["mssql.queryStudio.grid.copy"],
    candidateCandidates: ["mssql.queryStudio.grid.copy"],
};

/** High-signal non-gating diagnostics worth putting beside every A/B. */
const COMPARABLE_DIAGNOSTIC_METRICS = [
    "process.dataPlane.cpuTime",
    "process.dataPlane.peakWorkingSet",
    "exthost.memory.heapUsed.peak",
    "exthost.memory.external.peak",
    "exthost.memory.arrayBuffers.peak",
    "exthost.memory.rss.peak",
    "sqlDataPlane.tsNative.query.processHeapUsedPeakBytes",
    "sqlDataPlane.tsNative.query.processExternalPeakBytes",
    "sqlDataPlane.tsNative.query.processArrayBuffersPeakBytes",
    "sqlDataPlane.tsNative.query.processRssPeakBytes",
    "queryStudio.webview.usedJsHeap.peak",
    "queryStudio.webview.totalJsHeap.peak",
    "queryStudio.webview.longestTask.peak",
    "queryStudio.webview.longTaskTotal.final",
    "queryStudio.webview.longTaskCount.final",
    "queryStudio.webview.domNodes.peak",
    "sqlDataPlane.tsNative.query.duration",
    "sqlDataPlane.tsNative.query.firstMetadata",
    "sqlDataPlane.tsNative.query.firstPageProduced",
    "sqlDataPlane.tsNative.query.firstPageAccepted",
    "sqlDataPlane.tsNative.query.encode",
    "sqlDataPlane.tsNative.query.sinkWait",
    "sqlDataPlane.tsNative.query.pause.backpressure",
    "sqlDataPlane.tsNative.query.pause.cpuYield",
    "sqlDataPlane.tsNative.query.maxSynchronousSlice",
] as const;

export interface MetricSamples {
    name: string;
    unit: string;
    official: boolean;
    summary: SampleSummary;
    /** Distinct tags.timePlane values observed on the samples (honesty note). */
    timePlanes: string[];
}

export interface HeadToHeadSide {
    scenarioId: string;
    runId: string;
    createdAtUnixNs: string;
    environmentHash: string;
    runStatus: string;
    tag?: string;
    metrics: MetricSamples[];
}

export interface OfficialComparison {
    metric: string;
    unit: string;
    baseline?: SampleSummary;
    candidate?: SampleSummary;
    /** candidate median − baseline median (present when both sides have data). */
    deltaAbs?: number;
    deltaPct?: number;
}

export interface PhaseComparison {
    phase: string;
    baselineMetric: string;
    candidateMetric: string;
    unit: string;
    baseline?: SampleSummary;
    baselineTimePlanes?: string[];
    candidate?: SampleSummary;
    candidateTimePlanes?: string[];
    deltaAbs?: number;
    deltaPct?: number;
}

export interface HeadToHeadReport {
    baseline: HeadToHeadSide;
    candidate: HeadToHeadSide;
    /** Official metrics compared by NAME (e.g. scenario.wallclock on both). */
    official: OfficialComparison[];
    /** Marker-semantics phases mapped across metric families. */
    phases: PhaseComparison[];
    /** Shared resources plus provider-specific stage diagnostics (non-gating). */
    diagnostics: OfficialComparison[];
    /** Honesty notes: env mismatches, missing metrics, plane caveats. */
    notes: string[];
}

function inferPhaseMappings(
    baseline: ReadonlyMap<string, MetricSamples>,
    candidate: ReadonlyMap<string, MetricSamples>,
): PhaseMapping[] {
    const families = [
        ...AUTO_PHASE_FAMILIES,
        ...(baseline.has("mssql.queryStudio.grid.copy") ||
        candidate.has("mssql.queryStudio.grid.copy")
            ? [GRID_COPY_PHASE]
            : []),
    ];
    return families.map((family) => ({
        phase: family.phase,
        baselineMetric:
            family.baselineCandidates.find((name) => baseline.has(name)) ??
            family.baselineCandidates[0]!,
        candidateMetric:
            family.candidateCandidates.find((name) => candidate.has(name)) ??
            family.candidateCandidates[0]!,
    }));
}

interface MetricRow {
    name: string;
    unit: string;
    official: number;
    value: number;
    tags_json: string | null;
}

/**
 * Most recent measurement run in which the scenario produced official samples
 * from passed, non-warmup reps — "the last time this scenario officially
 * passed", independent of other scenarios in the same run.
 */
function latestOfficialPassingRun(
    store: PerfStore,
    scenarioId: string,
):
    | {
          runId: string;
          createdAtUnixNs: string;
          environmentHash: string;
          status: string;
          tag: string | null;
      }
    | undefined {
    const rows = store.query<{
        run_id: string;
        created_at_unix_ns: string;
        environment_hash: string;
        status: string;
        notes: string | null;
    }>(
        `SELECT r.run_id, r.created_at_unix_ns, r.environment_hash, r.status, r.notes
     FROM runs r
     WHERE r.pass_type = 'measurement'
       AND EXISTS (
         SELECT 1 FROM metrics m
         JOIN repetitions rep
           ON rep.run_id = m.run_id AND rep.scenario_id = m.scenario_id
          AND rep.rep_id = m.rep_id AND rep.attempt_id = m.attempt_id
         WHERE m.run_id = r.run_id AND m.scenario_id = ? AND m.official = 1
           AND rep.status = 'passed' AND rep.warmup = 0)
     ORDER BY r.created_at_unix_ns DESC LIMIT 1`,
        [scenarioId],
    );
    const row = rows[0];
    return row
        ? {
              runId: row.run_id,
              createdAtUnixNs: row.created_at_unix_ns,
              environmentHash: row.environment_hash,
              status: row.status,
              tag: row.notes,
          }
        : undefined;
}

/** All metric samples (official AND diagnostic) for one scenario in one run. */
function scenarioMetricSamples(
    store: PerfStore,
    runId: string,
    scenarioId: string,
): MetricSamples[] {
    const rows = store.query<MetricRow>(
        `SELECT m.name, m.unit, m.official, m.value, m.tags_json
     FROM metrics m
     JOIN repetitions rep
       ON rep.run_id = m.run_id AND rep.scenario_id = m.scenario_id
      AND rep.rep_id = m.rep_id AND rep.attempt_id = m.attempt_id
     WHERE m.run_id = ? AND m.scenario_id = ?
       AND rep.status = 'passed' AND rep.warmup = 0
     ORDER BY m.name`,
        [runId, scenarioId],
    );
    const grouped = new Map<string, { meta: MetricRow; values: number[]; planes: Set<string> }>();
    for (const row of rows) {
        const entry = grouped.get(row.name) ?? { meta: row, values: [], planes: new Set<string>() };
        entry.values.push(row.value);
        if (row.tags_json) {
            try {
                const tags = JSON.parse(row.tags_json) as Record<string, unknown>;
                if (typeof tags["timePlane"] === "string") entry.planes.add(tags["timePlane"]);
            } catch {
                // tags are informational — a malformed blob never breaks the report
            }
        }
        grouped.set(row.name, entry);
    }
    return [...grouped.values()].map(({ meta, values, planes }) => ({
        name: meta.name,
        unit: meta.unit,
        official: meta.official === 1,
        summary: summarize(values),
        timePlanes: [...planes].sort(),
    }));
}

function loadSide(store: PerfStore, scenarioId: string): HeadToHeadSide {
    const run = latestOfficialPassingRun(store, scenarioId);
    if (!run) {
        throw new HeadToHeadError(
            `No measurement run with official passing samples found for scenario '${scenarioId}'. ` +
                `Run it first (e.g. perftest run --config examples/config.phase3.local.jsonc --scenario ${scenarioId}).`,
        );
    }
    return {
        scenarioId,
        runId: run.runId,
        createdAtUnixNs: run.createdAtUnixNs,
        environmentHash: run.environmentHash,
        runStatus: run.status,
        ...(run.tag ? { tag: run.tag } : {}),
        metrics: scenarioMetricSamples(store, run.runId, scenarioId),
    };
}

function delta(
    baseline: SampleSummary | undefined,
    candidate: SampleSummary | undefined,
): { deltaAbs?: number; deltaPct?: number } {
    if (!baseline || !candidate) return {};
    const deltaAbs = candidate.median - baseline.median;
    return {
        deltaAbs,
        ...(baseline.median !== 0 ? { deltaPct: (deltaAbs / baseline.median) * 100 } : {}),
    };
}

export interface HeadToHeadOptions {
    baselineScenario?: string;
    candidateScenario?: string;
    phases?: PhaseMapping[];
}

export function headToHead(
    store: PerfStore,
    logger: HarnessLogger,
    options: HeadToHeadOptions = {},
): HeadToHeadReport {
    const baselineScenario = options.baselineScenario ?? DEFAULT_BASELINE_SCENARIO;
    const candidateScenario = options.candidateScenario ?? DEFAULT_CANDIDATE_SCENARIO;
    const span = logger.span("headToHead", { baselineScenario, candidateScenario });

    const baseline = loadSide(store, baselineScenario);
    const candidate = loadSide(store, candidateScenario);
    const notes: string[] = [
        "Head-to-head is an investigation view, not a regression gate: the sides are different code paths compared across separately-selected runs.",
    ];

    if (baseline.environmentHash !== candidate.environmentHash) {
        notes.push(
            `Environment hashes differ (${baseline.environmentHash.slice(0, 18)}… vs ${candidate.environmentHash.slice(0, 18)}…) — medians are not strictly comparable (config or machine state changed between the runs).`,
        );
    }
    if (baseline.runId === candidate.runId) {
        notes.push("Both scenarios come from the same run — same session, same machine state.");
    }

    // Official metrics compared by NAME (scenario.wallclock is the usual match).
    const baselineOfficial = new Map(
        baseline.metrics.filter((m) => m.official).map((m) => [m.name, m]),
    );
    const candidateOfficial = new Map(
        candidate.metrics.filter((m) => m.official).map((m) => [m.name, m]),
    );
    const official: OfficialComparison[] = [];
    for (const name of new Set([...baselineOfficial.keys(), ...candidateOfficial.keys()])) {
        const b = baselineOfficial.get(name);
        const c = candidateOfficial.get(name);
        official.push({
            metric: name,
            unit: (b ?? c)!.unit,
            ...(b ? { baseline: b.summary } : {}),
            ...(c ? { candidate: c.summary } : {}),
            ...delta(b?.summary, c?.summary),
        });
        if (!b) notes.push(`Official metric '${name}' exists only on ${candidateScenario}.`);
        if (!c) notes.push(`Official metric '${name}' exists only on ${baselineScenario}.`);
    }
    official.sort((a, b) => a.metric.localeCompare(b.metric));

    // Marker-semantics phases across differently-named metric families.
    const baselineAll = new Map(baseline.metrics.map((m) => [m.name, m]));
    const candidateAll = new Map(candidate.metrics.map((m) => [m.name, m]));
    const phases: PhaseComparison[] = [];
    for (const mapping of options.phases ??
        phaseMapForScenarios(baselineScenario, candidateScenario) ??
        inferPhaseMappings(baselineAll, candidateAll)) {
        const b = baselineAll.get(mapping.baselineMetric);
        const c = candidateAll.get(mapping.candidateMetric);
        if (!b && !c) {
            notes.push(
                `Phase '${mapping.phase}' skipped: neither ${mapping.baselineMetric} nor ${mapping.candidateMetric} was recorded.`,
            );
            continue;
        }
        if (!b) {
            notes.push(
                `Phase '${mapping.phase}': ${mapping.baselineMetric} missing on the baseline run.`,
            );
        }
        if (!c) {
            notes.push(
                `Phase '${mapping.phase}': ${mapping.candidateMetric} missing on the candidate run.`,
            );
        }
        const planes = new Set([...(b?.timePlanes ?? []), ...(c?.timePlanes ?? [])]);
        if (planes.size > 1) {
            notes.push(
                `Phase '${mapping.phase}' mixes timing planes (${[...planes].sort().join(", ")}): epoch-plane values include cross-process clock alignment.`,
            );
        }
        phases.push({
            phase: mapping.phase,
            baselineMetric: mapping.baselineMetric,
            candidateMetric: mapping.candidateMetric,
            unit: (b ?? c)!.unit,
            ...(b ? { baseline: b.summary, baselineTimePlanes: b.timePlanes } : {}),
            ...(c ? { candidate: c.summary, candidateTimePlanes: c.timePlanes } : {}),
            ...delta(b?.summary, c?.summary),
        });
    }

    const diagnostics: OfficialComparison[] = [];
    for (const name of COMPARABLE_DIAGNOSTIC_METRICS) {
        const b = baselineAll.get(name);
        const c = candidateAll.get(name);
        if (!b && !c) continue;
        diagnostics.push({
            metric: name,
            unit: (b ?? c)!.unit,
            ...(b ? { baseline: b.summary } : {}),
            ...(c ? { candidate: c.summary } : {}),
            ...delta(b?.summary, c?.summary),
        });
    }

    const report: HeadToHeadReport = { baseline, candidate, official, phases, diagnostics, notes };
    span.end({
        baselineRun: baseline.runId,
        candidateRun: candidate.runId,
        officialCount: official.length,
        phaseCount: phases.length,
        diagnosticCount: diagnostics.length,
    });
    return report;
}

// ---------------------------------------------------------------------------
// Console renderer
// ---------------------------------------------------------------------------

function fmtMs(value: number | undefined, unit: string): string {
    return value === undefined ? "—" : `${value.toFixed(1)} ${unit}`;
}

function fmtDelta(
    deltaAbs: number | undefined,
    deltaPct: number | undefined,
    unit: string,
): string {
    if (deltaAbs === undefined) return "—";
    const sign = deltaAbs >= 0 ? "+" : "";
    const pct = deltaPct !== undefined ? ` (${sign}${deltaPct.toFixed(1)}%)` : "";
    return `${sign}${deltaAbs.toFixed(1)} ${unit}${pct}`;
}

export function renderHeadToHeadConsole(report: HeadToHeadReport): string {
    const lines: string[] = [];
    lines.push(`Baseline:  ${report.baseline.scenarioId}  run ${report.baseline.runId}`);
    lines.push(`Candidate: ${report.candidate.scenarioId}  run ${report.candidate.runId}`);
    lines.push("");
    lines.push(
        "Official metric              Baseline med  Candidate med  Delta (cand−base)     p95 B / p95 C        n",
    );
    lines.push(
        "---------------------------- ------------- -------------- --------------------- -------------------- -----",
    );
    for (const m of report.official) {
        lines.push(
            `${m.metric.padEnd(28)} ${fmtMs(m.baseline?.median, m.unit).padEnd(13)} ${fmtMs(m.candidate?.median, m.unit).padEnd(14)} ${fmtDelta(m.deltaAbs, m.deltaPct, m.unit).padEnd(21)} ${`${fmtMs(m.baseline?.p95, m.unit)} / ${fmtMs(m.candidate?.p95, m.unit)}`.padEnd(20)} ${m.baseline?.samples ?? 0}/${m.candidate?.samples ?? 0}`,
        );
    }
    lines.push("");
    lines.push("Phase (shared marker semantics)");
    lines.push(
        "phase                base metric → cand metric                                        base med     cand med     delta",
    );
    lines.push(
        "-------------------- ---------------------------------------------------------------- ------------ ------------ ---------------------",
    );
    for (const p of report.phases) {
        lines.push(
            `${p.phase.padEnd(20)} ${`${p.baselineMetric} → ${p.candidateMetric}`.padEnd(64)} ${fmtMs(p.baseline?.median, p.unit).padEnd(12)} ${fmtMs(p.candidate?.median, p.unit).padEnd(12)} ${fmtDelta(p.deltaAbs, p.deltaPct, p.unit)}`,
        );
    }
    if (report.diagnostics.length > 0) {
        lines.push("");
        lines.push("Resource / provider diagnostics (non-gating)");
        lines.push("metric                                       base med     cand med     delta");
        lines.push(
            "-------------------------------------------- ------------ ------------ ---------------------",
        );
        for (const metric of report.diagnostics) {
            lines.push(
                `${metric.metric.padEnd(44)} ${fmtMs(metric.baseline?.median, metric.unit).padEnd(12)} ${fmtMs(metric.candidate?.median, metric.unit).padEnd(12)} ${fmtDelta(metric.deltaAbs, metric.deltaPct, metric.unit)}`,
            );
        }
    }
    if (report.notes.length > 0) {
        lines.push("");
        lines.push("Notes:");
        for (const note of report.notes) {
            lines.push(`  - ${note}`);
        }
    }
    return lines.join("\n");
}
