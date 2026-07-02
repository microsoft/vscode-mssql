/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { buildPrReport, PR_COMMENT_MARKER } from "../../src/cloudDeploy/ci/prReporter";
import { RunComparison, ValidationDelta } from "../../src/cloudDeploy/runs/runComparison";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunRecord,
    RunStatus,
    SourceVersion,
    ValidationResult,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";
import {
    Environment,
    SourceOfTruthKind,
    ValidationType,
} from "../../src/cloudDeploy/environments/types";

const ENV: Environment = {
    id: "ci",
    name: "ci-env",
    sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "p.sqlproj" },
    validations: [],
};

function makeValidation(displayName: string, status: ValidationStatus): ValidationResult {
    return {
        validationId: displayName,
        displayName,
        status,
        startedAtMs: 0,
        endedAtMs: 1,
        payload: {
            validationType: ValidationType.StaticAnalysis,
            findings: [],
            summary: { info: 0, warning: 0, error: 0 },
        },
    };
}

function makeRecord(
    status: RunStatus,
    validations: ValidationResult[] = [],
    sourceVersion?: SourceVersion,
): RunRecord {
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: "r1",
        environmentId: ENV.id,
        environmentSnapshot: ENV,
        runner: { userId: "u", displayName: "u", hostKind: "github-actions" },
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        startedAtMs: 0,
        endedAtMs: 1,
        status,
        validations,
    };
}

function makeDelta(over: Partial<ValidationDelta> & { validationId: string }): ValidationDelta {
    return {
        displayName: over.validationId,
        presence: "both",
        statusChanged: false,
        findingCountA: 0,
        findingCountB: 0,
        findingCountDelta: 0,
        ...over,
    };
}

function makeComparison(validations: ValidationDelta[]): RunComparison {
    return {
        runIdA: "base",
        runIdB: "pr",
        statusA: RunStatus.Passed,
        statusB: RunStatus.Passed,
        startedAtMsA: 0,
        startedAtMsB: 0,
        environmentNameA: "ci-env",
        environmentNameB: "ci-env",
        validations,
    };
}

