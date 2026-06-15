/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run-tests shared helpers.
 *
 * Reusable plumbing for D3 unit tests:
 *   * `FakeFileProvider`: in-memory `FileProvider` so writer/reader round
 *     trips happen with zero disk I/O. Mirrors `LocalFileProvider` semantics
 *     (ENOENT shape on missing reads; "atomic" writes are trivially atomic
 *     in memory).
 *   * `makeValidRunRecord`: tiny builder for a passing `RunRecord` that
 *     satisfies the Zod schema. Tests override only the fields they care
 *     about so the noise stays out of each individual test.
 */

import { FileProvider } from "../../src/cloudDeploy/providers";
import {
    SourceOfTruthKind,
    ValidationType,
    Environment,
} from "../../src/cloudDeploy/environments/types";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunRecord,
    RunStatus,
    ValidationResult,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";

// =============================================================================
// FakeFileProvider
// =============================================================================

/**
 * In-memory `FileProvider`. Exposes the raw `files` map so tests can seed
 * arbitrary bytes (e.g. corrupt zip content) without going through the
 * write API.
 */
export class FakeFileProvider implements FileProvider {
    public readonly files: Map<string, Buffer> = new Map();

    public async readFileBuffer(filePath: string): Promise<Buffer> {
        const data = this.files.get(filePath);
        if (data === undefined) {
            const err: NodeJS.ErrnoException = new Error(
                `ENOENT: no such file or directory, open '${filePath}'`,
            );
            err.code = "ENOENT";
            throw err;
        }
        // Return a copy so callers can't mutate the seeded buffer.
        return Buffer.from(data);
    }

    public async writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
        // Copy on write so callers reusing the buffer don't mutate stored state.
        this.files.set(filePath, Buffer.from(data));
    }

    public async fileExists(filePath: string): Promise<boolean> {
        return this.files.has(filePath);
    }
}

// =============================================================================
// Builders
// =============================================================================

export function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
    return {
        id: "env-1",
        name: "Env 1",
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "proj/Project.sqlproj" },
        validations: [],
        ...overrides,
    };
}

export function makeUnitTestsValidation(
    overrides: Partial<ValidationResult> = {},
): ValidationResult {
    return {
        validationId: "unit-tests-1",
        displayName: "Unit Tests",
        status: ValidationStatus.Passed,
        startedAtMs: 1_000,
        endedAtMs: 2_000,
        payload: {
            validationType: ValidationType.UnitTests,
            findings: [],
            summary: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 },
        },
        ...overrides,
    };
}

/**
 * Builds a minimal valid `RunRecord`. Override only the fields you need;
 * the defaults satisfy the Zod schema as-is.
 */
export function makeValidRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
    const env = overrides.environmentSnapshot ?? makeEnvironment();
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: "run-1",
        environmentId: env.id,
        environmentSnapshot: env,
        runner: {
            userId: "user-1",
            displayName: "Test User",
            hostKind: "vscode",
        },
        startedAtMs: 1_000,
        endedAtMs: 5_000,
        status: RunStatus.Passed,
        validations: [makeUnitTestsValidation()],
        ...overrides,
    };
}
