/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";

import {
    Environment,
    EnvironmentsFile,
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    SourceOfTruthKind,
    ValidationType,
} from "../../src/cloudDeploy/environments/types";
import { EnvironmentsFileParseError } from "../../src/cloudDeploy/environments/environmentSchema";
import { FileProvider } from "../../src/cloudDeploy/providers";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunRecord,
    RunStatus,
    SourceVersion,
    ValidationStatus,
    WorkloadObservedStep,
} from "../../src/cloudDeploy/runs/types";
import {
    exitCodeFor,
    runGates,
    RunGatesDeps,
    RunGatesIo,
    stampSourceLabels,
    WorkloadBaselineLookup,
} from "../../src/cloudDeploy/cli/runGates";

const REQUIRED_ARGS = ["--env", "dev", "--config", "c.json", "--out", "o.zip"] as const;

/** In-memory `FileProvider` that records every `writeFileAtomic`. */
class RecordingFileProvider implements FileProvider {
    public readonly writes: Array<{ path: string; data: Buffer }> = [];

    public async readFileBuffer(): Promise<Buffer> {
        throw new Error("readFileBuffer is not used by run-gates");
    }

    public async writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
        this.writes.push({ path: filePath, data });
    }

    public async fileExists(): Promise<boolean> {
        return false;
    }
}

function makeEnv(id: string): Environment {
    return {
        id,
        name: id,
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "proj/Project.sqlproj" },
        validations: [],
    };
}

function makeFile(...envs: Environment[]): EnvironmentsFile {
    return { schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION, environments: envs };
}

function makeRecord(status: RunStatus, sourceVersion?: SourceVersion): RunRecord {
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: "cli-test-run",
        environmentId: "dev",
        environmentSnapshot: makeEnv("dev"),
        runner: {
            userId: "cloud-deploy-cli",
            displayName: "Cloud Deploy CLI",
            hostKind: "github-actions",
        },
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        startedAtMs: 1,
        endedAtMs: 2,
        status,
        validations: [],
    };
}

function captureIo(): { io: RunGatesIo; out: () => string; err: () => string } {
    let outText = "";
    let errText = "";
    const io: RunGatesIo = {
        out: {
            write: (chunk: string) => {
                outText += chunk;
                return true;
            },
        } as unknown as NodeJS.WritableStream,
        err: {
            write: (chunk: string) => {
                errText += chunk;
                return true;
            },
        } as unknown as NodeJS.WritableStream,
    };
    return { io, out: () => outText, err: () => errText };
}

function makeDeps(overrides: Partial<RunGatesDeps> = {}): RunGatesDeps {
    return {
        fileProvider: new RecordingFileProvider(),
        loadEnvironments: async () => makeFile(makeEnv("dev")),
        runValidation: async () => makeRecord(RunStatus.Passed),
        loadRunArtifact: async () => makeRecord(RunStatus.Passed),
        ...overrides,
    };
}

