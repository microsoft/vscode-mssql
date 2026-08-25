/**
 * Static HTML run report (design §27.2). Self-contained single file — no
 * external assets — so a run folder can be zipped/copied and the report
 * still renders. Content mirrors report.md plus the comparison section.
 */

import type { PerfResult } from "@mssqlperf/contracts";
import type { RunComparison } from "../regression/regression";

export interface HtmlReportInputs {
    runId: string;
    passType: string;
    createdAt: string;
    environmentHash: string;
    machineId?: string;
    vscodeVersion?: string;
    results: PerfResult[];
    comparison?: RunComparison;
}

function esc(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const VERDICT_COLORS: Record<string, string> = {
    regressed: "#c62828",
    improved: "#2e7d32",
    unchanged: "#555",
    inconclusive: "#b26a00",
    passed: "#2e7d32",
    failed: "#c62828",
    invalid: "#b26a00",
    aborted: "#555",
};

export function renderHtmlReport(inputs: HtmlReportInputs): string {
    const byScenario = new Map<string, PerfResult[]>();
    for (const result of inputs.results) {
        const list = byScenario.get(result.scenarioId) ?? [];
        list.push(result);
        byScenario.set(result.scenarioId, list);
    }

    const scenarioSections = [...byScenario.entries()]
        .map(([scenarioId, results]) => {
            const rows = results
                .sort((a, b) => a.repId - b.repId)
                .map((r) => {
                    const wallclock = r.metrics.find((m) => m.name === "scenario.wallclock");
                    const others = r.metrics
                        .filter((m) => m.name !== "scenario.wallclock" && m.unit === "ms")
                        .map((m) => `${esc(m.name)}: ${m.value.toFixed(1)}ms`)
                        .join("<br>");
                    const repDir = `scenarios/${scenarioId}/reps/rep-${String(r.repId).padStart(2, "0")}`;
                    return `<tr>
            <td>${r.repId}</td>
            <td style="color:${VERDICT_COLORS[r.status] ?? "#000"}">${r.status}</td>
            <td class="num">${wallclock ? wallclock.value.toFixed(1) : "—"}</td>
            <td>${wallclock ? (wallclock.official ? "yes" : "no") : "—"}</td>
            <td class="small">${others || "—"}</td>
            <td class="small"><a href="${repDir}/result.json">result</a> · <a href="${repDir}/markers.jsonl">markers</a></td>
          </tr>`;
                })
                .join("\n");
            return `<h2>${esc(scenarioId)}</h2>
<table>
  <thead><tr><th>Rep</th><th>Status</th><th>wallclock (ms)</th><th>Official</th><th>Component metrics</th><th>Artifacts</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
        })
        .join("\n");

    const comparisonSection = inputs.comparison
        ? `<h2>Baseline comparison</h2>
<p>Baseline run <code>${esc(inputs.comparison.baselineRunId)}</code> — status
<strong style="color:${VERDICT_COLORS[inputs.comparison.status] ?? "#000"}">${inputs.comparison.status.toUpperCase()}</strong></p>
<table>
  <thead><tr><th>Scenario</th><th>Metric</th><th>Current</th><th>Baseline</th><th>Δ%</th><th>p</th><th>Verdict</th><th>Why</th></tr></thead>
  <tbody>
  ${inputs.comparison.metrics
      .map(
          (m) => `<tr>
    <td>${esc(m.key.scenarioId)}</td>
    <td>${esc(m.key.name)}</td>
    <td class="num">${m.current ? m.current.aggregate.toFixed(1) + " " + esc(m.key.unit) : "—"}</td>
    <td class="num">${m.baseline ? m.baseline.aggregate.toFixed(1) + " " + esc(m.key.unit) : "—"}</td>
    <td class="num">${m.deltaPct !== undefined ? (m.deltaPct >= 0 ? "+" : "") + m.deltaPct.toFixed(1) + "%" : "—"}</td>
    <td class="num">${m.pValue !== undefined ? m.pValue.toFixed(4) : "—"}</td>
    <td style="color:${VERDICT_COLORS[m.verdict] ?? "#000"}"><strong>${m.verdict}</strong></td>
    <td class="small">${esc(m.reason)}</td>
  </tr>`,
      )
      .join("\n")}
  </tbody>
</table>`
        : "";

    const validationNotes = inputs.results
        .flatMap((r) =>
            r.validations
                .filter((v) => v.status === "failed" || v.status === "warning")
                .map(
                    (v) =>
                        `<li><code>${esc(r.scenarioId)}</code> rep ${r.repId}: [${v.status}] ${esc(v.name)}${v.message ? " — " + esc(v.message) : ""}</li>`,
                ),
        )
        .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>perftest ${esc(inputs.runId)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 14px; }
  th { background: #f4f4f4; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .small { font-size: 12px; color: #555; }
  code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 2rem; }
  .meta td:first-child { font-weight: 600; width: 180px; }
</style>
</head>
<body>
<h1>perftest run report</h1>
<table class="meta">
  <tr><td>Run</td><td><code>${esc(inputs.runId)}</code></td></tr>
  <tr><td>Pass</td><td>${esc(inputs.passType)}</td></tr>
  <tr><td>Created</td><td>${esc(inputs.createdAt)}</td></tr>
  <tr><td>Machine</td><td>${esc(inputs.machineId ?? "unknown")}</td></tr>
  <tr><td>VS Code</td><td>${esc(inputs.vscodeVersion ?? "unknown")}</td></tr>
  <tr><td>Environment hash</td><td><code>${esc(inputs.environmentHash)}</code></td></tr>
</table>
${comparisonSection}
${scenarioSections}
${validationNotes ? `<h2>Validation notes</h2><ul>${validationNotes}</ul>` : ""}
<h2>Artifacts</h2>
<p><a href="harness-log.jsonl">harness-log.jsonl</a> · <a href="summary.json">summary.json</a> · <a href="environment.json">environment.json</a> · <a href="run-config.snapshot.jsonc">config snapshot</a></p>
</body>
</html>`;
}