suite("CloudDeploy PR reporter", () => {
    suite("conclusion", () => {
        test("a passing run concludes success", () => {
            expect(buildPrReport(makeRecord(RunStatus.Passed)).conclusion).to.equal("success");
        });

        test("a warning run still concludes success", () => {
            expect(buildPrReport(makeRecord(RunStatus.Warning)).conclusion).to.equal("success");
        });

        test("a failed run concludes failure", () => {
            const report = buildPrReport(makeRecord(RunStatus.Failed));
            expect(report.conclusion).to.equal("failure");
            expect(report.title).to.contain("failed");
        });

        test("an errored run concludes failure", () => {
            expect(buildPrReport(makeRecord(RunStatus.Errored)).conclusion).to.equal("failure");
        });

        test("a cancelled run concludes neutral", () => {
            expect(buildPrReport(makeRecord(RunStatus.Cancelled)).conclusion).to.equal("neutral");
        });
    });

    suite("comment body", () => {
        test("leads with the sticky marker and a heading", () => {
            const body = buildPrReport(makeRecord(RunStatus.Passed)).commentBody;
            expect(body.startsWith(PR_COMMENT_MARKER)).to.be.true;
            expect(body).to.contain("Cloud Deploy — schema validation");
        });

        test("renders a flat result table when there is no baseline", () => {
            const record = makeRecord(RunStatus.Passed, [
                makeValidation("Connectivity", ValidationStatus.Passed),
            ]);
            const body = buildPrReport(record).commentBody;
            expect(body).to.contain("| Gate | Result |");
            expect(body).to.contain("Connectivity");
            expect(body).to.contain("Pass");
        });

        test("describes the source ref and short commit when present", () => {
            const record = makeRecord(RunStatus.Passed, [], {
                hash: "sha256:abc",
                algorithm: "sha256",
                commitId: "deadbeefcafe",
                ref: "refs/pull/42/merge",
            });
            const body = buildPrReport(record).commentBody;
            expect(body).to.contain("refs/pull/42/merge");
            expect(body).to.contain("deadbee");
        });
    });

    suite("comparison table", () => {
        test("renders This PR / base columns when a comparison is given", () => {
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Connectivity",
                    statusA: ValidationStatus.Passed,
                    statusB: ValidationStatus.Passed,
                }),
            ]);
            const body = buildPrReport(makeRecord(RunStatus.Passed), comparison).commentBody;
            expect(body).to.contain("| Gate | This PR | base | Δ |");
        });

        test("calls out a status regression introduced by the candidate", () => {
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Workload",
                    statusA: ValidationStatus.Passed,
                    statusB: ValidationStatus.Warning,
                    statusChanged: true,
                    durationDeltaMs: 38,
                }),
            ]);
            const body = buildPrReport(makeRecord(RunStatus.Warning), comparison).commentBody;
            expect(body).to.contain("gate(s) regressed");
            expect(body).to.contain("+38 ms");
        });

        test("flags a finding-count increase as a regression", () => {
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Static analysis",
                    statusA: ValidationStatus.Passed,
                    statusB: ValidationStatus.Passed,
                    findingCountDelta: 2,
                }),
            ]);
            const body = buildPrReport(makeRecord(RunStatus.Passed), comparison).commentBody;
            expect(body).to.contain("+2 finding(s)");
            expect(body).to.contain("gate(s) regressed");
        });

        test("does not flag a regression when nothing got worse", () => {
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Connectivity",
                    statusA: ValidationStatus.Passed,
                    statusB: ValidationStatus.Passed,
                }),
            ]);
            const body = buildPrReport(makeRecord(RunStatus.Passed), comparison).commentBody;
            expect(body).to.contain("no regressions");
            expect(body).to.not.contain("regressed");
        });

        test("labels a gate that only exists on the candidate side as new", () => {
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Workload",
                    presence: "only-b",
                    statusB: ValidationStatus.Passed,
                }),
            ]);
            const body = buildPrReport(makeRecord(RunStatus.Passed), comparison).commentBody;
            expect(body).to.contain("new gate");
        });
    });

    suite("what changed detail", () => {
        test("spells out static-analysis findings for a failing gate", () => {
            const record = makeRecord(RunStatus.Failed, [
                {
                    validationId: "Static Analysis",
                    displayName: "Static Analysis",
                    status: ValidationStatus.Failed,
                    startedAtMs: 0,
                    endedAtMs: 1,
                    payload: {
                        validationType: ValidationType.StaticAnalysis,
                        findings: [
                            {
                                kind: "static-analysis",
                                ruleId: "SQL71502",
                                severity: "error",
                                message: "Unresolved reference to [dbo].[Reactions].",
                                location: { file: "db/GetChannelMessages.sql", line: 13 },
                            },
                        ],
                        summary: { info: 0, warning: 0, error: 1 },
                    },
                },
            ]);
            const body = buildPrReport(record).commentBody;
            expect(body).to.contain("### What changed");
            expect(body).to.contain("SQL71502");
            expect(body).to.contain("Unresolved reference to [dbo].[Reactions].");
            expect(body).to.contain("db/GetChannelMessages.sql:13");
        });

        test("annotates the prior status when a baseline is available", () => {
            const record = makeRecord(RunStatus.Failed, [
                makeValidation("Static Analysis", ValidationStatus.Failed),
            ]);
            const comparison = makeComparison([
                makeDelta({
                    validationId: "Static Analysis",
                    statusA: ValidationStatus.Passed,
                    statusB: ValidationStatus.Failed,
                    statusChanged: true,
                }),
            ]);
            const body = buildPrReport(record, comparison).commentBody;
            expect(body).to.contain("(was Pass)");
        });

        test("omits the What changed section when every gate passed", () => {
            const record = makeRecord(RunStatus.Passed, [
                makeValidation("Connectivity", ValidationStatus.Passed),
            ]);
            const body = buildPrReport(record).commentBody;
            expect(body).to.not.contain("### What changed");
        });

        test("always includes a collapsible full-results section", () => {
            const record = makeRecord(RunStatus.Passed, [
                makeValidation("Connectivity", ValidationStatus.Passed),
            ]);
            const body = buildPrReport(record).commentBody;
            expect(body).to.contain("<details>");
            expect(body).to.contain("Full results");
        });
    });
});
