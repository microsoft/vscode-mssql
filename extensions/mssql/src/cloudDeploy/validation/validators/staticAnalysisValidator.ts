/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `StaticAnalysisValidator`.
 *
 * Shells out to `sqlpackage /Action:DeployReport` via the injected
 * `ProcessProvider`, parses the diagnostics it prints to stderr, and
 * produces a `ValidationResult` whose `payload` is a `StaticAnalysisPayload`.
 *
 * Source-of-truth requirements:
 *   * `SqlProj` and `Dacpac` envs run analysis against `sourceOfTruth.path`.
 *   * `Container` envs have no project file — analysis is `Skipped` with a
 *     single `info` finding directing the user to attach a sqlproj/dacpac.
 *
 * Outcome mapping:
 *   * sqlpackage exits 0 with no warnings/errors → `Passed`, zero findings.
 *   * sqlpackage exits 0 with warnings only → `Passed` (no `failOn`
 *     promotion in this PR; `failOn: "warning"` is TBD-7, deferred).
 *     Warning findings still appear in the payload so the UI can render them.
 *   * sqlpackage exits non-zero → `Failed`. Findings are populated from
 *     parsed diagnostics; if no diagnostics could be parsed, a single
 *     synthesized `error` finding carries a stderr excerpt.
 *   * `CancellationError` (or `signal.aborted` observed at a checkpoint, or
 *     `ProcessResult.aborted === true`) → re-thrown as `CancellationError`
 *     so the runner reconciles `"user"` vs `"timeout"`.
 *   * `Error` from `processProvider.spawn()` itself (binary not found, OS
 *     refused to spawn) → re-thrown so the runner maps it to `Errored`.
 *
 * Diagnostic parsing is line-based. sqlpackage prints lines of the form
 * `Warning SQL71558: ...` and `Error SQL70001: ...` to stderr; we extract
 * `(severity, ruleId, message)` per match. Anything we can't parse is
 * preserved in the payload only when sqlpackage failed (so the UI surfaces
 * the raw output instead of an empty Failed result). Successful runs with
 * un-parseable stderr lines produce zero findings.
 */

import { type Environment, SourceOfTruthKind, ValidationType } from "../../environments/types";
import {
    type StaticAnalysisFinding,
    type StaticAnalysisPayload,
    type ValidationResult,
    ValidationStatus,
} from "../../runs/types";
import {
    CancellationError,
    type SettingsFor,
    throwIfCancelled,
    type Validator,
    type ValidatorRunOptions,
} from "../types";
import { type ProcessProvider, type ProcessResult } from "../providers/processProvider";

// =============================================================================
// Defaults & constants
// =============================================================================

/** Command name. The service layer is responsible for resolving an absolute
 * path before commit 6 wires up production. Defaulting to the bare name lets
 * unit tests (which inject `FakeProcessProvider`) ignore path resolution. */
const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";

/** sqlpackage's diagnostic line shape. Captures severity ("Warning" or
 * "Error"), the rule id ("SQL71558"), and the trailing message. */
const DIAGNOSTIC_LINE = /^\s*(Warning|Error)\s+([A-Z]+\d+):\s*(.+?)\s*$/;

/** When sqlpackage fails but emits no parseable diagnostics, surface this
 * many leading bytes of stderr in the synthesized finding so the user has
 * something to act on. */
const STDERR_EXCERPT_BYTES = 1024;

const SKIPPED_NEEDS_PROJECT_MESSAGE =
    "Static analysis requires a sqlproj or dacpac source of truth.";

const PARSE_FAILURE_RULE_ID = "SQLPACKAGE_FAILED";

// =============================================================================
// Validator
// =============================================================================

/**
 * Static-analysis validator. Constructor takes a `ProcessProvider` and an
 * optional command override (lets tests pass `"sqlpackage-test"` and lets
 * the service layer supply an absolute path).
 */
export class StaticAnalysisValidator implements Validator<ValidationType.StaticAnalysis> {
    public readonly type = ValidationType.StaticAnalysis;

    public constructor(
        private readonly _processes: ProcessProvider,
        private readonly _opts: { readonly sqlpackageCommand?: string } = {},
    ) {}

    public async run(
        env: Environment,
        _config: SettingsFor<ValidationType.StaticAnalysis>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        throwIfCancelled(opts.signal);

        const projectPath = projectPathFor(env);
        if (projectPath === undefined) {
            return buildSkippedResult(startedAtMs);
        }

        const command = this._opts.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;
        const args = buildSqlpackageArgs(projectPath);

        let result: ProcessResult;
        try {
            result = await this._processes.spawn(command, args, { signal: opts.signal });
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            // Spawn-time failures (binary not found, OS error) bubble up to
            // the runner, which classifies them as Errored.
            throw err;
        }

        throwIfCancelled(opts.signal);

        if (result.aborted) {
            // Subprocess was killed by our abort handler; treat as cancellation.
            throw new CancellationError("user");
        }

        const findings = parseDiagnostics(result.stdout, result.stderr);
        const succeeded = result.exitCode === 0;

        if (succeeded) {
            return buildPassedResult(findings, startedAtMs);
        }

        // sqlpackage exited non-zero. If we parsed real diagnostics, use
        // them; otherwise synthesize a single error from the stderr excerpt
        // so the UI has something concrete.
        const failureFindings: readonly StaticAnalysisFinding[] =
            findings.length > 0 ? findings : [synthesizeFailureFinding(result)];
        return buildFailedResult(failureFindings, startedAtMs);
    }
}

