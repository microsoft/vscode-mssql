/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal Markdown run report (design §27, grows in M6'). Renders run
 * metadata, the environment fingerprint, per-scenario rep tables, and
 * artifact links relative to the run directory.
 */

import type { PerfResult } from "@mssqlperf/contracts";

export interface RunReportInputs {
    runId: string;
    passType: string;
    createdAt: string;
    environmentHash: string;
    machineId?: string;
    vscodeVersion?: string;
    results: PerfResult[];
    harnessLogPath: string;
}

export function renderMarkdownReport(inputs: RunReportInputs): string {
    const lines: string[] = [];
    lines.push(`# perftest run report`);
    lines.push("");
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| Run | \`${inputs.runId}\` |`);
    lines.push(`| Pass | ${inputs.passType} |`);
    lines.push(`| Created | ${inputs.createdAt} |`);
    lines.push(`| Machine | ${inputs.machineId ?? "unknown"} |`);
    lines.push(`| VS Code | ${inputs.vscodeVersion ?? "unknown"} |`);
    lines.push(`| Environment hash | \`${inputs.environmentHash}\` |`);
    lines.push("");

    const byScenario = new Map<string, PerfResult[]>();
    for (const result of inputs.results) {
        const list = byScenario.get(result.scenarioId) ?? [];
        list.push(result);
        byScenario.set(result.scenarioId, list);
    }

    for (const [scenarioId, results] of byScenario) {
        lines.push(`## ${scenarioId}`);
        lines.push("");
        lines.push(`| Rep | Status | scenario.wallclock (ms) | Official | Result |`);
        lines.push(`|---:|---|---:|---|---|`);
        for (const result of results.sort((a, b) => a.repId - b.repId)) {
            const wallclock = result.metrics.find((m) => m.name === "scenario.wallclock");
            const value = wallclock ? wallclock.value.toFixed(1) : "—";
            const official = wallclock ? (wallclock.official ? "yes" : "no") : "—";
            const resultPath = `scenarios/${scenarioId}/reps/rep-${String(result.repId).padStart(2, "0")}/result.json`;
            lines.push(
                `| ${result.repId} | ${result.status} | ${value} | ${official} | [result.json](${resultPath}) |`,
            );
        }
        lines.push("");
        const valid = results.filter((r) => r.status === "passed");
        const values = valid
            .map((r) => r.metrics.find((m) => m.name === "scenario.wallclock")?.value)
            .filter((v): v is number => v !== undefined)
            .sort((a, b) => a - b);
        if (values.length > 0) {
            const median =
                values.length % 2 === 1
                    ? values[(values.length - 1) / 2]!
                    : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2;
            lines.push(
                `Passed reps: ${valid.length}/${results.length} · median wallclock **${median.toFixed(1)} ms** · min ${values[0]!.toFixed(1)} ms · max ${values[values.length - 1]!.toFixed(1)} ms`,
            );
            lines.push("");
        }

        const validationIssues = results.flatMap((r) =>
            r.validations
                .filter((v) => v.status === "failed" || v.status === "warning")
                .map(
                    (v) =>
                        `rep ${r.repId}: [${v.status}] ${v.name}${v.message ? ` — ${v.message}` : ""}`,
                ),
        );
        if (validationIssues.length > 0) {
            lines.push(`### Validation notes`);
            lines.push("");
            for (const issue of validationIssues) {
                lines.push(`- ${issue}`);
            }
            lines.push("");
        }
    }

    lines.push(`## Artifacts`);
    lines.push("");
    lines.push(`- Harness telemetry: [harness-log.jsonl](${inputs.harnessLogPath})`);
    for (const result of inputs.results) {
        const repDir = `scenarios/${result.scenarioId}/reps/rep-${String(result.repId).padStart(2, "0")}`;
        for (const artifact of result.artifacts) {
            lines.push(
                `- ${result.scenarioId} rep ${result.repId}: [${artifact.kind}](${repDir}/${artifact.path})`,
            );
        }
    }
    lines.push("");
    return lines.join("\n");
}