suite("CloudDeploy CLI runGates", () => {
    suite("exitCodeFor", () => {
        test("maps Passed, Skipped, and Warning to 0", () => {
            expect(exitCodeFor(RunStatus.Passed)).to.equal(0);
            expect(exitCodeFor(RunStatus.Skipped)).to.equal(0);
            expect(exitCodeFor(RunStatus.Warning)).to.equal(0);
        });

        test("maps Failed and Errored to 1", () => {
            expect(exitCodeFor(RunStatus.Failed)).to.equal(1);
            expect(exitCodeFor(RunStatus.Errored)).to.equal(1);
        });

        test("maps Cancelled to 130", () => {
            expect(exitCodeFor(RunStatus.Cancelled)).to.equal(130);
        });
    });

    suite("argument handling", () => {
        test("prints usage to stdout and returns 0 for --help", async () => {
            const { io, out } = captureIo();
            const code = await runGates(["--help"], makeDeps(), io);
            expect(code).to.equal(0);
            expect(out()).to.contain("Usage:");
        });

        test("prints an error to stderr and returns 2 for an unknown flag", async () => {
            const { io, err } = captureIo();
            const code = await runGates([...REQUIRED_ARGS, "--bogus"], makeDeps(), io);
            expect(code).to.equal(2);
            expect(err()).to.contain("error:");
        });
    });

    suite("run orchestration", () => {
        test("writes the artifact and returns 0 when the run passes", async () => {
            const fileProvider = new RecordingFileProvider();
            const { io, out } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({ fileProvider, runValidation: async () => makeRecord(RunStatus.Passed) }),
                io,
            );
            expect(code).to.equal(0);
            expect(fileProvider.writes).to.have.length(1);
            expect(fileProvider.writes[0].path).to.equal(path.resolve("o.zip"));
            expect(out()).to.contain("Run passed");
        });

        test("still writes the artifact but returns 1 when a gate errors", async () => {
            const fileProvider = new RecordingFileProvider();
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    fileProvider,
                    runValidation: async () => makeRecord(RunStatus.Errored),
                }),
                io,
            );
            expect(code).to.equal(1);
            expect(fileProvider.writes).to.have.length(1);
        });

        test("returns 2 when the requested environment id is not found", async () => {
            const { io, err } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({ loadEnvironments: async () => makeFile(makeEnv("other")) }),
                io,
            );
            expect(code).to.equal(2);
            expect(err()).to.contain("error:");
        });

        test("returns 2 when the config fails to load", async () => {
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    loadEnvironments: async () => {
                        throw new EnvironmentsFileParseError("c.json", "broken");
                    },
                }),
                io,
            );
            expect(code).to.equal(2);
        });

        test("diffs against the baseline when --baseline is given", async () => {
            let requested: string | undefined;
            const { io, out } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS, "--baseline", "main.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async (p) => {
                        requested = p;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            expect(code).to.equal(0);
            expect(requested).to.equal(path.resolve("main.cdrun.zip"));
            expect(out()).to.contain("Diff vs baseline");
        });

        test("does not load a baseline when --baseline is omitted", async () => {
            let called = false;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    loadRunArtifact: async () => {
                        called = true;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            expect(called).to.be.false;
        });

        test("writes a Markdown report when --report-out is given", async () => {
            const fileProvider = new RecordingFileProvider();
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS, "--report-out", "report.md"],
                makeDeps({ fileProvider }),
                io,
            );
            expect(code).to.equal(0);
            const report = fileProvider.writes.find((w) => w.path === path.resolve("report.md"));
            expect(report, "report file written").to.not.be.undefined;
            expect(report!.data.toString("utf8")).to.contain("Cloud Deploy — schema validation");
        });
    });

    suite("stampSourceLabels", () => {
        const baseVersion: SourceVersion = { hash: "sha256:abc", algorithm: "sha256" };

        test("adds the commit id and ref to an existing source version", () => {
            const stamped = stampSourceLabels(
                makeRecord(RunStatus.Passed, baseVersion),
                "deadbeef",
                "refs/pull/7/merge",
            );
            expect(stamped.sourceVersion).to.deep.equal({
                hash: "sha256:abc",
                algorithm: "sha256",
                commitId: "deadbeef",
                ref: "refs/pull/7/merge",
            });
        });

        test("returns the record unchanged when no labels are given", () => {
            const record = makeRecord(RunStatus.Passed, baseVersion);
            expect(stampSourceLabels(record, undefined, undefined)).to.equal(record);
        });

        test("is a no-op when the run produced no source version", () => {
            const record = makeRecord(RunStatus.Passed);
            expect(stampSourceLabels(record, "deadbeef", undefined)).to.equal(record);
        });
    });

    suite("workload baseline", () => {
        const BASELINE_STEPS: readonly WorkloadObservedStep[] = [
            { id: "stepA", latencyMs: 5, planHash: "0xAAA", logicalReads: 100, cpuMs: 2 },
        ];

        function makeWorkloadRecord(hash: string): RunRecord {
            return {
                ...makeRecord(RunStatus.Passed, { hash, algorithm: "sha256" }),
                validations: [
                    {
                        validationId: "workload-playback",
                        displayName: "Workload Playback",
                        status: ValidationStatus.Passed,
                        startedAtMs: 1,
                        endedAtMs: 2,
                        payload: {
                            validationType: ValidationType.WorkloadPlayback,
                            findings: [],
                            summary: { steps: BASELINE_STEPS.length, regressions: 0 },
                            observedSteps: BASELINE_STEPS,
                        },
                    },
                ],
            };
        }

        test("passes a workload baseline lookup to the run when --baseline is given", async () => {
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS, "--baseline", "main.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async () => makeWorkloadRecord("sha256:base"),
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            expect(captured).to.be.a("function");
        });

        test("does not pass a workload baseline lookup when --baseline is omitted", async () => {
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            expect(captured).to.be.undefined;
        });

        test("the lookup returns the baseline's steps when the schema hash differs", async () => {
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS, "--baseline", "main.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async () => makeWorkloadRecord("sha256:base"),
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            const steps = await captured!("dev", "sha256:candidate");
            expect(steps).to.deep.equal(BASELINE_STEPS);
        });

        test("the lookup includes the simulation step recorded by the baseline run", async () => {
            const SIM_STEP: WorkloadObservedStep = {
                id: "workload",
                latencyMs: 12,
                throughputQps: 950,
            };
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS, "--baseline", "main.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async () => ({
                        ...makeRecord(RunStatus.Passed, {
                            hash: "sha256:base",
                            algorithm: "sha256",
                        }),
                        validations: [
                            {
                                validationId: "workload-simulation",
                                displayName: "Workload Simulation",
                                status: ValidationStatus.Passed,
                                startedAtMs: 1,
                                endedAtMs: 2,
                                payload: {
                                    validationType: ValidationType.WorkloadSimulation,
                                    findings: [],
                                    summary: { steps: 1, regressions: 0 },
                                    observedSteps: [SIM_STEP],
                                },
                            },
                        ],
                    }),
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            const steps = await captured!("dev", "sha256:candidate");
            expect(steps).to.deep.equal([SIM_STEP]);
        });

        test("the lookup returns undefined when the schema hash is unchanged", async () => {
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            await runGates(
                [...REQUIRED_ARGS, "--baseline", "main.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async () => makeWorkloadRecord("sha256:same"),
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            const steps = await captured!("dev", "sha256:same");
            expect(steps).to.be.undefined;
        });

        test("a baseline that fails to load does not break the run", async () => {
            let captured: WorkloadBaselineLookup | undefined;
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS, "--baseline", "missing.cdrun.zip"],
                makeDeps({
                    loadRunArtifact: async () => {
                        throw new Error("no such artifact");
                    },
                    runValidation: async (_e, _b, _w, lookup) => {
                        captured = lookup;
                        return makeRecord(RunStatus.Passed);
                    },
                }),
                io,
            );
            expect(code).to.equal(0);
            expect(captured).to.be.undefined;
        });
    });
});
