/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    EnvironmentsFile,
} from "../../src/cloudDeploy/environments/types";
import { validateEnvironmentsFile } from "../../src/cloudDeploy/environments/environmentSchema";
import { EnvironmentsFileParseError } from "../../src/cloudDeploy/environments/environmentFile";

const FILE_PATH = "/tmp/environments.json";

function validEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "local-dev",
        name: "Local dev",
        sourceOfTruth: { kind: "sqlproj", path: "./db.sqlproj" },
        validations: [],
        ...overrides,
    };
}

function fileWith(...envs: unknown[]): unknown {
    return {
        schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
        environments: envs,
    };
}

function expectThrowsWithIssues(
    raw: unknown,
    assertIssues: (issues: { path: string; message: string }[]) => void,
): void {
    let caught: unknown;
    try {
        validateEnvironmentsFile(raw, FILE_PATH);
    } catch (err) {
        caught = err;
    }
    expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
    const issues = (caught as EnvironmentsFileParseError).issues;
    expect(issues, "expected issues[] to be populated").to.exist;
    assertIssues(issues!);
}

suite("CloudDeploy EnvironmentSchema", () => {
    suite("top-level shape", () => {
        test("rejects non-object root", () => {
            expectThrowsWithIssues("not an object", (issues) => {
                expect(issues.some((i) => i.path === "$")).to.be.true;
            });
        });

        test("rejects wrong schema version", () => {
            expectThrowsWithIssues({ schemaVersion: 99, environments: [] }, (issues) => {
                expect(issues.some((i) => i.path === "$.schemaVersion")).to.be.true;
            });
        });

        test("rejects when environments is not an array", () => {
            expectThrowsWithIssues(
                { schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION, environments: {} },
                (issues) => {
                    expect(issues.some((i) => i.path === "$.environments")).to.be.true;
                },
            );
        });

        test("accepts an empty environments array", () => {
            const result = validateEnvironmentsFile(fileWith(), FILE_PATH);
            expect(result.environments).to.deep.equal([]);
        });

        test("preserves unknown top-level fields (forward-compat)", () => {
            const raw = {
                schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
                environments: [],
                futureField: "ignored",
            };
            const result = validateEnvironmentsFile(raw, FILE_PATH) as EnvironmentsFile & {
                futureField?: string;
            };
            expect(result.futureField).to.equal("ignored");
        });
    });

    suite("per-environment fields", () => {
        test("accepts a minimal valid env (sqlproj source-of-truth)", () => {
            const result = validateEnvironmentsFile(fileWith(validEnv()), FILE_PATH);
            expect(result.environments).to.have.length(1);
            expect(result.environments[0].id).to.equal("local-dev");
        });

        test("rejects missing id", () => {
            expectThrowsWithIssues(fileWith(validEnv({ id: undefined })), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].id")).to.be.true;
            });
        });

        test("rejects id that violates the slug pattern", () => {
            expectThrowsWithIssues(fileWith(validEnv({ id: "has spaces" })), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].id")).to.be.true;
            });
        });

        test("rejects duplicate ids across envs", () => {
            const raw = fileWith(validEnv(), validEnv({ name: "second" }));
            expectThrowsWithIssues(raw, (issues) => {
                const dup = issues.find((i) => i.path === "$.environments[1].id");
                expect(dup, "expected duplicate-id issue on second env").to.exist;
                expect(dup!.message).to.match(/duplicate/i);
            });
        });

        test("rejects missing name", () => {
            expectThrowsWithIssues(fileWith(validEnv({ name: "" })), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].name")).to.be.true;
            });
        });

        test("rejects non-string description when present", () => {
            expectThrowsWithIssues(fileWith(validEnv({ description: 5 })), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].description")).to.be.true;
            });
        });

        test("does NOT require a top-level `kind` field (execution location is the runner's concern, not the env's)", () => {
            // Presence of stray `kind` should be ignored, not rejected.
            const result = validateEnvironmentsFile(
                fileWith(validEnv({ kind: "anything" })),
                FILE_PATH,
            );
            expect(result.environments).to.have.length(1);
        });

        test("does NOT require a top-level `connectionProfileId` field", () => {
            // The schema is the source of truth (Scope 2); the env itself carries
            // no top-level connection id.
            const env = validEnv();
            delete (env as Record<string, unknown>).connectionProfileId;
            const result = validateEnvironmentsFile(fileWith(env), FILE_PATH);
            expect(result.environments).to.have.length(1);
        });
    });

    suite("sourceOfTruth discriminated union", () => {
        test("accepts sqlproj with a path", () => {
            const env = validEnv({ sourceOfTruth: { kind: "sqlproj", path: "./db.sqlproj" } });
            const result = validateEnvironmentsFile(fileWith(env), FILE_PATH);
            expect(result.environments[0].sourceOfTruth).to.deep.equal({
                kind: "sqlproj",
                path: "./db.sqlproj",
            });
        });

        test("accepts dacpac with a path", () => {
            const env = validEnv({ sourceOfTruth: { kind: "dacpac", path: "./db.dacpac" } });
            const result = validateEnvironmentsFile(fileWith(env), FILE_PATH);
            expect(result.environments[0].sourceOfTruth.kind).to.equal("dacpac");
        });

        test("accepts a connection (live database) source with a profile id", () => {
            const env = validEnv({
                sourceOfTruth: { kind: "connection", connectionProfileId: "prod-db" },
            });
            const result = validateEnvironmentsFile(fileWith(env), FILE_PATH);
            expect(result.environments[0].sourceOfTruth).to.deep.equal({
                kind: "connection",
                connectionProfileId: "prod-db",
            });
        });

        test("rejects a connection source without a profile id", () => {
            const env = validEnv({ sourceOfTruth: { kind: "connection" } });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(
                    issues.some(
                        (i) => i.path === "$.environments[0].sourceOfTruth.connectionProfileId",
                    ),
                ).to.be.true;
            });
        });

        test("rejects sqlproj without a path", () => {
            const env = validEnv({ sourceOfTruth: { kind: "sqlproj" } });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].sourceOfTruth.path")).to.be
                    .true;
            });
        });

        test("rejects dacpac without a path", () => {
            const env = validEnv({ sourceOfTruth: { kind: "dacpac" } });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].sourceOfTruth.path")).to.be
                    .true;
            });
        });

        test("rejects an unknown sourceOfTruth.kind", () => {
            const env = validEnv({ sourceOfTruth: { kind: "ftp", path: "x" } });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].sourceOfTruth.kind")).to.be
                    .true;
            });
        });
    });

    suite("validations array (renamed from gates)", () => {
        test("accepts an env with no validations", () => {
            const result = validateEnvironmentsFile(
                fileWith(validEnv({ validations: [] })),
                FILE_PATH,
            );
            expect(result.environments[0].validations).to.deep.equal([]);
        });

        test("accepts each first-party validation type", () => {
            const env = validEnv({
                validations: [
                    { type: "static-analysis", enabled: true, settings: {} },
                    { type: "unit-tests", enabled: false, settings: {} },
                    { type: "workload-playback", enabled: true, settings: {} },
                ],
            });
            const result = validateEnvironmentsFile(fileWith(env), FILE_PATH);
            expect(result.environments[0].validations).to.have.length(3);
        });

        test("rejects when validations is not an array", () => {
            expectThrowsWithIssues(fileWith(validEnv({ validations: "nope" })), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].validations")).to.be.true;
            });
        });

        test("rejects an unknown validation type", () => {
            const env = validEnv({
                validations: [{ type: "drift-detection", enabled: true, settings: {} }],
            });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].validations[0].type")).to.be
                    .true;
            });
        });

        test("rejects non-boolean `enabled`", () => {
            const env = validEnv({
                validations: [{ type: "unit-tests", enabled: "yes", settings: {} }],
            });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].validations[0].enabled")).to
                    .be.true;
            });
        });

        test("rejects non-object `settings` when present", () => {
            const env = validEnv({
                validations: [{ type: "unit-tests", enabled: true, settings: 42 }],
            });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.some((i) => i.path === "$.environments[0].validations[0].settings"))
                    .to.be.true;
            });
        });
    });

    suite("accumulator behavior (all issues at once, not fail-fast)", () => {
        test("collects multiple per-env issues in one throw", () => {
            const env = validEnv({ id: "", name: "", validations: "nope" });
            expectThrowsWithIssues(fileWith(env), (issues) => {
                expect(issues.length).to.be.greaterThan(1);
            });
        });

        test("collects issues across multiple envs in one throw", () => {
            const raw = fileWith(validEnv({ id: "bad name" }), validEnv({ id: "" }));
            expectThrowsWithIssues(raw, (issues) => {
                const paths = issues.map((i) => i.path);
                expect(paths.some((p) => p.startsWith("$.environments[0]"))).to.be.true;
                expect(paths.some((p) => p.startsWith("$.environments[1]"))).to.be.true;
            });
        });
    });
});
