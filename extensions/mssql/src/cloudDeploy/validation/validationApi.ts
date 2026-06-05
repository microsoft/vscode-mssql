/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — validation service surface.
 *
 * `CloudDeployValidationApi` is the single seam between the rest of the
 * extension (commands, MCP tools, future webviews) and the validation
 * pipeline. The service constructs `Runner` once over the supplied
 * registry + bus and exposes a single `run(envId, opts)` method that:
 *
 *   1. Looks the env up by id. Returns a synthesized `Errored` `RunRecord`
 *      when the env is missing rather than throwing — callers route the
 *      record into the same UI flow as a normal failure, no special-case
 *      branching at the call site.
 *   2. Dispatches the run via the runner. Cancellation, timeouts, and bus
 *      events are the runner's job; this layer only hands the env in.
 *   3. Optionally persists the produced `RunRecord` via D3's
 *      `RunArtifactWriter`. Persistence failures are surfaced via the
 *      `runArtifactPath?` field on the result; the run's own status is
 *      not downgraded — a successful validation that fails to persist is
 *      still a successful validation.
 *
 * The service does NOT register any commands, build any UI, or subscribe
 * to the bus on its own. Those concerns live one layer up
 * (`CloudDeployService` wires this against the host bus + registry, and
 * `mainController` registers the command). Keeping the service free of
 * `vscode.*` calls makes it unit-testable without an extension host.
 */

import * as path from "path";

import type { DiagnosticEvent, DiagnosticEventBus } from "../diagnostics";
import type { EnvironmentStore } from "../environments/environmentStore";
import { Environment, SourceOfTruthKind, ValidationType } from "../environments/types";
import type { RunArtifactWriter } from "../runs";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunStatus,
    RunRecord,
    RunnerIdentity,
    ValidationStatus,
} from "../runs/types";

import { Runner, RunnerRunOptions } from "./runner";
import type { ValidatorRegistry } from "./types";

// =============================================================================
// Public API
// =============================================================================

/**
 * Result of `CloudDeployValidationApi.run()`. The `record` is always
 * present (even on env-not-found, a synthesized `Errored` record is
 * returned). `runArtifactPath` is set when persistence was requested and
 * succeeded; absent when persistence wasn't requested or failed.
 *
 * `persistError` carries the I/O error message when persistence was
 * requested but failed. The `record.status` is NOT downgraded in that
 * case — a green run that failed to persist is still a green run.
 */
export interface CloudDeployValidationRunResult {
    readonly record: RunRecord;
    readonly runArtifactPath?: string;
    readonly persistError?: string;
}

/** Options accepted by `CloudDeployValidationApi.run()`. */
export interface CloudDeployValidationRunOptions {
    /** Caller-supplied cancellation. Passed through to the runner. */
    readonly signal?: AbortSignal;
    /** Hard cap on the run in milliseconds. Passed through to the runner. */
    readonly timeoutMs?: number;
    /**
     * When `true`, the produced `RunRecord` is written through the run-artifact
     * writer at the supplied directory. Defaults to `false` so callers that
     * just want the record in-memory don't pay for I/O they didn't ask for.
     */
    readonly persist?: boolean;
    /**
     * Absolute directory to write the artifact under when `persist === true`.
     * The artifact filename is derived from `runId`. Required when
     * `persist === true`; ignored otherwise.
     */
    readonly artifactDir?: string;
    /** Stable runner identity stamped on the record. Defaults applied when omitted. */
    readonly runner?: RunnerIdentity;
}

/**
 * Service surface exposed on `CloudDeployService.validation`. Single
 * method; everything else (event subscription, output channel, command
 * registration) is layered above this.
 */
export interface CloudDeployValidationApi {
    /**
     * Runs every enabled validation declared on the env identified by `envId`.
     * Returns a `CloudDeployValidationRunResult` — never throws, never returns
     * `undefined`. Missing envs surface as a synthesized `Errored` record so
     * callers can route them through the same UI path as a real failure.
     */
    run(
        envId: string,
        opts?: CloudDeployValidationRunOptions,
    ): Promise<CloudDeployValidationRunResult>;
}

// =============================================================================
// ValidationService
// =============================================================================

const ENV_NOT_FOUND_MESSAGE = (envId: string): string =>
    `No Cloud Deploy environment with id "${envId}" was found in this workspace.`;
const PERSIST_DIR_REQUIRED_MESSAGE =
    "persist=true requires an artifactDir. The validation ran successfully; only the artifact was not written.";
const RUN_ARTIFACT_FILENAME = (runId: string): string => `${runId}.cdrun.zip`;

