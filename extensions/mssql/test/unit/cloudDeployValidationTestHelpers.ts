/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — validation runner shared test helpers.
 *
 * Reusable building blocks for every D2 test file:
 *   * `FakeValidator`: configurable `Validator` that lets a test pick the
 *     result it returns, optionally delay it, or throw a chosen error.
 *   * `makeFakeRegistry`: convenience for building a `ValidatorRegistry`
 *     wired to four fakes (one per `ValidationType` arm) so the runner
 *     can be exercised end-to-end without any real adapter.
 *   * `makeValidationConfig`: tiny config builder, defaults to `enabled: true`.
 *   * `makeEnvironmentWithValidations`: env builder seeded with the
 *     standard container source-of-truth and the caller's config list.
 *   * `TestEventCollector`: thin observer on the `DiagnosticEventBus`
 *     mirroring the D4 helper of the same name. Captures every event for
 *     ordering / payload assertions.
 *
 * Provider fakes for `ConnectionProvider` / `ProcessProvider` /
 * `ArtifactProvider` land in this file in their respective commits (2, 3,
 * 5) so each commit's tests have what they need.
 */

import {
    ConnectivitySettings,
    Environment,
    SourceOfTruthKind,
    StaticAnalysisSettings,
    UnitTestsSettings,
    ValidationConfig,
    ValidationType,
    WorkloadPlaybackSettings,
} from "../../src/cloudDeploy/environments/types";
import {
    RunStatus,
    ValidationPayload,
    ValidationResult,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";
import {
    CancellationError,
    SettingsFor,
    Validator,
    ValidatorRegistry,
    ValidatorRunOptions,
    defineRegistry,
    throwIfCancelled,
} from "../../src/cloudDeploy/validation";

export { TestEventCollector } from "./cloudDeployTestEventCollector";

// =============================================================================
// FakeValidator
// =============================================================================

/**
 * Per-call behavior selector. The runner invokes `behaviorFor(env)` (or just
 * uses the static `behavior`) and reacts accordingly:
 *
 *   * `"pass"` — returns the configured `result` or a passing default
 *     payload of the validator's `type`.
 *   * `"fail"` — returns a `Failed` result with empty findings.
 *   * `"errored"` — returns an `Errored` result with `errorMessage`.
 *   * `"throw"` — throws the configured `error` (defaults to `new Error("boom")`).
 *   * `"cancel"` — throws `CancellationError` with `reason: "user"`.
 *   * `"wait-then-pass"` — awaits the signal's `abort` to test cancellation
 *     mid-flight; throws `CancellationError("user")` on abort, otherwise
 *     resolves to a passing result after the configured delay.
 */
export type FakeBehavior =
    | { kind: "pass"; result?: Partial<ValidationResult> }
    | { kind: "fail" }
    | { kind: "warning" }
    | { kind: "errored"; message?: string }
    | { kind: "throw"; error?: unknown }
    | { kind: "cancel" }
    | { kind: "wait-then-pass"; delayMs?: number };

export class FakeValidator<T extends ValidationType = ValidationType> implements Validator<T> {
    public readonly invocations: Array<{
        envId: string;
        runId: string;
        config: SettingsFor<T>;
    }> = [];

    public behavior: FakeBehavior = { kind: "pass" };

    public constructor(public readonly type: T) {}

    public async run(
        env: Environment,
        config: SettingsFor<T>,
        opts: ValidatorRunOptions,
    ): Promise<ValidationResult> {
        this.invocations.push({ envId: env.id, runId: opts.runId, config });

        const startedAtMs = Date.now();
        // Honor cancellation at entry so a "cancel-before-dispatch" test path
        // still produces a CancellationError rather than a passing result.
        throwIfCancelled(opts.signal);

        switch (this.behavior.kind) {
            case "pass": {
                const endedAtMs = Date.now();
                return {
                    validationId: this.type,
                    displayName: this.type,
                    status: ValidationStatus.Passed,
                    startedAtMs,
                    endedAtMs,
                    payload: emptyPayloadFor(this.type),
                    ...this.behavior.result,
                };
            }
            case "warning": {
                const endedAtMs = Date.now();
                return {
                    validationId: this.type,
                    displayName: this.type,
                    status: ValidationStatus.Warning,
                    startedAtMs,
                    endedAtMs,
                    payload: emptyPayloadFor(this.type),
                };
            }
            case "fail": {
                const endedAtMs = Date.now();
                return {
                    validationId: this.type,
                    displayName: this.type,
                    status: ValidationStatus.Failed,
                    startedAtMs,
                    endedAtMs,
                    payload: emptyPayloadFor(this.type),
                };
            }
            case "errored": {
                const endedAtMs = Date.now();
                return {
                    validationId: this.type,
                    displayName: this.type,
                    status: ValidationStatus.Errored,
                    startedAtMs,
                    endedAtMs,
                    payload: emptyPayloadFor(this.type),
                    errorMessage: this.behavior.message ?? "fake errored",
                };
            }
            case "throw":
                throw this.behavior.error ?? new Error("boom");
            case "cancel":
                throw new CancellationError("user");
            case "wait-then-pass": {
                await waitForAbort(opts.signal, this.behavior.delayMs ?? 10);
                throwIfCancelled(opts.signal);
                const endedAtMs = Date.now();
                return {
                    validationId: this.type,
                    displayName: this.type,
                    status: ValidationStatus.Passed,
                    startedAtMs,
                    endedAtMs,
                    payload: emptyPayloadFor(this.type),
                };
            }
        }
    }
}

/**
 * Builds a registry wired to one `FakeValidator` per `ValidationType` arm.
 * Tests grab references off the returned object to configure per-validator
 * behavior before calling `runner.run()`.
 */
export interface FakeRegistryBundle {
    readonly registry: ValidatorRegistry;
    readonly connectivity: FakeValidator<ValidationType.Connectivity>;
    readonly staticAnalysis: FakeValidator<ValidationType.StaticAnalysis>;
    readonly unitTests: FakeValidator<ValidationType.UnitTests>;
    readonly workloadPlayback: FakeValidator<ValidationType.WorkloadPlayback>;
    readonly workloadSimulation: FakeValidator<ValidationType.WorkloadSimulation>;
}

export function makeFakeRegistry(): FakeRegistryBundle {
    const connectivity = new FakeValidator(ValidationType.Connectivity);
    const staticAnalysis = new FakeValidator(ValidationType.StaticAnalysis);
    const unitTests = new FakeValidator(ValidationType.UnitTests);
    const workloadPlayback = new FakeValidator(ValidationType.WorkloadPlayback);
    const workloadSimulation = new FakeValidator(ValidationType.WorkloadSimulation);

    const registry = defineRegistry({
        [ValidationType.Connectivity]: connectivity,
        [ValidationType.StaticAnalysis]: staticAnalysis,
        [ValidationType.UnitTests]: unitTests,
        [ValidationType.WorkloadPlayback]: workloadPlayback,
        [ValidationType.WorkloadSimulation]: workloadSimulation,
    });

    return {
        registry,
        connectivity,
        staticAnalysis,
        unitTests,
        workloadPlayback,
        workloadSimulation,
    };
}

// =============================================================================
// Config + env builders
// =============================================================================

export function makeValidationConfig<T extends ValidationType>(
    type: T,
    overrides: { enabled?: boolean; settings?: SettingsFor<T> } = {},
): ValidationConfig {
    const enabled = overrides.enabled ?? true;
    const settings = overrides.settings ?? emptySettingsFor(type);
    // The cast is safe: `type` and `settings` come from the same `T` arm.
    return { type, enabled, settings } as ValidationConfig;
}

export function makeEnvironmentWithValidations(
    validations: ValidationConfig[],
    overrides: Partial<Environment> = {},
): Environment {
    return {
        id: "env-1",
        name: "Env 1",
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "proj/Project.sqlproj" },
        validations,
        ...overrides,
    };
}

