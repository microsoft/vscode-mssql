/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — dev-only sample run seeder.
 *
 * Builds a synthetic `RunRecord` with all four `ValidationType` arms
 * populated with rich findings (connectivity probe, static-analysis rule
 * violations with file:line locations, mixed-outcome unit tests, workload
 * regressions) and writes it through the live `RunArtifactWriter` so the
 * resulting `.cdrun.zip` round-trips through the same code path real runs
 * take. Used by the `mssql.cloudDeploy.seedSampleRun` command to populate
 * the hub for manual smoke testing without standing up real validators.
 */

import * as path from "path";
import { Environment, SourceOfTruthKind, ValidationType } from "../environments/types";
import { RUN_RECORD_SCHEMA_VERSION, RunRecord, RunStatus, ValidationStatus } from "../runs/types";
import { RunArtifactWriter } from "../runs/runArtifactWriter";

export interface SeedSampleRunResult {
    readonly path: string;
    readonly sizeBytes: number;
}

export async function seedSampleRun(
    writer: RunArtifactWriter,
    runsDirectory: string,
): Promise<SeedSampleRunResult> {
    const runId = generateRunId();
    const startedAtMs = Date.now() - 4_200;
    const env: Environment = {
        id: "sample-dev",
        name: "Sample Dev",
        description: "Synthetic env used by the seed-sample-run dev command.",
        sourceOfTruth: {
            kind: SourceOfTruthKind.Container,
            connectionProfileId: "sample-connection",
        },
        validations: [
            { type: ValidationType.Connectivity, enabled: true, settings: {} },
            { type: ValidationType.StaticAnalysis, enabled: true, settings: {} },
            { type: ValidationType.UnitTests, enabled: true, settings: {} },
            { type: ValidationType.WorkloadPlayback, enabled: true, settings: {} },
        ],
    };

    const record: RunRecord = {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId,
        environmentId: env.id,
        environmentSnapshot: env,
        runner: {
            userId: "local-vscode",
            displayName: "Local VS Code",
            hostKind: "vscode",
        },
        startedAtMs,
        endedAtMs: startedAtMs + 4_100,
        status: RunStatus.Failed,
        validations: [
            {
                validationId: "connectivity",
                displayName: "Connectivity",
                status: ValidationStatus.Passed,
                startedAtMs: startedAtMs,
                endedAtMs: startedAtMs + 320,
                payload: {
                    validationType: ValidationType.Connectivity,
                    findings: [
                        {
                            kind: "connectivity",
                            outcome: "reachable",
                            severity: "info",
                            message: "Probe query returned in 312 ms.",
                        },
                    ],
                    summary: {
                        reachable: true,
                        serverVersion: "Microsoft SQL Server 2022 (16.0.4135.4)",
                    },
                },
            },
            {
                validationId: "static-analysis",
                displayName: "Static analysis",
                status: ValidationStatus.Warning,
                startedAtMs: startedAtMs + 350,
                endedAtMs: startedAtMs + 1_180,
                payload: {
                    validationType: ValidationType.StaticAnalysis,
                    findings: [
                        {
                            kind: "static-analysis",
                            ruleId: "SR0001",
                            severity: "warning",
                            message: "Avoid SELECT *; list columns explicitly.",
                            location: {
                                file: "dbo/Procedures/GetCustomers.sql",
                                line: 14,
                                column: 12,
                            },
                        },
                        {
                            kind: "static-analysis",
                            ruleId: "SR0014",
                            severity: "warning",
                            message: "Procedure missing SET NOCOUNT ON.",
                            location: { file: "dbo/Procedures/GetOrders.sql", line: 3 },
                        },
                        {
                            kind: "static-analysis",
                            ruleId: "SR0044",
                            severity: "info",
                            message: "Consider adding a covering index on (CustomerId, OrderDate).",
                            location: { file: "dbo/Tables/Orders.sql", line: 22 },
                        },
                    ],
                    summary: { info: 1, warning: 2, error: 0 },
                },
            },
            {
                validationId: "unit-tests",
                displayName: "Unit tests",
                status: ValidationStatus.Failed,
                startedAtMs: startedAtMs + 1_200,
                endedAtMs: startedAtMs + 3_400,
                payload: {
                    validationType: ValidationType.UnitTests,
                    findings: [
                        {
                            kind: "unit-tests",
                            testName: "OrderTests.[creates order with valid customer]",
                            outcome: "passed",
                            durationMs: 142,
                        },
                        {
                            kind: "unit-tests",
                            testName: "OrderTests.[rejects negative quantity]",
                            outcome: "failed",
                            message:
                                "Expected error 50001 but procedure completed without raising.",
                            durationMs: 87,
                        },
                        {
                            kind: "unit-tests",
                            testName: "CustomerTests.[soft-deletes inactive customers]",
                            outcome: "skipped",
                            durationMs: 0,
                        },
                        {
                            kind: "unit-tests",
                            testName: "InventoryTests.[adjusts stock on shipment]",
                            outcome: "passed",
                            durationMs: 211,
                        },
                    ],
                    summary: { total: 4, passed: 2, failed: 1, skipped: 1, errored: 0 },
                },
            },
            {
                validationId: "workload-playback",
                displayName: "Workload playback",
                status: ValidationStatus.Warning,
                startedAtMs: startedAtMs + 3_420,
                endedAtMs: startedAtMs + 4_080,
                payload: {
                    validationType: ValidationType.WorkloadPlayback,
                    findings: [
                        {
                            kind: "workload-playback",
                            stepId: "step-007-customer-search",
                            regression: "latency",
                            delta: 0.34,
                            message: "p95 latency 34% above baseline (412 ms vs 308 ms).",
                        },
                        {
                            kind: "workload-playback",
                            stepId: "step-014-order-insert",
                            regression: "throughput",
                            delta: -0.18,
                            message: "Throughput dropped 18% under the same workload.",
                        },
                    ],
                    summary: { steps: 24, regressions: 2 },
                },
            },
        ],
    };

    const destPath = path.join(runsDirectory, `${runId}.cdrun.zip`);
    const result = await writer.write(record, undefined, destPath);
    return { path: result.path, sizeBytes: result.sizeBytes };
}

function generateRunId(): string {
    // Synthetic uuid-shaped id; doesn't need cryptographic uniqueness for a
    // local dev-only fixture.
    const hex = (n: number) =>
        Math.floor(Math.random() * 16 ** n)
            .toString(16)
            .padStart(n, "0");
    return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}
