/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — environment schema validator.
 *
 * Hand-rolled validator. Walks a parsed JSON value and either returns a typed
 * `EnvironmentsFile` or throws `EnvironmentsFileParseError` with a list of every
 * issue found (collect-all, not fail-fast).
 *
 * Unknown fields are preserved (forward-compat). Path/connection existence
 * checks live elsewhere — this validator only checks file shape.
 */

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

/** A single validation problem. `path` is a JSON-pointer-ish string. */
export interface EnvironmentsFileIssue {
    path: string;
    message: string;
    severity: "error";
}

// =============================================================================
// Public entry point
// =============================================================================

/**
 * Validates `raw` as an `EnvironmentsFile`. On any rule violation, throws an
 * `EnvironmentsFileParseError` whose `issues` lists every problem found.
 */
export function validateEnvironmentsFile(raw: unknown, filePath: string): EnvironmentsFile {
    const issues: EnvironmentsFileIssue[] = [];

    if (!isPlainObject(raw)) {
        issues.push(error("$", "Expected top-level object."));
        throwIfIssues(filePath, issues);
        // unreachable, but narrows type for the rest of the function
        throw new Error("unreachable");
    }

    if (raw.schemaVersion !== ENVIRONMENTS_FILE_SCHEMA_VERSION) {
        issues.push(
            error(
                "$.schemaVersion",
                `Expected ${ENVIRONMENTS_FILE_SCHEMA_VERSION}, got ${formatValue(raw.schemaVersion)}.`,
            ),
        );
    }

    if (!Array.isArray(raw.environments)) {
        issues.push(error("$.environments", "Expected an array."));
        throwIfIssues(filePath, issues);
        throw new Error("unreachable");
    }

    const seenIds = new Set<string>();
    raw.environments.forEach((env, index) => {
        const envPath = `$.environments[${index}]`;
        validateEnvironment(env, envPath, issues, seenIds);
    });

    throwIfIssues(filePath, issues);
    return raw as unknown as EnvironmentsFile;
}

// =============================================================================
// Per-env validation
// =============================================================================

const VALIDATION_TYPES: readonly ValidationType[] = [
    ValidationType.StaticAnalysis,
    ValidationType.UnitTests,
    ValidationType.WorkloadPlayback,
];
const SOURCE_OF_TRUTH_KINDS: readonly SourceOfTruthKind[] = [
    SourceOfTruthKind.SqlProj,
    SourceOfTruthKind.Dacpac,
    SourceOfTruthKind.Container,
];
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function validateEnvironment(
    raw: unknown,
    envPath: string,
    issues: EnvironmentsFileIssue[],
    seenIds: Set<string>,
): void {
    if (!isPlainObject(raw)) {
        issues.push(error(envPath, "Expected an object."));
        return;
    }

    // id
    if (!isNonEmptyString(raw.id)) {
        issues.push(error(`${envPath}.id`, "Expected a non-empty string."));
    } else if (!ID_PATTERN.test(raw.id)) {
        issues.push(
            error(`${envPath}.id`, `Must match ${ID_PATTERN} (letters, digits, dash, underscore).`),
        );
    } else if (seenIds.has(raw.id)) {
        issues.push(error(`${envPath}.id`, `Duplicate id "${raw.id}".`));
    } else {
        seenIds.add(raw.id);
    }

    // name
    if (!isNonEmptyString(raw.name)) {
        issues.push(error(`${envPath}.name`, "Expected a non-empty string."));
    }

    // description (optional)
    if (raw.description !== undefined && typeof raw.description !== "string") {
        issues.push(error(`${envPath}.description`, "Expected a string if present."));
    }

    // sourceOfTruth
    validateSourceOfTruth(raw.sourceOfTruth, `${envPath}.sourceOfTruth`, issues);

    // validations
    if (!Array.isArray(raw.validations)) {
        issues.push(error(`${envPath}.validations`, "Expected an array."));
    } else {
        raw.validations.forEach((v, i) => {
            validateValidationConfig(v, `${envPath}.validations[${i}]`, issues);
        });
    }
}

function validateSourceOfTruth(raw: unknown, path: string, issues: EnvironmentsFileIssue[]): void {
    if (!isPlainObject(raw)) {
        issues.push(error(path, "Expected an object."));
        return;
    }

    const kind = raw.kind;
    if (kind === SourceOfTruthKind.SqlProj || kind === SourceOfTruthKind.Dacpac) {
        if (!isNonEmptyString(raw.path)) {
            issues.push(error(`${path}.path`, "Expected a non-empty string."));
        }
        return;
    }
    if (kind === SourceOfTruthKind.Container) {
        if (!isNonEmptyString(raw.connectionProfileId)) {
            issues.push(error(`${path}.connectionProfileId`, "Expected a non-empty string."));
        }
        return;
    }
    issues.push(
        error(
            `${path}.kind`,
            `Expected one of ${SOURCE_OF_TRUTH_KINDS.map((k) => `"${k}"`).join(", ")}.`,
        ),
    );
}

function validateValidationConfig(
    raw: unknown,
    path: string,
    issues: EnvironmentsFileIssue[],
): void {
    if (!isPlainObject(raw)) {
        issues.push(error(path, "Expected an object."));
        return;
    }
    if (!isOneOf(raw.type, VALIDATION_TYPES)) {
        issues.push(
            error(
                `${path}.type`,
                `Expected one of ${VALIDATION_TYPES.map((t) => `"${t}"`).join(", ")}.`,
            ),
        );
    }
    if (typeof raw.enabled !== "boolean") {
        issues.push(error(`${path}.enabled`, "Expected a boolean."));
    }
    if (raw.settings === undefined) {
        // `settings` is required by the typed model; default to an empty object for forwards/backwards compat.
        raw.settings = {};
    } else if (!isPlainObject(raw.settings)) {
        issues.push(error(`${path}.settings`, "Expected an object."));
    }
}

// =============================================================================
// Helpers
// =============================================================================

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

function isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
    return typeof v === "string" && (options as readonly string[]).includes(v);
}

function error(path: string, message: string): EnvironmentsFileIssue {
    return { path, message, severity: "error" };
}

function formatValue(v: unknown): string {
    if (v === undefined) {
        return "undefined";
    }
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

function throwIfIssues(filePath: string, issues: EnvironmentsFileIssue[]): void {
    if (issues.length === 0) {
        return;
    }
    const summary = issues.map((i) => `  • ${i.path}: ${i.message}`).join("\n");
    const err = new EnvironmentsFileParseError(
        filePath,
        `environments.json has ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${summary}`,
    );
    err.issues = issues;
    throw err;
}
