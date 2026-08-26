/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Investigation report (Phase-3 12.3): the A/B diff as a self-contained HTML
 * page — official gate first (the only gating signal), then the non-gating
 * what-changed sections with the SQL-activity delta as the headline.
 */

import type { RunComparison } from "../regression/regression";
import type { Investigation } from "../regression/investigate";
import { horizontalBars } from "./charts";
import {
    chartCard,
    dataTable,
    esc,
    kpiRow,
    pageShell,
    pill,
    section,
    type PillKind,
} from "./htmlShell";

export function renderInvestigationHtml(
    comparison: RunComparison | undefined,
    investigation: Investigation,
): string {
    const sections: string[] = [];
    const gateStatus = comparison?.status ?? "no gate (environment mismatch or missing runs)";
    const gateKind: PillKind =
        comparison?.status === "regressed"
            ? "fail"
            : comparison?.status === "improved" || comparison?.status === "passed"
              ? "ok"
              : "warn";

    sections.push(
        kpiRow([
            { label: "Gate verdict", value: gateStatus.toUpperCase(), kind: gateKind },
            { label: "Baseline", value: investigation.baselineRunId.slice(0, 23) },
            { label: "Candidate", value: investigation.candidateRunId.slice(0, 23) },
            {
                label: "Code delta",
                value:
                    investigation.git.candidate
                        .filter((r) => r.repo !== "perftest")
                        .map((r) => `${r.repo}@${r.sha.slice(0, 8)}${r.dirty ? "+" : ""}`)
                        .join(" ") || "unknown",
            },
        ]),
    );

    // --- Official gate (the ONLY gating signal) --------------------------------
    if (comparison) {
        sections.push(
            section(
                "Official gate",
                "verdicts from official metrics only — everything below is investigation context",
                dataTable(
                    [
                        { label: "Scenario" },
                        { label: "Metric" },
                        { label: "Current", numeric: true },
                        { label: "Baseline", numeric: true },
                        { label: "Δ", numeric: true },
                        { label: "p", numeric: true },
                        { label: "Verdict" },
                        { label: "Why" },
                    ],
                    comparison.metrics.map((m) => [
                        esc(m.key.scenarioId),
                        `<span class="mono">${esc(m.key.name)}</span>`,
                        m.current ? `${m.current.aggregate.toFixed(1)} ${esc(m.key.unit)}` : "—",
                        m.baseline ? `${m.baseline.aggregate.toFixed(1)} ${esc(m.key.unit)}` : "—",
                        m.deltaPct !== undefined
                            ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct.toFixed(1)}%`
                            : "—",
                        m.pValue !== undefined ? m.pValue.toFixed(4) : "—",
                        pill(
                            m.verdict,
                            m.verdict === "regressed"
                                ? "fail"
                                : m.verdict === "improved"
                                  ? "ok"
                                  : m.verdict === "inconclusive"
                                    ? "warn"
                                    : "info",
                        ),
                        `<span class="muted">${esc(m.reason)}</span>`,
                    ]),
                ),
                { pills: [pill(comparison.status.toUpperCase(), gateKind)] },
            ),
        );
    }

    // --- SQL activity delta (headline investigation) ---------------------------
    for (const activity of investigation.sqlActivity) {
        const parts: string[] = [];
        if (activity.note) {
            parts.push(`<p class="muted">${esc(activity.note)}</p>`);
        }
        const rows: string[][] = [];
        for (const added of activity.added) {
            rows.push([
                pill("ADDED", "fail"),
                `<span class="mono">${esc(added.key)}</span>`,
                `+${added.count}`,
                `+${added.durationMs.toFixed(1)}`,
                `+${added.logicalReads}`,
            ]);
        }
        for (const removed of activity.removed) {
            rows.push([
                pill("REMOVED", "ok"),
                `<span class="mono">${esc(removed.key)}</span>`,
                `−${removed.count}`,
                `−${removed.durationMs.toFixed(1)}`,
                `−${removed.logicalReads}`,
            ]);
        }
        for (const change of activity.changed) {
            rows.push([
                pill("CHANGED", "warn"),
                `<span class="mono">${esc(change.key)}</span>`,
                change.countDelta !== 0
                    ? `${change.countDelta > 0 ? "+" : ""}${change.countDelta} round-trip(s)`
                    : "=",
                `${change.durationDeltaMs > 0 ? "+" : ""}${change.durationDeltaMs.toFixed(1)}`,
                `${change.readsDelta > 0 ? "+" : ""}${change.readsDelta}`,
            ]);
        }
        parts.push(
            rows.length > 0
                ? dataTable(
                      [
                          { label: "" },
                          { label: "Command" },
                          { label: "Count Δ", numeric: true },
                          { label: "Duration Δ (ms)", numeric: true },
                          { label: "Reads Δ", numeric: true },
                      ],
                      rows,
                  )
                : `<p class="muted">no command-level differences</p>`,
        );
        sections.push(
            section(
                `SQL activity — ${activity.scenarioId}`,
                `${activity.baselineCommands} → ${activity.candidateCommands} commands (non-gating)`,
                parts.join(""),
                {
                    pills: [
                        pill(
                            `${activity.added.length} added · ${activity.removed.length} removed · ${activity.changed.length} changed`,
                            activity.added.length + activity.changed.length > 0 ? "warn" : "ok",
                        ),
                    ],
                },
            ),
        );
    }

    // --- Cross-signal metric deltas --------------------------------------------
    const interesting = investigation.metricDeltas.filter(
        (d) => Math.abs(d.deltaPct ?? 0) >= 5 && Math.abs(d.deltaAbs) >= 1,
    );
    if (interesting.length > 0) {
        const bars = horizontalBars(
            interesting.slice(0, 20).map((d) => ({
                label: `${d.official ? "◆" : "◇"} ${d.scenarioId}/${d.name}`,
                value: Number((d.deltaPct ?? 0).toFixed(1)),
                detail: `${d.baseline} → ${d.candidate} ${d.unit}`,
            })),
            { title: "metric deltas", unit: "Δ%", signed: true },
        );
        sections.push(
            section(
                "Metric deltas",
                "official (◆) and diagnostic (◇), |Δ| ≥ 5% and ≥ 1 unit — non-gating",
                chartCard(
                    "Delta by metric",
                    bars,
                    "Red = worse (direction-aware), green = better.",
                ),
                {},
            ),
        );
    }
    if (investigation.notes.length > 0) {
        sections.push(
            section(
                "Notes",
                "",
                `<ul>${investigation.notes.map((n) => `<li class="muted">${esc(n)}</li>`).join("")}</ul>`,
            ),
        );
    }

    return pageShell({
        title: "perftest investigation",
        subtitle: `${investigation.baselineRunId} → ${investigation.candidateRunId}`,
        statusPill: { label: gateStatus.toUpperCase(), kind: gateKind },
        body: sections.join("\n"),
    });
}
