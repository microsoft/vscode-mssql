/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `UnitTestsValidator`.
 *
 * Runs the tSQLt test framework against the env's live target and produces
 * a `ValidationResult` whose `payload` is a `UnitTestsPayload`. Reuses the
 * `ConnectionProvider` abstraction — no new provider
 * surface lands here.
 *
 * Behavior summary:
 *   * Source-of-truth gate: only `Container` envs have a live target to
 *     run tSQLt against. `SqlProj` / `Dacpac` envs short-circuit to
 *     `Skipped` with one `info` finding (no spawn / no connection).
 *   * tSQLt-installed probe: `SELECT 1 FROM sys.schemas WHERE name = 'tSQLt'`.
 *     Zero rows → `Skipped` with one `info` finding directing the user to
 *     install tSQLt. We invoke, we don't install.
 *   * Connection failure (`ConnectionError` from connect or any of the
 *     SQL probes) → `Skipped` with one `info` finding carrying the
 *     `ConnectionFailureKind` and message. Rationale: the runner already
 *     gates the run on `ConnectivityValidator`; a connection error here
 *     is a transient retry candidate, not a unit-test failure.
 *   * `EXEC tSQLt.RunAll` followed by
 *     `SELECT Class, TestCase, Result, Msg FROM tSQLt.TestResult` parses
 *     each row into a `UnitTestFinding`. `RunAll` itself raises a Msg 50000
 *     error whenever any test fails; that is expected test output, so it is
 *     captured and the authoritative results are read from `tSQLt.TestResult`
 *     instead. tSQLt's `Result` column values
 *     are `"Success" | "Failure" | "Error"`; we map to
 *     `"passed" | "failed" | "errored"` (skipped is not a tSQLt concept,
 *     so the count stays 0 unless future tooling surfaces it).
 *   * Outcome: `Passed` when zero failed + zero errored; `Failed` when any
 *     failed or errored row is present.
 *   * Cancellation: re-thrown `CancellationError` propagates so the runner
 *     reconciles the reason.
 *   * Validator-itself crash: re-thrown so the runner classifies as
 *     `Errored`.
 */

