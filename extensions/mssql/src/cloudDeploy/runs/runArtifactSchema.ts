/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run-artifact Zod validator.
 *
 * Validates the parsed JSON entries inside a `.cdrun.zip` against the
 * `RunRecord` model. The same `passthrough()` / collect-all / jq-path
 * conventions used by the environments validator apply here, so issues
 * surface in a familiar shape for callers and tests.
 *
 * Forward compatibility is enforced at the entry point: any `schemaVersion`
 * we don't recognize throws `RunArtifactParseError` with
 * `kind: "unknown-schema-version"` — fail-closed so an older reader never
 * silently mis-interprets a newer artifact.
 */

import { z } from "zod";

import { ValidationType } from "../environments/types";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunRecord,
    RunStatus,
    ValidationResult,
    ValidationStatus,
} from "./types";

// =============================================================================
// Public types
// =============================================================================

/** Single validation problem within a run artifact. Mirrors `EnvironmentsFileIssue`. */
export interface RunArtifactIssue {
    readonly path: string;
    readonly message: string;
    readonly severity: "error";
}

/**
 * Kinds of failures the reader can surface. Exhaustive so callers can switch
 * on `error.kind` for differentiated UI ("update the extension" vs.
 * "delete the corrupt file" vs. "open it and fix this issue").
 */
export type RunArtifactParseErrorKind =
    | "malformed-zip"
    | "unknown-schema-version"
    | "missing-entry"
    | "schema-validation"
    | "io";

/**
 * Thrown by the run-artifact reader for every recoverable failure path.
 * `kind` is always populated; `issues` and `schemaVersion` are present only
 * for the kinds that produce them.
 */
export class RunArtifactParseError extends Error {
    public constructor(
        public readonly filePath: string,
        public readonly kind: RunArtifactParseErrorKind,
        message: string,
        public readonly issues?: readonly RunArtifactIssue[],
        public readonly schemaVersion?: number,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "RunArtifactParseError";
    }
}

// =============================================================================
// Building-block schemas
// =============================================================================

/**
 * Loose env-snapshot validator: we know the env was valid at write time
 * (the store validates before persisting), so re-validating its full shape
 * on read would couple us to whatever the env schema looked like at write
 * time. Just enforce the core shape and preserve the rest verbatim.
 */
const EnvironmentSnapshotSchema = z
    .object({
        id: z.string().min(1),
        name: z.string().min(1),
        sourceOfTruth: z.object({ kind: z.string().min(1) }).passthrough(),
        validations: z.array(z.unknown()),
    })
    .passthrough();

const RunnerIdentitySchema = z
    .object({
        userId: z.string().min(1),
        displayName: z.string().min(1),
        hostKind: z.enum(["vscode", "codespaces", "github-actions"]),
    })
    .passthrough();

/**
 * Mirror of `SourceVersion` (Scope 2, decision D-A). `.optional()` on the
 * record because artifacts written before Scope 2 predate the field; always
 * written on new runs. Unknown fields pass through for forward-compat.
 */
const SourceVersionSchema = z
    .object({
        hash: z.string().min(1),
        algorithm: z.literal("sha256"),
        commitId: z.string().min(1).optional(),
        ref: z.string().min(1).optional(),
    })
    .passthrough();

const RunStatusSchema = z.nativeEnum(RunStatus);
const ValidationStatusSchema = z.nativeEnum(ValidationStatus);

// -----------------------------------------------------------------------------
// Finding schemas
// -----------------------------------------------------------------------------

const ConnectivityFindingSchema = z
    .object({
        kind: z.literal("connectivity"),
        outcome: z.enum([
            "reachable",
            "connection-refused",
            "auth-failed",
            "host-unreachable",
            "timeout",
            "unknown",
        ]),
        severity: z.enum(["info", "warning", "error"]),
        message: z.string(),
    })
    .passthrough();

