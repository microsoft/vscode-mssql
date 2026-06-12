/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — validation runner vocabulary.
 *
 * Pure type declarations. The contract every validator implements, the
 * registry shape the runner dispatches through, the cancellation marker the
 * runner catches, and the exhaustiveness helper validators reach for when
 * switching over `ValidationType`.
 *
 * No runtime, no I/O. Implementations live in `validation/validators/` and
 * `validation/runner.ts`.
 */

import type { DiagnosticEventBus } from "../diagnostics";
import type {
    Environment,
    ConnectivitySettings,
    StaticAnalysisSettings,
    UnitTestsSettings,
    ValidationConfig,
    ValidationType,
    WorkloadPlaybackSettings,
} from "../environments/types";
import type { CancellationReason, ValidationResult, WorkloadObservedStep } from "../runs/types";
import type { ConnectionHandle } from "./providers/connectionProvider";
// =============================================================================
// Per-type settings narrowing
// =============================================================================

/**
 * Picks the settings shape corresponding to a `ValidationType` arm. Lets the
 * `Validator<T>` interface narrow its `config` parameter to the right
 * `*Settings` shape per implementation, so a validator never has to widen
 * its config to `unknown` and re-narrow.
 */
export type SettingsFor<T extends ValidationType> = Extract<
    ValidationConfig,
    { type: T }
>["settings"];

// Light sanity wiring (not exported): if a new ValidationType arm lands without
// a settings interface, this conditional fails to typecheck. Forces the
// environments/types.ts author to add the matching ConnectivitySettings-shaped
// arm before the build is green.
type _SettingsExhaustivenessCheck =
    SettingsFor<ValidationType> extends
        | ConnectivitySettings
        | StaticAnalysisSettings
        | UnitTestsSettings
        | WorkloadPlaybackSettings
        ? true
        : never;
// Reference the alias so unused-type lint doesn't flag it; the check runs at
// type-resolution time regardless.
export type _ValidationSettingsExhaustiveness = _SettingsExhaustivenessCheck;

// =============================================================================
// Validator contract
// =============================================================================

/**
 * The contract every validation implements. Generic over the `ValidationType`
 * arm so `config` and (eventually) finding shapes narrow correctly per
 * validator implementation.
 *
 * Implementations MUST:
 *   * Return a `ValidationResult` whose `payload.validationType` matches `this.type`.
 *   * Poll `opts.signal` at safe checkpoints and throw `CancellationError`
 *     when cancellation is observed mid-flight.
 *   * Stamp accurate `startedAtMs` and `endedAtMs` on the result.
 *
 * Implementations MUST NOT:
 *   * Persist anything (the runner / service layer owns artifact writing).
 *   * Retry; failed validations stay failed.
 *   * Mutate the input `env` or `config`.
 */
export interface Validator<TType extends ValidationType = ValidationType> {
    /** The `ValidationType` arm this validator handles. Used as the registry key. */
    readonly type: TType;

    /**
     * Run the validation against the given environment. The returned
     * `ValidationResult` is in D3's canonical shape and is appended verbatim
     * to the run's `validations` array by the runner.
     */
    run(
        env: Environment,
        config: SettingsFor<TType>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult>;
}

/**
 * What the runner passes into every `validator.run()` invocation.
 *
 * `signal` is the *effective* signal: caller-supplied cancellation merged
 * with the runner's overall timeout (if any). Validators only ever see this
 * combined signal, never the raw caller-supplied one.
 *
 * `bus` is optional so a validator can run in a CLI / test harness context
 * with no bus wired and still produce a correct `ValidationResult`. When
 * present, validators emit `validation-started` / `validation-progress` /
 * `validation-finished` lifecycle events themselves.
 */
export interface ValidatorRunOptions {
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly bus?: DiagnosticEventBus;
    /**
     * Connection to the per-run ephemeral database the runner provisioned and
     * seeded for this run (Scope 2, decisions D-C / M6). Present only when the
     * runner stood one up (i.e. a runtime validator is enabled and an ephemeral
     * provider is wired); `undefined` for static-analysis-only runs and any
     * context with no ephemeral provider. Runtime validators (unit tests,
     * workload playback) run against this connection instead of opening their
     * own.
     */
    readonly ephemeralConnection?: ConnectionHandle;
    /**
     * Per-step metrics from the run-based performance baseline (Scope 2,
     * decision M9): the measured steps of the most-recent earlier run of this
     * environment whose schema differed. The workload validator compares its
     * fresh measurements against these to flag regressions. `undefined` when
     * there is no prior run to baseline against (e.g. the first run), in which
     * case the validator records its measurements without flagging a regression.
     */
    readonly workloadBaseline?: readonly WorkloadObservedStep[];
}

// =============================================================================
// Cancellation
// =============================================================================

/**
 * Thrown by validators when `signal.aborted` is observed at a safe checkpoint.
 * The runner catches this specifically and maps it to a
 * `ValidationStatus.Cancelled` result with the matching `cancellationReason`.
 *
 * Implementations call `throwIfCancelled(signal, reason)` rather than
 * instantiating `CancellationError` directly — the helper hides the message
 * formatting and keeps the call sites short.
 */
export class CancellationError extends Error {
    public constructor(
        public readonly reason: CancellationReason,
        message?: string,
    ) {
        super(message ?? `Validation cancelled (reason: ${reason}).`);
        this.name = "CancellationError";
    }
}

/**
 * Throws `CancellationError` if `signal.aborted` is true. Reason defaults to
 * `"user"`; callers running under a timeout-derived signal pass `"timeout"`
 * explicitly.
 */
export function throwIfCancelled(signal: AbortSignal, reason: CancellationReason = "user"): void {
    if (signal.aborted) {
        throw new CancellationError(reason);
    }
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Closed map of `ValidationType -> Validator`. Compile-time exhaustive:
 * every `ValidationType` arm MUST have an entry, and each entry's value is
 * narrowed to the matching `Validator<TType>` generic.
 *
 * Adding a new `ValidationType` enum value without adding a registry entry
 * is a type error at every `defineRegistry({ ... })` call site.
 */
export type ValidatorRegistry = {
    readonly [K in ValidationType]: Validator<K>;
};

/**
 * Helper for constructing a `ValidatorRegistry`. Pass an object literal with
 * every `ValidationType` arm wired to its `Validator`; TypeScript enforces
 * exhaustiveness. The returned object is frozen so post-construction
 * mutation is impossible.
 */
export function defineRegistry(entries: ValidatorRegistry): ValidatorRegistry {
    return Object.freeze({ ...entries });
}

// =============================================================================
// Exhaustiveness helper
// =============================================================================

/**
 * Reached only when a switch over `ValidationType` is missing an arm. The
 * compiler will narrow `x` to `never` only if every other arm is handled;
 * if a new arm is added without updating the switch, the call site fails to
 * compile because `x` is no longer `never`.
 */
export function assertNeverValidationType(x: never): never {
    throw new Error(`Unhandled validation type: ${JSON.stringify(x)}`);
}