const DEFAULT_RUNNER_IDENTITY: RunnerIdentity = {
    userId: "local-vscode",
    displayName: "Local VS Code",
    hostKind: "vscode",
};

/**
 * Concrete `CloudDeployValidationApi` implementation. Composed once by
 * `CloudDeployService` from a registry, an event bus, an env store, and
 * an optional run-artifact writer; reused for every `run()` call.
 *
 * The service is intentionally state-light: no caching, no batching, no
 * "in-flight runs" tracking. Each `run()` call is independent. Callers
 * that need to coordinate multiple runs (e.g. queueing) layer that above.
 */
export class ValidationService implements CloudDeployValidationApi {
    private readonly _runner: Runner;

    public constructor(
        private readonly _registry: ValidatorRegistry,
        private readonly _bus: DiagnosticEventBus,
        private readonly _environments: EnvironmentStore | undefined,
        private readonly _writer?: RunArtifactWriter,
    ) {
        this._runner = new Runner(this._registry, this._bus);
    }

    public async run(
        envId: string,
        opts: CloudDeployValidationRunOptions = {},
    ): Promise<CloudDeployValidationRunResult> {
        const env = this._environments?.get(envId);
        if (env === undefined) {
            return { record: synthesizeEnvNotFoundRecord(envId, opts.runner) };
        }

        const runnerOpts: RunnerRunOptions = {
            signal: opts.signal,
            timeoutMs: opts.timeoutMs,
            runner: opts.runner,
        };

        // When the caller wants the run persisted, buffer the lifecycle events
        // the runner emits on the bus so they can be written into the artifact's
        // `events.jsonl` and replayed later on the run's Logs tab. Each runner
        // event stamps `correlationId` with the run id, so the buffer is filtered
        // to this run after it completes (guards against interleaved runs sharing
        // the bus). The subscription is scoped to the run window and always
        // disposed.
        const collectedEvents: DiagnosticEvent[] = [];
        const eventSubscription = opts.persist
            ? this._bus.onDidEmit((event) => {
                  collectedEvents.push(event);
              })
            : undefined;

        let record: RunRecord;
        try {
            record = await this._runner.run(env, runnerOpts);
        } finally {
            eventSubscription?.dispose();
        }

        if (!opts.persist) {
            return { record };
        }

        if (this._writer === undefined || opts.artifactDir === undefined) {
            return { record, persistError: PERSIST_DIR_REQUIRED_MESSAGE };
        }

        const destPath = path.join(opts.artifactDir, RUN_ARTIFACT_FILENAME(record.runId));
        try {
            const runEvents = collectedEvents.filter(
                (event) => event.correlationId === record.runId,
            );
            const result = await this._writer.write(
                record,
                runEvents.length > 0 ? toAsyncEvents(runEvents) : undefined,
                destPath,
            );
            return { record, runArtifactPath: result.path };
        } catch (err) {
            return {
                record,
                persistError: err instanceof Error ? err.message : String(err),
            };
        }
    }
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Adapts a buffered array of diagnostic events into the `AsyncIterable` the
 * run-artifact writer drains. The events are already in memory; this only
 * bridges the sync buffer to the writer's async-iterable contract.
 */
async function* toAsyncEvents(events: readonly DiagnosticEvent[]): AsyncIterable<DiagnosticEvent> {
    for (const event of events) {
        yield event;
    }
}

/**
 * Builds an `Errored` `RunRecord` for the "env not found" path. Allows
 * callers to handle the "asked for an env that doesn't exist" case through
 * the same `RunRecord`-shaped UI flow as a real validation failure, with
 * no thrown exceptions to route around.
 */
function synthesizeEnvNotFoundRecord(envId: string, runner?: RunnerIdentity): RunRecord {
    const now = Date.now();
    const placeholderEnv: Environment = {
        id: envId,
        name: envId,
        sourceOfTruth: { kind: SourceOfTruthKind.Container, connectionProfileId: "" },
        validations: [],
    };
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: `missing-env-${envId}-${now}`,
        environmentId: envId,
        environmentSnapshot: placeholderEnv,
        runner: runner ?? DEFAULT_RUNNER_IDENTITY,
        startedAtMs: now,
        endedAtMs: now,
        status: RunStatus.Errored,
        validations: [
            {
                validationId: "env-not-found",
                displayName: "Environment lookup",
                status: ValidationStatus.Errored,
                startedAtMs: now,
                endedAtMs: now,
                payload: {
                    validationType: ValidationType.Connectivity,
                    findings: [],
                    summary: { reachable: false },
                },
                errorMessage: ENV_NOT_FOUND_MESSAGE(envId),
            },
        ],
    };
}
