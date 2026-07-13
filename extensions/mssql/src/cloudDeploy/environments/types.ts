/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — environment model.
 *
 * Defines what an "environment" is: a target a database lives in or could live
 * in (a local container today; other targets later). Pure type declarations —
 * no runtime, no I/O, no behavior. Storage lives in `environmentStore.ts`,
 * validation in `environmentSchema.ts`.
 *
 * Note: an environment describes *what to validate*, not *where/how to execute*.
 * Execution location is owned by a separate Runner subsystem. The same
 * `Environment` shape is consumed by a local runner today and by a future
 * remote runner with no changes here — cross-environment behavior is reached
 * via pluggable providers (file/artifact/process), wired at run time by the
 * runner, not declared on the env itself.
 */

// =============================================================================
// Enums / unions
// =============================================================================

/**
 * The set of first-party validations available today. Each env opts in/out per
 * validation via `ValidationConfig`. Intended to be replaced by a registry
 * lookup once third-party validations land; a closed enum keeps the initial
 * surface small without precluding that.
 */
export enum ValidationType {
    Connectivity = "connectivity",
    StaticAnalysis = "static-analysis",
    UnitTests = "unit-tests",
    WorkloadPlayback = "workload-playback",
    WorkloadSimulation = "workload-simulation",
}

// =============================================================================
// Source of truth
// =============================================================================

/**
 * Discriminator for `SourceOfTruth`. String values are persisted as-is in
 * `.mssql/environments.json`, so changing them is a file-format break.
 */
export enum SourceOfTruthKind {
    SqlProj = "sqlproj",
    Dacpac = "dacpac",
    Connection = "connection",
    Shadow = "shadow",
}

/**
 * Where the schema for this env comes from. Discriminated union: exactly one
 * variant is set per env. Validators must reject any other shape. The schema
 * is always the source of truth — the per-run
 * ephemeral database is built from it; a live container is no longer a source
 * of truth (it is, at most, a validator's runtime host via `RuntimeHostConfig`).
 *
 *   * `SqlProj` / `Dacpac` — the schema lives in a file on disk.
 *   * `Connection` — the schema lives in a running database, read READ-ONLY
 *     (a `sqlpackage` extract). The live database is never the validation
 *     target; only its shape is copied into the throwaway database.
 *   * `Shadow` — decompose an inner source into a deterministic, git-diffable
 *     `.sqlproj`. With `projectPath` set, the project is *synced* into the
 *     workspace at that path (committed, so it validates everywhere including
 *     CI); without it, the decomposition is ephemeral (a local validate-only
 *     check). Lets framework-generated schema be reviewed under the team's rules.
 */
export type SourceOfTruth =
    | { kind: SourceOfTruthKind.SqlProj; path: string }
    | { kind: SourceOfTruthKind.Dacpac; path: string }
    | { kind: SourceOfTruthKind.Connection; connectionProfileId: string }
    | { kind: SourceOfTruthKind.Shadow; source: ShadowInnerSource; projectPath?: string };

/**
 * Inner source a `Shadow` source of truth decomposes into a `.sqlproj`. Phase 1
 * supports only a live `Connection`; a `Dacpac` inner source is accepted by the
 * config shape but rejected at resolution until the dacpac-decomposition phase.
 */
export type ShadowInnerSource =
    | { kind: SourceOfTruthKind.Connection; connectionProfileId: string }
    | { kind: SourceOfTruthKind.Dacpac; path: string };

// =============================================================================
// Runtime host
// =============================================================================

/**
 * Where a runtime validator stands up the per-run ephemeral database. This is
 * distinct from `SourceOfTruth`: the source of truth is
 * *what schema to build*; the runtime host is *where to run the throwaway DB
 * built from that schema*.
 *
 *   * `docker` — the tool spins up and tears down a throwaway SQL Server
 *     container itself (the user only needs Docker present).
 *   * `connection` — the tool borrows an existing SQL engine (reached by a
 *     saved connection profile) and creates / drops a throwaway database on it.
 *
 * Carried per-validator (only the runtime validators need it), never on the
 * environment, because static analysis needs no database at all.
 */
export type RuntimeHostConfig =
    | { kind: "docker" }
    | { kind: "connection"; connectionProfileId: string };

// =============================================================================
// Per-validation settings
// =============================================================================

/**
 * Settings shapes per validation type. Empty for now — fields are added when
 * each validation is implemented. Keeping them as named interfaces (rather
 * than `Record<string, unknown>`) gives us type-safety as soon as fields land.
 */
export interface ConnectivitySettings {
    // populated when connectivity gains real options (e.g., custom probe query, retry policy)
}

export interface StaticAnalysisSettings {
    // populated when static analysis is implemented (e.g., enabled rule ids, severity overrides)
}

export interface UnitTestsSettings {
    /**
     * Where to stand up the per-run ephemeral database the tSQLt suite runs
     * against. When omitted, the runner's default host
     * is used. Unit tests run against the same ephemeral database the runner
     * provisions once per run.
     */
    runtimeHost?: RuntimeHostConfig;
}