// =============================================================================
// Helpers
// =============================================================================

function projectPathFor(env: Environment): string | undefined {
    const sot = env.sourceOfTruth;
    if (sot.kind === SourceOfTruthKind.SqlProj || sot.kind === SourceOfTruthKind.Dacpac) {
        return sot.path;
    }
    return undefined;
}

/**
 * Builds the sqlpackage CLI args for a deploy-report run against `path`.
 * Kept narrow: no profile, no target, no variables. Future settings (e.g.
 * `StaticAnalysisSettings.ruleSet`) extend this once they land.
 */
function buildSqlpackageArgs(path: string): readonly string[] {
    return ["/Action:DeployReport", `/SourceFile:${path}`];
}

/**
 * Walks stdout + stderr for `Warning SQLnnnnn: ...` / `Error SQLnnnnn: ...`
 * lines and emits one `StaticAnalysisFinding` per match. sqlpackage prints
 * to both streams depending on subcommand; we scan both and dedupe by the
 * literal line. Order is preserved (stdout first, then stderr).
 */
function parseDiagnostics(stdout: string, stderr: string): readonly StaticAnalysisFinding[] {
    const seen = new Set<string>();
    const findings: StaticAnalysisFinding[] = [];
    for (const stream of [stdout, stderr]) {
        for (const rawLine of stream.split(/\r?\n/)) {
            if (seen.has(rawLine)) {
                continue;
            }
            const match = DIAGNOSTIC_LINE.exec(rawLine);
            if (match === null) {
                continue;
            }
            seen.add(rawLine);
            const [, severityWord, ruleId, message] = match;
            findings.push({
                kind: "static-analysis",
                ruleId,
                severity: severityWord === "Error" ? "error" : "warning",
                message,
            });
        }
    }
    return findings;
}

function synthesizeFailureFinding(result: ProcessResult): StaticAnalysisFinding {
    const excerpt = (result.stderr || result.stdout).slice(0, STDERR_EXCERPT_BYTES).trim();
    const message =
        excerpt.length > 0
            ? `sqlpackage exited with code ${result.exitCode}: ${excerpt}`
            : `sqlpackage exited with code ${result.exitCode} (no diagnostics on stderr).`;
    return {
        kind: "static-analysis",
        ruleId: PARSE_FAILURE_RULE_ID,
        severity: "error",
        message,
    };
}

// =============================================================================
// Result builders
// =============================================================================

function summarize(findings: readonly StaticAnalysisFinding[]): StaticAnalysisPayload["summary"] {
    let info = 0;
    let warning = 0;
    let error = 0;
    for (const f of findings) {
        if (f.severity === "info") {
            info += 1;
        } else if (f.severity === "warning") {
            warning += 1;
        } else {
            error += 1;
        }
    }
    return { info, warning, error };
}

function buildPassedResult(
    findings: readonly StaticAnalysisFinding[],
    startedAtMs: number,
): ValidationResult {
    const payload: StaticAnalysisPayload = {
        validationType: ValidationType.StaticAnalysis,
        findings,
        summary: summarize(findings),
    };
    return {
        validationId: ValidationType.StaticAnalysis,
        displayName: "Static Analysis",
        status: ValidationStatus.Passed,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

function buildFailedResult(
    findings: readonly StaticAnalysisFinding[],
    startedAtMs: number,
): ValidationResult {
    const payload: StaticAnalysisPayload = {
        validationType: ValidationType.StaticAnalysis,
        findings,
        summary: summarize(findings),
    };
    return {
        validationId: ValidationType.StaticAnalysis,
        displayName: "Static Analysis",
        status: ValidationStatus.Failed,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}

function buildSkippedResult(startedAtMs: number): ValidationResult {
    const finding: StaticAnalysisFinding = {
        kind: "static-analysis",
        ruleId: "SOURCE_OF_TRUTH_UNSUPPORTED",
        severity: "info",
        message: SKIPPED_NEEDS_PROJECT_MESSAGE,
    };
    const payload: StaticAnalysisPayload = {
        validationType: ValidationType.StaticAnalysis,
        findings: [finding],
        summary: summarize([finding]),
    };
    return {
        validationId: ValidationType.StaticAnalysis,
        displayName: "Static Analysis",
        status: ValidationStatus.Skipped,
        startedAtMs,
        endedAtMs: Date.now(),
        payload,
    };
}
