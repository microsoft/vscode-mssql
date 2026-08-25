/**
 * Head-to-head HTML report (B7.7): self-contained page in the shared report
 * design system (benchmark.html tokens via htmlShell). Renders the official
 * medians/p95/rep counts, signed delta bars, and the marker-semantics phase
 * breakdown produced by regression/headToHead.ts. Explicitly labeled
 * non-gating — same honesty stance as the investigation report.
 */

import type { HeadToHeadReport } from "../regression/headToHead";
import { horizontalBars } from "./charts";
import { chartCard, dataTable, esc, kpiRow, pageShell, pill, section, type Kpi } from "./htmlShell";

function fmt(value: number | undefined, unit: string): string {
    return value === undefined ? "—" : `${value.toFixed(1)}&thinsp;${esc(unit)}`;
}

function fmtDelta(
    deltaAbs: number | undefined,
    deltaPct: number | undefined,
    unit: string,
): string {
    if (deltaAbs === undefined) return "—";
    const sign = deltaAbs >= 0 ? "+" : "";
    const pct = deltaPct !== undefined ? ` (${sign}${deltaPct.toFixed(1)}%)` : "";
    return `${sign}${deltaAbs.toFixed(1)}&thinsp;${esc(unit)}${esc(pct)}`;
}

/** Candidate slower (positive delta) reads as warn, faster as ok. */
function deltaPill(
    deltaAbs: number | undefined,
    deltaPct: number | undefined,
    unit: string,
): string {
    if (deltaAbs === undefined) return pill("no delta", "info");
    return pill(
        `${deltaAbs >= 0 ? "+" : ""}${deltaAbs.toFixed(1)} ${unit}${deltaPct !== undefined ? ` / ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%` : ""}`,
        deltaAbs > 0 ? "warn" : "ok",
    );
}

function runCard(side: HeadToHeadReport["baseline"], label: string): string {
    const created = Number(BigInt(side.createdAtUnixNs) / 1_000_000n);
    return (
        `<div class="panel"><h3>${esc(label)}</h3>` +
        `<div style="font-weight:650;font-size:14px;">${esc(side.scenarioId)}</div>` +
        `<div class="mono muted" style="margin-top:4px;">run ${esc(side.runId)}</div>` +
        `<div class="muted" style="margin-top:2px;">${esc(new Date(created).toISOString())}` +
        `${side.tag ? ` · tag ${esc(side.tag)}` : ""} · run status ${esc(side.runStatus)}</div>` +
        `<div class="mono muted" style="margin-top:2px;">env ${esc(side.environmentHash.slice(0, 26))}…</div>` +
        `</div>`
    );
}