const StaticAnalysisFindingSchema = z
    .object({
        kind: z.literal("static-analysis"),
        ruleId: z.string().min(1),
        severity: z.enum(["info", "warning", "error"]),
        message: z.string(),
        location: z
            .object({
                file: z.string().min(1),
                line: z.number().int().nonnegative().optional(),
                column: z.number().int().nonnegative().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const UnitTestFindingSchema = z
    .object({
        kind: z.literal("unit-tests"),
        testName: z.string().min(1),
        outcome: z.enum(["passed", "failed", "skipped", "errored"]),
        message: z.string().optional(),
        durationMs: z.number().nonnegative().optional(),
    })
    .passthrough();

const WorkloadRegressionFindingSchema = z
    .object({
        kind: z.literal("workload-playback"),
        stepId: z.string().min(1),
        regression: z.enum(["throughput", "latency", "error-rate", "plan-change"]),
        delta: z.number(),
        message: z.string(),
    })
    .passthrough();

// -----------------------------------------------------------------------------
// Payload schemas
// -----------------------------------------------------------------------------

const ConnectivityPayloadSchema = z
    .object({
        validationType: z.literal(ValidationType.Connectivity),
        findings: z.array(ConnectivityFindingSchema),
        summary: z
            .object({
                reachable: z.boolean(),
                serverVersion: z.string().min(1).optional(),
            })
            .passthrough(),
    })
    .passthrough();

const StaticAnalysisPayloadSchema = z
    .object({
        validationType: z.literal(ValidationType.StaticAnalysis),
        findings: z.array(StaticAnalysisFindingSchema),
        summary: z
            .object({
                info: z.number().int().nonnegative(),
                warning: z.number().int().nonnegative(),
                error: z.number().int().nonnegative(),
            })
            .passthrough(),
    })
    .passthrough();

const UnitTestsPayloadSchema = z
    .object({
        validationType: z.literal(ValidationType.UnitTests),
        findings: z.array(UnitTestFindingSchema),
        summary: z
            .object({
                total: z.number().int().nonnegative(),
                passed: z.number().int().nonnegative(),
                failed: z.number().int().nonnegative(),
                skipped: z.number().int().nonnegative(),
                errored: z.number().int().nonnegative(),
            })
            .passthrough(),
    })
    .passthrough();

const WorkloadPlaybackPayloadSchema = z
    .object({
        validationType: z.literal(ValidationType.WorkloadPlayback),
        findings: z.array(WorkloadRegressionFindingSchema),
        summary: z
            .object({
                steps: z.number().int().nonnegative(),
                regressions: z.number().int().nonnegative(),
            })
            .passthrough(),
        observedSteps: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        latencyMs: z.number().optional(),
                        throughputQps: z.number().optional(),
                        errorRate: z.number().optional(),
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

const ValidationPayloadSchema = z.discriminatedUnion("validationType", [
    ConnectivityPayloadSchema,
    StaticAnalysisPayloadSchema,
    UnitTestsPayloadSchema,
    WorkloadPlaybackPayloadSchema,
]);

// -----------------------------------------------------------------------------
// ValidationResult & RunRecord
// -----------------------------------------------------------------------------

const ValidationResultSchema = z
    .object({
        validationId: z.string().min(1),
        displayName: z.string().min(1),
        status: ValidationStatusSchema,
        startedAtMs: z.number().int().nonnegative(),
        endedAtMs: z.number().int().nonnegative(),
        payload: ValidationPayloadSchema,
        errorMessage: z.string().optional(),
        cancellationReason: z.enum(["user", "timeout"]).optional(),
    })
    .passthrough()
    .superRefine((res, ctx) => {
        if (res.status === ValidationStatus.Cancelled && res.cancellationReason === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "cancellationReason is required when status is 'cancelled'.",
                path: ["cancellationReason"],
            });
        }
        if (res.status !== ValidationStatus.Cancelled && res.cancellationReason !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "cancellationReason must be omitted unless status is 'cancelled'.",
                path: ["cancellationReason"],
            });
        }
    });

const RunRecordSchema = z
    .object({
        schemaVersion: z.literal(RUN_RECORD_SCHEMA_VERSION),
        runId: z.string().min(1),
        environmentId: z.string().min(1),
        environmentSnapshot: EnvironmentSnapshotSchema,
        runner: RunnerIdentitySchema,
        sourceVersion: SourceVersionSchema.optional(),
        startedAtMs: z.number().int().nonnegative(),
        endedAtMs: z.number().int().nonnegative(),
        status: RunStatusSchema,
        validations: z.array(ValidationResultSchema),
    })
    .passthrough()
    .superRefine((rec, ctx) => {
        if (rec.environmentSnapshot.id !== rec.environmentId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `environmentSnapshot.id (${rec.environmentSnapshot.id}) does not match environmentId (${rec.environmentId}).`,
                path: ["environmentSnapshot", "id"],
            });
        }
        if (rec.endedAtMs < rec.startedAtMs) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "endedAtMs must be >= startedAtMs.",
                path: ["endedAtMs"],
            });
        }
    });