export interface WorkloadPlaybackSettings {
    /**
     * Where to stand up the per-run ephemeral database the workload runs
     * against. When omitted, the runner's default host
     * is used.
     */
    runtimeHost?: RuntimeHostConfig;
    /**
     * Workload-spec artifact location: a JSON document `{ steps: [{ id, query,
     * iterations? }] }` describing the queries to time against the per-run
     * ephemeral database. This is an absolute or
     * workspace-relative local file path (resolved by the host); a future
     * `GitHubArtifactProvider` reuses the same field with a `gh://` URI.
     */
    workloadUri?: string;
    /**
     * Latency-regression threshold expressed as a fraction of the baseline
     * (e.g. `0.25` flags any step whose observed latency is more than 25 %
     * higher than the run-based baseline). Defaults applied by the validator.
     */
    latencyRegressionThreshold?: number;
    /**
     * Throughput-regression threshold expressed as a fraction of the baseline
     * (e.g. `0.25` flags any step whose observed throughput drops by more
     * than 25 %).
     */
    throughputRegressionThreshold?: number;
    /**
     * Error-rate-increase threshold expressed as an absolute delta (e.g.
     * `0.05` flags any step whose observed error rate is more than five
     * percentage points above baseline).
     */
    errorRateThreshold?: number;
    /**
     * Logical-reads-regression threshold expressed as a fraction of the
     * baseline (e.g. `0.25` flags any step whose observed logical reads are
     * more than 25 % above the run-based baseline). This is a deterministic
     * I/O signal, unlike wall-clock latency. Defaults applied by the validator.
     */
    logicalReadsRegressionThreshold?: number;
}

/**
 * Settings for the `workload-simulation` validation: replays a workload `.sql`
 * concurrently against the per-run ephemeral database using the injected
 * sqlsimtools engine (sqlpysim) and flags throughput / latency regressions.
 * Distinct from `WorkloadPlaybackSettings` (the in-process, per-query gate).
 */
export interface WorkloadSimulationSettings {
    /**
     * Where to stand up the per-run ephemeral database the simulation runs
     * against. When omitted, the runner's default host is used.
     */
    runtimeHost?: RuntimeHostConfig;
    /**
     * Path to the workload `.sql` file replayed concurrently against the
     * ephemeral database. Absolute or workspace-relative (resolved by the host).
     */
    workloadUri?: string;
    /** Concurrent threads the simulation replays with. Defaults applied by the validator. */
    threads?: number;
    /** Iterations per thread. Defaults applied by the validator. */
    iterations?: number;
    /** Measurement passes; the median is reported. Defaults applied by the validator. */
    runs?: number;
    /**
     * Throughput-regression threshold as a fraction of the baseline (e.g. `0.25`
     * warns when throughput drops more than 25 %). Defaults applied by the validator.
     */
    throughputRegressionThreshold?: number;
    /**
     * Latency-regression threshold as a fraction of the baseline (e.g. `0.25`
     * warns when latency rises more than 25 %). Defaults applied by the validator.
     */
    latencyRegressionThreshold?: number;
}

/**
 * Per-env, per-validation configuration. Discriminated by `type` so each
 * validation's `settings` is correctly typed.
 */
export type ValidationConfig =
    | { type: ValidationType.Connectivity; enabled: boolean; settings: ConnectivitySettings }
    | { type: ValidationType.StaticAnalysis; enabled: boolean; settings: StaticAnalysisSettings }
    | { type: ValidationType.UnitTests; enabled: boolean; settings: UnitTestsSettings }
    | {
          type: ValidationType.WorkloadPlayback;
          enabled: boolean;
          settings: WorkloadPlaybackSettings;
      }
    | {
          type: ValidationType.WorkloadSimulation;
          enabled: boolean;
          settings: WorkloadSimulationSettings;
      };

// =============================================================================
// Environment
// =============================================================================

/**
 * A single environment definition. Identity is `id` (stable, slug-ish, unique
 * within the file). `name` is display-only and not required to be unique.
 *
 * Deliberately omits any "where this runs" field: execution location belongs
 * to the Runner. An env that points at a container source-of-truth can be
 * driven by a local runner today and by a future remote runner unchanged.
 *
 * Connection identity, when one is needed, lives inside `sourceOfTruth`
 * (currently the `container` variant). The env carries no top-level
 * connection reference — that would duplicate state and re-introduce a
 * cross-field rule the validator no longer needs.
 */
export interface Environment {
    /** Stable unique id within the file. Slug-like (e.g., "local-dev"). */
    id: string;
    /** Human-readable label. Display-only. */
    name: string;
    /** Optional free-form description. */
    description?: string;
    /** Where the schema for this env comes from. */
    sourceOfTruth: SourceOfTruth;
    /**
     * Path to a hand-authored data-generator SQL script that seeds the per-run
     * ephemeral database before the runtime validators run. One script per
     * environment, shared by the runtime validators;
     * re-run fresh on every run so workload measurements stay comparable.
     * Absolute or workspace-relative; resolved by the host. When omitted,
     * workload playback is skipped (no data to measure) and unit tests rely on
     * their own per-test fixtures.
     */
    dataGeneratorScript?: string;
    /**
     * Which validations run against this env, with their config. An empty
     * array is valid and means "no validations configured yet."
     */
    validations: ValidationConfig[];
}

// =============================================================================
// File on disk
// =============================================================================

/** Schema version of the on-disk file. Bump when the shape changes incompatibly. */
export const ENVIRONMENTS_FILE_SCHEMA_VERSION = 1 as const;

/**
 * Top-level shape of `.mssql/environments.json`. Wrapper object (rather than a
 * bare array) so we can add file-level fields later without breaking the format.
 */
export interface EnvironmentsFile {
    schemaVersion: typeof ENVIRONMENTS_FILE_SCHEMA_VERSION;
    environments: Environment[];
}
