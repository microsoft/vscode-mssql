/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { compareRuns } from "../../src/cloudDeploy/runs/runComparison";
import { RunStatus, ValidationStatus } from "../../src/cloudDeploy/runs/types";
import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { makeUnitTestsValidation, makeValidRunRecord } from "./cloudDeployRunsTestHelpers";

suite("CloudDeploy runComparison", () => {
    suite("validation pairing", () => {
        test("pairs validations present in both runs as 'both'", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            const result = compareRuns(a, b);
            expect(result.validations).to.have.length(1);
            expect(result.validations[0].presence).to.equal("both");
        });

        test("marks a validation only in run A as 'only-a'", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "only-in-a" })],
            });
            const b = makeValidRunRecord({ runId: "b", validations: [] });
            const result = compareRuns(a, b);
            expect(result.validations).to.have.length(1);
            expect(result.validations[0].presence).to.equal("only-a");
        });

        test("marks a validation only in run B as 'only-b'", () => {
            const a = makeValidRunRecord({ runId: "a", validations: [] });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [makeUnitTestsValidation({ validationId: "only-in-b" })],
            });
            const result = compareRuns(a, b);
            expect(result.validations).to.have.length(1);
            expect(result.validations[0].presence).to.equal("only-b");
        });

        test("emits run A validations before validations unique to run B", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "shared" })],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [
                    makeUnitTestsValidation({ validationId: "shared" }),
                    makeUnitTestsValidation({ validationId: "b-only" }),
                ],
            });
            const result = compareRuns(a, b);
            expect(result.validations.map((v) => v.validationId)).to.deep.equal([
                "shared",
                "b-only",
            ]);
        });
    });

    suite("status delta", () => {
        test("flags statusChanged when the paired statuses differ", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [
                    makeUnitTestsValidation({
                        validationId: "v1",
                        status: ValidationStatus.Passed,
                    }),
                ],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [
                    makeUnitTestsValidation({
                        validationId: "v1",
                        status: ValidationStatus.Failed,
                    }),
                ],
            });
            const result = compareRuns(a, b);
            expect(result.validations[0].statusChanged).to.equal(true);
            expect(result.validations[0].statusA).to.equal(ValidationStatus.Passed);
            expect(result.validations[0].statusB).to.equal(ValidationStatus.Failed);
        });

        test("does not flag statusChanged when statuses match", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            expect(compareRuns(a, b).validations[0].statusChanged).to.equal(false);
        });
    });

    suite("finding and duration deltas", () => {
        test("computes a positive finding-count delta when run B has more findings", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [
                    makeUnitTestsValidation({
                        validationId: "v1",
                        payload: {
                            validationType: ValidationType.UnitTests,
                            findings: [
                                {
                                    kind: "unit-tests",
                                    testName: "t1",
                                    outcome: "failed",
                                },
                            ],
                            summary: { total: 1, passed: 0, failed: 1, skipped: 0, errored: 0 },
                        },
                    }),
                ],
            });
            const delta = compareRuns(a, b).validations[0];
            expect(delta.findingCountA).to.equal(0);
            expect(delta.findingCountB).to.equal(1);
            expect(delta.findingCountDelta).to.equal(1);
        });

        test("computes the duration delta as B duration minus A duration", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [
                    makeUnitTestsValidation({
                        validationId: "v1",
                        startedAtMs: 0,
                        endedAtMs: 1_000,
                    }),
                ],
            });
            const b = makeValidRunRecord({
                runId: "b",
                validations: [
                    makeUnitTestsValidation({
                        validationId: "v1",
                        startedAtMs: 0,
                        endedAtMs: 3_500,
                    }),
                ],
            });
            expect(compareRuns(a, b).validations[0].durationDeltaMs).to.equal(2_500);
        });

        test("leaves durationDeltaMs undefined when a validation is one-sided", () => {
            const a = makeValidRunRecord({
                runId: "a",
                validations: [makeUnitTestsValidation({ validationId: "v1" })],
            });
            const b = makeValidRunRecord({ runId: "b", validations: [] });
            expect(compareRuns(a, b).validations[0].durationDeltaMs).to.equal(undefined);
        });
    });

    suite("run-level metadata", () => {
        test("carries both run ids, statuses, and environment names", () => {
            const a = makeValidRunRecord({
                runId: "run-a",
                status: RunStatus.Passed,
                environmentSnapshot: { ...makeValidRunRecord().environmentSnapshot, name: "Dev" },
            });
            const b = makeValidRunRecord({
                runId: "run-b",
                status: RunStatus.Failed,
                environmentSnapshot: { ...makeValidRunRecord().environmentSnapshot, name: "Prod" },
            });
            const result = compareRuns(a, b);
            expect(result.runIdA).to.equal("run-a");
            expect(result.runIdB).to.equal("run-b");
            expect(result.statusA).to.equal(RunStatus.Passed);
            expect(result.statusB).to.equal(RunStatus.Failed);
            expect(result.environmentNameA).to.equal("Dev");
            expect(result.environmentNameB).to.equal("Prod");
        });
    });
});
