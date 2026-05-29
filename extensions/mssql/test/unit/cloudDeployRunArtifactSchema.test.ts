/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunStatus,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";
import {
    RunArtifactParseError,
    validateRunRecord,
    validateValidationResult,
} from "../../src/cloudDeploy/runs/runArtifactSchema";
import { makeUnitTestsValidation, makeValidRunRecord } from "./cloudDeployRunsTestHelpers";

const FILE_PATH = "/tmp/run.cdrun.zip";

function expectThrows(raw: unknown, assert: (err: RunArtifactParseError) => void): void {
    let caught: unknown;
    try {
        validateRunRecord(raw, FILE_PATH);
    } catch (err) {
        caught = err;
    }
    expect(caught).to.be.instanceOf(RunArtifactParseError);
    assert(caught as RunArtifactParseError);
}

suite("CloudDeploy RunArtifactSchema", () => {
    suite("validateRunRecord — happy path", () => {
        test("accepts a minimal valid record", () => {
            const record = makeValidRunRecord();
            const validated = validateRunRecord(record, FILE_PATH);
            expect(validated.runId).to.equal("run-1");
            expect(validated.status).to.equal(RunStatus.Passed);
            expect(validated.validations).to.have.lengthOf(1);
        });

        test("preserves unknown top-level fields (forward-compat passthrough)", () => {
            const raw = { ...makeValidRunRecord(), futureField: "keep me" };
            const validated = validateRunRecord(raw, FILE_PATH) as unknown as Record<
                string,
                unknown
            >;
            expect(validated.futureField).to.equal("keep me");
        });

        test("accepts an empty validations array", () => {
            const record = makeValidRunRecord({ validations: [] });
            const validated = validateRunRecord(record, FILE_PATH);
            expect(validated.validations).to.deep.equal([]);
        });
    });

    suite("validateRunRecord — schemaVersion gate", () => {
        test("rejects an unknown forward schemaVersion with kind 'unknown-schema-version'", () => {
            const raw = { ...makeValidRunRecord(), schemaVersion: 99 };
            expectThrows(raw, (err) => {
                expect(err.kind).to.equal("unknown-schema-version");
                expect(err.schemaVersion).to.equal(99);
                expect(err.issues).to.be.undefined;
            });
        });

        test("rejects a missing schemaVersion via schema-validation, not version gate", () => {
            const raw = { ...makeValidRunRecord() } as Record<string, unknown>;
            delete raw.schemaVersion;
            expectThrows(raw, (err) => {
                expect(err.kind).to.equal("schema-validation");
                expect(err.issues).to.exist;
                expect(err.issues!.some((i) => i.path === "$.schemaVersion")).to.be.true;
            });
        });
    });

    suite("validateRunRecord — shape errors collect every issue", () => {
        test("rejects non-object root", () => {
            expectThrows("not an object", (err) => {
                expect(err.kind).to.equal("schema-validation");
                expect(err.issues!.some((i) => i.path === "$")).to.be.true;
            });
        });

        test("flags every missing required top-level field at once", () => {
            expectThrows({ schemaVersion: RUN_RECORD_SCHEMA_VERSION }, (err) => {
                const paths = new Set((err.issues ?? []).map((i) => i.path));
                expect(paths).to.include("$.runId");
                expect(paths).to.include("$.environmentId");
                expect(paths).to.include("$.environmentSnapshot");
                expect(paths).to.include("$.runner");
                expect(paths).to.include("$.startedAtMs");
                expect(paths).to.include("$.endedAtMs");
                expect(paths).to.include("$.status");
                expect(paths).to.include("$.validations");
            });
        });

        test("rejects environmentSnapshot.id mismatching environmentId", () => {
            const record = makeValidRunRecord({ environmentId: "different" });
            expectThrows(record, (err) => {
                expect(err.kind).to.equal("schema-validation");
                expect(err.issues!.some((i) => i.path === "$.environmentSnapshot.id")).to.be.true;
            });
        });

        test("rejects endedAtMs < startedAtMs", () => {
            const record = makeValidRunRecord({ startedAtMs: 5_000, endedAtMs: 1_000 });
            expectThrows(record, (err) => {
                expect(err.issues!.some((i) => i.path === "$.endedAtMs")).to.be.true;
            });
        });

        test("rejects an unknown run status", () => {
            const record = { ...makeValidRunRecord(), status: "not-a-status" };
            expectThrows(record, (err) => {
                expect(err.issues!.some((i) => i.path === "$.status")).to.be.true;
            });
        });
    });

    suite("validateRunRecord — validation payload discrimination", () => {
        test("narrows by validationType (UnitTests payload accepted)", () => {
            const record = makeValidRunRecord({
                validations: [
                    makeUnitTestsValidation({
                        payload: {
                            validationType: ValidationType.UnitTests,
                            findings: [
                                {
                                    kind: "unit-tests",
                                    testName: "suite.it works",
                                    outcome: "passed",
                                },
                            ],
                            summary: {
                                total: 1,
                                passed: 1,
                                failed: 0,
                                skipped: 0,
                                errored: 0,
                            },
                        },
                    }),
                ],
            });
            const validated = validateRunRecord(record, FILE_PATH);
            expect(validated.validations[0].payload.validationType).to.equal(
                ValidationType.UnitTests,
            );
        });

        test("rejects a payload whose finding kind doesn't match validationType", () => {
            const record = makeValidRunRecord({
                validations: [
                    makeUnitTestsValidation({
                        payload: {
                            validationType: ValidationType.UnitTests,
                            // wrong finding kind for this payload
                            findings: [
                                {
                                    kind: "static-analysis",
                                    ruleId: "rule-1",
                                    severity: "error",
                                    message: "oops",
                                } as never,
                            ],
                            summary: {
                                total: 0,
                                passed: 0,
                                failed: 0,
                                skipped: 0,
                                errored: 0,
                            },
                        },
                    }),
                ],
            });
            expectThrows(record, (err) => {
                expect(err.kind).to.equal("schema-validation");
                // Reports under the validation's findings array.
                expect(
                    err.issues!.some((i) =>
                        i.path.startsWith("$.validations[0].payload.findings[0]"),
                    ),
                ).to.be.true;
            });
        });

        test("rejects an unknown validationType discriminator", () => {
            const record = makeValidRunRecord({
                validations: [
                    {
                        validationId: "v",
                        displayName: "v",
                        status: ValidationStatus.Passed,
                        startedAtMs: 0,
                        endedAtMs: 0,
                        payload: {
                            validationType: "bogus",
                            findings: [],
                            summary: {},
                        } as never,
                    },
                ],
            });
            expectThrows(record, (err) => {
                expect(err.issues!.some((i) => i.path.startsWith("$.validations[0].payload"))).to.be
                    .true;
            });
        });
    });

    suite("validateValidationResult", () => {
        test("accepts a valid single result", () => {
            const result = validateValidationResult(makeUnitTestsValidation(), FILE_PATH);
            expect(result.validationId).to.equal("unit-tests-1");
        });

        test("throws schema-validation error on a malformed result", () => {
            let caught: unknown;
            try {
                validateValidationResult({ validationId: 1 }, FILE_PATH);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(RunArtifactParseError);
            expect((caught as RunArtifactParseError).kind).to.equal("schema-validation");
        });
    });
});