// =============================================================================
// TestEventCollector
// =============================================================================

// Re-exported above from the existing D4 helper to avoid duplication. Tests
// import `TestEventCollector` directly from this module so each test file
// has a single source for all D2 test utilities.

// =============================================================================
// Status-rollup expectation helper
// =============================================================================

/**
 * Map of `ValidationStatus` to the matching `RunStatus`. Used by tests that
 * stamp a single fake's status and want to assert the resulting rollup.
 * Keeping it in helpers means the matrix is computed once, in one place.
 */
export const STATUS_TO_RUN_STATUS: Readonly<Record<ValidationStatus, RunStatus>> = Object.freeze({
    [ValidationStatus.Passed]: RunStatus.Passed,
    [ValidationStatus.Skipped]: RunStatus.Skipped,
    [ValidationStatus.Cancelled]: RunStatus.Cancelled,
    [ValidationStatus.Warning]: RunStatus.Warning,
    [ValidationStatus.Failed]: RunStatus.Failed,
    [ValidationStatus.Errored]: RunStatus.Errored,
});

// =============================================================================
// Internals
// =============================================================================

function waitForAbort(signal: AbortSignal, maxDelayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, maxDelayMs);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

function emptySettingsFor<T extends ValidationType>(type: T): SettingsFor<T> {
    // All four settings shapes are currently empty objects; cast widens to
    // the right arm. Update as soon as a real settings shape gains fields.
    void type;
    const empty:
        | ConnectivitySettings
        | StaticAnalysisSettings
        | UnitTestsSettings
        | WorkloadPlaybackSettings = {};
    return empty as SettingsFor<T>;
}

function emptyPayloadFor(type: ValidationType): ValidationPayload {
    switch (type) {
        case ValidationType.Connectivity:
            return {
                validationType: ValidationType.Connectivity,
                findings: [],
                summary: { reachable: true },
            };
        case ValidationType.StaticAnalysis:
            return {
                validationType: ValidationType.StaticAnalysis,
                findings: [],
                summary: { info: 0, warning: 0, error: 0 },
            };
        case ValidationType.UnitTests:
            return {
                validationType: ValidationType.UnitTests,
                findings: [],
                summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 },
            };
        case ValidationType.WorkloadPlayback:
            return {
                validationType: ValidationType.WorkloadPlayback,
                findings: [],
                summary: { steps: 0, regressions: 0 },
            };
    }
}
