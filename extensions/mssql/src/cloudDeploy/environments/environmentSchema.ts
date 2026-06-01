/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — environment schema validator.
 *
 * Validates `.mssql/environments.json` against the typed `EnvironmentsFile`
 * model using zod. Returns the typed object on success, or throws
 * `EnvironmentsFileParseError` carrying every issue found (collect-all, not
 * fail-fast — the user fixes every problem in one editing pass).
 *
 * Unknown fields are preserved (forward-compat) via `.passthrough()`. Path
 * and connection-existence checks are out of scope — this validator checks
 * file shape only.
 *
 * Issue paths use a `$.field[index].subfield` jq-ish format, kept identical
 * to the previous hand-rolled validator so downstream consumers and tests
 * are unaffected by the zod migration.
 */

import { z } from "zod";

import {
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    EnvironmentsFile,
    SourceOfTruthKind,
    ValidationType,
} from "./types";
import { EnvironmentsFileParseError } from "./environmentFile";

// =============================================================================
// Public types
// =============================================================================

/**
 * A single validation problem. `path` is a `$.field[index].subfield` jq-ish
 * pointer into the source document; `$` is the document root.
 */
export interface EnvironmentsFileIssue {
    path: string;
    message: string;
    severity: "error";
}

// =============================================================================
// Schemas
// =============================================================================

/** Slug pattern: starts with letter or digit; then letters, digits, dash, underscore. */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/** Per-validation settings — empty objects today; gain fields as each validation is implemented. */
const SettingsSchema = z.object({}).passthrough();

const SourceOfTruthSchema = z.discriminatedUnion("kind", [
    z
        .object({
            kind: z.literal(SourceOfTruthKind.SqlProj),
            path: z.string().min(1),
        })
        .passthrough(),
    z
        .object({
            kind: z.literal(SourceOfTruthKind.Dacpac),
            path: z.string().min(1),
        })
        .passthrough(),
    z
        .object({
            kind: z.literal(SourceOfTruthKind.Container),
            connectionProfileId: z.string().min(1),
        })
        .passthrough(),
]);

const ValidationConfigSchema = z.discriminatedUnion("type", [
    z
        .object({
            type: z.literal(ValidationType.Connectivity),
            enabled: z.boolean(),
            settings: SettingsSchema.default({}),
        })
        .passthrough(),
    z
        .object({
            type: z.literal(ValidationType.StaticAnalysis),
            enabled: z.boolean(),
            settings: SettingsSchema.default({}),
        })
        .passthrough(),
    z
        .object({
            type: z.literal(ValidationType.UnitTests),
            enabled: z.boolean(),
            settings: SettingsSchema.default({}),
        })
        .passthrough(),
    z
        .object({
            type: z.literal(ValidationType.WorkloadPlayback),
            enabled: z.boolean(),
            settings: SettingsSchema.default({}),
        })
        .passthrough(),
]);

const EnvironmentSchema = z
    .object({
        id: z.string().min(1).regex(ID_PATTERN),
        name: z.string().min(1),
        description: z.string().optional(),
        sourceOfTruth: SourceOfTruthSchema,
        validations: z.array(ValidationConfigSchema),
    })
    .passthrough();

const EnvironmentsFileSchema = z
    .object({
        schemaVersion: z.literal(ENVIRONMENTS_FILE_SCHEMA_VERSION),
        environments: z.array(EnvironmentSchema).superRefine(checkUniqueEnvIds),
    })
    .passthrough();

/**
 * `superRefine` hook: reject duplicate env ids. Duplicates are reported on
 * the second-or-later occurrence so the first env keeps its identity.
 */
function checkUniqueEnvIds(envs: { id: string }[], ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    envs.forEach((env, index) => {
        if (typeof env.id !== "string") {
            return;
        }
        if (seen.has(env.id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate id "${env.id}".`,
                path: [index, "id"],
            });
        } else {
            seen.add(env.id);
        }
    });
}

// =============================================================================
// Public entry point
// =============================================================================

/**
 * Validates `raw` as an `EnvironmentsFile`. On any rule violation, throws an
 * `EnvironmentsFileParseError` whose `issues` lists every problem found.
 */
export function validateEnvironmentsFile(raw: unknown, filePath: string): EnvironmentsFile {
    const result = EnvironmentsFileSchema.safeParse(raw);
    if (result.success) {
        return result.data as unknown as EnvironmentsFile;
    }
    const issues = mapZodErrorToIssues(result.error);
    const summary = issues.map((i) => `  • ${i.path}: ${i.message}`).join("\n");
    const err = new EnvironmentsFileParseError(
        filePath,
        `environments.json has ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${summary}`,
    );
    err.issues = issues;
    throw err;
}

// =============================================================================
// Zod -> EnvironmentsFileIssue adapter
// =============================================================================

function mapZodErrorToIssues(error: z.ZodError): EnvironmentsFileIssue[] {
    return error.issues.map((issue) => ({
        path: zodPathToJqPath(issue.path),
        message: issue.message,
        severity: "error" as const,
    }));
}

/** `["environments", 0, "id"]` -> `"$.environments[0].id"`. `[]` -> `"$"`. */
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
