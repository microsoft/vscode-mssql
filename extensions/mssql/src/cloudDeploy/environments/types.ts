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
    StaticAnalysis = "static-analysis",
    UnitTests = "unit-tests",
    WorkloadPlayback = "workload-playback",
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
    Container = "container",
}

/**
 * Where the schema for this env comes from. Discriminated union: exactly one
 * variant is set per env. Validators must reject any other shape.
 */
export type SourceOfTruth =
    | { kind: SourceOfTruthKind.SqlProj; path: string }
    | { kind: SourceOfTruthKind.Dacpac; path: string }
    | { kind: SourceOfTruthKind.Container; connectionProfileId: string };

// =============================================================================
// Per-validation settings
// =============================================================================

/**
 * Settings shapes per validation type. Empty for now — fields are added when
 * each validation is implemented. Keeping them as named interfaces (rather
 * than `Record<string, unknown>`) gives us type-safety as soon as fields land.
 */
export interface StaticAnalysisSettings {
    // populated when static analysis is implemented (e.g., enabled rule ids, severity overrides)
}

export interface UnitTestsSettings {
    // populated when unit tests are implemented (e.g., tSQLt schema name, test filter)
}

export interface WorkloadPlaybackSettings {
    // populated when workload playback is implemented (e.g., baseline artifact ref, regression threshold)
}

/**
 * Per-env, per-validation configuration. Discriminated by `type` so each
 * validation's `settings` is correctly typed.
 */
export type ValidationConfig =
    | { type: ValidationType.StaticAnalysis; enabled: boolean; settings: StaticAnalysisSettings }
    | { type: ValidationType.UnitTests; enabled: boolean; settings: UnitTestsSettings }
    | {
          type: ValidationType.WorkloadPlayback;
          enabled: boolean;
          settings: WorkloadPlaybackSettings;
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
