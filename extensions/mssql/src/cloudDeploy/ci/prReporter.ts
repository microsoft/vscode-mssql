/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — pull-request result reporter.
 *
 * Pure, side-effect-free formatting of a `RunRecord` (and an optional
 * candidate-vs-baseline `RunComparison`) into the two things a pull-request
 * check surfaces: a check-run `conclusion` (the pass/fail gate) and a sticky
 * Markdown comment body (the human-readable detail). No I/O, no network — the
 * workflow takes this output and posts it through the GitHub API, which keeps
 * this module trivially unit-testable.
 *
 * The comment is "sticky": it leads with `PR_COMMENT_MARKER` so the workflow
 * can find and update the same comment on each push instead of posting a new
 * one every time.
 */

import { ValidationType } from "../environments/types";
import { RunComparison, ValidationDelta } from "../runs/runComparison";
import {
    Finding,
    RunRecord,
    RunStatus,
    ValidationResult,
    ValidationStatus,
    WorkloadObservedChange,
} from "../runs/types";

// =============================================================================
// Types
// =============================================================================

/** A check-run conclusion: a successful gate, a blocking failure, or neutral. */
export type CheckConclusion = "success" | "failure" | "neutral";

/** The formatted report the workflow posts to the pull request. */
export interface PrReport {
    /** Drives the check-run gate (and mirrors the CLI exit code). */
    readonly conclusion: CheckConclusion;
    /** Short check-run title, e.g. "All gates passed". */
    readonly title: string;
    /** One-line summary used as the check-run summary. */
    readonly summary: string;
    /** Sticky Markdown comment body, marker-prefixed for in-place updates. */
    readonly commentBody: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Leading marker the workflow matches to update the existing comment in place. */
export const PR_COMMENT_MARKER = "<!-- cloud-deploy-validate -->";

/** Severity rank for a single validation status; higher = worse. */
const VALIDATION_SEVERITY: Readonly<Record<ValidationStatus, number>> = {
    [ValidationStatus.Skipped]: 0,
    [ValidationStatus.Passed]: 1,
    [ValidationStatus.Cancelled]: 2,
    [ValidationStatus.Warning]: 3,
    [ValidationStatus.Failed]: 4,
    [ValidationStatus.Errored]: 5,
};

/** Human labels for a status column. */
const STATUS_LABEL: Readonly<Record<ValidationStatus, string>> = {
    [ValidationStatus.Passed]: "Pass",
    [ValidationStatus.Skipped]: "Skip",
    [ValidationStatus.Cancelled]: "Cancelled",
    [ValidationStatus.Warning]: "Warn",
    [ValidationStatus.Failed]: "Fail",
    [ValidationStatus.Errored]: "Error",
};

/** Status glyphs, matching the usual CI-comment convention. */
const STATUS_ICON: Readonly<Record<ValidationStatus, string>> = {
    [ValidationStatus.Passed]: "\u2705",
    [ValidationStatus.Skipped]: "\u23ed\ufe0f",
    [ValidationStatus.Cancelled]: "\u23f9\ufe0f",
    [ValidationStatus.Warning]: "\u26a0\ufe0f",
    [ValidationStatus.Failed]: "\u274c",
    [ValidationStatus.Errored]: "\u274c",
};

/** Latency deltas below this magnitude are treated as noise and not shown. */
const LATENCY_NOISE_FLOOR_MS = 1;

/** Glyphs for an observed-change severity tag: within tolerance / advisory / blocking. */
const CHANGE_SEVERITY_ICON: Readonly<Record<"pass" | "warning" | "fail", string>> = {
    pass: "✅",
    warning: "⚠️",
    fail: "❌",
};

// =============================================================================
// buildPrReport
// =============================================================================

/**
 * Formats a run (optionally diffed against a baseline) into a `PrReport`: a
 * check `conclusion` plus a detailed sticky Markdown comment. The comment leads
 * with an at-a-glance gate table, then — for anything that failed or regressed —
 * spells out exactly what changed (rule ids, failing tests, error messages),
 * with a collapsible full-results section beneath.
 */
export function buildPrReport(record: RunRecord, comparison?: RunComparison): PrReport {
    const conclusion = conclusionForRun(record.status);
    const title = titleForRun(record.status);
    const summary = summaryForRun(record);
    return { conclusion, title, summary, commentBody: renderComment(record, comparison) };
}

/** Assembles the full sticky comment body from the run and optional diff. */
function renderComment(record: RunRecord, comparison?: RunComparison): string {
    const sections: string[] = [
        PR_COMMENT_MARKER,
        `## ${runIcon(record.status)} Cloud Deploy — schema validation`,
        "",
        ...headline(record, comparison),
        "",
        ...gatesSection(record, comparison),
    ];

    const changed = whatChangedSection(record, comparison);
    if (changed.length > 0) {
        sections.push("", ...changed);
    }

    sections.push("", ...fullDetailsSection(record));
    sections.push(
        "",
        "_Download the run artifacts from the workflow run to open them in the Cloud Deploy dashboard._",
    );

    return `${sections.join("\n")}\n`;
}

/** The verdict line plus a one-sentence summary. */
function headline(record: RunRecord, comparison?: RunComparison): string[] {
    const against = comparison !== undefined ? " against `base`" : "";
    const verdict = `**${runStatusLabel(record.status)}** — ${describeSource(record)}${against}.`;
    return [verdict, "", summarySentence(record, comparison)];
}

function summarySentence(record: RunRecord, comparison?: RunComparison): string {
    const total = record.validations.length;
    if (comparison === undefined) {
        const passed = record.validations.filter((v) => isPass(v.status)).length;
        return `${passed} of ${total} gate(s) passed.`;
    }
    const regressions = countRegressions(comparison.validations);
    if (regressions === 0) {
        return `All ${total} gate(s) held — no regressions against \`base\`.`;
    }
    return `**${regressions} of ${total} gate(s) regressed** against \`base\`. See what changed below.`;
}

// =============================================================================
// Conclusion + summary
// =============================================================================

/**
 * Maps a run's aggregate status to a check conclusion. Failed/Errored block
 * the gate; Cancelled is neutral (no verdict); everything else (including
 * Warning) passes, matching the CLI's exit-code policy.
 */
function conclusionForRun(status: RunStatus): CheckConclusion {
    switch (status) {
        case RunStatus.Failed:
        case RunStatus.Errored:
            return "failure";
        case RunStatus.Cancelled:
            return "neutral";
        default:
            return "success";
    }
}

function titleForRun(status: RunStatus): string {
    switch (status) {
        case RunStatus.Failed:
        case RunStatus.Errored:
            return "Schema validation failed";
        case RunStatus.Cancelled:
            return "Schema validation cancelled";
        case RunStatus.Warning:
            return "Schema validation passed with warnings";
        default:
            return "All gates passed";
    }
}

function summaryForRun(record: RunRecord): string {
    const total = record.validations.length;
    const passed = record.validations.filter((v) => v.status === ValidationStatus.Passed).length;
    return `${passed}/${total} gate(s) passed — overall ${runStatusLabel(record.status)}.`;
}

// =============================================================================
// Tables
// =============================================================================

/** The at-a-glance gate table. With a baseline it shows This PR / base / delta. */
function gatesSection(record: RunRecord, comparison?: RunComparison): string[] {
    if (comparison === undefined) {
        const rows = record.validations.map(
            (v) => `| ${v.displayName} | ${statusCell(v.status)} |`,
        );
        return ["### Gates", "", "| Gate | Result |", "|---|---|", ...rows];
    }
    const rows = comparison.validations.map(
        (d) =>
            `| ${d.displayName} | ${optionalStatusCell(d.statusB)} | ${optionalStatusCell(d.statusA)} | ${deltaCell(d)} |`,
    );
    return ["### Gates", "", "| Gate | This PR | base | \u0394 |", "|---|---|---|---|", ...rows];
}

/** `icon Label` for a known status. */
function statusCell(status: ValidationStatus): string {
    return `${STATUS_ICON[status]} ${STATUS_LABEL[status]}`;
}

function optionalStatusCell(status: ValidationStatus | undefined): string {
    return status === undefined ? "\u2014" : statusCell(status);
}

/**
 * For every gate that failed, errored, or warned, a subsection spelling out the
 * concrete findings (rule ids, failing tests, error messages), plus what the
 * gate's status was before the change when a baseline is available.
 */
function whatChangedSection(record: RunRecord, comparison?: RunComparison): string[] {
    const baseStatuses = baseStatusById(comparison);
    const problems = record.validations.filter((v) => !isPass(v.status) && !isSkip(v.status));
    if (problems.length === 0) {
        return [];
    }

    const lines: string[] = ["### What changed"];
    for (const v of problems) {
        const was = baseStatuses.get(v.validationId);
        const wasNote =
            was !== undefined && was !== v.status ? ` _(was ${STATUS_LABEL[was]})_` : "";
        lines.push(
            "",
            `#### ${STATUS_ICON[v.status]} ${v.displayName} — ${STATUS_LABEL[v.status]}${wasNote}`,
        );
        const details = detailLines(v);
        lines.push(...(details.length > 0 ? details : ["- No further detail reported."]));
    }
    return lines;
}

/** Bullet lines for one problem gate: its error message and problem findings. */
function detailLines(v: ValidationResult): string[] {
    const lines: string[] = [];
    if (v.errorMessage !== undefined && v.errorMessage.length > 0) {
        lines.push(`- ${v.errorMessage}`);
    }
    for (const finding of v.payload.findings) {
        if (isProblemFinding(finding)) {
            lines.push(`- ${renderFinding(finding)}`);
        }
    }
    return lines;
}

/** One-line rendering of a finding, formatted for its kind. */
function renderFinding(f: Finding): string {
    switch (f.kind) {
        case "static-analysis": {
            const line = f.location?.line !== undefined ? `:${f.location.line}` : "";
            const loc = f.location !== undefined ? ` \`${f.location.file}${line}\`` : "";
            return `\`${f.ruleId}\` — ${f.message}${loc}`;
        }
        case "unit-tests":
            return `\`${f.testName}\` — ${f.message ?? f.outcome}`;
        case "workload-playback":
            return `\`${f.stepId}\` (${f.regression}) — ${f.message}`;
        case "connectivity":
            return f.message;
    }
}

/** Whether a finding represents a problem (vs a success marker). */
function isProblemFinding(f: Finding): boolean {
    switch (f.kind) {
        case "connectivity":
            return f.outcome !== "reachable";
        case "unit-tests":
            return f.outcome !== "passed";
        case "static-analysis":
        case "workload-playback":
            return true;
    }
}

/** A collapsible section listing every gate and all of its findings. */
function fullDetailsSection(record: RunRecord): string[] {
    const lines: string[] = ["<details>", "<summary>Full results — all gates</summary>", ""];
    for (const v of record.validations) {
        lines.push(`**${STATUS_ICON[v.status]} ${v.displayName} — ${STATUS_LABEL[v.status]}**`, "");
        const bullets = allFindingLines(v);
        lines.push(...(bullets.length > 0 ? bullets : ["- No findings."]), "");
    }
    lines.push("</details>");
    return lines;
}

function allFindingLines(v: ValidationResult): string[] {
    const lines: string[] = [];
    if (v.errorMessage !== undefined && v.errorMessage.length > 0) {
        lines.push(`- ${v.errorMessage}`);
    }
    const changeLines = workloadChangeLines(v);
    if (changeLines !== undefined) {
        lines.push(...changeLines);
        return lines;
    }
    for (const finding of v.payload.findings) {
        lines.push(`- ${renderFinding(finding)}`);
    }
    return lines;
}

/**
 * For a workload gate that recorded observed changes, renders the full "what
 * changed" view — every drifted axis tagged pass/warning/fail — instead of only
 * the threshold-crossing findings. Returns `undefined` for other gates (and for
 * pre-feature workload runs) so the caller falls back to findings.
 */
function workloadChangeLines(v: ValidationResult): string[] | undefined {
    if (v.payload.validationType !== ValidationType.WorkloadPlayback) {
        return undefined;
    }
    const changes = v.payload.changes;
    if (changes === undefined || changes.length === 0) {
        return undefined;
    }
    return changes.map(renderChange);
}

/** One-line rendering of an observed workload change, tagged by its severity. */
function renderChange(c: WorkloadObservedChange): string {
    return `- ${CHANGE_SEVERITY_ICON[c.severity]} \`${c.stepId}\` — ${c.message}`;
}

/** Maps each gate id to its baseline status, for the "(was ...)" annotations. */
function baseStatusById(comparison?: RunComparison): Map<string, ValidationStatus> {
    const map = new Map<string, ValidationStatus>();
    if (comparison !== undefined) {
        for (const d of comparison.validations) {
            if (d.statusA !== undefined) {
                map.set(d.validationId, d.statusA);
            }
        }
    }
    return map;
}

/** Renders the human-readable delta for one validation pair. */
function deltaCell(delta: ValidationDelta): string {
    if (delta.presence === "only-b") {
        return "new gate";
    }
    if (delta.presence === "only-a") {
        return "removed";
    }
    const parts: string[] = [];
    if (delta.findingCountDelta !== 0) {
        parts.push(`${signed(delta.findingCountDelta)} finding(s)`);
    }
    if (
        delta.durationDeltaMs !== undefined &&
        Math.abs(delta.durationDeltaMs) >= LATENCY_NOISE_FLOOR_MS
    ) {
        parts.push(`${signed(delta.durationDeltaMs)} ms`);
    }
    return parts.length === 0 ? "—" : parts.join(", ");
}

// =============================================================================
// Regression detection
// =============================================================================

/**
 * Counts validations that got worse in the candidate relative to the baseline:
 * either the status climbed in severity, or the finding count grew.
 */
function countRegressions(deltas: readonly ValidationDelta[]): number {
    return deltas.filter(isRegression).length;
}

function isRegression(delta: ValidationDelta): boolean {
    if (delta.presence !== "both" || delta.statusA === undefined || delta.statusB === undefined) {
        return false;
    }
    const statusWorsened = VALIDATION_SEVERITY[delta.statusB] > VALIDATION_SEVERITY[delta.statusA];
    return statusWorsened || delta.findingCountDelta > 0;
}

// =============================================================================
// Formatting helpers
// =============================================================================

function describeSource(record: RunRecord): string {
    const ref = record.sourceVersion?.ref;
    const commit = record.sourceVersion?.commitId;
    if (ref !== undefined && commit !== undefined) {
        return `validated \`${ref}\` (\`${shortCommit(commit)}\`)`;
    }
    if (commit !== undefined) {
        return `validated \`${shortCommit(commit)}\``;
    }
    return `validated environment \`${record.environmentSnapshot.name}\``;
}

function shortCommit(commit: string): string {
    return commit.length > 7 ? commit.slice(0, 7) : commit;
}

function runStatusLabel(status: RunStatus): string {
    return STATUS_LABEL[status as unknown as ValidationStatus] ?? status;
}

function runIcon(status: RunStatus): string {
    return STATUS_ICON[status as unknown as ValidationStatus] ?? "";
}

function isPass(status: ValidationStatus): boolean {
    return status === ValidationStatus.Passed;
}

function isSkip(status: ValidationStatus): boolean {
    return status === ValidationStatus.Skipped;
}

function signed(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
}
