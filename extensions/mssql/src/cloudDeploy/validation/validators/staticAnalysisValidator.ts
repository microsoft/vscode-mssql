/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `StaticAnalysisValidator`.
 *
 * Runs build-time DacFx static analysis on a `.sqlproj` by shelling out to
 * `dotnet build` (with `/p:RunSqlCodeAnalysis=true`) via the injected
 * `ProcessProvider`, parses the MSBuild diagnostics it prints, and produces a
 * `ValidationResult` whose `payload` is a `StaticAnalysisPayload`.
 *
 * Why build-time analysis: DacFx model validation (the `SQL715xx` family of
 * unresolved-reference diagnostics) and the `SR`-prefixed code-analysis rules
 * are produced by the SQL build itself — there is no standalone "analyze this
 * model" CLI in this toolchain. The build is the analyzer, which makes the
 * `.sqlproj` the only source of truth we can actually analyze.
 *
 * Source-of-truth requirements:
 *   * `SqlProj` envs run the real analysis: `dotnet build <project>
 *     /p:RunSqlCodeAnalysis=true`. Diagnostics are parsed from MSBuild output.
 *   * `Dacpac` envs are `Skipped`. A `.dacpac` is a compiled artifact — DacFx
 *     analysis already ran when the project was built into it, so there is no
 *     build left to run here. (A `sqlpackage` deploy-report is a deployment
 *     diff, not static analysis, so it is intentionally not used.)
 *   * `Container` envs have no project file — analysis is `Skipped` with a
 *     single `info` finding directing the user to attach a sqlproj.
 *
 * Outcome mapping:
 *   * Build emits zero DacFx diagnostics and exits 0 → `Passed`, zero
 *     findings.
 *   * Build emits one or more DacFx diagnostics (warning or error) → `Failed`.
 *     Static analysis is a gate: a clean build is required to pass. Per-rule
 *     `failOn` tuning (relaxing warnings to non-blocking) is future work.
 *   * Build exits non-zero with no parseable DacFx diagnostics → `Failed`
 *     with a single synthesized `error` finding carrying a build-output
 *     excerpt.
 *   * `CancellationError` (or `signal.aborted` observed at a checkpoint, or
 *     `ProcessResult.aborted === true`) → re-thrown as `CancellationError`
 *     so the runner reconciles `"user"` vs `"timeout"`.
 *   * `Error` from `processProvider.spawn()` itself (binary not found, OS
 *     refused to spawn) → re-thrown so the runner maps it to `Errored`.
 *
 * Diagnostic parsing is line-based. MSBuild prints lines of the form
 * `path\file.sql(9,10,9,10): warning SQL71502: ... [project.sqlproj]`; we
 * extract `(file, line, severity, ruleId, message)` per match, keeping only
 * `SQL`/`SR`-prefixed rule ids so generic MSBuild noise (`MSBnnnn`,
 * `NETSDKnnnn`) never counts as a static-analysis finding. MSBuild repeats
 * each diagnostic (inline, then in its summary), so matches are deduped by
 * rule id + cleaned message.
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

/** Build driver. Defaults to the bare `dotnet` name (resolved off PATH); the
 * service layer may inject an absolute path. Unit tests inject a
 * `FakeProcessProvider` and ignore path resolution. */
const DEFAULT_DOTNET_COMMAND = "dotnet";

/**
 * MSBuild diagnostic line shape. Captures an optional source location (`file`,
 * `line`, `column`), the severity (`warning` / `error`), the rule id
 * (`SQL71502`, `SR0001`), and the trailing message. The same DacFx diagnostic
 * is emitted under several MSBuild subcategories (`Build`, `StaticCodeAnalysis`,
 * a raw `{guid}`, or none); `(?:[^:]*?\s+)?` tolerates any of them so model
 * validation *and* code-analysis (SR) findings are both captured. The
 * `(?:,\d+,\d+)?` tolerates the four-number `(line,col,line,col)` span MSBuild
 * emits for T-SQL diagnostics.
 */
const MSBUILD_DIAGNOSTIC_LINE =
    /^(?:(.+?)\((\d+),(\d+)(?:,\d+,\d+)?\)\s*:\s*)?(?:[^:]*?\s+)?(warning|error)\s+((?:SQL|SR)\d+)\s*:\s*(.+)$/i;

/** Strips the trailing ` [C:\...\Project.sqlproj]` annotation MSBuild appends
 * to every diagnostic line, without touching `[schema].[object]` tokens that
 * legitimately appear inside a message. */
const MSBUILD_PROJECT_ANNOTATION = /\s*\[[^\]]*\.sqlproj\]\s*$/i;

/** When the build fails but emits no parseable DacFx diagnostics, surface this
 * many leading bytes of output in the synthesized finding so the user has
 * something to act on. */
const OUTPUT_EXCERPT_BYTES = 1024;

const SKIPPED_NEEDS_PROJECT_MESSAGE =
    "Static analysis requires a .sqlproj source of truth (build-time DacFx analysis).";

/**
 * Shown for `Dacpac` source-of-truth envs. A `.dacpac` is a compiled artifact:
 * DacFx static analysis already ran when the project was built into it, so
 * there is no build to re-run here. The check is an honest `Skipped` rather
 * than a fabricated pass.
 */
const SKIPPED_DACPAC_PREBUILT_MESSAGE =
    "Static analysis runs at build time. A .dacpac is a pre-built artifact, so analysis already ran when it was produced; point the environment at a .sqlproj to analyze the source.";

const RULE_ID_SOURCE_UNSUPPORTED = "SOURCE_OF_TRUTH_UNSUPPORTED";
const RULE_ID_DACPAC_PREBUILT = "DACPAC_PREBUILT";