import { type Environment, ValidationType } from "../../environments/types";
import {
    type UnitTestFinding,
    type UnitTestsPayload,
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
import { ConnectionError } from "../providers/connectionProvider";

const DISPLAY_NAME = "Unit Tests";

/**
 * Probes whether tSQLt is installed in the target DB. Empty result set
 * means "not installed". `sys.schemas` is the canonical detection point —
 * `tSQLt.RunAll` would error with a helpful message anyway, but probing
 * first lets us produce a `Skipped` result instead of a noisy `Failed`.
 */
const TSQLT_PROBE_SQL = "SELECT 1 FROM sys.schemas WHERE name = 'tSQLt'";

/** Runs every test class / case registered with tSQLt. */
const TSQLT_RUN_ALL_SQL = "EXEC tSQLt.RunAll";

/**
 * Pulls the populated result table after `RunAll` returns. `Id` ascending
 * preserves test execution order. `Result` is `'Success' | 'Failure' | 'Error'`.
 * `Msg` is the failure / error message (empty for successes).
 */
const TSQLT_RESULTS_SQL = "SELECT Class, TestCase, Result, Msg FROM tSQLt.TestResult ORDER BY Id";

export class UnitTestsValidator implements Validator<ValidationType.UnitTests> {
    public readonly type = ValidationType.UnitTests;

    public async run(
        _env: Environment,
        _config: SettingsFor<ValidationType.UnitTests>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();

        // Cheap pre-check so a caller-cancelled run exits before any query.
        throwIfCancelled(opts.signal);

        // Unit tests run against the per-run ephemeral
        // database the runner provisioned and seeded, handed in via
        // `opts.ephemeralConnection`. The validator no longer opens or owns a
        // connection — the runner provisions one DB per run and disposes
        // it. When no ephemeral connection is present (e.g. the runtime host
        // could not be provisioned), there is nothing to run against.
        const handle = opts.ephemeralConnection;
        if (handle === undefined) {
            return buildSkippedNoLiveTarget(startedAtMs, Date.now());
        }

        try {
            // tSQLt installed?
            const probeRows = await handle.execute(TSQLT_PROBE_SQL, opts.signal);
            throwIfCancelled(opts.signal);
            if (probeRows.length === 0) {
                return buildSkippedTsqltMissing(startedAtMs, Date.now());
            }

            // Run all tests, then collect results. tSQLt.RunAll deliberately
            // raises an error (Msg 50000) whenever any test fails — that is
            // expected test output, not a connection fault — so capture it and
            // fall through to read the authoritative per-test rows from
            // tSQLt.TestResult. The captured error is only surfaced if no
            // results were recorded (a genuine RunAll failure).
            let runAllError: unknown;
            try {
                await handle.execute(TSQLT_RUN_ALL_SQL, opts.signal);
            } catch (err) {
                if (err instanceof CancellationError) {
                    throw err;
                }
                throwIfCancelled(opts.signal);
                runAllError = err;
            }
            throwIfCancelled(opts.signal);

            const resultRows = await handle.execute(TSQLT_RESULTS_SQL, opts.signal);
            throwIfCancelled(opts.signal);
            if (resultRows.length === 0 && runAllError !== undefined) {
                throw runAllError;
            }

            const findings = parseResultRows(resultRows);
            return buildResultFromFindings(startedAtMs, Date.now(), findings);
        } catch (err) {
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            if (err instanceof ConnectionError) {
                return buildSkippedConnectionFailure(startedAtMs, Date.now(), err);
            }
            // Any other error: re-throw so the runner classifies as Errored.
            throw err;
        }
        // No `finally` disposal: the runner owns the ephemeral database's
        // lifecycle and disposes it once after every validator has run.
    }
}

// =============================================================================
// Row parsing
// =============================================================================

/**
 * Maps a single `tSQLt.TestResult` row to a `UnitTestFinding`. Defensive
 * against unexpected scalar shapes: any non-string value is stringified;
 * an unrecognized `Result` value is treated as `"errored"` so a typo or a
 * future tSQLt status surfaces visibly rather than being silently dropped.
 */
function parseResultRows(rows: unknown[][]): UnitTestFinding[] {
    const findings: UnitTestFinding[] = [];
    for (const row of rows) {
        const className = stringOrEmpty(row[0]);
        const testCase = stringOrEmpty(row[1]);
        const result = stringOrEmpty(row[2]);
        const msg = stringOrEmpty(row[3]);

        const testName =
            className && testCase
                ? `${className}.${testCase}`
                : testCase || className || "(unknown)";
        const outcome = mapTsqltResult(result);
        const finding: UnitTestFinding = {
            kind: "unit-tests",
            testName,
            outcome,
            ...(outcome === "passed" || msg.length === 0 ? {} : { message: msg }),
        };
        findings.push(finding);
    }
    return findings;
}

function mapTsqltResult(raw: string): UnitTestFinding["outcome"] {
    switch (raw) {
        case "Success":
            return "passed";
        case "Failure":
            return "failed";
        case "Error":
            return "errored";
        default:
            // Unknown status — treat as errored so it surfaces visibly.
            return "errored";
    }
}

function stringOrEmpty(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    return typeof value === "string" ? value : String(value);
}

// =============================================================================
// Result builders
// =============================================================================

function buildResultFromFindings(
    startedAtMs: number,
    endedAtMs: number,
    findings: UnitTestFinding[],
): ValidationResult {
    let passed = 0;
    let failed = 0;
    let errored = 0;
    for (const f of findings) {
        if (f.outcome === "passed") {
            passed++;
        } else if (f.outcome === "failed") {
            failed++;
        } else if (f.outcome === "errored") {
            errored++;
        }
    }
    const total = findings.length;
    const status =
        failed === 0 && errored === 0 ? ValidationStatus.Passed : ValidationStatus.Failed;
    const payload: UnitTestsPayload = {
        validationType: ValidationType.UnitTests,
        findings,
        summary: { total, passed, failed, skipped: 0, errored },
    };
    return {
        validationId: ValidationType.UnitTests,
        displayName: DISPLAY_NAME,
        status,
        startedAtMs,
        endedAtMs,
        payload,
    };
}

function buildSkippedNoLiveTarget(startedAtMs: number, endedAtMs: number): ValidationResult {
    const finding: UnitTestFinding = {
        kind: "unit-tests",
        testName: "(skipped)",
        outcome: "skipped",
        message:
            "No validation database was available to run unit tests against. Enable a runtime host (Docker) so the schema can be provisioned for this run.",
    };
    const payload: UnitTestsPayload = {
        validationType: ValidationType.UnitTests,
        findings: [finding],
        summary: { total: 0, passed: 0, failed: 0, skipped: 1, errored: 0 },
    };
    return {
        validationId: ValidationType.UnitTests,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Skipped,
        startedAtMs,
        endedAtMs,
        payload,
    };
}

function buildSkippedTsqltMissing(startedAtMs: number, endedAtMs: number): ValidationResult {
    const finding: UnitTestFinding = {
        kind: "unit-tests",
        testName: "(skipped)",
        outcome: "skipped",
        message:
            "tSQLt is not installed on the target database. Install tSQLt (https://tsqlt.org/) and rerun to execute unit tests.",
    };
    const payload: UnitTestsPayload = {
        validationType: ValidationType.UnitTests,
        findings: [finding],
        summary: { total: 0, passed: 0, failed: 0, skipped: 1, errored: 0 },
    };
    return {
        validationId: ValidationType.UnitTests,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Skipped,
        startedAtMs,
        endedAtMs,
        payload,
    };
}

function buildSkippedConnectionFailure(
    startedAtMs: number,
    endedAtMs: number,
    err: ConnectionError,
): ValidationResult {
    const finding: UnitTestFinding = {
        kind: "unit-tests",
        testName: "(skipped)",
        outcome: "skipped",
        message: `Could not connect to the target database (${err.kind}): ${err.message}`,
    };
    const payload: UnitTestsPayload = {
        validationType: ValidationType.UnitTests,
        findings: [finding],
        summary: { total: 0, passed: 0, failed: 0, skipped: 1, errored: 0 },
    };
    return {
        validationId: ValidationType.UnitTests,
        displayName: DISPLAY_NAME,
        status: ValidationStatus.Skipped,
        startedAtMs,
        endedAtMs,
        payload,
    };
}