// =============================================================================
// Public entry points
// =============================================================================

/**
 * Validates a single parsed `ValidationResult` JSON entry. Throws
 * `RunArtifactParseError` with `kind: "schema-validation"` on any issue.
 *
 * Exposed so the reader can stream validations one-at-a-time without
 * materializing the full `RunRecord` upfront.
 */
export function validateValidationResult(raw: unknown, filePath: string): ValidationResult {
    const result = ValidationResultSchema.safeParse(raw);
    if (result.success) {
        return result.data as unknown as ValidationResult;
    }
    throw buildSchemaError(result.error, filePath);
}

/**
 * Validates a parsed `RunRecord` (the assembled manifest + validations).
 * Forward-version detection happens BEFORE Zod parsing: we peek at
 * `schemaVersion` and reject anything we don't understand with a typed
 * `unknown-schema-version` error so callers can prompt the user to upgrade.
 */
export function validateRunRecord(raw: unknown, filePath: string): RunRecord {
    const versionPeek = peekSchemaVersion(raw);
    if (versionPeek !== undefined && versionPeek !== RUN_RECORD_SCHEMA_VERSION) {
        throw new RunArtifactParseError(
            filePath,
            "unknown-schema-version",
            `Run artifact at ${filePath} declares schemaVersion ${versionPeek}, expected ${RUN_RECORD_SCHEMA_VERSION}.`,
            undefined,
            versionPeek,
        );
    }
    const result = RunRecordSchema.safeParse(raw);
    if (result.success) {
        return result.data as unknown as RunRecord;
    }
    throw buildSchemaError(result.error, filePath);
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Pulls `schemaVersion` off a raw value without committing to the full shape.
 * Returns `undefined` if the value isn't an object or the field isn't numeric;
 * the full validator will surface the real complaint in that case.
 */
function peekSchemaVersion(raw: unknown): number | undefined {
    if (raw === null || typeof raw !== "object") {
        return undefined;
    }
    const v = (raw as { schemaVersion?: unknown }).schemaVersion;
    return typeof v === "number" ? v : undefined;
}

function buildSchemaError(error: z.ZodError, filePath: string): RunArtifactParseError {
    const issues = mapZodErrorToIssues(error);
    const summary = issues.map((i) => `  • ${i.path}: ${i.message}`).join("\n");
    return new RunArtifactParseError(
        filePath,
        "schema-validation",
        `Run artifact at ${filePath} has ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${summary}`,
        issues,
    );
}

function mapZodErrorToIssues(error: z.ZodError): RunArtifactIssue[] {
    return error.issues.map((issue) => ({
        path: zodPathToJqPath(issue.path),
        message: issue.message,
        severity: "error" as const,
    }));
}

/** `["validations", 0, "validationId"]` -> `"$.validations[0].validationId"`. `[]` -> `"$"`. */
function zodPathToJqPath(path: (string | number)[]): string {
    let out = "$";
    for (const segment of path) {
        if (typeof segment === "number") {
            out += `[${segment}]`;
        } else {
            out += `.${segment}`;
        }
    }
    return out;
}
