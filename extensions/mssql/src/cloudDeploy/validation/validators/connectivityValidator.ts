/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `ConnectivityValidator`.
 *
 * The first real validator. Opens a connection via the injected
 * `ConnectionProvider`, runs a `SELECT @@VERSION` probe, closes the
 * connection, and produces a `ValidationResult` whose `payload` is a
 * `ConnectivityPayload`.
 *
 * Behavior summary:
 *   * Success → status `Passed`. Payload carries one `info` finding
 *     (`outcome: "reachable"`) plus the server-version string in
 *     `summary.serverVersion`.
 *   * `ConnectionError` from connect/execute → status `Failed`. Payload
 *     carries one `error` finding whose `outcome` mirrors the error's
 *     `kind`.
 *   * `CancellationError` (or `signal.aborted` observed at a checkpoint) →
 *     re-thrown so the runner reconciles the reason against the signal
 *     and produces a `Cancelled` result.
 *   * Any other thrown error → re-thrown so the runner maps it to
 *     `Errored` (not `Failed`). The runner draws the line: connection
 *     transport failures are `Failed`; the validator itself crashing is
 *     `Errored`.
 *
 * Connectivity gates the rest of the run (`Runner` short-circuits the
 * remaining validations to `Skipped` whenever this validator's result is
 * not `Passed`). That rule lives in the runner; the validator's only job
 * is to produce an accurate result.
 */

import { type Environment, ValidationType } from "../../environments/types";
import {
    type ConnectivityFinding,
    type ConnectivityPayload,
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
import {
    ConnectionError,
    type ConnectionHandle,
    type ConnectionProvider,
} from "../providers/connectionProvider";

/**
 * The probe query. `@@VERSION` is preferred over `SELECT 1` because the
 * server-version string is itself a useful artifact (rendered by the UI as
 * "connected to SQL Server 2022 (16.0.x)") and the latency cost is small
 * (~50ms vs ~10ms — see deliverable2.md TBD-10).
 */
const PROBE_SQL = "SELECT @@VERSION";

/**
 * Shape returned by the probe. SQL Server returns a single row, single
 * column with the version banner. Defensive against odd shapes:
 * non-string scalars are stringified; missing rows produce `undefined`
 * which the validator treats as a `Passed` result with no version.
 */
function extractServerVersion(rows: unknown[][]): string | undefined {
    const first = rows[0]?.[0];
    if (first === undefined || first === null) {
        return undefined;
    }
    return typeof first === "string" ? first : String(first);
}

export class ConnectivityValidator implements Validator<ValidationType.Connectivity> {
    public readonly type = ValidationType.Connectivity;

    public constructor(private readonly _connections: ConnectionProvider) {}

    public async run(
        env: Environment,
        _config: SettingsFor<ValidationType.Connectivity>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        const startedAtMs = Date.now();

        // Cheap pre-check so a caller-cancelled run never opens a socket.
        throwIfCancelled(opts.signal);

        let handle: ConnectionHandle | undefined;
        try {
            handle = await this._connections.connect(env, opts.signal);
            throwIfCancelled(opts.signal);

            const rows = await handle.execute(PROBE_SQL, opts.signal);
            throwIfCancelled(opts.signal);

            const serverVersion = extractServerVersion(rows);
            return buildPassedResult(startedAtMs, Date.now(), serverVersion);
        } catch (err) {
            // Cancellation propagates to the runner unchanged so the runner
            // can stamp the right reason from the (possibly timeout-derived)
            // signal. Aborted signal during connect/execute also yields a
            // ConnectionError("timeout") which we translate to cancellation
            // when the signal is the cause.
            if (err instanceof CancellationError) {
                throw err;
            }
            if (opts.signal.aborted) {
                throw new CancellationError("user");
            }
            if (err instanceof ConnectionError) {
                return buildFailedResult(startedAtMs, Date.now(), err);
            }
            // Any other error: re-throw so the runner classifies as Errored.
            throw err;
        } finally {
            if (handle) {
                try {
                    await handle.dispose();
                } catch {
                    // Disposal failures are not surfaced — the validator's
                    // job is the probe result, not connection-pool hygiene.
                }
            }
        }
    }
}

// =============================================================================
// Result builders
// =============================================================================

function buildPassedResult(
    startedAtMs: number,
    endedAtMs: number,
    serverVersion: string | undefined,
): ValidationResult {
    const finding: ConnectivityFinding = {
        kind: "connectivity",
        outcome: "reachable",
        severity: "info",
        message: serverVersion ? `Connected. Server version: ${serverVersion}` : "Connected.",
    };
    const payload: ConnectivityPayload = {
        validationType: ValidationType.Connectivity,
        findings: [finding],
        summary:
            serverVersion !== undefined ? { reachable: true, serverVersion } : { reachable: true },
    };
    return {
        validationId: ValidationType.Connectivity,
        displayName: "Connectivity",
        status: ValidationStatus.Passed,
        startedAtMs,
        endedAtMs,
        payload,
    };
}

function buildFailedResult(
    startedAtMs: number,
    endedAtMs: number,
    err: ConnectionError,
): ValidationResult {
    const finding: ConnectivityFinding = {
        kind: "connectivity",
        outcome: err.kind,
        severity: "error",
        message: err.message,
    };
    const payload: ConnectivityPayload = {
        validationType: ValidationType.Connectivity,
        findings: [finding],
        summary: { reachable: false },
    };
    return {
        validationId: ValidationType.Connectivity,
        displayName: "Connectivity",
        status: ValidationStatus.Failed,
        startedAtMs,
        endedAtMs,
        payload,
    };
}