const BUILD_FAILURE_RULE_ID = "BUILD_FAILED";

// =============================================================================
// Validator
// =============================================================================

/**
 * Static-analysis validator. Constructor takes a `ProcessProvider` and
 * optional overrides: `dotnetCommand` (an absolute path to `dotnet`) and
 * `systemDacpacsLocation` (the sql-database-projects `BuildDirectory`, needed
 * only by projects with system-database references).
 */
export class StaticAnalysisValidator implements Validator<ValidationType.StaticAnalysis> {
    public readonly type = ValidationType.StaticAnalysis;

    public constructor(
        private readonly _processes: ProcessProvider,
        private readonly _opts: {
            readonly dotnetCommand?: string;
            readonly systemDacpacsLocation?: string;
        } = {},
    ) {}

    public async run(
        env: Environment,
        _config: SettingsFor<ValidationType.StaticAnalysis>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();
        throwIfCancelled(opts.signal);

        const sot = env.sourceOfTruth;
        // A `.dacpac` is already built — DacFx static analysis ran at build
        // time, so there is nothing to analyze here. Honest Skip, not a pass.
        if (sot.kind === SourceOfTruthKind.Dacpac) {
            return buildSkippedResult(
                startedAtMs,
                RULE_ID_DACPAC_PREBUILT,
                SKIPPED_DACPAC_PREBUILT_MESSAGE,
            );
        }
        if (sot.kind !== SourceOfTruthKind.SqlProj) {
            return buildSkippedResult(
                startedAtMs,
                RULE_ID_SOURCE_UNSUPPORTED,
                SKIPPED_NEEDS_PROJECT_MESSAGE,
            );
        }
        const projectPath = sot.path;

        const command = this._opts.dotnetCommand ?? DEFAULT_DOTNET_COMMAND;
        const args = buildDotnetArgs(projectPath, this._opts.systemDacpacsLocation);

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

        // Static analysis is a gate: any DacFx diagnostic fails the check.
        if (findings.length > 0) {
            return buildFailedResult(findings, startedAtMs);
        }

        // No diagnostics: a clean build passes. A non-zero exit with no
        // parseable diagnostics is a build break we surface as a single
        // synthesized error so the UI has something concrete.
        if (result.exitCode === 0) {
            return buildPassedResult(findings, startedAtMs);
        }
        return buildFailedResult([synthesizeFailureFinding(result)], startedAtMs);
    }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Builds the `dotnet build` args for a static-analysis run of `projectPath`.
 * `/p:RunSqlCodeAnalysis=true` turns on the `SR`-prefixed code-analysis rules
 * on top of the always-on model-validation diagnostics. `systemDacpacsLocation`,
 * when provided, points the build at the sql-database-projects `BuildDirectory`
 * so projects with system-database references resolve. Paths are passed as
 * discrete argv entries (no shell), so they are not quoted here.
 */
function buildDotnetArgs(
    projectPath: string,
    systemDacpacsLocation: string | undefined,
): readonly string[] {
    const args: string[] = [
        "build",
        projectPath,
        "/nologo",
        "/p:NetCoreBuild=true",
        "/p:RunSqlCodeAnalysis=true",
    ];
    if (systemDacpacsLocation !== undefined && systemDacpacsLocation.length > 0) {
        args.push(`/p:SystemDacpacsLocation=${systemDacpacsLocation}`);
    }
    return args;
}

/**
 * Walks stdout + stderr for MSBuild DacFx diagnostic lines and emits one
 * `StaticAnalysisFinding` per distinct `(ruleId, message)`. MSBuild repeats
 * each diagnostic (inline during the build, then in the trailing summary), so
 * matches are deduped by rule id + cleaned message. Only `SQL`/`SR` rule ids
 * are kept; generic MSBuild codes are ignored.
 */
function parseDiagnostics(stdout: string, stderr: string): readonly StaticAnalysisFinding[] {
    const seen = new Set<string>();
    const findings: StaticAnalysisFinding[] = [];
    for (const stream of [stdout, stderr]) {
        for (const rawLine of stream.split(/\r?\n/)) {
            const match = MSBUILD_DIAGNOSTIC_LINE.exec(rawLine);
            if (match === null) {
                continue;
            }
            const [, file, line, column, severityWord, ruleId, rawMessage] = match;
            const message = rawMessage.replace(MSBUILD_PROJECT_ANNOTATION, "").trim();
            const dedupeKey = `${ruleId}\u0000${message}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            const finding: StaticAnalysisFinding = {
                kind: "static-analysis",
                ruleId,
                severity: severityWord.toLowerCase() === "error" ? "error" : "warning",
                message,
                ...(file !== undefined
                    ? { location: { file, line: Number(line), column: Number(column) } }
                    : {}),
            };
            findings.push(finding);
        }
    }
    return findings;
}

function synthesizeFailureFinding(result: ProcessResult): StaticAnalysisFinding {
    const excerpt = (result.stderr || result.stdout).slice(0, OUTPUT_EXCERPT_BYTES).trim();
    const message =
        excerpt.length > 0
            ? `dotnet build exited with code ${result.exitCode}: ${excerpt}`
            : `dotnet build exited with code ${result.exitCode} (no diagnostics in output).`;
    return {
        kind: "static-analysis",
        ruleId: BUILD_FAILURE_RULE_ID,
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

function buildSkippedResult(
    startedAtMs: number,
    ruleId: string,
    message: string,
): ValidationResult {
    const finding: StaticAnalysisFinding = {
        kind: "static-analysis",
        ruleId,
        severity: "info",
        message,
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