export function renderHeadToHeadHtml(report: HeadToHeadReport): string {
    const wallclock = report.official.find((m) => m.metric === "scenario.wallclock");
    const kpis: Kpi[] = [
        {
            label: `${report.baseline.scenarioId} median`,
            value: wallclock?.baseline ? wallclock.baseline.median.toFixed(1) : "—",
            unit: wallclock?.unit ?? "ms",
        },
        {
            label: `${report.candidate.scenarioId} median`,
            value: wallclock?.candidate ? wallclock.candidate.median.toFixed(1) : "—",
            unit: wallclock?.unit ?? "ms",
        },
        {
            label: "delta (cand − base)",
            value:
                wallclock?.deltaAbs !== undefined
                    ? `${wallclock.deltaAbs >= 0 ? "+" : ""}${wallclock.deltaAbs.toFixed(1)}`
                    : "—",
            unit: wallclock?.unit ?? "ms",
            kind:
                wallclock?.deltaAbs !== undefined
                    ? wallclock.deltaAbs > 0
                        ? "warn"
                        : "ok"
                    : "plain",
        },
        {
            label: "reps (base / cand)",
            value: `${wallclock?.baseline?.samples ?? 0} / ${wallclock?.candidate?.samples ?? 0}`,
        },
    ];

    const officialTable = dataTable(
        [
            { label: "Official metric" },
            { label: "Baseline median", numeric: true },
            { label: "Baseline p95", numeric: true },
            { label: "Candidate median", numeric: true },
            { label: "Candidate p95", numeric: true },
            { label: "Delta (cand − base)", numeric: true },
            { label: "Reps B / C", numeric: true },
        ],
        report.official.map((m) => [
            `<span class="mono">${esc(m.metric)}</span>`,
            fmt(m.baseline?.median, m.unit),
            fmt(m.baseline?.p95, m.unit),
            fmt(m.candidate?.median, m.unit),
            fmt(m.candidate?.p95, m.unit),
            fmtDelta(m.deltaAbs, m.deltaPct, m.unit),
            `${m.baseline?.samples ?? 0} / ${m.candidate?.samples ?? 0}`,
        ]),
    );

    const deltaEntries = [
        ...report.official
            .filter((m) => m.deltaAbs !== undefined)
            .map((m) => ({
                label: m.metric,
                value: m.deltaAbs!,
                detail: `${m.baseline!.median.toFixed(1)} → ${m.candidate!.median.toFixed(1)} ${m.unit}`,
            })),
        ...report.phases
            .filter((p) => p.deltaAbs !== undefined)
            .map((p) => ({
                label: p.phase,
                value: p.deltaAbs!,
                detail: `${p.baseline!.median.toFixed(1)} → ${p.candidate!.median.toFixed(1)} ${p.unit}`,
            })),
    ];
    const deltaChart =
        deltaEntries.length > 0
            ? chartCard(
                  "Median deltas (candidate − baseline; right = candidate slower)",
                  horizontalBars(deltaEntries, {
                      title: "median delta",
                      unit: report.official[0]?.unit ?? "ms",
                      signed: true,
                  }),
                  "Signed medians over passed non-warmup reps of each side's selected run.",
              )
            : `<div class="muted">No comparable metric pairs — nothing to chart.</div>`;

    const phaseTable = dataTable(
        [
            { label: "Phase" },
            { label: "Baseline metric" },
            { label: "Candidate metric" },
            { label: "Baseline median", numeric: true },
            { label: "Candidate median", numeric: true },
            { label: "Delta", numeric: true },
            { label: "Time plane(s)" },
        ],
        report.phases.map((p) => [
            esc(p.phase),
            `<span class="mono">${esc(p.baselineMetric)}</span>`,
            `<span class="mono">${esc(p.candidateMetric)}</span>`,
            fmt(p.baseline?.median, p.unit),
            fmt(p.candidate?.median, p.unit),
            deltaPill(p.deltaAbs, p.deltaPct, p.unit),
            esc(
                [
                    ...new Set([...(p.baselineTimePlanes ?? []), ...(p.candidateTimePlanes ?? [])]),
                ].join(", ") || "—",
            ),
        ]),
    );

    const diagnosticTable = dataTable(
        [
            { label: "Resource / provider metric" },
            { label: "Baseline median", numeric: true },
            { label: "Baseline p95", numeric: true },
            { label: "Candidate median", numeric: true },
            { label: "Candidate p95", numeric: true },
            { label: "Delta", numeric: true },
            { label: "Reps B / C", numeric: true },
        ],
        report.diagnostics.map((metric) => [
            `<span class="mono">${esc(metric.metric)}</span>`,
            fmt(metric.baseline?.median, metric.unit),
            fmt(metric.baseline?.p95, metric.unit),
            fmt(metric.candidate?.median, metric.unit),
            fmt(metric.candidate?.p95, metric.unit),
            deltaPill(metric.deltaAbs, metric.deltaPct, metric.unit),
            `${metric.baseline?.samples ?? 0} / ${metric.candidate?.samples ?? 0}`,
        ]),
    );

    const notesHtml =
        `<ul style="margin:0;padding-left:18px;">` +
        report.notes.map((note) => `<li>${esc(note)}</li>`).join("") +
        `</ul>`;

    const body = [
        kpiRow(kpis),
        `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-bottom:10px;">` +
            runCard(report.baseline, "Baseline") +
            runCard(report.candidate, "Candidate") +
            `</div>`,
        section("Official metrics", "medians / p95 / rep counts per side", officialTable, {
            pills: [pill("non-gating", "info")],
        }),
        section("Deltas", "candidate − baseline medians", deltaChart),
        section(
            "Phase breakdown",
            "marker pairs with shared semantics across the two code paths",
            phaseTable,
        ),
        section(
            "Resource & provider diagnostics",
            "non-gating totals and provider-stage attribution",
            diagnosticTable,
            { pills: [pill("diagnostic", "info")] },
        ),
        section("Notes", "honesty first", notesHtml),
    ].join('\n<div class="spacer"></div>\n');

    return pageShell({
        title: `Head-to-head: ${report.baseline.scenarioId} vs ${report.candidate.scenarioId}`,
        subtitle: `${report.baseline.runId} vs ${report.candidate.runId}`,
        statusPill: { label: "investigation · non-gating", kind: "info" },
        body,
    });
}
