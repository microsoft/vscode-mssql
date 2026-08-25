/**
 * Runtime JSON Schema validation (ajv, draft 2020-12) for the three perf
 * contracts. Schemas are loaded from the package's schemas/ directory so the
 * JSON files remain the single source of truth.
 */

import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction, ErrorObject } from "ajv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Marker } from "./marker";
import type { PerfResult } from "./result";
import type { PerfConfig } from "./config";

export interface ValidationOutcome {
    valid: boolean;
    errors: string[];
}

export type ContractName = "marker" | "perf-config" | "perf-result";

const SCHEMA_DIR = join(__dirname, "..", "schemas");

const SCHEMA_FILES: Record<ContractName, string> = {
    marker: "marker.schema.json",
    "perf-config": "perf-config.schema.json",
    "perf-result": "perf-result.schema.json",
};

let ajv: Ajv2020 | undefined;
const compiled = new Map<ContractName, ValidateFunction>();

function getValidator(name: ContractName): ValidateFunction {
    const cached = compiled.get(name);
    if (cached) {
        return cached;
    }
    if (!ajv) {
        ajv = new Ajv2020({ allErrors: true, strict: false });
    }
    const schemaPath = join(SCHEMA_DIR, SCHEMA_FILES[name]);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const validator = ajv.compile(schema);
    compiled.set(name, validator);
    return validator;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
    if (!errors) {
        return [];
    }
    return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

export function validateContract(name: ContractName, data: unknown): ValidationOutcome {
    const validator = getValidator(name);
    const valid = validator(data) === true;
    return { valid, errors: valid ? [] : formatErrors(validator.errors) };
}

export function validateMarker(data: unknown): ValidationOutcome {
    return validateContract("marker", data);
}

export function isMarker(data: unknown): data is Marker {
    return validateMarker(data).valid;
}

export function validateConfig(data: unknown): ValidationOutcome {
    return validateContract("perf-config", data);
}

export function isConfig(data: unknown): data is PerfConfig {
    return validateConfig(data).valid;
}

export function validateResult(data: unknown): ValidationOutcome {
    return validateContract("perf-result", data);
}

export function isResult(data: unknown): data is PerfResult {
    return validateResult(data).valid;
}

/** Absolute path of a bundled schema file (for `perftest schema validate`). */
export function schemaPath(name: ContractName): string {
    return join(SCHEMA_DIR, SCHEMA_FILES[name]);
}

/** Absolute path of the bundled SQLite store schema. */
export function sqliteSchemaPath(): string {
    return join(__dirname, "..", "sql", "perf-store.schema.sql");
}

/**
 * Absolute paths of the bundled central-store SQL files, in apply order
 * (schema -> procedures -> views -> roles). `perftest central init/migrate`
 * executes these; they are idempotent (IF NULL guards + CREATE OR ALTER).
 */
export function centralSchemaPaths(): string[] {
    const sqlDir = join(__dirname, "..", "sql");
    return [
        join(sqlDir, "central-store.schema.mssql.sql"),
        join(sqlDir, "central-store.procedures.sql"),
        join(sqlDir, "central-store.views.sql"),
        join(sqlDir, "central-store.roles.sql"),
    ];
}
